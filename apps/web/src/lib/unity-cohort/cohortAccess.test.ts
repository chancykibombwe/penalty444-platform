/**
 * B6D3B PR-1 — cohort configuration / gating tests.
 * Node `node:test` via `tsx`. Pure; no network, no Supabase.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractBearerToken,
  isEmailInCohort,
  isProductionDenied,
  opaqueNotFound,
  parseCohortEmails,
  resolveSigningSecret,
  resolveTokenVersion,
  sanitizedUpstreamFailure,
  validateArtifactOrigin,
} from "./cohortAccess";

// ── production gate ───────────────────────────────────────────────────────────

test("production is denied; preview/development/absent are not", () => {
  assert.equal(isProductionDenied({ VERCEL_ENV: "production" }), true);
  assert.equal(isProductionDenied({ VERCEL_ENV: "preview" }), false);
  assert.equal(isProductionDenied({ VERCEL_ENV: "development" }), false);
  assert.equal(isProductionDenied({}), false);
});

// ── allowlist ─────────────────────────────────────────────────────────────────

test("allowlist parsing trims, lower-cases and drops empties", () => {
  assert.deepStrictEqual(parseCohortEmails(" A@x.com , b@Y.com ,, "), ["a@x.com", "b@y.com"]);
  assert.deepStrictEqual(parseCohortEmails(undefined), []);
  assert.deepStrictEqual(parseCohortEmails(""), []);
  assert.deepStrictEqual(parseCohortEmails("   "), []);
});

test("membership is case-insensitive; an empty allowlist denies everyone", () => {
  const list = parseCohortEmails("a@x.com,b@y.com");
  assert.equal(isEmailInCohort("A@X.com", list), true);
  assert.equal(isEmailInCohort(" a@x.com ", list), true);
  assert.equal(isEmailInCohort("c@z.com", list), false);
  assert.equal(isEmailInCohort("a@x.com", []), false);
  assert.equal(isEmailInCohort(undefined, list), false);
  assert.equal(isEmailInCohort("", list), false);
  assert.equal(isEmailInCohort(null, list), false);
});

// ── signing secret / token version ────────────────────────────────────────────

test("signing secret must be present and >= 32 chars", () => {
  assert.equal(resolveSigningSecret({}), null);
  assert.equal(resolveSigningSecret({ UNITY_COHORT_SIGNING_SECRET: "short" }), null);
  const strong = "k".repeat(32);
  assert.equal(resolveSigningSecret({ UNITY_COHORT_SIGNING_SECRET: strong }), strong);
});

test("token version must be an explicit non-negative integer, else fails closed", () => {
  assert.equal(resolveTokenVersion({ UNITY_COHORT_TOKEN_VERSION: "0" }), 0);
  assert.equal(resolveTokenVersion({ UNITY_COHORT_TOKEN_VERSION: " 7 " }), 7);
  assert.equal(resolveTokenVersion({}), null);
  for (const bad of ["", "  ", "-1", "1.5", "1e3", "abc", "0x2", "+2"]) {
    assert.equal(resolveTokenVersion({ UNITY_COHORT_TOKEN_VERSION: bad }), null, `must reject ${JSON.stringify(bad)}`);
  }
});

// ── artifact origin ───────────────────────────────────────────────────────────

test("accepts a bare immutable-style .vercel.app deployment origin", () => {
  const ok = "https://proj-abc123hash-team.vercel.app";
  assert.equal(validateArtifactOrigin(ok), ok);
  assert.equal(validateArtifactOrigin("https://proj-abc123hash-team.vercel.app/"), ok);
});

test("rejects a bare project/production alias (no deployment segment)", () => {
  assert.equal(validateArtifactOrigin("https://someproject.vercel.app"), null);
  assert.equal(validateArtifactOrigin("https://someproject.vercel.app/"), null);
});

test("rejects non-https, credentials, query, fragment and any non-root path", () => {
  for (const bad of [
    "http://proj-hash-team.vercel.app",
    "https://user:pw@proj-hash-team.vercel.app",
    "https://proj-hash-team.vercel.app?x=1",
    "https://proj-hash-team.vercel.app#f",
    "https://proj-hash-team.vercel.app/releases/b6b-local-fb840878-d",
    "https://proj-hash-team.vercel.app/anything",
  ]) {
    assert.equal(validateArtifactOrigin(bad), null, `must reject ${bad}`);
  }
});

test("rejects non-vercel hosts, nested subdomains, garbage and empties", () => {
  for (const bad of [
    "https://evil.example.com",
    "https://proj-hash.vercel.app.evil.com",
    "https://a.b-c.vercel.app",
    "not-a-url",
    "",
    "   ",
    undefined,
    null,
  ]) {
    assert.equal(validateArtifactOrigin(bad as string | undefined | null), null, `must reject ${String(bad)}`);
  }
});

// ── bearer ────────────────────────────────────────────────────────────────────

test("extracts only a canonical, whitespace-free Bearer token", () => {
  assert.equal(extractBearerToken("Bearer abc.def"), "abc.def");
  for (const bad of ["bearer abc", "Bearer", "Bearer ", "Basic abc", "Bearer a b", "Bearer\tabc", null, undefined, ""]) {
    assert.equal(extractBearerToken(bad as string | null | undefined), null, `must reject ${JSON.stringify(bad)}`);
  }
});

// ── denial responses ──────────────────────────────────────────────────────────

test("opaque 404 is byte-identical, plain text and never cacheable", async () => {
  const a = opaqueNotFound();
  const b = opaqueNotFound();
  assert.equal(a.status, 404);
  assert.equal(await a.text(), "Not Found");
  assert.equal(await b.text(), "Not Found");
  assert.equal(a.headers.get("cache-control"), "no-store");
  assert.equal(a.headers.get("content-type"), "text/plain; charset=utf-8");
  // No identity, config or protected-delivery header leaks through a denial.
  assert.equal(a.headers.get("set-cookie"), null);
  assert.equal(a.headers.get("etag"), null);
  assert.equal(a.headers.get("content-encoding"), null);
});

test("sanitized upstream failure carries no body and no cacheable directive", async () => {
  const r = sanitizedUpstreamFailure(504);
  assert.equal(r.status, 504);
  assert.equal(await r.text(), "");
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("vary"), "Cookie");
  assert.equal(/public|s-maxage|immutable/i.test(r.headers.get("cache-control") ?? ""), false);
});
