#!/usr/bin/env node
/**
 * Hardening Sprint 4 — TASK 12: local security posture self-audit.
 *
 * Run from the repo root:
 *
 *   node scripts/check-security-posture.mjs
 *
 * The script is INTENTIONALLY OFFLINE — it never reads secrets and
 * never connects to Supabase. Its job is to verify the static posture
 * of this repository:
 *
 *   1. No `.env*` (other than `.env.example`) is tracked by git.
 *   2. The Sprint 3 RLS migration file exists.
 *   3. Sprint 4 security helpers exist.
 *   4. Required documentation files exist.
 *   5. The realtime server config requires the internal secret.
 *
 * Each check prints:
 *
 *     [PASS] description
 *     [WARN] description (something to look at; not a blocker)
 *     [FAIL] description (real blocker)
 *
 * The script exits with code 0 if there are zero `[FAIL]` entries
 * and code 1 otherwise. `[WARN]` does not affect the exit code.
 *
 * Run this BEFORE every PR that changes security posture.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
let failures = 0;

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function warn(message) {
  console.log(`[WARN] ${message}`);
}

function fail(message) {
  console.log(`[FAIL] ${message}`);
  failures += 1;
}

function trackedEnvFiles() {
  try {
    // Use `git ls-files :*.env :*.env.*` so we don't materialise the
    // whole repo file list into a buffer (Windows default is 1MiB and
    // overflows on monorepos).
    const patterns = [
      ":(glob)**/.env",
      ":(glob)**/.env.*",
      ":(glob).env",
      ":(glob).env.*",
    ];
    const out = execSync(`git ls-files -- ${patterns.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    warn(`could not run git ls-files: ${error.message}`);
    return [];
  }
}

function checkNoTrackedSecretEnv() {
  const tracked = trackedEnvFiles();
  const safe = tracked.filter((path) => path.endsWith(".env.example"));
  const unsafe = tracked.filter((path) => !path.endsWith(".env.example"));

  if (unsafe.length > 0) {
    fail(
      `tracked env file(s) detected: ${unsafe.join(", ")} — run \`git rm --cached <file>\` and rotate the secret`
    );
  } else {
    pass(`no real .env file tracked (placeholders only: ${safe.join(", ") || "none"})`);
  }
}

function checkExists(path, label) {
  const fullPath = resolve(ROOT, path);
  if (existsSync(fullPath)) {
    pass(`${label} exists (${path})`);
    return true;
  }
  fail(`${label} missing (${path})`);
  return false;
}

function checkContains(path, needle, label) {
  const fullPath = resolve(ROOT, path);
  if (!existsSync(fullPath)) {
    fail(`${label} cannot be checked because ${path} is missing`);
    return;
  }
  const contents = readFileSync(fullPath, "utf8");
  if (contents.includes(needle)) {
    pass(`${label} (${path})`);
  } else {
    fail(`${label} — expected substring not found in ${path}: \`${needle}\``);
  }
}

function checkNoServiceRoleInClient() {
  // Hand-walk the browser-bound directories looking for
  // SUPABASE_SERVICE_ROLE_KEY-shaped strings. We avoid relying on `rg`
  // because Windows installs frequently ship without it.
  const PATTERNS = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "service_role",
    "sb_secret",
    "NEXT_PUBLIC_SUPABASE_SERVICE",
  ];
  const TARGETS = [
    "apps/web/src/components",
    "apps/web/src/lib/social",
    "apps/web/src/lib/economy",
    "apps/web/src/lib/player",
    "apps/web/src/lib/live",
  ];

  const offenders = [];
  for (const target of TARGETS) {
    const fullDir = resolve(ROOT, target);
    if (!existsSync(fullDir)) continue;
    walkDir(fullDir, (filePath) => {
      const lower = filePath.toLowerCase();
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) return;
      let contents;
      try {
        contents = readFileSync(filePath, "utf8");
      } catch {
        return;
      }
      for (const pattern of PATTERNS) {
        if (contents.includes(pattern)) {
          offenders.push(`${filePath}: ${pattern}`);
        }
      }
    });
  }

  if (offenders.length > 0) {
    fail(
      `service-role-shaped string found in browser-bound code:\n  ${offenders.join("\n  ")}`
    );
  } else {
    pass("no service-role secret reference in client components / lib");
  }
}

function walkDir(dir, onFile) {
  let entries;
  try {
    entries = readdirSyncSafe(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walkDir(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

function readdirSyncSafe(dir) {
  return readdirSync(dir, { withFileTypes: true });
}

function main() {
  console.log("─── Penalty444 security posture self-audit ───");
  console.log(`repo: ${ROOT}`);
  console.log("");

  // 1. Env file hygiene.
  checkNoTrackedSecretEnv();
  checkExists(".gitignore", ".gitignore");
  checkContains(".gitignore", ".env", ".gitignore blocks .env");

  // 2. Sprint 3 RLS migration (tracked separately, may not be on this
  //    branch yet — degrade to warn).
  if (
    !existsSync(
      resolve(ROOT, "supabase/migrations/20260523080000_rls_security_hardening.sql")
    )
  ) {
    warn(
      "Sprint 3 RLS migration not on this branch (`supabase/migrations/20260523080000_rls_security_hardening.sql`) — this is OK on a feature branch that doesn't depend on it; merge the Sprint 3 PR first"
    );
  } else {
    pass("Sprint 3 RLS migration present");
  }

  // 3. Sprint 4 security helpers.
  checkExists(
    "apps/realtime-server/src/security/socketIdentity.ts",
    "socketIdentity helper"
  );
  checkExists(
    "apps/realtime-server/src/security/replayGuard.ts",
    "replayGuard helper"
  );
  checkExists(
    "apps/realtime-server/src/security/rateLimit.ts",
    "rateLimit helper"
  );
  checkExists(
    "apps/realtime-server/src/security/internalSecret.ts",
    "internalSecret helper"
  );
  checkExists(
    "apps/realtime-server/src/security/jwt.ts",
    "JWT verification module"
  );
  checkExists(
    "apps/realtime-server/src/security/identity.ts",
    "identity ladder module"
  );

  // 4. Documentation.
  checkExists("docs/server-authority.md", "server-authority docs");
  checkExists("docs/socket-security.md", "socket-security docs");
  checkExists("docs/socket-auth-plan.md", "socket-auth plan");
  checkExists(
    "docs/pre-real-money-checklist.md",
    "pre-real-money checklist"
  );

  // 5. Realtime config sanity.
  checkContains(
    "apps/realtime-server/src/config.ts",
    "REALTIME_INTERNAL_SECRET",
    "realtime config reads REALTIME_INTERNAL_SECRET"
  );
  checkContains(
    "apps/realtime-server/src/security/internalSecret.ts",
    "x-realtime-internal-secret",
    "internalSecret guard reads x-realtime-internal-secret header"
  );
  checkContains(
    "apps/realtime-server/src/index.ts",
    "economyLaunchBlockers",
    "realtime server runs the economy launch blocker check"
  );

  // 6. No service-role leak into browser bundles.
  checkNoServiceRoleInClient();

  console.log("");
  if (failures === 0) {
    console.log("✓ all critical posture checks passed");
    process.exit(0);
  } else {
    console.log(`✗ ${failures} failing check(s) — see [FAIL] above`);
    process.exit(1);
  }
}

main();
