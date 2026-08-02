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
 */

import { useEffect, useRef, useState } from "react";

export type UnityPlayerFacingGateState = "disabled" | "checking" | "authorized" | "denied";

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

/**
 * Pure/injectable decision flow: session → status → mint. Returns `authorized`
 * ONLY after the status endpoint confirms membership AND the mint returns 204.
 * Never throws and never returns the token or any identity.
 */
export async function runUnityPlayerFacingGate(
  deps: GateRunnerDeps,
): Promise<"authorized" | "denied"> {
  try {
    const supabase = await deps.getSupabase();
    if (supabase === null) return "denied";

    // 1–3. Read the session; keep the token in a local variable only.
    let accessToken: string | null = null;
    try {
      const result = await supabase.auth.getSession();
      if (result === null || result === undefined) return "denied";
      if (result.error) return "denied";
      const token = result.data?.session?.access_token;
      accessToken = typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return "denied";
    }
    if (accessToken === null) return "denied";

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
      if (!res || res.status !== 200) return "denied";
      const body: unknown = await res.json();
      if (body === null || typeof body !== "object" || Array.isArray(body)) return "denied";
      const keys = Object.keys(body as Record<string, unknown>);
      if (keys.length !== 1 || keys[0] !== "inCohort") return "denied"; // exact shape
      const value = (body as Record<string, unknown>).inCohort;
      if (typeof value !== "boolean") return "denied";
      inCohort = value;
    } catch {
      return "denied";
    }
    if (!inCohort) return "denied"; // non-member ⇒ never attempt the mint

    // 6–7. Mint the short-lived HttpOnly capability. Must be exactly 204.
    try {
      const res = await deps.fetchImpl(SESSION_PATH, { ...common, method: "POST", headers: authHeaders });
      if (!res || res.status !== 204) return "denied";
    } catch {
      return "denied";
    }

    // 8. Authorized only after a successful mint.
    return "authorized";
  } catch {
    return "denied";
  }
}

/** Default Supabase browser-client resolver (dynamically imported, fail-closed). */
async function defaultGetSupabase(): Promise<GateSupabaseLike | null> {
  try {
    const mod: unknown = await import("../../lib/supabase/client");
    const candidate = (mod as { supabase?: unknown }).supabase;
    if (candidate === null || typeof candidate !== "object") return null;
    const auth = (candidate as { auth?: unknown }).auth;
    if (auth === null || typeof auth !== "object") return null;
    if (typeof (auth as { getSession?: unknown }).getSession !== "function") return null;
    return candidate as GateSupabaseLike;
  } catch {
    return null;
  }
}

export interface UnityPlayerFacingGateOptions {
  /** Every required public flag must already be true before we check anything. */
  readonly requested: boolean;
  readonly getSupabase?: () => Promise<GateSupabaseLike | null>;
  readonly fetchImpl?: typeof fetch;
}

/**
 * React binding. Returns `disabled` — performing NO Supabase read and NO network
 * request — whenever the player-facing flags are not all enabled.
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
      const outcome = await runUnityPlayerFacingGate({
        getSupabase: depsRef.current.getSupabase ?? defaultGetSupabase,
        fetchImpl: depsRef.current.fetchImpl ?? fetch,
        signal: controller.signal,
      });
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
