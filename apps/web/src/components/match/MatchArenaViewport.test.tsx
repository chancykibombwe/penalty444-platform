/**
 * B6D3B PR-2 — arena viewport + MatchRoomPanel integration assertions.
 * Node `node:test` via `tsx` with `renderToStaticMarkup` and source inspection.
 * No React Testing Library, no jsdom, no new dependency.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import MatchArenaViewport from "./MatchArenaViewport";
import {
  PRESENTATION_PROTOCOL_VERSION,
  PRESENTATION_TYPE,
  validateEnvelope,
  type PresentationEnvelope,
} from "./unityPresentationProtocol";
import { buildViewerIdentityContext } from "./unityPresentationIdentity";
import { shouldRenderUnityShadow } from "./useUnityPlayerFacingGate";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const panelSource = readFileSync(`${HERE}MatchRoomPanel.tsx`, "utf8");
const rendererSource = readFileSync(`${HERE}MatchRenderer3D.tsx`, "utf8");

const INSTANCE = "ABCD12:1";
const identity = buildViewerIdentityContext({
  matchInstanceId: INSTANCE,
  viewerPlayerId: "self-id",
  scores: { "self-id": 2, "opp-id": 1 },
})!;
const message = validateEnvelope({
  type: PRESENTATION_TYPE,
  protocolVersion: PRESENTATION_PROTOCOL_VERSION,
  matchInstanceId: INSTANCE,
  sequence: 1,
  event: "match_state_sync",
  payload: { scores: { LEFT: 2, RIGHT: 1 }, round: 1, maxRounds: 5, phase: "NORMAL" },
}) as PresentationEnvelope;

function render(playerFacingActive: boolean): string {
  return renderToStaticMarkup(
    <MatchArenaViewport
      playerFacingActive={playerFacingActive}
      matchInstanceId={INSTANCE}
      messages={[{ id: "m1", message }]}
      identity={identity}
      correlation={null}
      onReady={() => {}}
      onError={() => {}}
      onMessageSent={() => {}}
    >
      <div data-decorative-artwork="">pitch dividers</div>
    </MatchArenaViewport>,
  );
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ── viewport layering ─────────────────────────────────────────────────────────

test("the decorative layer renders in both modes", () => {
  for (const active of [false, true]) {
    const html = render(active);
    assert.ok(html.includes("data-decorative-artwork"), `artwork missing (active=${active})`);
    assert.ok(html.includes("pitch dividers"));
  }
});

test("the presentation layer sits below content and captures no pointer input", () => {
  const html = render(true);
  assert.ok(html.includes("data-arena-viewport"));
  assert.ok(html.includes("pointer-events-none"), "must not capture pointer input");
  assert.ok(/z-index:\s*-10/.test(html), "must paint below in-flow controls");
});

test("the decorative layer owns no accessibility content", () => {
  const html = render(true);
  assert.ok(html.includes('aria-hidden="true"'));
  for (const forbidden of ["<button", "aria-live", 'role="status"', "tabindex=\"0\""]) {
    assert.equal(html.includes(forbidden), false, `viewport must not contain ${forbidden}`);
  }
});

test("inactive mode renders the artwork with no Unity host at all", () => {
  const html = render(false);
  assert.equal(count(html, "data-unity-host"), 0);
  assert.equal(count(html, "data-unity-slot"), 0);
});

test("active mode mounts exactly one host", () => {
  const html = render(true);
  assert.equal(count(html, "data-unity-host"), 1);
});

// ── MatchRoomPanel integration (source assertions) ────────────────────────────

test("the player-facing host receives PROJECTED sanitized messages", () => {
  assert.ok(
    /messages=\{viewerPresentation\.messages\}/.test(panelSource),
    "the viewport must receive viewerPresentation.messages",
  );
  assert.ok(
    /identity=\{viewerPresentation\.identity\}/.test(panelSource),
    "the viewport must receive the sanitized identity",
  );
  // The raw pending buffer must never be handed to the player-facing path.
  // Scope the check to the MatchArenaViewport element itself (up to its `>`).
  const viewportTag = /<MatchArenaViewport[\s\S]*?>/.exec(panelSource);
  assert.ok(viewportTag, "MatchArenaViewport must be mounted");
  assert.equal(
    viewportTag[0].includes("unityB6D2Pending"),
    false,
    "raw pending messages must never reach the player-facing host",
  );
  assert.ok(viewportTag[0].includes("viewerPresentation.messages"));
});

test("the existing shadow still receives the ORIGINAL pending messages", () => {
  assert.ok(
    /messages=\{unityB6D2Pending\}/.test(panelSource),
    "the shadow renderer keeps using the existing pending buffer",
  );
});

test("the renderer handoff is driven by the pure decision helper", () => {
  // The old inline `unityShadowEnabled && !unityPlayerFacingActive` condition left
  // the shadow mounted during `checking`; the helper closes that window.
  assert.equal(
    /\{unityShadowEnabled && !unityPlayerFacingActive \?/.test(panelSource),
    false,
    "the superseded inline XOR condition must be gone",
  );
  assert.ok(
    /shouldRenderUnityShadow\(\{/.test(panelSource),
    "MatchRoomPanel must use the pure shadow-decision helper",
  );
  assert.ok(
    /shadowEnabled: unityShadowEnabled/.test(panelSource) &&
      /playerFacingRequested: unityPlayerFacingRequested/.test(panelSource) &&
      /gateState: unityPlayerFacingGate/.test(panelSource),
    "the helper must receive shadow, requested and gate inputs",
  );
  assert.ok(
    /\{unityShadowVisible \?/.test(panelSource),
    "the shadow section must render from the derived decision",
  );
  assert.ok(
    /playerFacingActive=\{unityPlayerFacingActive\}/.test(panelSource),
    "the viewport must be driven by the host activation flag",
  );
});

test("zero Unity iframes are possible while the gate is resolving", () => {
  // Host activation requires `authorized`; the helper returns false for
  // disabled/checking/authorized — so during resolution neither mounts.
  for (const gateState of ["disabled", "checking", "authorized"] as const) {
    assert.equal(
      shouldRenderUnityShadow({ shadowEnabled: true, playerFacingRequested: true, gateState }),
      false,
      `shadow must not mount while gate is ${gateState}`,
    );
  }
  // The host itself additionally needs identity + instance.
  assert.ok(/unityPlayerFacingGate === "authorized"/.test(panelSource));
  assert.ok(/viewerPresentation\.identity !== null/.test(panelSource));
});

test("player-facing requires the fourth public flag plus the cohort gate", () => {
  assert.ok(panelSource.includes("NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED"));
  assert.ok(/unityPlayerFacingGate === "authorized"/.test(panelSource));
  assert.ok(
    /unityPlayerFacingRequested =\s*\n?\s*unityB6D2ShadowEnabled &&/.test(panelSource),
    "the player-facing request must build on the existing shadow flags",
  );
});

test("no second coordinator, emitter or queue was created", () => {
  assert.equal(
    count(panelSource, "new UnityPresentationShadowCoordinator()"),
    1,
    "exactly one shadow coordinator may exist",
  );
  assert.equal(count(panelSource, "new PresentationSequenceEmitter"), 0);
  assert.equal(count(panelSource, "new ShadowDispatchQueue"), 0);
});

test("the existing ready/error/sent callbacks are reused, not duplicated", () => {
  assert.equal(count(panelSource, "const handleB6D2Ready"), 1);
  assert.equal(count(panelSource, "const handleB6D2Error"), 1);
  assert.equal(count(panelSource, "const handleB6D2Sent"), 1);
  assert.ok(/onReady=\{handleB6D2Ready\}/.test(panelSource));
  assert.ok(/onError=\{handleB6D2Error\}/.test(panelSource));
  assert.ok(/onMessageSent=\{handleB6D2Sent\}/.test(panelSource));
});

test("pick() and the socket subscription set were not duplicated", () => {
  assert.equal(count(panelSource, "function pick(lane: Lane)"), 1, "exactly one pick() definition");
  assert.equal(count(panelSource, 'socket.emit("match:pick"'), 1);
  // The single socket effect keeps one on/off pairing per event.
  assert.equal(
    count(panelSource, 'socket.on("match:result"'),
    count(panelSource, 'socket.off("match:result"'),
    "match:result subscriptions and cleanups must stay paired",
  );
  assert.equal(
    count(panelSource, 'socket.on("match:update"'),
    count(panelSource, 'socket.off("match:update"'),
    "match:update subscriptions and cleanups must stay paired",
  );
});

test("the player-facing path passes presentationOnly isolation to the renderer", () => {
  const hostSource = readFileSync(`${HERE}UnityPresentationHost.tsx`, "utf8");
  assert.ok(/presentationOnly/.test(hostSource));
  assert.ok(/deliveryMode="fifo"/.test(hostSource));
});

test("MatchRenderer3D isolation is opt-in and preserves default behaviour", () => {
  assert.ok(/presentationOnly = false/.test(rendererSource), "must default to false");
  assert.ok(/presentationOnly \? \{ inert: true \}/.test(rendererSource));
  assert.ok(/tabIndex: -1/.test(rendererSource));
  // The existing gates/timeouts/validation are untouched.
  assert.ok(rendererSource.includes("NEXT_PUBLIC_UNITY_MATCH_ENABLED"));
  assert.ok(rendererSource.includes("UNITY_READY_TIMEOUT_MS"));
});
