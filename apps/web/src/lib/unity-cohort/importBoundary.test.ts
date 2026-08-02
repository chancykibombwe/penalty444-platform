/**
 * B6D3B PR-1 — import-boundary regression test.
 *
 * The final `unity-cohort` / `unity-arena` modules are server-side security and
 * delivery infrastructure. They must not reach into the React player surface, the
 * realtime authority, the shared package, the browser Supabase client, Unity C#, or
 * the disposable proof-only harness.
 *
 * The server-side `createAdminClient` import is permitted, but ONLY in the two
 * places that need cohort authentication / entry allowlist recheck.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../../app/", import.meta.url));

const COHORT_API_DIR = join(APP_DIR, "api/unity-cohort");
const ARENA_DIR = join(APP_DIR, "unity-arena");

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

/** All final PR-1 sources (implementation only — test files are excluded). */
function finalSources(): string[] {
  return [...collect(LIB_DIR), ...collect(COHORT_API_DIR), ...collect(ARENA_DIR)].filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
  );
}

function importLines(src: string): string[] {
  return src
    .split("\n")
    .filter((l) => /\b(import|require)\b/.test(l) && /["']/.test(l));
}

const FORBIDDEN = [
  "MatchRoomPanel",
  "MatchRenderer3D",
  "UnityPresentationHost",
  "useViewerPresentation",
  "unityPresentationAdapter",
  "unityPresentationShadow",
  "unityPresentationIdentity",
  "unityPresentationCorrelation",
  "unityPresentationProtocol",
  "matchPresentation",
  "realtime-server",
  "packages/shared",
  "@shared",
  "socket.io",
  "unity-stream-proof",
  "supabase/client",
  "next/navigation",
];

test("final PR-1 sources exist and are discovered", () => {
  const files = finalSources();
  assert.ok(files.length >= 8, `expected the PR-1 modules, found ${files.length}`);
  for (const expected of [
    "capability.ts",
    "cohortAccess.ts",
    "artifactManifest.ts",
    "rawArtifactProxy.ts",
    "handlers.ts",
  ]) {
    assert.ok(
      files.some((f) => f.endsWith(expected)),
      `missing ${expected}`,
    );
  }
});

test("no final module imports a forbidden runtime/proof module", () => {
  for (const file of finalSources()) {
    const lines = importLines(readFileSync(file, "utf8"));
    for (const bad of FORBIDDEN) {
      for (const line of lines) {
        assert.equal(line.includes(bad), false, `${file} must not import ${bad}: ${line.trim()}`);
      }
    }
  }
});

test("the proof-only harness is never imported by final runtime code", () => {
  for (const file of finalSources()) {
    const src = readFileSync(file, "utf8");
    assert.equal(
      /from\s+["'][^"']*unity-stream-proof/.test(src),
      false,
      `${file} must not import the proof-only harness`,
    );
  }
});

test("createAdminClient is imported only where cohort auth requires it", () => {
  const importers = finalSources().filter((f) => readFileSync(f, "utf8").includes("supabase/admin"));
  const names = importers.map((f) => f.replace(/.*\/(?=(app|lib)\/)/, "")).sort();
  // status + session (bearer verification) and player (allowlist recheck) only.
  assert.equal(importers.length, 3, `unexpected admin-client importers: ${names.join(", ")}`);
  assert.ok(importers.some((f) => f.includes("api/unity-cohort/status")));
  assert.ok(importers.some((f) => f.includes("api/unity-cohort/session")));
  assert.ok(importers.some((f) => f.includes("unity-arena/player")));
  // The artifact route must NOT perform a per-file identity lookup.
  assert.equal(
    importers.some((f) => f.includes("unity-arena/artifact")),
    false,
    "the artifact route must not import the admin client",
  );
});

test("no final module uses built-in fetch for artifact delivery", () => {
  for (const file of finalSources()) {
    const src = readFileSync(file, "utf8");
    if (file.includes("rawArtifactProxy") || file.includes("unity-arena/artifact")) {
      assert.equal(/\bfetch\s*\(/.test(src), false, `${file} must not call fetch()`);
      assert.equal(/require\(["']zlib["']\)|from\s+["']node:zlib["']/.test(src), false, `${file} must not use zlib`);
      // No whole-body buffering helpers.
      for (const banned of ["arrayBuffer(", "blob(", ".text()", ".json()"]) {
        assert.equal(src.includes(banned), false, `${file} must not buffer via ${banned}`);
      }
    }
  }
});

test("no client directive in server-only cohort modules", () => {
  for (const file of finalSources()) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes('"use client"'), false, `${file} must not be a client module`);
    assert.equal(src.includes("'use client'"), false, `${file} must not be a client module`);
  }
});

test("no hardcoded upstream hostname or secret literal in final sources", () => {
  for (const file of finalSources()) {
    const src = readFileSync(file, "utf8");
    // Placeholder/documentation hostnames are fine only in comments; assert no
    // real deployment hostname literal is present at all.
    assert.equal(
      /https:\/\/[a-z0-9-]+\.vercel\.app/i.test(src),
      false,
      `${file} must not contain a concrete .vercel.app hostname`,
    );
    assert.equal(/UNITY_COHORT_SIGNING_SECRET\s*=\s*["']/.test(src), false, `${file} must not assign a secret literal`);
  }
});
