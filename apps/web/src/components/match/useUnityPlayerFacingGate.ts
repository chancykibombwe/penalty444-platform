/**
 * B6D3B PR-2 — client-side cohort gate (CONVENIENCE / UX ONLY).
 *
 * This hook decides whether the browser should even attempt to mount the
 * player-facing Unity host. It is **not** the security boundary: the PR-1 server
 * routes (`/api/unity-cohort/session`, `/unity-arena/player`,
 * `/unity-arena/artifact/**`) independently enforce production denial, bearer
 * verification, allowlist membership and the signed capability, and every failure
 * there is an opaque 404. Nothing in this file can widen that.
 *
 * Fail-closed by construction: any missing session, thrown error, unexpected
 * status, malformed body, non-member answer, 404 or abort resolves to `denied`.
 *
 * The Supabase access token is held ONLY in a local function variable while the
 * two requests are issued. It is never placed in React state, `localStorage`,
 * `sessionStorage`, a URL, a query string, a log, or the returned state.
 *
 * Bounded internal diagnostics (`UnityPlayerFacingGateDiagnostic`) exist only for
 * isolated tests / non-production operator tooling. The player-facing React state
 * remains exclusively `disabled | checking | authorized | denied`. Diagnostics
 * never include emails, tokens, cookies, headers, bodies, secrets, URLs, or
 * free-form error strings, and are never rendered in Production.
 */

import { useEffect, useRef, useState } from "react";

import { supabase as sharedSupabase } from "../../lib/supabase/client";

export type UnityPlayerFacingGateState = "disabled" | "checking" | "authorized" | "denied";

/**
 * Bounded, non-secret diagnostic categories for the gate decision flow.
 * Never contains PII, tokens, headers, bodies, secrets, URLs, or free-form text.
 */
export type UnityPlayerFacingGateDiagnostic =
  | "resolver_unavailable"
  | "client_shape_invalid"
  | "session_read_failed"
  | "session_missing"
  | "access_token_missing"
  | "status_request_denied"
  | "status_response_invalid"
  | "not_in_cohort"
  | "session_mint_denied"
  | "authorized";

export interface UnityPlayerFacingGateDiagnosedResult {
  readonly state: "authorized" | "denied";
  readonly diagnostic: UnityPlayerFacingGateDiagnostic;
}

/**
 * Single-renderer handoff decision (pure).
 *
 * The player-facing host and the legacy shadow preview must NEVER be mounted
 * together, and there must be no window in which BOTH are mounted or in which the
 * shadow flickers while the cohort gate is still resolving.
 *
 * Once the player-facing path has been *requested*, the shadow is suppressed for
 * the whole resolution — `disabled` (the initial state before the gate effect
 * runs), `checking`, and `authorized` all render ZERO Unity iframes from the
 * shadow. It resumes ONLY after an explicit `denied`, or when the player-facing
 * path was never requested at all (in which case existing behaviour is untouched).
 *
 * Note this deliberately says nothing about whether the HOST mounts: the host has
 * its own stricter conditions (authorized AND sanitized identity AND a valid
 * instance), so `authorized`-without-identity correctly shows plain React.
 */
export function shouldRenderUnityShadow(args: {
  shadowEnabled: boolean;
  playerFacingRequested: boolean;
  gateState: UnityPlayerFacingGateState;
}): boolean {
  const { shadowEnabled, playerFacingRequested, gateState } = args;
  if (!shadowEnabled) return false;
  if (!playerFacingRequested) return true; // existing shadow behaviour preserved
  return gateState === "denied"; // resume only after an explicit denial
}

/** Minimal shape of the Supabase browser client used here. */
export interface GateSupabaseLike {
  readonly auth: {
    getSession(): Promise<{
      data: { session: { access_token?: string | null } | null } | null;
      error?: unknown;
    }>;
  };
}

export interface GateRunnerDeps {
  /** Resolves the Supabase browser client, or null when unavailable. */
  readonly getSupabase: () => Promise<GateSupabaseLike | null>;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
}

