/**
 * B6D3B PR-2 — player-facing host tests.
 * Node `node:test` via `tsx`, using the pure lifecycle reducer plus
 * `ReactDOMServer.renderToStaticMarkup`. No React Testing Library, no jsdom, no
 * new dependency.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import UnityPresentationHost, {
  computeHostState,
  shouldMountRenderer,
  INITIAL_HOST_RUNTIME,
  type HostState,
  type HostRuntimeState,
} from "./UnityPresentationHost";
import {
  PRESENTATION_PROTOCOL_VERSION,
  PRESENTATION_TYPE,
  validateEnvelope,
  type PresentationEnvelope,
} from "./unityPresentationProtocol";
import { buildViewerIdentityContext } from "./unityPresentationIdentity";

const INSTANCE = "ABCD12:1";
const OTHER_INSTANCE = "ABCD12:2";

const identity = buildViewerIdentityContext({
  matchInstanceId: INSTANCE,
  viewerPlayerId: "self-id",
  scores: { "self-id": 1, "opp-id": 0 },
})!;

const stateSyncMessage = validateEnvelope({
  type: PRESENTATION_TYPE,
  protocolVersion: PRESENTATION_PROTOCOL_VERSION,
  matchInstanceId: INSTANCE,
  sequence: 1,
  event: "match_state_sync",
  payload: { scores: { LEFT: 1, RIGHT: 0 }, round: 1, maxRounds: 5, phase: "NORMAL" },
}) as PresentationEnvelope;

const messages = [{ id: `${INSTANCE}:1:match_state_sync`, message: stateSyncMessage }];

const runtime = (over: Partial<HostRuntimeState> = {}): HostRuntimeState => ({
  ...INITIAL_HOST_RUNTIME,
  ...over,
});

function render(over: Partial<React.ComponentProps<typeof UnityPresentationHost>> = {}): string {
  return renderToStaticMarkup(
    <UnityPresentationHost
      playerFacingAuthorized
      matchInstanceId={INSTANCE}
      messages={messages}
      identity={identity}
      correlation={null}
      onReady={() => {}}
      onError={() => {}}
      onMessageSent={() => {}}
      {...over}
    >
      <div data-underlay-artwork="">pitch artwork</div>
    </UnityPresentationHost>,
  );
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ── pure lifecycle reducer ────────────────────────────────────────────────────

test("unauthorized, missing instance or missing identity → REACT_ONLY", () => {
  const base = { matchInstanceId: INSTANCE, identityInstanceId: INSTANCE, runtime: runtime() };
  assert.equal(computeHostState({ ...base, playerFacingAuthorized: false }), "REACT_ONLY");
  assert.equal(
    computeHostState({ ...base, playerFacingAuthorized: true, matchInstanceId: null }),
    "REACT_ONLY",
  );
  assert.equal(
    computeHostState({ ...base, playerFacingAuthorized: true, matchInstanceId: "" }),
    "REACT_ONLY",
  );
  assert.equal(
    computeHostState({ ...base, playerFacingAuthorized: true, identityInstanceId: null }),
    "REACT_ONLY",
  );
});

test("sanitized identity / instance mismatch fails to React", () => {
  assert.equal(
    computeHostState({
      playerFacingAuthorized: true,
      matchInstanceId: INSTANCE,
      identityInstanceId: OTHER_INSTANCE,
      runtime: runtime(),
    }),
    "REACT_ONLY",
  );
});

test("authorized + valid instance → UNITY_LOADING, then READY on ready", () => {
  const base = {
    playerFacingAuthorized: true,
    matchInstanceId: INSTANCE,
    identityInstanceId: INSTANCE,
  };
  assert.equal(computeHostState({ ...base, runtime: runtime() }), "UNITY_LOADING");
  assert.equal(
    computeHostState({ ...base, runtime: runtime({ readyInstanceId: INSTANCE }) }),
    "UNITY_READY_VISIBLE",
  );
});

test("failure is terminal for the SAME instance and beats readiness", () => {
  const base = {
    playerFacingAuthorized: true,
    matchInstanceId: INSTANCE,
    identityInstanceId: INSTANCE,
  };
  assert.equal(
    computeHostState({ ...base, runtime: runtime({ failedInstanceId: INSTANCE }) }),
    "UNITY_FAILED_REACT_FALLBACK",
  );
  assert.equal(
    computeHostState({
      ...base,
      runtime: runtime({ failedInstanceId: INSTANCE, readyInstanceId: INSTANCE }),
    }),
    "UNITY_FAILED_REACT_FALLBACK",
    "a failed renderer must never resurrect",
  );
});

test("a NEW match instance resets the terminal failure", () => {
  assert.equal(
    computeHostState({
      playerFacingAuthorized: true,
      matchInstanceId: OTHER_INSTANCE,
      identityInstanceId: OTHER_INSTANCE,
      runtime: runtime({ failedInstanceId: INSTANCE }),
    }),
    "UNITY_LOADING",
  );
});

test("the renderer mounts only while loading or ready", () => {
  assert.equal(shouldMountRenderer("REACT_ONLY"), false);
  assert.equal(shouldMountRenderer("UNITY_LOADING"), true);
  assert.equal(shouldMountRenderer("UNITY_READY_VISIBLE"), true);
  assert.equal(shouldMountRenderer("UNITY_FAILED_REACT_FALLBACK"), false);
});

// ── rendered output ───────────────────────────────────────────────────────────

test("the React underlay stays mounted in EVERY state", () => {
  const states: HostState[] = [
    "REACT_ONLY",
    "UNITY_LOADING",
    "UNITY_READY_VISIBLE",
    "UNITY_FAILED_REACT_FALLBACK",
  ];
  for (const forceState of states) {
    const html = render({ testHooks: { forceState } });
    assert.ok(html.includes("data-underlay-artwork"), `underlay missing in ${forceState}`);
    assert.ok(html.includes("pitch artwork"), `underlay content missing in ${forceState}`);
    assert.equal(count(html, "data-unity-underlay"), 1);
  }
});

test("unauthorized → no renderer slot at all", () => {
  const html = render({ playerFacingAuthorized: false });
  assert.ok(html.includes('data-host-state="REACT_ONLY"'));
  assert.equal(count(html, "data-unity-slot"), 0);
});

test("missing identity → REACT_ONLY and no renderer slot", () => {
  const html = render({ identity: null });
  assert.ok(html.includes('data-host-state="REACT_ONLY"'));
  assert.equal(count(html, "data-unity-slot"), 0);
});

test("loading → exactly one renderer slot", () => {
  const html = render({ testHooks: { forceState: "UNITY_LOADING" } });
  assert.ok(html.includes('data-host-state="UNITY_LOADING"'));
  assert.equal(count(html, "data-unity-slot"), 1);
});

test("ready → one renderer slot; the underlay is only visually hidden", () => {
  const html = render({ testHooks: { forceState: "UNITY_READY_VISIBLE" } });
  assert.equal(count(html, "data-unity-slot"), 1);
  assert.ok(html.includes("data-underlay-artwork"), "underlay must still be mounted");
  assert.ok(html.includes("opacity-0"), "underlay must be visually hidden, not unmounted");
});

test("failure → renderer removed and the underlay exposed, with no error card", () => {
  const html = render({ testHooks: { forceState: "UNITY_FAILED_REACT_FALLBACK" } });
  assert.equal(count(html, "data-unity-slot"), 0, "renderer must be unmounted");
  assert.ok(html.includes("data-underlay-artwork"));
  assert.ok(html.includes("opacity-100"), "underlay must be fully visible again");
  // No player-facing error surface over gameplay.
  for (const word of ["error", "Error", "failed", "Failed", "unavailable"]) {
    assert.equal(html.includes(word), false, `host must not surface "${word}"`);
  }
});

test("at most ONE renderer slot exists in any state", () => {
  for (const forceState of [
    "REACT_ONLY",
    "UNITY_LOADING",
    "UNITY_READY_VISIBLE",
    "UNITY_FAILED_REACT_FALLBACK",
  ] as HostState[]) {
    assert.ok(count(render({ testHooks: { forceState } }), "data-unity-slot") <= 1);
  }
});

test("the host never renders controls, scoreboard, timer or aria-live content", () => {
  const html = render({ testHooks: { forceState: "UNITY_READY_VISIBLE" } });
  for (const forbidden of ["<button", "aria-live", 'role="status"', "onClick"]) {
    assert.equal(html.includes(forbidden), false, `host must not contain ${forbidden}`);
  }
  // The decorative underlay is hidden from assistive technology.
  assert.ok(html.includes('aria-hidden="true"'));
});

test("the host output contains no raw player id", () => {
  const html = render({ testHooks: { forceState: "UNITY_READY_VISIBLE" } });
  assert.equal(html.includes("self-id"), false);
  assert.equal(html.includes("opp-id"), false);
});

// ── callback containment ──────────────────────────────────────────────────────

test("throwing onReady/onError/onMessageSent never break rendering", () => {
  const boom = () => {
    throw new Error("consumer exploded");
  };
  assert.doesNotThrow(() => {
    render({
      testHooks: { forceState: "UNITY_LOADING" },
      onReady: boom,
      onError: boom,
      onMessageSent: boom,
    });
  });
});
