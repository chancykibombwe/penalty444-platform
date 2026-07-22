/**
 * B6D3A — Unit tests for the viewer-relative identity / visual-side contract.
 * Runs on Node's built-in `node:test` via `tsx` (see package.json
 * `test:unity-presentation`). Pure TypeScript; no Unity, no sockets, no React.
 *
 * Tests assert the CONTRACT (deterministic SELF/OPPONENT mapping, deterministic
 * visual side, role/score projection, authoritative-only outcome, privacy: no raw
 * id in any output, no mutation of inputs, and controlled null on malformed /
 * hostile input) rather than internal implementation details.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewerIdentityContext,
  sanitizeDisplayLabel,
  MAX_DISPLAY_LABEL_LENGTH,
  type ViewerIdentityInput,
} from "./unityPresentationIdentity";

const INSTANCE = "ABCD12:1";

function baseInput(overrides: Partial<ViewerIdentityInput> = {}): ViewerIdentityInput {
  return {
    matchInstanceId: INSTANCE,
    viewerPlayerId: "player-self-uuid",
    scores: { "player-self-uuid": 2, "player-opp-uuid": 1 },
    ...overrides,
  };
}

// ── Core mapping ────────────────────────────────────────────────────────────────

test("maps viewer to SELF (LEFT) and the other to OPPONENT (RIGHT)", () => {
  const ctx = buildViewerIdentityContext(baseInput());
  assert.ok(ctx);
  assert.equal(ctx.matchInstanceId, INSTANCE);
  assert.equal(ctx.self.participant, "SELF");
  assert.equal(ctx.self.side, "LEFT");
  assert.equal(ctx.self.score, 2);
  assert.equal(ctx.opponent.participant, "OPPONENT");
  assert.equal(ctx.opponent.side, "RIGHT");
  assert.equal(ctx.opponent.score, 1);
});

test("mapping is deterministic when the score key order is reversed", () => {
  const forward = buildViewerIdentityContext(baseInput());
  const reversed = buildViewerIdentityContext(
    baseInput({ scores: { "player-opp-uuid": 1, "player-self-uuid": 2 } }),
  );
  assert.deepStrictEqual(reversed, forward);
});

test("visual side is deterministic: SELF is always LEFT regardless of scores", () => {
  const a = buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": 0, "player-opp-uuid": 5 } }));
  const b = buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": 9, "player-opp-uuid": 0 } }));
  assert.equal(a?.self.side, "LEFT");
  assert.equal(a?.opponent.side, "RIGHT");
  assert.equal(b?.self.side, "LEFT");
  assert.equal(b?.opponent.side, "RIGHT");
});

// ── Roles ─────────────────────────────────────────────────────────────────────

test("kicker=SELF / keeper=OPPONENT maps roles viewer-relative", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ kickerPlayerId: "player-self-uuid", keeperPlayerId: "player-opp-uuid" }),
  );
  assert.equal(ctx?.self.role, "KICKER");
  assert.equal(ctx?.opponent.role, "KEEPER");
});

test("kicker=OPPONENT / keeper=SELF maps roles viewer-relative", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ kickerPlayerId: "player-opp-uuid", keeperPlayerId: "player-self-uuid" }),
  );
  assert.equal(ctx?.self.role, "KEEPER");
  assert.equal(ctx?.opponent.role, "KICKER");
});

test("roles omitted entirely when no kicker/keeper ids are supplied", () => {
  const ctx = buildViewerIdentityContext(baseInput());
  assert.equal(ctx?.self.role, undefined);
  assert.equal(ctx?.opponent.role, undefined);
  assert.ok(!("role" in (ctx as object as Record<string, unknown>)));
});

test("partial roles (only kicker) is malformed → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ kickerPlayerId: "player-self-uuid" })), null);
});

test("role ids that do not partition the two participants → null", () => {
  assert.equal(
    buildViewerIdentityContext(
      baseInput({ kickerPlayerId: "player-self-uuid", keeperPlayerId: "someone-else" }),
    ),
    null,
  );
});

test("duplicate role ids (kicker === keeper) → null", () => {
  assert.equal(
    buildViewerIdentityContext(
      baseInput({ kickerPlayerId: "player-self-uuid", keeperPlayerId: "player-self-uuid" }),
    ),
    null,
  );
});

// ── Score projection (no calculation) ───────────────────────────────────────────

test("authoritative scores are projected verbatim, not calculated", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ scores: { "player-self-uuid": 3, "player-opp-uuid": 3 } }),
  );
  // Equal scores must NOT be resolved into a winner and must be copied as-is.
  assert.equal(ctx?.self.score, 3);
  assert.equal(ctx?.opponent.score, 3);
  assert.equal(ctx?.outcome, undefined);
});

test("zero scores are projected (not treated as missing)", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ scores: { "player-self-uuid": 0, "player-opp-uuid": 0 } }),
  );
  assert.equal(ctx?.self.score, 0);
  assert.equal(ctx?.opponent.score, 0);
});

// ── Authoritative outcome (never derived) ───────────────────────────────────────

test("authoritative winner=viewer → outcome SELF", () => {
  const ctx = buildViewerIdentityContext(baseInput({ winnerPlayerId: "player-self-uuid" }));
  assert.equal(ctx?.outcome, "SELF");
});

test("authoritative winner=opponent → outcome OPPONENT", () => {
  const ctx = buildViewerIdentityContext(baseInput({ winnerPlayerId: "player-opp-uuid" }));
  assert.equal(ctx?.outcome, "OPPONENT");
});

test("authoritative isDraw=true → outcome DRAW", () => {
  const ctx = buildViewerIdentityContext(baseInput({ isDraw: true }));
  assert.equal(ctx?.outcome, "DRAW");
});

test("no outcome is derived when neither winner nor draw is supplied", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ scores: { "player-self-uuid": 5, "player-opp-uuid": 0 } }),
  );
  // Even a lopsided score must not synthesize an outcome.
  assert.equal(ctx?.outcome, undefined);
});

test("unknown winner id → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ winnerPlayerId: "ghost" })), null);
});

test("conflicting authoritative outcome (draw AND winner) → null", () => {
  assert.equal(
    buildViewerIdentityContext(baseInput({ isDraw: true, winnerPlayerId: "player-self-uuid" })),
    null,
  );
});

test("isDraw only responds to the literal true (not a truthy string)", () => {
  const ctx = buildViewerIdentityContext(baseInput({ isDraw: "yes" as unknown }));
  assert.equal(ctx?.outcome, undefined);
});

// ── New instance = new context ──────────────────────────────────────────────────

test("a new match instance produces an independent context", () => {
  const first = buildViewerIdentityContext(baseInput({ matchInstanceId: "ABCD12:1" }));
  const second = buildViewerIdentityContext(baseInput({ matchInstanceId: "ABCD12:2" }));
  assert.equal(first?.matchInstanceId, "ABCD12:1");
  assert.equal(second?.matchInstanceId, "ABCD12:2");
});

// ── Malformed / hostile identity inputs → controlled null, never throws ─────────

test("invalid matchInstanceId → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ matchInstanceId: "   " })), null);
});

test("missing viewer (empty id) → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ viewerPlayerId: "" })), null);
});

test("viewer not among participants (unknown player) → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ viewerPlayerId: "stranger" })), null);
});

test("fewer than two players → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": 1 } })), null);
});

test("more than two players → null", () => {
  assert.equal(
    buildViewerIdentityContext(
      baseInput({ scores: { "player-self-uuid": 1, "player-opp-uuid": 0, third: 0 } }),
    ),
    null,
  );
});

test("malformed score map (array) → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ scores: [2, 1] as unknown })), null);
});

test("malformed score map (non-object) → null", () => {
  assert.equal(buildViewerIdentityContext(baseInput({ scores: 42 as unknown })), null);
});

test("missing/non-number score value → null", () => {
  assert.equal(
    buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": 2, "player-opp-uuid": "x" as unknown as number } })),
    null,
  );
});

test("negative score → null", () => {
  assert.equal(
    buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": -1, "player-opp-uuid": 0 } })),
    null,
  );
});

test("fractional score → null", () => {
  assert.equal(
    buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": 1.5, "player-opp-uuid": 0 } })),
    null,
  );
});

test("non-finite score → null", () => {
  assert.equal(
    buildViewerIdentityContext(baseInput({ scores: { "player-self-uuid": Infinity, "player-opp-uuid": 0 } })),
    null,
  );
});

test("dangerous score keys (__proto__/prototype/constructor) → null", () => {
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const scores: Record<string, number> = {};
    Object.defineProperty(scores, key, { value: 1, enumerable: true, configurable: true, writable: true });
    scores["player-self-uuid"] = 2;
    assert.equal(
      buildViewerIdentityContext(baseInput({ viewerPlayerId: "player-self-uuid", scores })),
      null,
      `key ${key} must be rejected`,
    );
  }
});

test("a hostile throwing getter on scores never throws → null", () => {
  const input = baseInput();
  Object.defineProperty(input, "scores", {
    get() {
      throw new Error("hostile");
    },
  });
  assert.doesNotThrow(() => buildViewerIdentityContext(input));
  assert.equal(buildViewerIdentityContext(input), null);
});

test("null / non-object input → null and never throws", () => {
  assert.doesNotThrow(() => buildViewerIdentityContext(null as unknown as ViewerIdentityInput));
  assert.equal(buildViewerIdentityContext(null as unknown as ViewerIdentityInput), null);
  assert.equal(buildViewerIdentityContext(7 as unknown as ViewerIdentityInput), null);
});

// ── Privacy: no raw id ever appears in output ───────────────────────────────────

test("serialized output contains no raw player id / key", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({
      kickerPlayerId: "player-self-uuid",
      keeperPlayerId: "player-opp-uuid",
      winnerPlayerId: "player-self-uuid",
      displayNames: { "player-self-uuid": "Ada", "player-opp-uuid": "Blake" },
    }),
  );
  const serialized = JSON.stringify(ctx);
  assert.ok(!serialized.includes("player-self-uuid"));
  assert.ok(!serialized.includes("player-opp-uuid"));
});

test("source input objects are not mutated", () => {
  const scores = Object.freeze({ "player-self-uuid": 2, "player-opp-uuid": 1 });
  const displayNames = Object.freeze({ "player-self-uuid": "Ada", "player-opp-uuid": "Blake" });
  const input: ViewerIdentityInput = {
    matchInstanceId: INSTANCE,
    viewerPlayerId: "player-self-uuid",
    scores,
    displayNames,
  };
  const ctx = buildViewerIdentityContext(input);
  assert.ok(ctx);
  // Frozen sources are untouched; the builder cloned rather than mutated.
  assert.deepStrictEqual(scores, { "player-self-uuid": 2, "player-opp-uuid": 1 });
  assert.deepStrictEqual(displayNames, { "player-self-uuid": "Ada", "player-opp-uuid": "Blake" });
});

// ── Optional display labels ─────────────────────────────────────────────────────

test("safe display names are attached to the correct participants", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ displayNames: { "player-self-uuid": "  Ada  ", "player-opp-uuid": "Blake" } }),
  );
  assert.equal(ctx?.self.displayLabel, "Ada");
  assert.equal(ctx?.opponent.displayLabel, "Blake");
});

test("an unsafe display name is omitted but identity mapping stays valid", () => {
  const ctx = buildViewerIdentityContext(
    baseInput({ displayNames: { "player-self-uuid": "user@example.com", "player-opp-uuid": "Blake" } }),
  );
  assert.ok(ctx);
  assert.equal(ctx.self.displayLabel, undefined); // email rejected
  assert.equal(ctx.opponent.displayLabel, "Blake");
});

test("missing displayNames map → labels simply absent, mapping still valid", () => {
  const ctx = buildViewerIdentityContext(baseInput());
  assert.ok(ctx);
  assert.equal(ctx.self.displayLabel, undefined);
  assert.equal(ctx.opponent.displayLabel, undefined);
});

// ── sanitizeDisplayLabel direct coverage ────────────────────────────────────────

test("sanitizeDisplayLabel trims and truncates to the documented maximum", () => {
  assert.equal(sanitizeDisplayLabel("  Ada Lovelace  "), "Ada Lovelace");
  // Use a non-hex letter so the length rule (not the opaque-hex-id rule) applies.
  const long = "Z".repeat(MAX_DISPLAY_LABEL_LENGTH + 10);
  assert.equal(sanitizeDisplayLabel(long)?.length, MAX_DISPLAY_LABEL_LENGTH);
});

test("sanitizeDisplayLabel rejects empty / whitespace-only", () => {
  assert.equal(sanitizeDisplayLabel(""), null);
  assert.equal(sanitizeDisplayLabel("    "), null);
  assert.equal(sanitizeDisplayLabel("\t\n"), null);
});

test("sanitizeDisplayLabel rejects control characters", () => {
  const withBell = "Ada" + String.fromCharCode(7) + "Lovelace";
  assert.equal(sanitizeDisplayLabel(withBell), null);
  const withNull = "Nul" + String.fromCharCode(0);
  assert.equal(sanitizeDisplayLabel(withNull), null);
  const withDel = "Del" + String.fromCharCode(0x7f);
  assert.equal(sanitizeDisplayLabel(withDel), null);
});

test("sanitizeDisplayLabel rejects emails, UUIDs, and opaque hex ids", () => {
  assert.equal(sanitizeDisplayLabel("player@host.com"), null);
  assert.equal(sanitizeDisplayLabel("550e8400-e29b-41d4-a716-446655440000"), null);
  assert.equal(sanitizeDisplayLabel("deadbeefdeadbeef00"), null);
});

test("sanitizeDisplayLabel rejects punctuation-only and non-strings", () => {
  assert.equal(sanitizeDisplayLabel("----"), null);
  assert.equal(sanitizeDisplayLabel(42 as unknown), null);
  assert.equal(sanitizeDisplayLabel(null), null);
  assert.equal(sanitizeDisplayLabel(undefined), null);
});

test("sanitizeDisplayLabel keeps a normal alphanumeric handle", () => {
  assert.equal(sanitizeDisplayLabel("Blake_99"), "Blake_99");
});
