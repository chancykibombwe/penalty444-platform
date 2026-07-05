/**
 * Hardening Sprint 5 — TASK 8: realtime server environment validation.
 *
 * Runs on boot and prints a redacted summary plus a list of
 * problems. NEVER prints values — only `present` / `missing`.
 *
 * Failure semantics:
 *
 *   - In production:
 *       * Missing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 *         `REALTIME_INTERNAL_SECRET`, or `ALLOWED_ORIGINS` is FATAL —
 *         the server refuses to start.
 *       * `ECONOMY_REAL_MONEY_ENABLED=true` without
 *         `SOCKET_JWT_ENFORCE=true` is FATAL (matches the existing
 *         `economyLaunchBlockers` check; documented redundancy).
 *
 *   - In development:
 *       * Same problems are LOGGED as warnings but the server keeps
 *         running. Free-play / spectator / private-room flows continue
 *         to work without a service-role key.
 *
 * The boot banner from `printEnvSummary()` is safe to ship in any
 * environment because it never includes raw env values.
 */

import { describeOriginPolicy, isProduction } from "./origins";

type Severity = "fatal" | "warn" | "info";

type EnvProblem = {
  severity: Severity;
  message: string;
};

function presence(name: string): "present" | "missing" {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0
    ? "present"
    : "missing";
}

function isTrue(name: string): boolean {
  return process.env[name] === "true";
}

/**
 * Validate that SUPABASE_URL is the project API URL, not a dashboard
 * URL, a `/rest/v1` endpoint, or a direct-DB hostname. A wrong value
 * here previously caused a production outage where supabase-js received
 * an HTML dashboard page and failed to parse JSON.
 *
 * Accepted shape:
 *   - a valid URL
 *   - https:
 *   - hostname ends with `.supabase.co`
 *   - hostname does NOT start with `db.`
 *   - pathname is empty or `/`
 *
 * Returns a problem message when invalid, or null when the shape is OK.
 * Never logs secrets — only the (non-secret) host/path of the URL.
 */
function validateSupabaseUrlShape(raw: string): string | null {
  const guidance =
    "SUPABASE_URL must be the project API URL, e.g. " +
    "https://<project-ref>.supabase.co. Do not use dashboard URLs or /rest/v1.";

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return `SUPABASE_URL is not a valid URL. ${guidance}`;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const pathIsRoot = path === "" || path === "/";

  const shapeOk =
    url.protocol === "https:" &&
    host.endsWith(".supabase.co") &&
    !host.startsWith("db.") &&
    pathIsRoot;

  if (!shapeOk) {
    return (
      `${guidance} (saw host=${host || "(none)"} path=${path || "/"})`
    );
  }

  return null;
}

/**
 * Non-secret description of SUPABASE_URL for the boot banner. Surfaces
 * the host/path so a misconfiguration is obvious in logs, without ever
 * printing the service-role key.
 */
function describeSupabaseUrl(): string {
  const raw = process.env.SUPABASE_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return "missing";
  }
  try {
    const url = new URL(raw.trim());
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return "present (unparseable)";
  }
}

/**
 * Inspect every env var the realtime server needs. Returns an ordered
 * list of problems. Caller decides whether to log, exit, or both.
 */
