/**
 * B6D3B PR-1 — protected player entry route tests.
 * Node `node:test` via `tsx`. No network, no real Supabase; deps are injected.
 *
 * Proves: production denial precedes every dependency; cookie validation +
 * allowlist recheck (immediate revocation at entry); and that the trusted HTML
 * references only the four protected same-origin artifact URLs and leaks no
 * identity, capability, upstream hostname or query authorization.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlayerEntryHtml,
  createPlayerHandler,
  PROTECTED_ARTIFACT_URLS,
  type CohortAdminLike,
} from "../../../lib/unity-cohort/handlers";
import { COHORT_COOKIE_NAME, signCapability } from "../../../lib/unity-cohort/capability";
import {
  ARTIFACT_RECORDS,
  ARTIFACT_RELEASE_ID,
} from "../../../lib/unity-cohort/artifactManifest";
import { GET as liveGET } from "./route";
import * as routeModule from "./route";

const MEMBER = "member@example.com";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000;
const VER = 2;

function env(over: Record<string, string | undefined> = {}) {
  return () => ({
    VERCEL_ENV: "preview",
    UNITY_COHORT_EMAILS: MEMBER,
    UNITY_COHORT_SIGNING_SECRET: SECRET,
    UNITY_COHORT_TOKEN_VERSION: String(VER),
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

function validToken(over: { ttlSeconds?: number; ver?: number; secret?: string; sub?: string } = {}): string {
  const signed = signCapability({
    sub: over.sub ?? USER_ID,
    nowSeconds: NOW,
    ttlSeconds: over.ttlSeconds ?? 600,
    ver: over.ver ?? VER,
    secret: over.secret ?? SECRET,
  });
  assert.ok(signed);
  return signed.token;
}

function req(cookie?: string) {
  return new Request("http://localhost/unity-arena/player", {
    headers: cookie === undefined ? {} : { cookie },
  });
}

function handler(over: Partial<Parameters<typeof createPlayerHandler>[0]> = {}) {
  return createPlayerHandler({
    readEnv: env(),
    createAdmin: memberAdmin,
    nowSeconds: () => NOW + 1,
    ...over,
  });
}

async function assertOpaque404(res: Response): Promise<void> {
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not Found");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
}

test("route exports nodejs runtime and force-dynamic", () => {
  assert.equal(routeModule.runtime, "nodejs");
  assert.equal(routeModule.dynamic, "force-dynamic");
  assert.equal(typeof liveGET, "function");
});

// ── production denial ordering ─────────────────────────────────────────────────

test("production returns opaque 404 before any Supabase lookup", async () => {
  let adminCalled = false;
  const h = handler({
    readEnv: env({ VERCEL_ENV: "production" }),
    createAdmin: () => {
      adminCalled = true;
      return memberAdmin();
    },
  });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`)));
  assert.equal(adminCalled, false);
});

// ── cookie gates ──────────────────────────────────────────────────────────────

test("no cookie → opaque 404 (and no Supabase lookup)", async () => {
  let adminCalled = false;
  const h = handler({
    createAdmin: () => {
      adminCalled = true;
      return memberAdmin();
    },
  });
  await assertOpaque404(await h.GET(req()));
  assert.equal(adminCalled, false, "cookie validation precedes the lookup");
});

test("malformed / tampered cookie → opaque 404", async () => {
  await assertOpaque404(await handler().GET(req(`${COHORT_COOKIE_NAME}=garbage`)));
  const t = validToken();
  const [seg, sig] = t.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  await assertOpaque404(await handler().GET(req(`${COHORT_COOKIE_NAME}=${seg}.${flipped}`)));
});

test("expired cookie → opaque 404", async () => {
  const h = handler({ nowSeconds: () => NOW + 601 });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken({ ttlSeconds: 600 })}`)));
});

test("wrong token version → opaque 404 (emergency revocation)", async () => {
  await assertOpaque404(await handler().GET(req(`${COHORT_COOKIE_NAME}=${validToken({ ver: VER + 1 })}`)));
});

test("token signed with a rotated-away secret → opaque 404", async () => {
  await assertOpaque404(
    await handler().GET(req(`${COHORT_COOKIE_NAME}=${validToken({ secret: "z".repeat(32) })}`)),
  );
});

test("missing signing secret / token version configuration fails closed", async () => {
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_SIGNING_SECRET: undefined }) }).GET(
      req(`${COHORT_COOKIE_NAME}=${validToken()}`),
    ),
  );
  await assertOpaque404(
    await handler({ readEnv: env({ UNITY_COHORT_TOKEN_VERSION: undefined }) }).GET(
      req(`${COHORT_COOKIE_NAME}=${validToken()}`),
    ),
  );
});

// ── allowlist recheck (revocation at entry) ───────────────────────────────────

test("de-allowlisted member with a still-valid cookie → opaque 404 immediately", async () => {
  const h = handler({ createAdmin: () => admin({ id: USER_ID, email: "removed@example.com" }) });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`)));
});

test("allowlist emptied after mint → opaque 404 immediately", async () => {
  const h = handler({ readEnv: env({ UNITY_COHORT_EMAILS: "" }) });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`)));
});

test("user no longer resolvable by sub → opaque 404", async () => {
  const h = handler({ createAdmin: () => admin(null, { message: "not found" }) });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`)));
});

test("admin client unavailable → opaque 404", async () => {
  const h = handler({
    createAdmin: () => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    },
  });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`)));
});

test("the allowlist recheck resolves the user by the token's sub", async () => {
  let seenId: string | null = null;
  const h = handler({
    createAdmin: () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: null }, error: null }),
          admin: {
            getUserById: async (id: string) => {
              seenId = id;
              return { data: { user: { id, email: MEMBER } }, error: null };
            },
          },
        },
      }) as CohortAdminLike,
  });
  const res = await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`));
  assert.equal(res.status, 200);
  assert.equal(seenId, USER_ID);
});

// ── authorized entry ──────────────────────────────────────────────────────────

test("authorized member receives trusted HTML with the protected headers", async () => {
  const res = await handler().GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("vary"), "Cookie");
  const html = await res.text();
  assert.ok(html.startsWith("<!doctype html>"));
  // Framing is set in next.config.ts, never here.
  assert.equal(res.headers.get("x-frame-options"), null);
  assert.equal(res.headers.get("content-security-policy"), null);
});

test("HTML references exactly the four protected same-origin artifact URLs", async () => {
  const html = buildPlayerEntryHtml();
  assert.equal(PROTECTED_ARTIFACT_URLS.length, 4);
  for (const r of ARTIFACT_RECORDS) {
    const url = `/unity-arena/artifact/${r.path}`;
    assert.ok(html.includes(url), `missing ${url}`);
    assert.ok(PROTECTED_ARTIFACT_URLS.includes(url));
  }
  // Every referenced URL is same-origin under the protected artifact prefix.
  const refs = [...html.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]).filter((u) => u.includes("artifact"));
  assert.equal(refs.length, 4);
  for (const u of refs) assert.ok(u.startsWith("/unity-arena/artifact/"), `unexpected ref ${u}`);
});

test("productVersion equals ARTIFACT_RELEASE_ID and player uses B6D2B filenames only", () => {
  const html = buildPlayerEntryHtml();
  assert.equal(ARTIFACT_RELEASE_ID, "b6d2b-5226d3c1-a");
  assert.ok(
    html.includes(`productVersion: "${ARTIFACT_RELEASE_ID}"`),
    "productVersion must derive from ARTIFACT_RELEASE_ID",
  );
  assert.equal(html.includes("b6b-local-fb840878-d"), false, "no B6B artifact filename in player HTML");
  for (const name of [
    "b6d2b-5226d3c1-a.loader.js",
    "b6d2b-5226d3c1-a.framework.js.gz",
    "b6d2b-5226d3c1-a.data.gz",
    "b6d2b-5226d3c1-a.wasm.gz",
  ]) {
    assert.ok(html.includes(name), `missing B6D2B filename ${name}`);
  }
});

test("HTML exposes no upstream origin, identity, capability or query authorization", async () => {
  const html = buildPlayerEntryHtml();
  for (const forbidden of [
    "vercel.app",
    "https://",
    "http://",
    MEMBER,
    USER_ID,
    SECRET,
    COHORT_COOKIE_NAME,
    "roomCode",
    "matchId",
    "?token=",
    "Bearer",
    "releases/",
    "TemplateData",
    "index.html",
    "localStorage",
    "sessionStorage",
  ]) {
    assert.equal(html.includes(forbidden), false, `HTML must not contain ${forbidden}`);
  }
  assert.equal(html.includes("?"), false, "no query-string authorization anywhere");
});

test("HTML boots exactly one Unity canvas and no gameplay state", async () => {
  const html = buildPlayerEntryHtml();
  assert.equal((html.match(/<canvas/g) ?? []).length, 1);
  assert.equal((html.match(/createUnityInstance\(/g) ?? []).length, 1);
  // Presentation only: no Protocol v1 change, no socket, no scoring.
  for (const forbidden of ["socket.io", "PENALTY444_MATCH_EVENT", "protocolVersion", "scores", "match_state_sync"]) {
    assert.equal(html.includes(forbidden), false, `HTML must not contain ${forbidden}`);
  }
});

test("entry HTML is deterministic and does not depend on the upstream template", async () => {
  assert.equal(buildPlayerEntryHtml(), buildPlayerEntryHtml());
});