const STATUS_PATH = "/api/unity-cohort/status";
const SESSION_PATH = "/api/unity-cohort/session";

const DENIED = (diagnostic: UnityPlayerFacingGateDiagnostic): UnityPlayerFacingGateDiagnosedResult => ({
  state: "denied",
  diagnostic,
});

/**
 * Shape-check a candidate client without reading sessions or throwing free-form
 * errors into diagnostics.
 */
export function asGateSupabaseLike(candidate: unknown): GateSupabaseLike | null {
  if (candidate === null || typeof candidate !== "object") return null;
  const auth = (candidate as { auth?: unknown }).auth;
  if (auth === null || typeof auth !== "object") return null;
  if (typeof (auth as { getSession?: unknown }).getSession !== "function") return null;
  return candidate as GateSupabaseLike;
}

/**
 * Default resolver: the shared browser Supabase client (static import).
 * Fail-closed when the export shape is wrong.
 */
export async function resolveDefaultGateSupabase(): Promise<GateSupabaseLike | null> {
  return asGateSupabaseLike(sharedSupabase);
}

/**
 * Legacy / test helper: resolve a module namespace the way the fragile dynamic
 * import previously did. Used only to reproduce resolver failures in diagnostics.
 */
export function resolveGateSupabaseFromModule(mod: unknown): GateSupabaseLike | null {
  if (mod === null || typeof mod !== "object") return null;
  const candidate = (mod as { supabase?: unknown }).supabase;
  return asGateSupabaseLike(candidate);
}

/**
 * Pure/injectable decision flow with bounded diagnostics. Returns `authorized`
 * ONLY after the status endpoint confirms membership AND the mint returns 204.
 * Never throws and never returns the token or any identity.
 */
export async function runUnityPlayerFacingGateDiagnosed(
  deps: GateRunnerDeps,
): Promise<UnityPlayerFacingGateDiagnosedResult> {
  try {
    let supabase: GateSupabaseLike | null;
    try {
      supabase = await deps.getSupabase();
    } catch {
      return DENIED("resolver_unavailable");
    }
    if (supabase === null) return DENIED("resolver_unavailable");
    if (asGateSupabaseLike(supabase) === null) return DENIED("client_shape_invalid");

    // 1–3. Read the session; keep the token in a local variable only.
    let accessToken: string | null = null;
    try {
      const result = await supabase.auth.getSession();
      if (result === null || result === undefined) return DENIED("session_read_failed");
      if (result.error) return DENIED("session_read_failed");
      const session = result.data?.session ?? null;
      if (session === null) return DENIED("session_missing");
      const token = session.access_token;
      accessToken = typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return DENIED("session_read_failed");
    }
    if (accessToken === null) return DENIED("access_token_missing");

    const authHeaders: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-store",
    };
    const common: RequestInit = {
      credentials: "same-origin",
      cache: "no-store",
      ...(deps.signal ? { signal: deps.signal } : {}),
    };

    // 4–5. Convenience membership check. Must be 200 with the exact safe shape.
    let inCohort = false;
    try {
      const res = await deps.fetchImpl(STATUS_PATH, { ...common, method: "GET", headers: authHeaders });
      if (!res || res.status !== 200) return DENIED("status_request_denied");
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return DENIED("status_response_invalid");
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return DENIED("status_response_invalid");
      }
      const keys = Object.keys(body as Record<string, unknown>);
      if (keys.length !== 1 || keys[0] !== "inCohort") return DENIED("status_response_invalid");
      const value = (body as Record<string, unknown>).inCohort;
      if (typeof value !== "boolean") return DENIED("status_response_invalid");
      inCohort = value;
    } catch {
      return DENIED("status_request_denied");
    }
    if (!inCohort) return DENIED("not_in_cohort");

    // 6–7. Mint the short-lived HttpOnly capability. Must be exactly 204.
    try {
      const res = await deps.fetchImpl(SESSION_PATH, { ...common, method: "POST", headers: authHeaders });
      if (!res || res.status !== 204) return DENIED("session_mint_denied");
    } catch {
      return DENIED("session_mint_denied");
    }

    return { state: "authorized", diagnostic: "authorized" };
  } catch {
    return DENIED("resolver_unavailable");
  }
}

