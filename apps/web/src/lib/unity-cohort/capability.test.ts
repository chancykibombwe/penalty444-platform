/**
 * B6D3B PR-1 — capability token + cookie tests.
 * Node `node:test` via `tsx`. Pure; no network, no Supabase, no Unity.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildClearedCohortCookie,
  buildCohortCookie,
  COHORT_COOKIE_NAME,
  COHORT_COOKIE_PATH,
  constantTimeEqual,
  isUsableSigningSecret,
  MAX_CAPABILITY_TTL_SECONDS,
  MIN_SIGNING_SECRET_LENGTH,
  readCookieValue,
  signCapability,
  verifyCapability,
} from "./capability";

const SECRET = "s".repeat(MIN_SIGNING_SECRET_LENGTH);
const OTHER_SECRET = "x".repeat(MIN_SIGNING_SECRET_LENGTH);
const SUB = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000;
const VER = 3;

function mint(over: Partial<Parameters<typeof signCapability>[0]> = {}) {
  return signCapability({ sub: SUB, nowSeconds: NOW, ttlSeconds: 600, ver: VER, secret: SECRET, ...over });
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function forge(payloadJson: string, secret = SECRET): string {
  const seg = b64url(payloadJson);
  const sig = createHmac("sha256", secret)
    .update(seg, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${seg}.${sig}`;
}

// ── sign / verify happy path ──────────────────────────────────────────────────

test("signs and verifies a valid capability", () => {
  const signed = mint();
  assert.ok(signed);
  assert.deepStrictEqual(signed.payload, { sub: SUB, iat: NOW, exp: NOW + 600, ver: VER });
  const verified = verifyCapability(signed.token, { secret: SECRET, ver: VER, nowSeconds: NOW + 1 });
  assert.deepStrictEqual(verified, signed.payload);
});

test("token payload contains exactly sub/iat/exp/ver and no email", () => {
  const signed = mint();
  assert.ok(signed);
  const payloadSeg = signed.token.split(".")[0];
  const json = JSON.parse(Buffer.from(payloadSeg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.deepStrictEqual(Object.keys(json).sort(), ["exp", "iat", "sub", "ver"]);
  assert.ok(!JSON.stringify(json).includes("@"));
});

test("token is opaque: no identity beyond the stable sub", () => {
  const signed = mint();
  assert.ok(signed);
  assert.ok(!signed.token.includes("@"));
  assert.equal(signed.token.split(".").length, 2);
});

// ── rejection paths ───────────────────────────────────────────────────────────

test("tampered signature rejected", () => {
  const signed = mint();
  assert.ok(signed);
  const [seg, sig] = signed.token.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(verifyCapability(`${seg}.${flipped}`, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("tampered payload rejected (signature no longer matches)", () => {
  const signed = mint();
  assert.ok(signed);
  const sig = signed.token.split(".")[1];
  const evil = b64url(JSON.stringify({ sub: "attacker", iat: NOW, exp: NOW + 600, ver: VER }));
  assert.equal(verifyCapability(`${evil}.${sig}`, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("signature from a different secret rejected", () => {
  const token = forge(JSON.stringify({ sub: SUB, iat: NOW, exp: NOW + 600, ver: VER }), OTHER_SECRET);
  assert.equal(verifyCapability(token, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("secret rotation immediately invalidates existing tokens", () => {
  const signed = mint();
  assert.ok(signed);
  assert.ok(verifyCapability(signed.token, { secret: SECRET, ver: VER, nowSeconds: NOW }));
  assert.equal(verifyCapability(signed.token, { secret: OTHER_SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("token-version bump immediately invalidates existing tokens", () => {
  const signed = mint();
  assert.ok(signed);
  assert.equal(verifyCapability(signed.token, { secret: SECRET, ver: VER + 1, nowSeconds: NOW }), null);
});

test("malformed Base64URL rejected (standard-base64 alphabet, padding, junk)", () => {
  for (const bad of ["a+b.c", "ab=.cd", "ab.cd=", "!!.??", "", ".", "a.", ".b", "a.b.c"]) {
    assert.equal(verifyCapability(bad, { secret: SECRET, ver: VER, nowSeconds: NOW }), null, `must reject ${JSON.stringify(bad)}`);
  }
});

test("malformed JSON payload rejected", () => {
  assert.equal(verifyCapability(forge("{not json"), { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("missing payload field rejected", () => {
  assert.equal(
    verifyCapability(forge(JSON.stringify({ sub: SUB, iat: NOW, exp: NOW + 600 })), { secret: SECRET, ver: VER, nowSeconds: NOW }),
    null,
  );
});

test("extra payload field rejected", () => {
  assert.equal(
    verifyCapability(forge(JSON.stringify({ sub: SUB, iat: NOW, exp: NOW + 600, ver: VER, email: "a@b.c" })), {
      secret: SECRET,
      ver: VER,
      nowSeconds: NOW,
    }),
    null,
  );
});

test("expired token rejected (exp == now and exp < now)", () => {
  const signed = mint({ ttlSeconds: 60 });
  assert.ok(signed);
  assert.equal(verifyCapability(signed.token, { secret: SECRET, ver: VER, nowSeconds: NOW + 60 }), null);
  assert.equal(verifyCapability(signed.token, { secret: SECRET, ver: VER, nowSeconds: NOW + 61 }), null);
  assert.ok(verifyCapability(signed.token, { secret: SECRET, ver: VER, nowSeconds: NOW + 59 }));
});

test("future-dated (iat > now) token rejected", () => {
  const token = forge(JSON.stringify({ sub: SUB, iat: NOW + 100, exp: NOW + 300, ver: VER }));
  assert.equal(verifyCapability(token, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("invalid timestamp types/values rejected", () => {
  for (const p of [
    { sub: SUB, iat: -1, exp: NOW + 600, ver: VER },
    { sub: SUB, iat: 1.5, exp: NOW + 600, ver: VER },
    { sub: SUB, iat: NOW, exp: NOW, ver: VER },
    { sub: SUB, iat: NOW, exp: NOW - 1, ver: VER },
    { sub: SUB, iat: "x", exp: NOW + 600, ver: VER },
    { sub: SUB, iat: NOW, exp: NOW + 600, ver: -1 },
    { sub: "", iat: NOW, exp: NOW + 600, ver: VER },
  ]) {
    assert.equal(
      verifyCapability(forge(JSON.stringify(p)), { secret: SECRET, ver: VER, nowSeconds: NOW }),
      null,
      `must reject ${JSON.stringify(p)}`,
    );
  }
});

test("TTL greater than 600 seconds is rejected on sign AND on verify", () => {
  assert.equal(mint({ ttlSeconds: MAX_CAPABILITY_TTL_SECONDS + 1 }), null);
  // A forged long-lived token must also be rejected by the verifier's TTL ceiling.
  const token = forge(JSON.stringify({ sub: SUB, iat: NOW, exp: NOW + 3600, ver: VER }));
  assert.equal(verifyCapability(token, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
});

test("non-positive TTL rejected", () => {
  assert.equal(mint({ ttlSeconds: 0 }), null);
  assert.equal(mint({ ttlSeconds: -5 }), null);
});

// ── fail-closed configuration ─────────────────────────────────────────────────

test("missing or weak signing secret fails closed on sign and verify", () => {
  assert.equal(isUsableSigningSecret(undefined), false);
  assert.equal(isUsableSigningSecret("short"), false);
  assert.equal(isUsableSigningSecret(SECRET), true);
  assert.equal(mint({ secret: "" }), null);
  assert.equal(mint({ secret: "tooshort" }), null);
  const signed = mint();
  assert.ok(signed);
  assert.equal(verifyCapability(signed.token, { secret: "tooshort", ver: VER, nowSeconds: NOW }), null);
});

test("hostile inputs never throw", () => {
  for (const v of [null, undefined, 42, {}, [], true]) {
    assert.doesNotThrow(() => verifyCapability(v, { secret: SECRET, ver: VER, nowSeconds: NOW }));
    assert.equal(verifyCapability(v, { secret: SECRET, ver: VER, nowSeconds: NOW }), null);
  }
});

// ── constant-time comparison ──────────────────────────────────────────────────

test("constantTimeEqual matches only identical strings, incl. unequal lengths", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.doesNotThrow(() => constantTimeEqual("a", "bbbbbbbbbbbbbbbb"));
});

// ── cookie ────────────────────────────────────────────────────────────────────

test("cookie has the exact required attributes and no Domain", () => {
  const signed = mint();
  assert.ok(signed);
  const cookie = buildCohortCookie(signed.token, signed.payload, NOW);
  assert.ok(cookie);
  assert.ok(cookie.startsWith(`${COHORT_COOKIE_NAME}=${signed.token};`));
  assert.ok(cookie.includes(`Path=${COHORT_COOKIE_PATH}`));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Max-Age=600"));
  assert.equal(/domain=/i.test(cookie), false, "must be host-only (no Domain)");
});

test("cookie Max-Age aligns with exp and never exceeds the ceiling", () => {
  const signed = mint({ ttlSeconds: 120 });
  assert.ok(signed);
  const cookie = buildCohortCookie(signed.token, signed.payload, NOW);
  assert.ok(cookie?.includes("Max-Age=120"));
  // Elapsed time shrinks Max-Age to the remaining lifetime.
  const later = buildCohortCookie(signed.token, signed.payload, NOW + 100);
  assert.ok(later?.includes("Max-Age=20"));
  // An already-expired payload yields no cookie.
  assert.equal(buildCohortCookie(signed.token, signed.payload, NOW + 120), null);
});

test("cleared cookie targets the same name and path with Max-Age=0", () => {
  const cleared = buildClearedCohortCookie();
  assert.ok(cleared.startsWith(`${COHORT_COOKIE_NAME}=;`));
  assert.ok(cleared.includes(`Path=${COHORT_COOKIE_PATH}`));
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(cleared.includes("HttpOnly"));
  assert.equal(/domain=/i.test(cleared), false);
});

test("readCookieValue extracts only the exact cookie name", () => {
  assert.equal(readCookieValue(`a=1; ${COHORT_COOKIE_NAME}=tok; b=2`, COHORT_COOKIE_NAME), "tok");
  assert.equal(readCookieValue(`${COHORT_COOKIE_NAME}_other=tok`, COHORT_COOKIE_NAME), null);
  assert.equal(readCookieValue("", COHORT_COOKIE_NAME), null);
  assert.equal(readCookieValue(null, COHORT_COOKIE_NAME), null);
  assert.equal(readCookieValue(`${COHORT_COOKIE_NAME}=`, COHORT_COOKIE_NAME), null);
});
