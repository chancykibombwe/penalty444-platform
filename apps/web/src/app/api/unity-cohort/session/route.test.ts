/**
 * B6D3B PR-1 — cohort session mint route tests.
 * Node `node:test` via `tsx`. No network, no real Supabase; deps are injected.
 *
 * Proves: production denial happens BEFORE any dependency; every failure is one
 * byte-identical opaque 404 (never 401/403); the minted cookie has exactly the
 * required attributes; and no token or identity reaches the response body.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createSessionHandler, type CohortAdminLike } from "../../../../lib/unity-cohort/handlers";
import { verifyCapability, COHORT_COOKIE_NAME } from "../../../../lib/unity-cohort/capability";
import { POST as livePOST } from "./route";
import * as routeModule from "./route";

const MEMBER = "member@example.com";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000;

function env(over: Record<string, string | undefined> = {}) {
  return () => ({
    VERCEL_ENV: "preview",
    UNITY_COHORT_EMAILS: MEMBER,
    UNITY_COHORT_SIGNING_SECRET: SECRET,
    UNITY_COHORT_TOKEN_VERSION: "4",
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

const memberAdmin = () => admin({ id: USER_ID, email: MEMBER });

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/unity-cohort/session", { method: "POST", headers });
}

function handler(over: Partial<Parameters<typeof createSessionHandler>[0]> = {}) {
  return createSessionHandler({
    readEnv: env(),
    createAdmin: memberAdmin,
    nowSeconds: () => NOW,
    ...over,
  });
}

async function assertOpaque404(res: Response): Promise<void> {
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not Found");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null, "a denial must never set a cookie");
}

test("route exports nodejs runtime and force-dynamic", () => {
  assert.equal(routeModule.runtime, "nodejs");
  assert.equal(routeModule.dynamic, "force-dynamic");
  assert.equal(typeof livePOST, "function");
});

// ── production denial ordering ─────────────────────────────────────────────────

test("production returns opaque 404 before touching Supabase or signing", async () => {
  let adminCalled = false;
  const h = handler({
    readEnv: env({ VERCEL_ENV: "production" }),
    createAdmin: () => {
      adminCalled = true;
      return memberAdmin();
    },
  });
  await assertOpaque404(await h.POST(req({ authorization: "Bearer valid" })));
  assert.equal(adminCalled, false, "production must not create the admin client");
});

// ── denial paths ──────────────────────────────────────────────────────────────

test("missing / malformed / invalid bearer → opaque 404", async () => {
  await assertOpaque404(await handler().POST(req()));
  await assertOpaque404(await handler().POST(req({ authorization: "Basic abc" })));
  await assertOpaque404(await handler().POST(req({ authorization: "Bearer " })));
  const bad = handler({ createAdmin: () => admin(null, { message: "invalid jwt" }) });
  await assertOpaque404(await bad.POST(req({ authorization: "Bearer bad" })));
});

test("admin client unavailable → opaque 404", async () => {
  const h = handler({
    createAdmin: () => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    },
  });
  await assertOpaque404(await h.POST(req({ authorization: "Bearer valid" })));
});

test("user without an email → opaque 404", async () => {
  const h = handler({ createAdmin: () => admin({ id: USER_ID, email: null }) });
  await assertOpaque404(await h.POST(req({ authorization: "Bearer valid" })));
});

test("user without an id → opaque 404", async () => {
  const h = handler({ createAdmin: () => admin({ id: null, email: MEMBER }) });
  await assertOpaque404(await h.POST(req({ authorization: "Bearer valid" })));
});

test("non-member cannot mint (revocation by allowlist removal)", async () => {
  const h = handler({ createAdmin: () => admin({ id: USER_ID, email: "removed@example.com" }) });
  await assertOpaque404(await h.POST(req({ authorization: "Bearer valid" })));
});

test("empty / missing allowlist denies everyone", async () => {
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_EMAILS: "" }) }).POST(req({ authorization: "Bearer valid" })),
  );
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_EMAILS: undefined }) }).POST(req({ authorization: "Bearer valid" })),
  );
});

test("missing or weak signing secret fails closed", async () => {
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_SIGNING_SECRET: undefined }) }).POST(
      req({ authorization: "Bearer valid" }),
    ),
  );
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_SIGNING_SECRET: "short" }) }).POST(
      req({ authorization: "Bearer valid" }),
    ),
  );
});

test("missing or invalid token version fails closed", async () => {
  for (const v of [undefined, "", "abc", "-1", "1.5"]) {
    await assertOpaque404(
      await handler({ readEnv: env({ UNITY_COHORT_TOKEN_VERSION: v }) }).POST(req({ authorization: "Bearer valid" })),
    );
  }
});

test("every denial is byte-identical", async () => {
  const responses = [
    await handler().POST(req()),
    await handler().POST(req({ authorization: "Basic x" })),
    await handler({ createAdmin: () => admin({ id: USER_ID, email: "removed@example.com" }) }).POST(
      req({ authorization: "Bearer valid" }),
    ),
    await handler({ readEnv: env({ VERCEL_ENV: "production" }) }).POST(req({ authorization: "Bearer valid" })),
    await handler({ readEnv: env({ UNITY_COHORT_SIGNING_SECRET: "short" }) }).POST(
      req({ authorization: "Bearer valid" }),
    ),
  ];
  const snapshots = await Promise.all(
    responses.map(async (r) => ({
      status: r.status,
      body: await r.text(),
      ct: r.headers.get("content-type"),
      cc: r.headers.get("cache-control"),
    })),
  );
  for (const s of snapshots) assert.deepStrictEqual(s, snapshots[0]);
  assert.equal(snapshots[0].status, 404);
});

// ── successful mint ───────────────────────────────────────────────────────────

test("allowlisted member mints a cookie with the exact required attributes", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  assert.equal(res.status, 204);
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(cookie.startsWith(`${COHORT_COOKIE_NAME}=`));
  assert.ok(cookie.includes("Path=/unity-arena"));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Max-Age=600"));
  assert.equal(/domain=/i.test(cookie), false, "must be host-only");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("minted token verifies and its payload is exactly sub/iat/exp/ver", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  const cookie = res.headers.get("set-cookie") as string;
  const token = cookie.slice(`${COHORT_COOKIE_NAME}=`.length, cookie.indexOf(";"));
  const payload = verifyCapability(token, { secret: SECRET, ver: 4, nowSeconds: NOW + 1 });
  assert.ok(payload);
  assert.deepStrictEqual(payload, { sub: USER_ID, iat: NOW, exp: NOW + 600, ver: 4 });
  assert.deepStrictEqual(Object.keys(payload).sort(), ["exp", "iat", "sub", "ver"]);
});

test("Max-Age is aligned to the token exp and never exceeds 600", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  const cookie = res.headers.get("set-cookie") as string;
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  const token = cookie.slice(`${COHORT_COOKIE_NAME}=`.length, cookie.indexOf(";"));
  const payload = verifyCapability(token, { secret: SECRET, ver: 4, nowSeconds: NOW });
  assert.ok(payload);
  assert.equal(maxAge, payload.exp - NOW);
  assert.ok(maxAge <= 600);
});

test("successful response carries no token and no identity in the body", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  const text = await res.text();
  assert.equal(text, "", "204 must have an empty body");
  const headerDump = JSON.stringify([...res.headers.entries()].filter(([k]) => k.toLowerCase() !== "set-cookie"));
  assert.equal(headerDump.includes(MEMBER), false);
  assert.equal(headerDump.includes(USER_ID), false);
  assert.equal(headerDump.includes(SECRET), false);
});

test("the signing secret never appears anywhere in the response", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  const all = JSON.stringify([...res.headers.entries()]) + (await res.text());
  assert.equal(all.includes(SECRET), false);
  assert.equal(all.includes(MEMBER), false);
});

test("a token minted for version N is rejected once the version is bumped", async () => {
  const res = await handler().POST(req({ authorization: "Bearer valid" }));
  const cookie = res.headers.get("set-cookie") as string;
  const token = cookie.slice(`${COHORT_COOKIE_NAME}=`.length, cookie.indexOf(";"));
  assert.ok(verifyCapability(token, { secret: SECRET, ver: 4, nowSeconds: NOW }));
  assert.equal(verifyCapability(token, { secret: SECRET, ver: 5, nowSeconds: NOW }), null);
  // Secret rotation revokes just as immediately.
  assert.equal(verifyCapability(token, { secret: "z".repeat(32), ver: 4, nowSeconds: NOW }), null);
});