/**
 * Pure/injectable decision flow: session → status → mint. Returns `authorized`
 * ONLY after the status endpoint confirms membership AND the mint returns 204.
 * Never throws and never returns the token, any identity, or a diagnostic.
 */
export async function runUnityPlayerFacingGate(
  deps: GateRunnerDeps,
): Promise<"authorized" | "denied"> {
  const result = await runUnityPlayerFacingGateDiagnosed(deps);
  return result.state;
}

/**
 * Resolve the gate ONCE and report its bounded diagnostic.
 *
 * Exported so the hook's exact behaviour is unit-testable without a React
 * testing dependency. The diagnosed flow runs exactly once per call, so enabling
 * diagnostics can never add a status request or a capability mint.
 *
 * The callback is invoked defensively: a throwing operator consumer can never
 * change the decision, and the decision is computed before the callback runs.
 */
export async function resolveGateWithDiagnostic(
  deps: GateRunnerDeps,
  onDiagnostic?: (diagnostic: UnityPlayerFacingGateDiagnostic) => void,
): Promise<"authorized" | "denied"> {
  const outcome = await runUnityPlayerFacingGateDiagnosed(deps);
  if (onDiagnostic) {
    try {
      onDiagnostic(outcome.diagnostic);
    } catch {
      /* operator-tooling callback errors are contained */
    }
  }
  return outcome.state;
}

export interface UnityPlayerFacingGateOptions {
  /** Every required public flag must already be true before we check anything. */
  readonly requested: boolean;
  readonly getSupabase?: () => Promise<GateSupabaseLike | null>;
  readonly fetchImpl?: typeof fetch;
  /**
   * OPTIONAL bounded-diagnostic sink for isolated, non-production operator
   * tooling (the B6D3C protected-preview proof harness). It receives only a
   * `UnityPlayerFacingGateDiagnostic` enum member — never an email, token,
   * cookie, header, body, URL, secret or free-form error string.
   *
   * Consumers that omit it behave exactly as before: the diagnostic is computed
   * either way (it always was, inside the diagnosed runner) and simply discarded.
   */
  readonly onDiagnostic?: (diagnostic: UnityPlayerFacingGateDiagnostic) => void;
}

/**
 * React binding. Returns `disabled` — performing NO Supabase read and NO network
 * request — whenever the player-facing flags are not all enabled.
 *
 * Never exposes diagnostics in React state (Production-safe surface). The bounded
 * diagnostic is delivered ONLY through the optional `onDiagnostic` callback, which
 * no player-facing consumer passes.
 */
export function useUnityPlayerFacingGate(
  options: UnityPlayerFacingGateOptions,
): UnityPlayerFacingGateState {
  const { requested } = options;
  const [state, setState] = useState<UnityPlayerFacingGateState>("disabled");
  const depsRef = useRef(options);
  depsRef.current = options;

  useEffect(() => {
    if (!requested) {
      setState("disabled");
      return;
    }
    const controller = new AbortController();
    let mounted = true;
    setState("checking");
    void (async () => {
      // ONE resolution per request. `resolveGateWithDiagnostic` runs the same
      // diagnosed flow the non-diagnostic wrapper already ran internally, so no
      // extra status request and no extra capability mint is introduced.
      const outcome = await resolveGateWithDiagnostic(
        {
          getSupabase: depsRef.current.getSupabase ?? resolveDefaultGateSupabase,
          fetchImpl: depsRef.current.fetchImpl ?? fetch,
          signal: controller.signal,
        },
        (diagnostic) => {
          if (!mounted || controller.signal.aborted) return; // unmount protection
          depsRef.current.onDiagnostic?.(diagnostic);
        },
      );
      if (!mounted || controller.signal.aborted) return; // unmount protection
      setState(outcome);
    })();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [requested]);

  return state;
}
