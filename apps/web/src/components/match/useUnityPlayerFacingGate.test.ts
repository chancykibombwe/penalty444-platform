/**
 * B6D3B PR-2 — client cohort gate tests.
 * Node `node:test` via `tsx`. Pure decision flow via the injectable runner —
 * no React testing dependency, no real network, no real Supabase.
 *
 * The gate is convenience-only; these tests prove it FAILS CLOSED on every path
 * and never surfaces the access token.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { supabase as sharedSupabase } from "../../lib/supabase/client";

import {
  asGateSupabaseLike,
  resolveDefaultGateSupabase,
  resolveGateSupabaseFromModule,
  resolveGateWithDiagnostic,
  runUnityPlayerFacingGate,
  runUnityPlayerFacingGateDiagnosed,
  shouldRenderUnityShadow,
  type GateSupabaseLike,
  type UnityPlayerFacingGateDiagnostic,
  type UnityPlayerFacingGateState,
} from "./useUnityPlayerFacingGate";

const ALL_STATES: UnityPlayerFacingGateState[] = ["disabled", "checking", "authorized", "denied"];

const TOKEN = "supabase-access-token-value-must-never-leak";

function supabaseWith(session: { access_token?: string | null } | null, error?: unknown): GateSupabaseLike {
  return {
    auth: {
      getSession: async () => ({ data: { session }, ...(error ? { error } : {}) }),
    },
  };
}

function throwingSupabase(): GateSupabaseLike {
  return {
    auth: {
      getSession: async () => {
        throw new Error("session read failed");
      },
    },
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function recordingFetch(
  responders: Record<string, () => Response | Promise<Response>>,
): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k] = v;
    calls.push({ url, method: init?.method ?? "GET", headers });
    const responder = responders[url];
    if (!responder) throw new Error(`unexpected request: ${url}`);
    return responder();
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const STATUS = "/api/unity-cohort/status";
const SESSION = "/api/unity-cohort/session";

const okFlow = () =>
  recordingFetch({
    [STATUS]: () => json({ inCohort: true }),
    [SESSION]: () => new Response(null, { status: 204 }),
  });

// ── authorized path ───────────────────────────────────────────────────────────

test("status true + mint 204 → authorized", async () => {
  const f = okFlow();
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(outcome, "authorized");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, STATUS);
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[1].url, SESSION);
  assert.equal(f.calls[1].method, "POST");
});

test("the bearer is sent as a header and never in a URL", async () => {
  const f = okFlow();
  await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  for (const call of f.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.headers["Cache-Control"], "no-store");
    assert.equal(call.url.includes(TOKEN), false, "token must never appear in a URL");
    assert.equal(call.url.includes("?"), false, "no query-string authorization");
  }
});

test("the returned state never contains the token", async () => {
  const f = okFlow();
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(JSON.stringify(outcome).includes(TOKEN), false);
  assert.equal(outcome, "authorized");
});

// ── denial paths ──────────────────────────────────────────────────────────────

test("no Supabase client → denied without any request", async () => {
  const f = okFlow();
  const outcome = await runUnityPlayerFacingGate({ getSupabase: async () => null, fetchImpl: f.impl });
  assert.equal(outcome, "denied");
  assert.equal(f.calls.length, 0);
});

test("no browser session → denied without any request", async () => {
  const f = okFlow();
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith(null),
    fetchImpl: f.impl,
  });
  assert.equal(outcome, "denied");
  assert.equal(f.calls.length, 0);
});

test("empty/absent access token → denied without any request", async () => {
  const f = okFlow();
  for (const session of [{}, { access_token: "" }, { access_token: null }]) {
    const outcome = await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith(session),
      fetchImpl: f.impl,
    });
    assert.equal(outcome, "denied");
  }
  assert.equal(f.calls.length, 0);
});

test("session-read failure (thrown or error field) → denied", async () => {
  const f = okFlow();
  assert.equal(
    await runUnityPlayerFacingGate({ getSupabase: async () => throwingSupabase(), fetchImpl: f.impl }),
    "denied",
  );
  assert.equal(
    await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }, { message: "bad" }),
      fetchImpl: f.impl,
    }),
    "denied",
  );
  assert.equal(f.calls.length, 0);
});

test("getSupabase throwing → denied", async () => {
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => {
      throw new Error("import failed");
    },
    fetchImpl: okFlow().impl,
  });
  assert.equal(outcome, "denied");
});

test("status false → denied and the mint is NEVER attempted", async () => {
  const f = recordingFetch({
    [STATUS]: () => json({ inCohort: false }),
    [SESSION]: () => new Response(null, { status: 204 }),
  });
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(outcome, "denied");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, STATUS);
});

test("malformed status responses → denied and no mint", async () => {
  const bodies: unknown[] = [
    { inCohort: "true" },
    { inCohort: true, extra: 1 },
    {},
    [],
    null,
    "inCohort",
    { member: true },
  ];
  for (const body of bodies) {
    const f = recordingFetch({
      [STATUS]: () => json(body),
      [SESSION]: () => new Response(null, { status: 204 }),
    });
    const outcome = await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: f.impl,
    });
    assert.equal(outcome, "denied", `body ${JSON.stringify(body)} must deny`);
    assert.equal(f.calls.length, 1, "mint must not be attempted");
  }
});

test("non-200 status (incl. opaque 404) → denied and no mint", async () => {
  for (const code of [204, 301, 400, 401, 403, 404, 500]) {
    const f = recordingFetch({
      [STATUS]: () => json({ inCohort: true }, code),
      [SESSION]: () => new Response(null, { status: 204 }),
    });
    const outcome = await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: f.impl,
    });
    assert.equal(outcome, "denied", `status ${code} must deny`);
    assert.equal(f.calls.length, 1);
  }
});

test("non-JSON status body → denied", async () => {
  const f = recordingFetch({
    [STATUS]: () => new Response("<html>nope</html>", { status: 200 }),
    [SESSION]: () => new Response(null, { status: 204 }),
  });
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(outcome, "denied");
});

test("mint failure or opaque 404 → denied", async () => {
  for (const code of [200, 201, 400, 401, 403, 404, 500]) {
    const f = recordingFetch({
      [STATUS]: () => json({ inCohort: true }),
      [SESSION]: () => new Response(null, { status: code }),
    });
    const outcome = await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: f.impl,
    });
    assert.equal(outcome, "denied", `mint ${code} must deny`);
    assert.equal(f.calls.length, 2);
  }
});

test("network throw on status or mint → denied", async () => {
  const throwOnStatus = recordingFetch({
    [STATUS]: () => {
      throw new Error("network down");
    },
    [SESSION]: () => new Response(null, { status: 204 }),
  });
  assert.equal(
    await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: throwOnStatus.impl,
    }),
    "denied",
  );
  const throwOnMint = recordingFetch({
    [STATUS]: () => json({ inCohort: true }),
    [SESSION]: () => {
      throw new Error("network down");
    },
  });
  assert.equal(
    await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: throwOnMint.impl,
    }),
    "denied",
  );
});

test("an aborted signal fails closed to denied", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = recordingFetch({
    [STATUS]: () => {
      throw new DOMException("aborted", "AbortError");
    },
    [SESSION]: () => new Response(null, { status: 204 }),
  });
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
    signal: controller.signal,
  });
  assert.equal(outcome, "denied");
});

test("requests are same-origin, no-store and carry no credentials in the URL", async () => {
  const seen: RequestInit[] = [];
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init ?? {});
    return String(_input) === STATUS
      ? json({ inCohort: true })
      : new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: impl,
  });
  assert.equal(seen.length, 2);
  for (const init of seen) {
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
  }
});

// ── renderer handoff decision table (review correction) ───────────────────────
// The shadow must render ZERO Unity iframes for the whole player-facing gate
// resolution, resuming only after an explicit denial or when never requested.

test("shadow disabled → false in every gate state", () => {
  for (const gateState of ALL_STATES) {
    for (const playerFacingRequested of [false, true]) {
      assert.equal(
        shouldRenderUnityShadow({ shadowEnabled: false, playerFacingRequested, gateState }),
        false,
        `disabled shadow must stay off (${gateState}, requested=${playerFacingRequested})`,
      );
    }
  }
});

test("shadow enabled + player-facing NOT requested → true (existing behaviour)", () => {
  for (const gateState of ALL_STATES) {
    assert.equal(
      shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: false, gateState }),
      true,
      `existing shadow behaviour must be preserved (${gateState})`,
    );
  }
});

test("shadow enabled + requested + gate disabled → false", () => {
  assert.equal(
    shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState: "disabled" }),
    false,
  );
});

test("shadow enabled + requested + gate checking → false", () => {
  assert.equal(
    shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState: "checking" }),
    false,
  );
});

test("shadow enabled + requested + gate authorized → false", () => {
  assert.equal(
    shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState: "authorized" }),
    false,
  );
});

test("shadow enabled + requested + gate denied → true (shadow may resume)", () => {
  assert.equal(
    shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState: "denied" }),
    true,
  );
});

test("the full decision table matches the specification exactly", () => {
  const expected: Array<[boolean, boolean, UnityPlayerFacingGateState, boolean]> = [
    [false, false, "disabled", false],
    [false, true, "checking", false],
    [true, false, "disabled", true],
    [true, false, "checking", true],
    [true, false, "authorized", true],
    [true, false, "denied", true],
    [true, true, "disabled", false],
    [true, true, "checking", false],
    [true, true, "authorized", false],
    [true, true, "denied", true],
  ];
  for (const [shadowEnabled, playerFacingRequested, gateState, want] of expected) {
    assert.equal(
      shouldRenderUnityShadow({ shadowEnabled, playerFacingRequested, gateState }),
      want,
      `shadow=${shadowEnabled} requested=${playerFacingRequested} gate=${gateState}`,
    );
  }
});

test("authorized never renders the shadow, so host and shadow can never coexist", () => {
  // The host mounts only under `authorized` (plus identity + instance); the shadow
  // is false for `authorized`, so the two are mutually exclusive by construction.
  assert.equal(
    shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState: "authorized" }),
    false,
  );
});

// ── bounded diagnostics (non-secret categories only) ──────────────────────────

const ALL_DIAGNOSTICS: UnityPlayerFacingGateDiagnostic[] = [
  "resolver_unavailable",
  "client_shape_invalid",
  "session_read_failed",
  "session_missing",
  "access_token_missing",
  "status_request_denied",
  "status_response_invalid",
  "not_in_cohort",
  "session_mint_denied",
  "authorized",
];

const FORBIDDEN_SECRET_FRAGMENTS = [
  TOKEN,
  "Bearer ",
  "Authorization",
  "Cookie",
  "supabase.co",
  "pwfgcblgjgoywefsotga",
  "sb_publishable",
  "info@",
  "gmail.com",
  "/api/unity-cohort",
  "http://",
  "https://",
  "session read failed",
  "network down",
  "import failed",
];

function assertDiagnosticSafe(diagnostic: UnityPlayerFacingGateDiagnostic): void {
  assert.equal(ALL_DIAGNOSTICS.includes(diagnostic), true, `unknown diagnostic: ${diagnostic}`);
  const encoded = JSON.stringify(diagnostic);
  for (const frag of FORBIDDEN_SECRET_FRAGMENTS) {
    assert.equal(encoded.includes(frag), false, `diagnostic must not contain ${frag}`);
  }
}

test("diagnostics: resolver_unavailable when getSupabase returns null", async () => {
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => null,
    fetchImpl: okFlow().impl,
  });
  assert.equal(result.state, "denied");
  assert.equal(result.diagnostic, "resolver_unavailable");
  assertDiagnosticSafe(result.diagnostic);
});

test("diagnostics: resolver_unavailable when getSupabase throws", async () => {
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => {
      throw new Error("import failed");
    },
    fetchImpl: okFlow().impl,
  });
  assert.equal(result.state, "denied");
  assert.equal(result.diagnostic, "resolver_unavailable");
  assertDiagnosticSafe(result.diagnostic);
});

test("diagnostics: client_shape_invalid for a malformed client object", async () => {
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => ({ auth: {} }) as GateSupabaseLike,
    fetchImpl: okFlow().impl,
  });
  assert.equal(result.state, "denied");
  assert.equal(result.diagnostic, "client_shape_invalid");
});

test("diagnostics: session_missing / access_token_missing / session_read_failed", async () => {
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith(null),
        fetchImpl: okFlow().impl,
      })
    ).diagnostic,
    "session_missing",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: "" }),
        fetchImpl: okFlow().impl,
      })
    ).diagnostic,
    "access_token_missing",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => throwingSupabase(),
        fetchImpl: okFlow().impl,
      })
    ).diagnostic,
    "session_read_failed",
  );
});

test("diagnostics: status / cohort / mint categories", async () => {
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: TOKEN }),
        fetchImpl: recordingFetch({
          [STATUS]: () => json({ inCohort: true }, 404),
          [SESSION]: () => new Response(null, { status: 204 }),
        }).impl,
      })
    ).diagnostic,
    "status_request_denied",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: TOKEN }),
        fetchImpl: recordingFetch({
          [STATUS]: () => json({ inCohort: true, extra: 1 }),
          [SESSION]: () => new Response(null, { status: 204 }),
        }).impl,
      })
    ).diagnostic,
    "status_response_invalid",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: TOKEN }),
        fetchImpl: recordingFetch({
          [STATUS]: () => json({ inCohort: false }),
          [SESSION]: () => new Response(null, { status: 204 }),
        }).impl,
      })
    ).diagnostic,
    "not_in_cohort",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: TOKEN }),
        fetchImpl: recordingFetch({
          [STATUS]: () => json({ inCohort: true }),
          [SESSION]: () => new Response(null, { status: 404 }),
        }).impl,
      })
    ).diagnostic,
    "session_mint_denied",
  );
  assert.equal(
    (
      await runUnityPlayerFacingGateDiagnosed({
        getSupabase: async () => supabaseWith({ access_token: TOKEN }),
        fetchImpl: okFlow().impl,
      })
    ).diagnostic,
    "authorized",
  );
});

test("diagnosed runner never embeds secrets in the returned object", async () => {
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: okFlow().impl,
  });
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes(TOKEN), false);
  assertDiagnosticSafe(result.diagnostic);
  assert.deepEqual(Object.keys(result).sort(), ["diagnostic", "state"]);
});

// ── real default resolver (shared Supabase module) ────────────────────────────

test("fragile module-shape resolver rejects namespaces without supabase named export", () => {
  // Reproduces the prior dynamic-import failure mode: a module namespace that is
  // present but missing the expected named `supabase` export / auth shape.
  assert.equal(resolveGateSupabaseFromModule(null), null);
  assert.equal(resolveGateSupabaseFromModule({}), null);
  assert.equal(resolveGateSupabaseFromModule({ supabase: null }), null);
  assert.equal(resolveGateSupabaseFromModule({ supabase: { auth: {} } }), null);
  assert.equal(resolveGateSupabaseFromModule({ default: sharedSupabase }), null);
});

test("reproduced failure: default-less module namespace → resolver_unavailable (no fetch)", async () => {
  const f = okFlow();
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => resolveGateSupabaseFromModule({ default: sharedSupabase }),
    fetchImpl: f.impl,
  });
  assert.equal(result.state, "denied");
  assert.equal(result.diagnostic, "resolver_unavailable");
  assert.equal(f.calls.length, 0);
});

test("shared Supabase module resolves and exposes auth.getSession", async () => {
  const client = await resolveDefaultGateSupabase();
  assert.notEqual(client, null);
  assert.equal(typeof client?.auth.getSession, "function");
  assert.equal(asGateSupabaseLike(sharedSupabase) !== null, true);
});

test("real default resolver + valid session proceeds status → session mint", async () => {
  const original = sharedSupabase.auth.getSession.bind(sharedSupabase.auth);
  const f = okFlow();
  sharedSupabase.auth.getSession = (async () => ({
    data: { session: { access_token: TOKEN } },
    error: null,
  })) as typeof sharedSupabase.auth.getSession;
  try {
    const diagnosed = await runUnityPlayerFacingGateDiagnosed({
      getSupabase: resolveDefaultGateSupabase,
      fetchImpl: f.impl,
    });
    assert.equal(diagnosed.state, "authorized");
    assert.equal(diagnosed.diagnostic, "authorized");
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].url, STATUS);
    assert.equal(f.calls[1].url, SESSION);
    assert.equal(f.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(diagnosed).includes(TOKEN), false);
  } finally {
    sharedSupabase.auth.getSession = original;
  }
});

test("real default resolver: missing session / token fails before fetch", async () => {
  const original = sharedSupabase.auth.getSession.bind(sharedSupabase.auth);
  const f = okFlow();
  try {
    sharedSupabase.auth.getSession = (async () => ({
      data: { session: null },
      error: null,
    })) as typeof sharedSupabase.auth.getSession;
    assert.equal(
      (await runUnityPlayerFacingGateDiagnosed({ getSupabase: resolveDefaultGateSupabase, fetchImpl: f.impl }))
        .diagnostic,
      "session_missing",
    );
    sharedSupabase.auth.getSession = (async () => ({
      data: { session: { access_token: "" } },
      error: null,
    })) as typeof sharedSupabase.auth.getSession;
    assert.equal(
      (await runUnityPlayerFacingGateDiagnosed({ getSupabase: resolveDefaultGateSupabase, fetchImpl: f.impl }))
        .diagnostic,
      "access_token_missing",
    );
    assert.equal(f.calls.length, 0);
  } finally {
    sharedSupabase.auth.getSession = original;
  }
});

test("real default resolver: malformed / non-200 status fails closed; mint non-204 fails closed", async () => {
  const original = sharedSupabase.auth.getSession.bind(sharedSupabase.auth);
  sharedSupabase.auth.getSession = (async () => ({
    data: { session: { access_token: TOKEN } },
    error: null,
  })) as typeof sharedSupabase.auth.getSession;
  try {
    const badStatus = recordingFetch({
      [STATUS]: () => json({ inCohort: true }, 500),
      [SESSION]: () => new Response(null, { status: 204 }),
    });
    assert.equal(
      (
        await runUnityPlayerFacingGateDiagnosed({
          getSupabase: resolveDefaultGateSupabase,
          fetchImpl: badStatus.impl,
        })
      ).diagnostic,
      "status_request_denied",
    );
    assert.equal(badStatus.calls.length, 1);

    const badBody = recordingFetch({
      [STATUS]: () => json({ inCohort: "yes" }),
      [SESSION]: () => new Response(null, { status: 204 }),
    });
    assert.equal(
      (
        await runUnityPlayerFacingGateDiagnosed({
          getSupabase: resolveDefaultGateSupabase,
          fetchImpl: badBody.impl,
        })
      ).diagnostic,
      "status_response_invalid",
    );

    const badMint = recordingFetch({
      [STATUS]: () => json({ inCohort: true }),
      [SESSION]: () => new Response(null, { status: 200 }),
    });
    assert.equal(
      (
        await runUnityPlayerFacingGateDiagnosed({
          getSupabase: resolveDefaultGateSupabase,
          fetchImpl: badMint.impl,
        })
      ).diagnostic,
      "session_mint_denied",
    );
    assert.equal(badMint.calls.length, 2);
  } finally {
    sharedSupabase.auth.getSession = original;
  }
});

test("player-facing public API still returns only authorized|denied (no diagnostic)", async () => {
  const outcome = await runUnityPlayerFacingGate({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: okFlow().impl,
  });
  assert.equal(outcome, "authorized");
  assert.equal(typeof outcome, "string");
  assert.equal(JSON.stringify(outcome), '"authorized"');
});

// ── B6D3C: optional bounded-diagnostic reporting ──────────────────────────────
//
// `resolveGateWithDiagnostic` is exactly what the React hook's effect runs, so
// these tests cover the hook's behaviour without a React testing dependency.

const DIAGNOSTIC_VALUES: UnityPlayerFacingGateDiagnostic[] = [
  "resolver_unavailable",
  "client_shape_invalid",
  "session_read_failed",
  "session_missing",
  "access_token_missing",
  "status_request_denied",
  "status_response_invalid",
  "not_in_cohort",
  "session_mint_denied",
  "authorized",
];

test("diagnostic sink: the resolved state is still authorized on the happy path", async () => {
  const f = okFlow();
  const seen: UnityPlayerFacingGateDiagnostic[] = [];
  const state = await resolveGateWithDiagnostic(
    { getSupabase: async () => supabaseWith({ access_token: TOKEN }), fetchImpl: f.impl },
    (d) => seen.push(d),
  );
  assert.equal(state, "authorized");
  assert.deepEqual(seen, ["authorized"]);
});

test("diagnostic sink: the resolved state is still denied on failures", async () => {
  const f = okFlow();
  const seen: UnityPlayerFacingGateDiagnostic[] = [];
  const state = await resolveGateWithDiagnostic(
    { getSupabase: async () => supabaseWith(null), fetchImpl: f.impl },
    (d) => seen.push(d),
  );
  assert.equal(state, "denied");
  assert.deepEqual(seen, ["session_missing"], "the denial category must reach the operator");
  assert.equal(f.calls.length, 0, "a denial before the first fetch issues no request");
});

test("diagnostic sink: every denial category is reportable and stays in the bounded set", async () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["resolver_unavailable", async () => null],
    ["client_shape_invalid", async () => ({ auth: {} })],
    ["session_missing", async () => supabaseWith(null)],
    ["access_token_missing", async () => supabaseWith({ access_token: "" })],
    ["session_read_failed", async () => throwingSupabase()],
  ];
  for (const [expected, getSupabase] of cases) {
    const seen: UnityPlayerFacingGateDiagnostic[] = [];
    const state = await resolveGateWithDiagnostic(
      { getSupabase: getSupabase as () => Promise<GateSupabaseLike | null>, fetchImpl: okFlow().impl },
      (d) => seen.push(d),
    );
    assert.equal(state, "denied");
    assert.deepEqual(seen, [expected]);
    assert.ok(DIAGNOSTIC_VALUES.includes(seen[0]), `${seen[0]} must be a bounded category`);
  }
});

test("diagnostics never duplicate the status request or the capability mint", async () => {
  // Without a sink.
  const bare = okFlow();
  await resolveGateWithDiagnostic({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: bare.impl,
  });
  // With a sink.
  const diagnosed = okFlow();
  const seen: UnityPlayerFacingGateDiagnostic[] = [];
  await resolveGateWithDiagnostic(
    { getSupabase: async () => supabaseWith({ access_token: TOKEN }), fetchImpl: diagnosed.impl },
    (d) => seen.push(d),
  );

  assert.equal(bare.calls.length, 2, "one status + one mint");
  assert.equal(diagnosed.calls.length, 2, "enabling diagnostics must not add a request");
  assert.deepEqual(
    diagnosed.calls.map((c) => `${c.method} ${c.url}`),
    bare.calls.map((c) => `${c.method} ${c.url}`),
    "the request sequence must be byte-identical with and without diagnostics",
  );
  assert.equal(diagnosed.calls.filter((c) => c.url === STATUS).length, 1);
  assert.equal(diagnosed.calls.filter((c) => c.url === SESSION).length, 1);
  assert.equal(seen.length, 1, "exactly one diagnostic per resolution");
});

test("the sink is optional — omitting it preserves existing behaviour exactly", async () => {
  const f = okFlow();
  const state = await resolveGateWithDiagnostic({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(state, "authorized");
  assert.equal(f.calls.length, 2);
  // And the legacy non-diagnostic wrapper is unchanged.
  const legacy = okFlow();
  assert.equal(
    await runUnityPlayerFacingGate({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: legacy.impl,
    }),
    "authorized",
  );
  assert.equal(legacy.calls.length, 2);
});

test("the sink receives ONLY a bounded enum — no token, email, header or body", async () => {
  const received: unknown[] = [];
  for (const getSupabase of [
    async () => supabaseWith({ access_token: TOKEN }),
    async () => supabaseWith(null),
  ]) {
    await resolveGateWithDiagnostic(
      { getSupabase, fetchImpl: okFlow().impl },
      (...args: unknown[]) => received.push(...args),
    );
  }
  assert.equal(received.length, 2);
  for (const value of received) {
    assert.equal(typeof value, "string", "the sink must receive a plain string");
    assert.ok(DIAGNOSTIC_VALUES.includes(value as UnityPlayerFacingGateDiagnostic));
  }
  const serialized = JSON.stringify(received);
  assert.equal(serialized.includes(TOKEN), false, "the access token must never reach the sink");
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("@"), false, "no email-shaped value may reach the sink");
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes("cookie"), false);
});

test("a throwing sink can never change the gate decision", async () => {
  const f = okFlow();
  const state = await resolveGateWithDiagnostic(
    { getSupabase: async () => supabaseWith({ access_token: TOKEN }), fetchImpl: f.impl },
    () => {
      throw new Error("operator tooling blew up");
    },
  );
  assert.equal(state, "authorized", "the decision is computed before the sink runs");
  assert.equal(f.calls.length, 2, "and no request is repeated");
});

test("the hook wires the sink through the ref, so it cannot re-run the effect", () => {
  const source = readFileSync(new URL("./useUnityPlayerFacingGate.ts", import.meta.url), "utf8");
  // One resolution per request, via the diagnosed path.
  assert.ok(/const outcome = await resolveGateWithDiagnostic\(/.test(source));
  assert.equal(
    /await runUnityPlayerFacingGate\(\{/.test(source),
    false,
    "the hook must no longer call the diagnostic-discarding wrapper",
  );
  // Read from the mutable ref, and `requested` remains the only effect dep.
  assert.ok(/depsRef\.current\.onDiagnostic\?\.\(diagnostic\)/.test(source));
  assert.ok(/\}, \[requested\]\);/.test(source), "the effect must still depend only on `requested`");
  // Unmount protection guards the sink as well as setState.
  assert.equal(
    (source.match(/if \(!mounted \|\| controller\.signal\.aborted\) return;/g) ?? []).length,
    2,
    "both the sink and setState must be unmount-protected",
  );
});

// ── B6D3C: native-fetch RECEIVER regression ───────────────────────────────────
//
// Reproduces the confirmed browser failure. Native `fetch` is a method of the
// global object: invoking it as `deps.fetchImpl(...)` makes `this === deps` and
// the browser throws `TypeError: Illegal invocation` BEFORE any request leaves
// the page. The gate caught that throw and flattened it to
// `status_request_denied`, which is exactly what the Preview reported.
//
// An arrow-function double cannot catch this (arrows ignore `this`), so the
// double below is deliberately receiver-sensitive.

interface ReceiverCall {
  url: string;
  method: string;
  receiverWasGlobal: boolean;
  signal: AbortSignal | null | undefined;
  hasAuthorization: boolean;
}

function receiverSensitiveFetch(options?: {
  statusCode?: number;
  statusBody?: unknown;
  mintStatus?: number;
}): { calls: ReceiverCall[]; impl: typeof fetch } {
  const calls: ReceiverCall[] = [];
  function impl(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // The exact behaviour of native browser `fetch`.
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    const url = String(input);
    const raw = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      receiverWasGlobal: true,
      signal: init?.signal,
      hasAuthorization: typeof raw.Authorization === "string",
    });
    if (url === STATUS) {
      return Promise.resolve(
        json(options?.statusBody ?? { inCohort: true }, options?.statusCode ?? 200),
      );
    }
    if (url === SESSION) {
      return Promise.resolve(new Response(null, { status: options?.mintStatus ?? 204 }));
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  }
  return { calls, impl: impl as unknown as typeof fetch };
}

test("regression: the double genuinely reproduces the browser TypeError method-style", () => {
  // This is the pre-fix call shape: `deps.fetchImpl(...)` ⇒ `this === deps`.
  const f = receiverSensitiveFetch();
  const deps = { fetchImpl: f.impl };
  assert.throws(
    () => {
      void deps.fetchImpl(STATUS, { method: "GET" });
    },
    (error: unknown) => error instanceof TypeError,
    "the double must throw exactly as native fetch does for a non-global receiver",
  );
  assert.equal(f.calls.length, 0, "no request may be recorded when the receiver is wrong");
});

test("regression: a receiver-sensitive native fetch now AUTHORIZES through the gate", async () => {
  const f = receiverSensitiveFetch();
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.equal(result.state, "authorized");
  assert.equal(result.diagnostic, "authorized");
  // Exactly one status and one mint, in that order.
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.filter((c) => c.url === STATUS).length, 1);
  assert.equal(f.calls.filter((c) => c.url === SESSION).length, 1);
  assert.deepEqual(
    f.calls.map((c) => `${c.method} ${c.url}`),
    [`GET ${STATUS}`, `POST ${SESSION}`],
    "the request sequence must be status then mint",
  );
  assert.ok(f.calls.every((c) => c.receiverWasGlobal));
  assert.ok(f.calls.every((c) => c.hasAuthorization), "the bearer must still be sent");
});

test("regression: the AbortSignal still reaches both requests through the bound call", async () => {
  const controller = new AbortController();
  const f = receiverSensitiveFetch();
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
    signal: controller.signal,
  });
  assert.equal(result.state, "authorized");
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.signal, controller.signal, "the caller's signal must be forwarded verbatim");
  }
});

test("regression: fail-closed denials survive the receiver fix", async () => {
  // Non-200 status.
  const denied = receiverSensitiveFetch({ statusCode: 403 });
  assert.deepEqual(
    await runUnityPlayerFacingGateDiagnosed({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: denied.impl,
    }),
    { state: "denied", diagnostic: "status_request_denied" },
  );
  assert.equal(denied.calls.length, 1, "the mint must never be attempted after a status denial");

  // Non-member.
  const notMember = receiverSensitiveFetch({ statusBody: { inCohort: false } });
  assert.deepEqual(
    await runUnityPlayerFacingGateDiagnosed({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: notMember.impl,
    }),
    { state: "denied", diagnostic: "not_in_cohort" },
  );
  assert.equal(notMember.calls.length, 1);

  // Mint failure.
  const badMint = receiverSensitiveFetch({ mintStatus: 404 });
  assert.deepEqual(
    await runUnityPlayerFacingGateDiagnosed({
      getSupabase: async () => supabaseWith({ access_token: TOKEN }),
      fetchImpl: badMint.impl,
    }),
    { state: "denied", diagnostic: "session_mint_denied" },
  );
  assert.equal(badMint.calls.length, 2, "the mint is attempted exactly once");
});

test("regression: binding never mutates the caller's dependency object", async () => {
  const f = receiverSensitiveFetch();
  const deps = {
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  };
  const original = deps.fetchImpl;
  await runUnityPlayerFacingGateDiagnosed(deps);
  assert.equal(deps.fetchImpl, original, "deps.fetchImpl must be left untouched");
});

test("regression: the fix does not alter the diagnosed result shape or leak anything", async () => {
  const f = receiverSensitiveFetch();
  const result = await runUnityPlayerFacingGateDiagnosed({
    getSupabase: async () => supabaseWith({ access_token: TOKEN }),
    fetchImpl: f.impl,
  });
  assert.deepEqual(Object.keys(result).sort(), ["diagnostic", "state"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("@"), false);
});

test("the runner invokes a receiver-safe callable for BOTH endpoints", () => {
  const raw = readFileSync(new URL("./useUnityPlayerFacingGate.ts", import.meta.url), "utf8");
  // Strip comments: the fix is documented by naming the old broken call shape,
  // and prose must not read as a violation (nor hide one).
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  assert.ok(
    /const fetchImpl = deps\.fetchImpl\.bind\(globalThis\);/.test(source),
    "the callable must be normalized once with a valid global receiver",
  );
  assert.equal(
    (source.match(/deps\.fetchImpl/g) ?? []).length,
    1,
    "`deps.fetchImpl` may appear exactly once — in the bind, never as a call site",
  );
  assert.equal(
    /deps\.fetchImpl\(/.test(source),
    false,
    "no call site may invoke fetch method-style off `deps`",
  );
  assert.equal(
    (source.match(/await fetchImpl\(/g) ?? []).length,
    2,
    "exactly the status request and the capability mint",
  );
});
