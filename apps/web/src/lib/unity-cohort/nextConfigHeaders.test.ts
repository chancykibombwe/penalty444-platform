/**
 * B6D3B PR-1 — next.config.ts framing-override configuration tests.
 *
 * Proves the SOURCE CONFIG resolves correctly: the global `X-Frame-Options: DENY`
 * is preserved, exactly `/unity-arena/player` gains `SAMEORIGIN` +
 * `frame-ancestors 'self'` with overriding precedence (it must appear AFTER the
 * global block, since Next.js resolves conflicts as "the last header key wins"),
 * the artifact route stays `DENY`, unrelated routes stay `DENY`, no global CSP is
 * introduced, and the B6C staging rules are untouched.
 *
 * A deployment-level check of the FINAL response headers on a protected preview is
 * still required before merge and is NOT performed here.
 */

import test from "node:test";
import assert from "node:assert/strict";

import nextConfig from "../../../next.config";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function rules(): Promise<HeaderRule[]> {
  assert.equal(typeof nextConfig.headers, "function");
  const resolved = (await nextConfig.headers!()) as unknown as HeaderRule[];
  assert.ok(Array.isArray(resolved));
  return resolved;
}

/**
 * Resolve the effective value of a header for a path, applying Next.js precedence
 * (later matching rules override earlier ones). Uses exact/prefix matching that is
 * sufficient for the specific literal sources this config declares.
 */
function effective(rulesList: HeaderRule[], path: string, key: string): string | null {
  let value: string | null = null;
  for (const rule of rulesList) {
    if (!matches(rule.source, path)) continue;
    for (const h of rule.headers) {
      if (h.key.toLowerCase() === key.toLowerCase()) value = h.value;
    }
  }
  return value;
}

function matches(source: string, path: string): boolean {
  if (source === "/:path*") return true; // global
  if (source === path) return true; // exact
  // `/prefix/:path*` style
  const starIdx = source.indexOf("/:path*");
  if (starIdx > 0) {
    const prefix = source.slice(0, starIdx);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return false;
}

test("global route retains X-Frame-Options: DENY", async () => {
  const r = await rules();
  assert.equal(effective(r, "/", "X-Frame-Options"), "DENY");
  assert.equal(effective(r, "/lobby", "X-Frame-Options"), "DENY");
});

test("the exact player path resolves to SAMEORIGIN (override wins)", async () => {
  const r = await rules();
  assert.equal(effective(r, "/unity-arena/player", "X-Frame-Options"), "SAMEORIGIN");
});

test("the player path carries Content-Security-Policy: frame-ancestors 'self'", async () => {
  const r = await rules();
  assert.equal(effective(r, "/unity-arena/player", "Content-Security-Policy"), "frame-ancestors 'self'");
});

test("the player rule appears AFTER the global block so it takes precedence", async () => {
  const r = await rules();
  const globalIdx = r.findIndex((x) => x.source === "/:path*");
  const playerIdx = r.findIndex((x) => x.source === "/unity-arena/player");
  assert.ok(globalIdx >= 0, "global rule must exist");
  assert.ok(playerIdx >= 0, "exact player rule must exist");
  assert.ok(playerIdx > globalIdx, "player override must come after the global DENY");
});

test("the player rule is scoped to the EXACT path (no wildcard)", async () => {
  const r = await rules();
  const player = r.filter((x) => x.source.startsWith("/unity-arena"));
  assert.equal(player.length, 1, "exactly one /unity-arena rule may exist");
  assert.equal(player[0].source, "/unity-arena/player");
  assert.equal(player[0].source.includes(":path*"), false);
  assert.equal(player[0].source.includes("*"), false);
});

test("the artifact route retains DENY (framing never relaxed for artifacts)", async () => {
  const r = await rules();
  for (const p of [
    "/unity-arena/artifact/Build/b6d2b-5226d3c1-a.wasm.gz",
    "/unity-arena/artifact/Build/b6d2b-5226d3c1-a.loader.js",
    "/unity-arena/artifact",
  ]) {
    assert.equal(effective(r, p, "X-Frame-Options"), "DENY", `${p} must stay DENY`);
    assert.equal(effective(r, p, "Content-Security-Policy"), null, `${p} must have no CSP`);
  }
});

test("unrelated routes retain DENY and gain no CSP", async () => {
  const r = await rules();
  for (const p of ["/", "/lobby", "/match/ABC123", "/api/admin/me", "/unity-arena", "/unity-arena/playerx"]) {
    assert.equal(effective(r, p, "X-Frame-Options"), "DENY", `${p} must stay DENY`);
    assert.equal(effective(r, p, "Content-Security-Policy"), null, `${p} must have no CSP`);
  }
});

test("no global Content-Security-Policy was introduced", async () => {
  const r = await rules();
  const global = r.find((x) => x.source === "/:path*");
  assert.ok(global);
  assert.equal(
    global.headers.some((h) => h.key.toLowerCase() === "content-security-policy"),
    false,
    "the global block must not gain a CSP",
  );
  // CSP exists on exactly one rule: the player override.
  const withCsp = r.filter((x) => x.headers.some((h) => h.key.toLowerCase() === "content-security-policy"));
  assert.equal(withCsp.length, 1);
  assert.equal(withCsp[0].source, "/unity-arena/player");
});

test("other global security headers are unchanged", async () => {
  const r = await rules();
  const global = r.find((x) => x.source === "/:path*");
  assert.ok(global);
  const keys = global.headers.map((h) => h.key);
  for (const expected of [
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.ok(keys.includes(expected), `global header ${expected} must be preserved`);
  }
  assert.equal(effective(r, "/lobby", "X-Content-Type-Options"), "nosniff");
  assert.equal(effective(r, "/lobby", "Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("B6C staging rules are untouched", async () => {
  const r = await rules();
  const staging = r.filter((x) => x.source.startsWith("/unity/penalty444/staging/"));
  assert.equal(staging.length, 4, "the four B6C staging rules must remain");
  assert.equal(
    effective(r, "/unity/penalty444/staging/releases/v1/index.html", "X-Frame-Options"),
    "SAMEORIGIN",
    "B6C staging framing behaviour must be unchanged",
  );
  // The staging immutable cache policy must not be affected by PR-1.
  const versioned = staging.find((x) => x.source === "/unity/penalty444/staging/releases/:version/:path*");
  assert.ok(versioned);
  assert.ok(versioned.headers.some((h) => h.key === "Cache-Control" && h.value.includes("immutable")));
});

test("the protected player path never gains a public cache directive from config", async () => {
  const r = await rules();
  assert.equal(effective(r, "/unity-arena/player", "Cache-Control"), null);
  assert.equal(effective(r, "/unity-arena/artifact/Build/x.wasm.gz", "Cache-Control"), null);
});