export function inspectRealtimeServerEnv(): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const prod = isProduction();

  // 1. Supabase
  if (presence("SUPABASE_URL") === "missing") {
    problems.push({
      severity: prod ? "fatal" : "warn",
      message:
        "SUPABASE_URL is missing. Database-backed flows (settlement, " +
        "progression, tournaments) will be inert until set.",
    });
  } else {
    // Present → validate its shape. A dashboard URL / `/rest/v1` /
    // db-hostname here is just as broken as a missing one (it silently
    // returns HTML to supabase-js), so it carries the same severity.
    const shapeProblem = validateSupabaseUrlShape(
      process.env.SUPABASE_URL as string
    );
    if (shapeProblem) {
      problems.push({
        severity: prod ? "fatal" : "warn",
        message: shapeProblem,
      });
    }
  }
  if (presence("SUPABASE_SERVICE_ROLE_KEY") === "missing") {
    problems.push({
      severity: prod ? "fatal" : "warn",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is missing. Realtime server cannot " +
        "write to RLS-protected tables.",
    });
  }

  // 2. Internal secret
  if (presence("REALTIME_INTERNAL_SECRET") === "missing") {
    problems.push({
      severity: prod ? "fatal" : "warn",
      message:
        "REALTIME_INTERNAL_SECRET is missing. Every /internal/* endpoint " +
        "will reject all callers (fail-closed) — including the web app's " +
        "tournament-room / economy-proxy routes.",
    });
  }

  // 3. CORS allow-list
  const originPolicy = describeOriginPolicy();
  if (prod && originPolicy.count === 0) {
    problems.push({
      severity: "fatal",
      message:
        "ALLOWED_ORIGINS is empty in production. Every browser request " +
        "will be CORS-denied. Set a comma-separated list of trusted " +
        "origins (e.g. https://444arena.com).",
    });
  }

  // 4. SOCKET_JWT_ENFORCE — production hard gate.
  //
  // In production the realtime server MUST reject unauthenticated / spoofed
  // sockets: without it, any scripted socket.io client can claim an arbitrary
  // playerId (player IDs are not secret — they are broadcast in room rosters
  // and the public leaderboard) and hijack or cancel another player's room /
  // match. This is INDEPENDENT of the economy flags below — even a Free Play
  // beta must not run with soft identity in production. Boot fails fast so a
  // later env drift can never silently ship an unsafe realtime server.
  //
  // Development / local intentionally stays flexible (warn only) so the
  // free-play flow keeps working without wiring JWT verification.
  if (prod && !isTrue("SOCKET_JWT_ENFORCE")) {
    problems.push({
      severity: "fatal",
      message:
        "SOCKET_JWT_ENFORCE must be true in production. Without it the " +
        "realtime server accepts unauthenticated sockets that can spoof " +
        "another player's identity. Set SOCKET_JWT_ENFORCE=true.",
    });
  }

  // 5. JWT enforcement vs. real-money flag (mirrors `economyLaunchBlockers`).
  if (isTrue("ECONOMY_REAL_MONEY_ENABLED") && !isTrue("SOCKET_JWT_ENFORCE")) {
    problems.push({
      severity: "fatal",
      message:
        "ECONOMY_REAL_MONEY_ENABLED=true requires SOCKET_JWT_ENFORCE=true. " +
        "Real-money flows must reject unauthenticated sockets.",
    });
  }

  // 6. JWT enforcement when economy is on (warn only).
  if (
    isTrue("ECONOMY_ENABLED") &&
    !isTrue("SOCKET_JWT_ENFORCE") &&
    !isTrue("ECONOMY_REAL_MONEY_ENABLED")
  ) {
    problems.push({
      severity: "warn",
      message:
        "ECONOMY_ENABLED=true with SOCKET_JWT_ENFORCE!=true. Acceptable " +
        "for ECONOMY_TEST_MODE but MUST be flipped before real money.",
    });
  }

  return problems;
}

/**
 * Print a tabular summary at boot. Never prints values.
 */
export function printEnvSummary(): void {
  const policy = describeOriginPolicy();
  const summary = {
    NODE_ENV: process.env.NODE_ENV ?? "(unset)",
    SUPABASE_URL: describeSupabaseUrl(),
    SUPABASE_SERVICE_ROLE_KEY: presence("SUPABASE_SERVICE_ROLE_KEY"),
    REALTIME_INTERNAL_SECRET: presence("REALTIME_INTERNAL_SECRET"),
    ALLOWED_ORIGINS: policy.count > 0 ? `${policy.count} entries` : "(empty)",
    SOCKET_JWT_ENFORCE: isTrue("SOCKET_JWT_ENFORCE") ? "on" : "off",
    ECONOMY_ENABLED: isTrue("ECONOMY_ENABLED") ? "on" : "off",
    ECONOMY_TEST_MODE: isTrue("ECONOMY_TEST_MODE") ? "on" : "off",
    ECONOMY_REAL_MONEY_ENABLED: isTrue("ECONOMY_REAL_MONEY_ENABLED")
      ? "on"
      : "off",
    ECONOMY_RECONCILIATION_ENABLED: isTrue("ECONOMY_RECONCILIATION_ENABLED")
      ? "on"
      : "off",
  };

  const corsMode = policy.mode === "production" ? "production" : "development";
  console.log(
    `[boot] realtime-server config — mode=${corsMode}, ` +
      Object.entries(summary)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
  );
}

/**
 * Run validation and decide whether to keep going. Throws (and logs)
 * when any fatal problem is present. Caller is responsible for catching
 * and exiting cleanly so the process supervisor sees a non-zero code.
 */
export function validateRealtimeServerEnv(): void {
  const problems = inspectRealtimeServerEnv();
  printEnvSummary();

  let fatal = 0;
  for (const problem of problems) {
    if (problem.severity === "fatal") {
      fatal += 1;
      console.error(`[boot] FATAL: ${problem.message}`);
    } else if (problem.severity === "warn") {
      console.warn(`[boot] WARN: ${problem.message}`);
    } else {
      console.log(`[boot] INFO: ${problem.message}`);
    }
  }

  if (fatal > 0) {
    throw new Error(
      `realtime-server env validation failed: ${fatal} fatal problem(s)`
    );
  }
}
