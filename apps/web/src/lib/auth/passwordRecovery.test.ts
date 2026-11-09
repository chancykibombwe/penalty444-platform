/**
 * Focused password-recovery unit tests (no live Supabase / network).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERIC_RESET_EMAIL_SENT_MESSAGE,
  PASSWORD_RECOVERY_PATH,
  buildPasswordRecoveryRedirectTo,
  clearRecoveryFlag,
  hasAuthCallbackError,
  isPasswordRecoveryCallback,
  isValidEmail,
  parseAuthCallbackParams,
  readRecoveryFlag,
  shouldForcePasswordUpdate,
  validateNewPassword,
  writeRecoveryFlag,
} from "./passwordRecovery";

const HERE = dirname(fileURLToPath(import.meta.url));
const webSrc = join(HERE, "..", "..");

test("buildPasswordRecoveryRedirectTo uses same-origin reset path", () => {
  assert.equal(
    buildPasswordRecoveryRedirectTo("https://preview.example"),
    `https://preview.example${PASSWORD_RECOVERY_PATH}`
  );
  assert.equal(
    buildPasswordRecoveryRedirectTo("https://preview.example/"),
    `https://preview.example${PASSWORD_RECOVERY_PATH}`
  );
  assert.throws(() => buildPasswordRecoveryRedirectTo("   "));
  assert.equal(
    buildPasswordRecoveryRedirectTo("https://preview.example").includes(
      "penalty444-platform-at1y.vercel.app"
    ),
    false
  );
});

test("forgot-password confirmation message is generic", () => {
  assert.match(GENERIC_RESET_EMAIL_SENT_MESSAGE, /If an account exists/i);
  assert.equal(/not found|doesn't exist|no account/i.test(GENERIC_RESET_EMAIL_SENT_MESSAGE), false);
});

test("parseAuthCallbackParams detects hash recovery tokens", () => {
  const params = parseAuthCallbackParams(
    "",
    "#access_token=secret-token&type=recovery&expires_in=3600"
  );
  assert.equal(isPasswordRecoveryCallback(params), true);
  assert.equal(params.hasAccessToken, true);
  assert.equal(params.hasCode, false);
  // Never assert on token value beyond presence — keep secrets out of logs/tests output intent.
  assert.equal(params.type, "recovery");
});

test("parseAuthCallbackParams detects query recovery + PKCE code", () => {
  const params = parseAuthCallbackParams(
    "?code=abc&type=recovery",
    ""
  );
  assert.equal(isPasswordRecoveryCallback(params), true);
  assert.equal(params.hasCode, true);
});

test("parseAuthCallbackParams detects expired/error callbacks", () => {
  const params = parseAuthCallbackParams(
    "",
    "#error=access_denied&error_description=Email_link_is_invalid_or_has_expired"
  );
  assert.equal(hasAuthCallbackError(params), true);
  assert.equal(isPasswordRecoveryCallback(params), false);
});

test("shouldForcePasswordUpdate covers event, flag, and callback", () => {
  assert.equal(
    shouldForcePasswordUpdate({
      authEvent: "PASSWORD_RECOVERY",
      recoveryFlagSet: false,
      callbackIsRecovery: false,
    }),
    true
  );
  assert.equal(
    shouldForcePasswordUpdate({
      authEvent: "SIGNED_IN",
      recoveryFlagSet: true,
      callbackIsRecovery: false,
    }),
    true
  );
  assert.equal(
    shouldForcePasswordUpdate({
      authEvent: "SIGNED_IN",
      recoveryFlagSet: false,
      callbackIsRecovery: true,
    }),
    true
  );
  assert.equal(
    shouldForcePasswordUpdate({
      authEvent: "SIGNED_IN",
      recoveryFlagSet: false,
      callbackIsRecovery: false,
    }),
    false
  );
});

test("validateNewPassword covers mismatch and short passwords", () => {
  assert.equal(validateNewPassword("abcdef", "abcdef"), null);
  assert.match(String(validateNewPassword("abc", "abc")), /at least 6/i);
  assert.match(
    String(validateNewPassword("abcdef", "abcdefg")),
    /do not match/i
  );
  assert.match(String(validateNewPassword("", "")), /Enter and confirm/i);
});

test("isValidEmail basic checks", () => {
  assert.equal(isValidEmail("player@example.com"), true);
  assert.equal(isValidEmail("bad"), false);
  assert.equal(isValidEmail(" "), false);
});

test("recovery session flag round-trip", () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  assert.equal(readRecoveryFlag(fakeStorage), false);
  writeRecoveryFlag(fakeStorage);
  assert.equal(readRecoveryFlag(fakeStorage), true);
  clearRecoveryFlag(fakeStorage);
  assert.equal(readRecoveryFlag(fakeStorage), false);
});

test("login page keeps password sign-in and exposes forgot-password link", () => {
  const login = readFileSync(
    join(webSrc, "app", "auth", "login", "page.tsx"),
    "utf8"
  );
  assert.ok(login.includes("signInWithPassword"));
  assert.ok(login.includes('href="/auth/forgot-password"'));
  assert.ok(login.includes("Forgot password?"));
  assert.ok(login.includes('router.push("/lobby")'));
});

test("forgot-password page uses resetPasswordForEmail and generic copy", () => {
  const page = readFileSync(
    join(webSrc, "app", "auth", "forgot-password", "page.tsx"),
    "utf8"
  );
  assert.ok(page.includes("resetPasswordForEmail"));
  assert.ok(page.includes("buildPasswordRecoveryRedirectTo"));
  assert.ok(page.includes("GENERIC_RESET_EMAIL_SENT_MESSAGE"));
  assert.equal(page.includes("penalty444-platform-at1y.vercel.app"), false);
  assert.equal(/console\.log\(.*(password|token)/i.test(page), false);
});

test("reset-password page updates password and avoids premature lobby push", () => {
  const page = readFileSync(
    join(webSrc, "app", "auth", "reset-password", "page.tsx"),
    "utf8"
  );
  assert.ok(page.includes("updateUser({ password })"));
  assert.ok(page.includes("PASSWORD_RECOVERY"));
  assert.ok(page.includes("signOut"));
  assert.equal(page.includes('router.push("/lobby")'), false);
  assert.equal(page.includes('href="/lobby"'), false);
  assert.ok(page.includes('href="/auth/login"'));
  assert.equal(/console\.log\(.*(password|token|access_token)/i.test(page), false);
});

test("PasswordRecoveryRedirect prevents homepage recovery trap", () => {
  const source = readFileSync(
    join(webSrc, "components", "auth", "PasswordRecoveryRedirect.tsx"),
    "utf8"
  );
  assert.ok(source.includes("PASSWORD_RECOVERY"));
  assert.ok(source.includes("router.replace(PASSWORD_RECOVERY_PATH)"));
  assert.ok(source.includes("isPasswordRecoveryCallback"));
});

test("app shell mounts PasswordRecoveryRedirect on normal routes", () => {
  const shell = readFileSync(
    join(webSrc, "components", "layout", "RouteAwareAppShell.tsx"),
    "utf8"
  );
  assert.ok(shell.includes("PasswordRecoveryRedirect"));
  assert.ok(shell.includes("<PasswordRecoveryRedirect />"));
});
