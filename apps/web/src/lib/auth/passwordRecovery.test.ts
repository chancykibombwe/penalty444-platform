/**
 * Password-recovery unit + behavioral bootstrap tests (mocked auth, no network).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERIC_RESET_EMAIL_SENT_MESSAGE,
  INVALID_RECOVERY_LINK_MESSAGE,
  PASSWORD_RECOVERY_PATH,
  RECOVERY_EMPTY_VISIT_TIMEOUT_MS,
  RECOVERY_EXCHANGE_TIMEOUT_MS,
  buildPasswordRecoveryRedirectTo,
  clearRecoveryFlag,
  hasAuthCallbackError,
  initialRecoveryGateState,
  isPasswordRecoveryCallback,
  isPkceRecoveryCandidate,
  parseAuthCallbackParams,
  readRecoveryFlag,
  reduceRecoveryGate,
  shouldClearStaleRecoveryFlag,
  shouldForcePasswordUpdate,
  startRecoveryBootstrap,
  validateNewPassword,
  writeRecoveryFlag,
  type RecoveryGateState,
} from "./passwordRecovery";

const HERE = dirname(fileURLToPath(import.meta.url));
const webSrc = join(HERE, "..", "..");

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

type AuthListener = (
  event: string,
  session: { user?: { id?: string } } | null
) => void;

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
    flush(ms: number) {
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.ms <= ms) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending() {
      return [...timers.values()].map((t) => t.ms);
    },
  };
}

test("buildPasswordRecoveryRedirectTo uses same-origin reset path", () => {
  assert.equal(
    buildPasswordRecoveryRedirectTo("https://preview.example"),
    `https://preview.example${PASSWORD_RECOVERY_PATH}`
  );
  assert.equal(
    buildPasswordRecoveryRedirectTo("https://preview.example").includes(
      "penalty444-platform-at1y.vercel.app"
    ),
    false
  );
});

test("forgot-password confirmation message is generic", () => {
  assert.match(GENERIC_RESET_EMAIL_SENT_MESSAGE, /If an account exists/i);
});

test("hash recovery callback detection", () => {
  const params = parseAuthCallbackParams(
    "",
    "#access_token=secret-token&type=recovery&expires_in=3600"
  );
  assert.equal(isPasswordRecoveryCallback(params), true);
  assert.equal(params.hasAccessToken, true);
});

test("PKCE callback without type=recovery is recovery candidate on reset path only", () => {
  const params = parseAuthCallbackParams("?code=pkce-code-value", "");
  assert.equal(isPasswordRecoveryCallback(params), false);
  assert.equal(isPkceRecoveryCandidate(params, true), true);
  assert.equal(isPkceRecoveryCandidate(params, false), false);
});

test("expired callback errors are detected", () => {
  const params = parseAuthCallbackParams(
    "",
    "#error=access_denied&error_description=email_link_is_invalid_or_has_expired"
  );
  assert.equal(hasAuthCallbackError(params), true);
});

test("validateNewPassword covers mismatch and short passwords", () => {
  assert.equal(validateNewPassword("abcdef", "abcdef"), null);
  assert.match(String(validateNewPassword("abc", "abc")), /at least 6/i);
  assert.match(
    String(validateNewPassword("abcdef", "abcdefg")),
    /do not match/i
  );
});

test("reduceRecoveryGate ignores actions after terminal states", () => {
  let state = initialRecoveryGateState();
  state = reduceRecoveryGate(state, { type: "PASSWORD_RECOVERY_EVENT" });
  assert.equal(state.status, "ready");
  state = reduceRecoveryGate(state, { type: "EXCHANGE_TIMEOUT" });
  assert.equal(state.status, "ready");
});

test("successful PASSWORD_RECOVERY event opens the form", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];
  const auth = { cb: null as AuthListener | null };

  const boot = startRecoveryBootstrap({
    getSearch: () => "",
    getHash: () => "#access_token=tok&type=recovery",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: (cb) => {
      auth.cb = cb;
      return { unsubscribe: () => undefined };
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  assert.equal(readRecoveryFlag(storage), true);
  // Still checking — exchange in flight; short 1500ms must NOT invalidate.
  timers.flush(1500);
  assert.equal(states.at(-1)?.status, "checking");

  assert.ok(auth.cb);
  auth.cb("PASSWORD_RECOVERY", { user: { id: "user-1" } });
  assert.equal(states.at(-1)?.status, "ready");
  boot.stop();
});

test("PASSWORD_RECOVERY arriving after 1500ms still succeeds", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];
  const auth = { cb: null as AuthListener | null };

  const boot = startRecoveryBootstrap({
    getSearch: () => "?code=slow-pkce",
    getHash: () => "",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: (cb) => {
      auth.cb = cb;
      return { unsubscribe: () => undefined };
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  timers.flush(1500);
  assert.equal(states.at(-1)?.status, "checking");
  assert.ok(auth.cb);
  auth.cb("PASSWORD_RECOVERY", { user: { id: "user-1" } });
  assert.equal(states.at(-1)?.status, "ready");
  boot.stop();
});

test("PKCE code without type=recovery waits then becomes ready on recovery event", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];
  const auth = { cb: null as AuthListener | null };

  startRecoveryBootstrap({
    getSearch: () => "?code=abc123",
    getHash: () => "",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: (cb) => {
      auth.cb = cb;
      return { unsubscribe: () => undefined };
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  assert.equal(readRecoveryFlag(storage), true);
  assert.ok(timers.pending().includes(RECOVERY_EXCHANGE_TIMEOUT_MS));
  assert.ok(auth.cb);
  auth.cb("PASSWORD_RECOVERY", { user: { id: "u" } });
  assert.equal(states.at(-1)?.status, "ready");
});

test("explicit expired token callback is invalid immediately", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];

  startRecoveryBootstrap({
    getSearch: () => "",
    getHash: () => "#error=access_denied&error_description=expired",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  assert.equal(states.at(-1)?.status, "invalid");
  assert.equal(states.at(-1)?.message, INVALID_RECOVERY_LINK_MESSAGE);
  assert.equal(timers.pending().length, 0);
});

test("normal login context does not force password update", () => {
  assert.equal(
    shouldForcePasswordUpdate({
      authEvent: "SIGNED_IN",
      recoveryFlagSet: false,
      callbackIsRecovery: false,
      pkceRecoveryCandidate: false,
    }),
    false
  );
});

test("abandoned recovery flag clears on ordinary SIGNED_IN off reset path", () => {
  assert.equal(
    shouldClearStaleRecoveryFlag({
      authEvent: "SIGNED_IN",
      onResetPasswordPath: false,
      callbackIsRecovery: false,
      pkceRecoveryCandidate: false,
    }),
    true
  );
  assert.equal(
    shouldClearStaleRecoveryFlag({
      authEvent: "PASSWORD_RECOVERY",
      onResetPasswordPath: false,
      callbackIsRecovery: false,
      pkceRecoveryCandidate: false,
    }),
    false
  );
  // Preserve marker during legitimate recovery / refresh on the reset page.
  assert.equal(
    shouldClearStaleRecoveryFlag({
      authEvent: "TOKEN_REFRESHED",
      onResetPasswordPath: true,
      callbackIsRecovery: false,
      pkceRecoveryCandidate: false,
    }),
    false
  );
  assert.equal(
    shouldClearStaleRecoveryFlag({
      authEvent: "INITIAL_SESSION",
      onResetPasswordPath: true,
      callbackIsRecovery: false,
      pkceRecoveryCandidate: false,
    }),
    false
  );
});

test("abandoned recovery then ordinary sign-in clears flag via bootstrap listener", async () => {
  const storage = memoryStorage();
  writeRecoveryFlag(storage);
  const timers = createFakeTimers();
  const auth = { cb: null as AuthListener | null };
  const states: RecoveryGateState[] = [];

  const boot = startRecoveryBootstrap({
    getSearch: () => "",
    getHash: () => "",
    onResetPasswordPath: false,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: (cb) => {
      auth.cb = cb;
      return { unsubscribe: () => undefined };
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  assert.equal(readRecoveryFlag(storage), true);
  assert.ok(auth.cb);
  auth.cb("SIGNED_IN", { user: { id: "normal" } });
  assert.equal(readRecoveryFlag(storage), false);
  // Must not open the password-update form for an ordinary off-path sign-in.
  assert.equal(states.some((s) => s.status === "ready"), false);
  boot.stop();
});

test("empty visit timeout invalidates only without recovery markers", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];

  startRecoveryBootstrap({
    getSearch: () => "",
    getHash: () => "",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  assert.ok(timers.pending().includes(RECOVERY_EMPTY_VISIT_TIMEOUT_MS));
  timers.flush(RECOVERY_EMPTY_VISIT_TIMEOUT_MS);
  assert.equal(states.at(-1)?.status, "invalid");
});

test("exchange timeout does not fire at 1500ms for pending PKCE", async () => {
  const storage = memoryStorage();
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];

  startRecoveryBootstrap({
    getSearch: () => "?code=pending",
    getHash: () => "",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: null }),
    onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  timers.flush(1500);
  assert.equal(states.filter((s) => s.status === "invalid").length, 0);
  timers.flush(RECOVERY_EXCHANGE_TIMEOUT_MS);
  assert.equal(states.at(-1)?.status, "invalid");
});

test("password mismatch validation is enforced", () => {
  assert.equal(validateNewPassword("secret1", "secret2"), "Passwords do not match.");
});

test("successful update path signs out and avoids lobby redirects in page source", () => {
  const page = readFileSync(
    join(webSrc, "app", "auth", "reset-password", "page.tsx"),
    "utf8"
  );
  assert.ok(page.includes("startRecoveryBootstrap"));
  assert.ok(page.includes("updateUser({ password })"));
  assert.ok(page.includes("signOut"));
  assert.equal(page.includes('router.push("/lobby")'), false);
  assert.equal(page.includes('href="/lobby"'), false);
  assert.equal(page.includes("1500"), false);
  assert.ok(page.includes('href="/auth/login"'));
});

test("login regression: signInWithPassword and forgot-password link remain", () => {
  const login = readFileSync(
    join(webSrc, "app", "auth", "login", "page.tsx"),
    "utf8"
  );
  assert.ok(login.includes("signInWithPassword"));
  assert.ok(login.includes('href="/auth/forgot-password"'));
});

test("PasswordRecoveryRedirect clears stale markers and routes recovery", () => {
  const source = readFileSync(
    join(webSrc, "components", "auth", "PasswordRecoveryRedirect.tsx"),
    "utf8"
  );
  assert.ok(source.includes("PASSWORD_RECOVERY"));
  assert.ok(source.includes("shouldClearStaleRecoveryFlag"));
  assert.ok(source.includes("isPkceRecoveryCandidate"));
  assert.ok(source.includes("router.replace(PASSWORD_RECOVERY_PATH)"));
});

test("session already present with recovery flag becomes ready without waiting", async () => {
  const storage = memoryStorage();
  writeRecoveryFlag(storage);
  const timers = createFakeTimers();
  const states: RecoveryGateState[] = [];

  startRecoveryBootstrap({
    getSearch: () => "",
    getHash: () => "",
    onResetPasswordPath: true,
    storage,
    getSession: async () => ({ session: { user: { id: "u1" } } }),
    onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onState: (s) => states.push({ ...s }),
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(states.at(-1)?.status, "ready");
  assert.equal(timers.pending().length, 0);
});
