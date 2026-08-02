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

import {
  runUnityPlayerFacingGate,
  shouldRenderUnityShadow,
  type GateSupabaseLike,
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
