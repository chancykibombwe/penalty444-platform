/**
 * RouteAwareAppShell isolation contract tests.
 * Pure helpers + source inspection — no Next router runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ISOLATED_DEV_ROUTES,
  isIsolatedDevRoute,
} from "./RouteAwareAppShell";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "RouteAwareAppShell.tsx"), "utf8");

test("isolated set is exact and does not blanket /dev/*", () => {
  assert.equal(ISOLATED_DEV_ROUTES.has("/dev/unity-staging"), true);
  assert.equal(ISOLATED_DEV_ROUTES.has("/dev/unity-b6d3c"), true);
  assert.equal(ISOLATED_DEV_ROUTES.size, 2);
  assert.equal(isIsolatedDevRoute("/dev/unity-staging"), true);
  assert.equal(isIsolatedDevRoute("/dev/unity-b6d3c"), true);
  assert.equal(isIsolatedDevRoute("/dev/other"), false);
  assert.equal(isIsolatedDevRoute("/lobby"), false);
  assert.equal(isIsolatedDevRoute("/"), false);
  assert.equal(isIsolatedDevRoute(null), false);
  assert.equal(isIsolatedDevRoute(undefined), false);
  assert.equal(isIsolatedDevRoute("/dev/unity-b6d3c/extra"), false);
});

test("the shell mounts chrome only when the route is not isolated", () => {
  assert.ok(/isIsolatedDevRoute\(pathname\)/.test(source));
  assert.ok(/return <main>\{children\}<\/main>/.test(source));
  assert.ok(/<ActiveMatchRecovery \/>/.test(source));
  assert.ok(/<MatchReadyNotification \/>/.test(source));
  assert.ok(/<TournamentMatchReadyNotification \/>/.test(source));
  assert.ok(/<Navbar \/>/.test(source));
  assert.ok(/<FreePlayNoticeStrip \/>/.test(source));
  assert.ok(/Report a bug/.test(source));
  // Isolated branch must not broaden to every /dev route via prefix matching.
  assert.equal(/pathname\.startsWith\(["']\/dev/.test(source), false);
  assert.equal(/ISOLATED_DEV_ROUTES\.has\(pathname\)/.test(source) || /isIsolatedDevRoute\(pathname\)/.test(source), true);
  assert.equal(source.includes('"/dev/unity-staging"'), true);
  assert.equal(source.includes('"/dev/unity-b6d3c"'), true);
});
