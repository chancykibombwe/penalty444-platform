/**
 * B6D3B PR-1 — cohort status route tests.
 * Node `node:test` via `tsx`. No network, no real Supabase; the admin client is
 * injected. This endpoint is convenience-only and never a security boundary.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createStatusHandler, type CohortAdminLike } from "../../../../lib/unity-cohort/handlers";
import { GET as liveGET } from "./route";
import * as routeModule from "./route";

const MEMBER = "member@example.com";
const SECRET = "s".repeat(32);

function env(over: Record<string, string | undefined> = {}) {
  return () => ({
    VERCEL_ENV: "preview",
    UNITY_COHORT_EMAILS: `${MEMBER},other@example.com`,
    UNITY_COHORT_SIGNING_SECRET: SECRET,
    UNITY_COHORT_TOKEN_VERSION: "1",
    ...over,
  });
}

function admin(user: { id?: string | null; email?: string | null } | null, error: unknown = null): CohortAdminLike {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error }),
      admin: { getUserById: async () => ({ data: { user }, error }) },
    },
  };
}

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/unity-cohort/status", { headers });
}

async function body(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

test("route exports nodejs runtime and force-dynamic", () => {
  assert.equal(routeModule.runtime, "nodejs");
  assert.equal(routeModule.dynamic, "force-dynamic");
  assert.equal(typeof liveGET, "function");
});

test("allowlisted authenticated user → inCohort true", async () => {
  const h = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u1", email: MEMBER }) });
  const res = await h.GET(req({ authorization: "Bearer valid" }));
  assert.equal(res.status, 200);
  assert.deepStrictEqual(await body(res), { inCohort: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("non-member → false", async () => {
  const h = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u2", email: "nope@example.com" }) });
  assert.deepStrictEqual(await body(await h.GET(req({ authorization: "Bearer valid" }))), { inCohort: false });
});

test("missing bearer → false", async () => {
  const h = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u1", email: MEMBER }) });
  assert.deepStrictEqual(await body(await h.GET(req())), { inCohort: false });
});

test("malformed / invalid bearer → false", async () => {
  const h1 = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u1", email: MEMBER }) });
  assert.deepStrictEqual(await body(await h1.GET(req({ authorization: "Basic x" }))), { inCohort: false });
  const h2 = createStatusHandler({ readEnv: env(), createAdmin: () => admin(null, { message: "bad jwt" }) });
  assert.deepStrictEqual(await body(await h2.GET(req({ authorization: "Bearer bad" }))), { inCohort: false });
});

test("admin client unavailable → false (never throws)", async () => {
  const h = createStatusHandler({
    readEnv: env(),
    createAdmin: () => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    },
  });
  const res = await h.GET(req({ authorization: "Bearer valid" }));
  assert.equal(res.status, 200);
  assert.deepStrictEqual(await body(res), { inCohort: false });
});

test("no admin client configured at all → false", async () => {
  const h = createStatusHandler({ readEnv: env() });
  assert.deepStrictEqual(await body(await h.GET(req({ authorization: "Bearer valid" }))), { inCohort: false });
});

test("production always returns false, even for a valid member", async () => {
  let adminCalled = false;
  const h = createStatusHandler({
    readEnv: env({ VERCEL_ENV: "production" }),
    createAdmin: () => {
      adminCalled = true;
      return admin({ id: "u1", email: MEMBER });
    },
  });
  assert.deepStrictEqual(await body(await h.GET(req({ authorization: "Bearer valid" }))), { inCohort: false });
  assert.equal(adminCalled, false, "production must not touch Supabase");
});

test("missing allowlist configuration → false", async () => {
  const h = createStatusHandler({
    readEnv: env({ UNITY_COHORT_EMAILS: undefined }),
    createAdmin: () => admin({ id: "u1", email: MEMBER }),
  });
  assert.deepStrictEqual(await body(await h.GET(req({ authorization: "Bearer valid" }))), { inCohort: false });
});

test("user without an email → false", async () => {
  const h = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u1", email: null }) });
  assert.deepStrictEqual(await body(await h.GET(req({ authorization: "Bearer valid" }))), { inCohort: false });
});

test("response body is exactly { inCohort } — no identity or configuration leak", async () => {
  const h = createStatusHandler({ readEnv: env(), createAdmin: () => admin({ id: "u1", email: MEMBER }) });
  const res = await h.GET(req({ authorization: "Bearer valid" }));
  const text = await res.text();
  assert.deepStrictEqual(Object.keys(JSON.parse(text)), ["inCohort"]);
  assert.equal(text.includes(MEMBER), false);
  assert.equal(text.includes("u1"), false);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("other@example.com"), false);
  assert.equal(res.headers.get("set-cookie"), null);
});
