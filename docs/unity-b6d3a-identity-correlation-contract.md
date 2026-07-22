# B6D3A — Identity / Visual-Side and Result-to-State Correlation Contract

> **Status: IMPLEMENTED (pure TypeScript + unit tests + documentation only).**
> This phase adds two standalone, deterministic, exception-safe contract modules
> and their tests. It adds **no runtime integration**, changes **no serialized
> Protocol v1 wire shape**, activates **no Unity**, configures **no feature flag**,
> and performs **no deployment**. B6D3B and later remain **unauthorized**;
> production remains **NO-GO**.

---

## 1. Scope

B6D3A resolves the two contract-level design problems that the B6D3 planning
document (`docs/unity-b6d3-player-facing-integration-scope.md`, §7–§8) named as
the central blockers for any player-facing Unity step:

1. **Player-identity → visual-side mapping** — Unity's scoreboard is currently
   *identity-neutral* (numeric values only, player-id keys discarded). A
   player-facing view needs a **viewer-relative** mapping that assigns each
   authoritative participant to a fixed visual side **without ever exposing a raw
   internal player id**.
2. **Result-to-state correlation** — because scores are **not** atomic with
   `match:result`, the shot-result presentation (`round_result`) and the
   authoritative scoreboard (`match_state_sync`) must be **decoupled** and related
   by a precise, testable rule.

Both are implemented as **pure** utilities (no React, no Socket.IO, no Supabase,
no browser APIs, no Unity). They are **not wired** into any runtime path; they are
groundwork to be reviewed before B6D3B.

---

## 2. Exact base SHA

- Base branch: `master`
- Base commit: **`5d3148027850b8448f593f9c597f5591375a6a53`** (PR #211 merged —
  B6D3 planning brief).
- Feature branch: `feat/unity-b6d3a-identity-correlation-contract`
- Built in a **separate clean worktree** so the main checkout's locally-modified
  `unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` is never touched.

---

## 3. Architecture invariants (unchanged, upheld)

- Node.js / Socket.IO remains the **sole gameplay authority**.
- React remains the **player-facing renderer**; `MatchRoomPanel` owns the match
  state machine and timers.
- Unity remains **presentation-only** and never computes scores, results, winners,
  rounds, or sudden-death progression.
- Existing Protocol v1 serialized envelopes remain **backward-compatible and
  unchanged**; `round_result` and `match_state_sync` payload shapes are untouched.
- **No new `postMessage` event** is introduced; **no protocol version bump**.
- **No raw player id, UUID, email, auth token, socket data, or wallet data** may
  appear in any sanitized presentation output.
- Existing tests and behaviour remain **green** (210/210 unit tests).

---

## 4. Identity input contract

`buildViewerIdentityContext(input: ViewerIdentityInput)` accepts authoritative,
id-bearing inputs (the React adapter already receives these), which are **consumed
but never emitted**:

| Field | Type | Notes |
|---|---|---|
| `matchInstanceId` | `string` | protocol instance id `<ROOMCODE>:<INSTANCE>` (not a player id); validated |
| `viewerPlayerId` | `string` | raw internal id of the viewing player; **input only** |
| `scores` | `unknown` | authoritative `Record<playerId, number>`; must sanitize to **exactly two** entries |
| `kickerPlayerId?` | `unknown` | optional; if present, `keeperPlayerId` must be too |
| `keeperPlayerId?` | `unknown` | optional; must partition the two participants |
| `winnerPlayerId?` | `unknown` | optional **authoritative** winner id; must be one of the two |
| `isDraw?` | `unknown` | optional **authoritative** draw flag (only literal `true` triggers DRAW) |
| `displayNames?` | `unknown` | optional `Record<playerId, string>`; sanitized here |

Scores are sanitized with the existing protocol `sanitizeScores` (finite
non-negative integers; non-empty/trimmed/non-dangerous keys; prototype-pollution
guard). Inputs are **never mutated**; a new sanitized object is always produced.

---

## 5. Sanitized viewer-relative output contract

`ViewerIdentityContext` contains **no raw id**:

```
{
  matchInstanceId: string,               // non-identifying protocol id
  self:     { participant: "SELF",     side: "LEFT",  score, role?, displayLabel? },
  opponent: { participant: "OPPONENT", side: "RIGHT", score, role?, displayLabel? },
  outcome?: "SELF" | "OPPONENT" | "DRAW" // authoritative only (see §10)
}
```

- `participant` ∈ `SELF | OPPONENT` — viewer-relative label, never an id.
- `side` ∈ `LEFT | RIGHT` — the scoreboard visual side (see §6). This is **not** a
  shot `Lane` (`LEFT | CENTER | RIGHT`); it is a separate type.
- `score` — the authoritative value copied verbatim from the score map.
- `role?` — present only when kicker/keeper ids were supplied (see §8).
- `displayLabel?` — present only when a safe, bounded label was supplied (see §9).

---

## 6. Visual-side assignment rule

**Deterministic and viewer-relative:** the viewer (`SELF`) is always on the
`LEFT`; the `OPPONENT` is always on the `RIGHT`. The SELF/OPPONENT selection is
made by **matching `viewerPlayerId` to a score key**, so the result is independent
of object key ordering (verified by a key-order-reversal test). The mapping is
meaningful **only within one `matchInstanceId`**; a rematch/new instance is a new
context.

---

## 7. Score projection rule

`self.score` and `opponent.score` are the authoritative values copied **verbatim**
from the sanitized score map by id. The module performs **no arithmetic**: it never
increments, subtracts, compares, or infers a score, and never derives a winner from
score values. Equal scores are copied as-is and never resolved into an outcome.

---

## 8. Kicker/keeper role mapping

Roles are **optional and all-or-nothing**. If either `kickerPlayerId` or
`keeperPlayerId` is present, **both** must be present, distinct, and be exactly the
two participants; any other shape (partial, duplicate, or non-matching ids) yields
a controlled `null`. When supplied, each participant's raw kicker/keeper id is
translated to a viewer-relative `role` (`KICKER | KEEPER`) and the **id is
discarded** from output.

---

## 9. Optional display-label rules

`sanitizeDisplayLabel(raw)` (also applied per-participant via `displayNames`)
**never invents** a name and returns a bounded safe string or `null`:

- non-strings → `null`;
- empty / whitespace-only → `null`;
- any ASCII control character → `null`;
- e-mail-like (contains `@`) → `null`;
- UUID or long bare hex token (≥16 hex chars) → `null` (obvious internal ids);
- no alphanumeric character → `null`;
- otherwise trimmed and truncated to **`MAX_DISPLAY_LABEL_LENGTH = 24`**.

A missing or unsafe label is simply **omitted**; it never makes the identity
mapping unsafe or fails the whole context. **Display labels are not wired into
Unity in B6D3A.**

---

## 10. Correlation rule

`correlateResultToStateSync(rawResult, rawStateSync)` composes with the existing
`validateEnvelope` (it does **not** duplicate the streaming
`PresentationSequenceGate`). It accepts iff, in order:

1. `rawResult` validates and is a `round_result` envelope;
2. `rawStateSync` validates and is a `match_state_sync` envelope;
3. both carry the **same `matchInstanceId`** (this separates a rematch/new-instance
   state sync from an old-instance result);
4. `stateSync.sequence` is **strictly greater than** `result.sequence`.

On accept it returns a sanitized `CorrelationSummary`:

```
{ matchInstanceId, resultSequence, stateSyncSequence,
  resultRound, stateSyncRound, phase, scoreValues, suddenDeathRound? }
```

- **Only `match_state_sync` is score-bearing** (`isScoreBearingEvent`);
  `scoreValues` are sorted numeric values taken **only** from the state sync.
- Round numbers are copied verbatim; the rule is governed by **sequence**, not
  round equality (the authoritative post-result snapshot may carry the next round
  number), so a state sync whose round equals or exceeds the result round is
  accepted. **No next round, score delta, winner, or phase is derived.**

---

## 11. Invalid / rejected cases

**Identity** → controlled `null`: invalid `matchInstanceId`; missing/empty viewer;
viewer not among participants; fewer/more than two players; non-object/array score
map; missing/non-number/negative/fractional/non-finite score; dangerous keys
(`__proto__`/`prototype`/`constructor`); partial or non-partitioning roles;
duplicate role ids; unknown winner id; conflicting draw+winner; hostile throwing
getter; null/non-object input.

**Correlation** → typed rejection reason: `invalid-result-envelope`;
`invalid-state-sync-envelope`; `wrong-event-type` (swapped or non-state-sync);
`foreign-instance` (different room or rematch instance); `stale-or-duplicate`
(state-sync sequence ≤ result sequence); hostile throwing getter.

No function throws on any input.

---

## 12. Privacy guarantees

- No raw player id, object key derived from an id, username-as-id, email, UUID,
  auth/session/token, socket data, or wallet/economy field appears in any output.
- Verified by tests that `JSON.stringify` of both the identity context and the
  correlation summary contains **none** of the input ids.
- Score maps are cloned via `sanitizeScores`; source objects are never mutated
  (verified with frozen inputs).
- Raw inputs are never logged.

---

## 13. Explicit non-goals

- No runtime wiring (MatchRoomPanel / MatchRenderer3D / shadow / staging).
- No `postMessage` emission and no new event.
- No serialized Protocol v1 wire-shape change and no protocol version bump.
- No feature-flag or environment change; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`
  remains **UNCONFIGURED**.
- No Unity activation, no WebGL rebuild, no real match, no deployment.
- No server, Supabase, or Unity C# change.
- Display labels are **not** delivered to Unity in this phase.

---

## 14. Exact changed-file list

| File | Change |
|---|---|
| `apps/web/src/components/match/unityPresentationIdentity.ts` | **new** — viewer-relative identity/visual-side contract |
| `apps/web/src/components/match/unityPresentationIdentity.test.ts` | **new** — identity unit tests |
| `apps/web/src/components/match/unityPresentationCorrelation.ts` | **new** — result-to-state correlation contract |
| `apps/web/src/components/match/unityPresentationCorrelation.test.ts` | **new** — correlation unit tests |
| `apps/web/package.json` | **modified** — register the two new test files in `test:unity-presentation` (no dependency change) |
| `docs/unity-b6d3a-identity-correlation-contract.md` | **new** — this document |

No other tracked file is changed. No lockfile changed. No generated artifact added.
The main checkout's `ProjectSettings.asset` is untouched.

---

## 15. Test results

- **`npm run test:unity-presentation`: 210 tests, 210 pass, 0 fail** (149
  pre-existing + 61 new: 44 identity + 17 correlation).
- **Web `tsc --noEmit`:** PASS (exit 0).
- **Web `next build` (Turbopack, CI Supabase placeholders):** PASS —
  "✓ Compiled successfully", 27/27 static pages generated.
- **Realtime `tsc --noEmit` and `npm run build`:** PASS (exit 0) — server files
  unchanged; run as a regression check.
- `git diff --check`: clean.

---

## 16. Remaining blockers for B6D3B

- **B1 — Sanctioned `/dev/unity-staging` harness-route run** still blocked by
  Vercel SSO (B6D2B §15); must be completed before any player-facing runtime.
- **B3 — Versioned live-shadow never run against a real match**; B6D3C real-match
  shadow evidence still owed.
- **B4 — Unity engine default diagnostics endpoints** must be disabled/verified in
  a player-facing build.
- **Wiring/UX for a player-facing surface** (separate flag + **server-side cohort
  gate**, React-underneath fallback, perf budget) is B6D3B and remains
  **unauthorized**. This contract must be **reviewed** before it is wired.

The identity-contract blocker (B2) is **addressed at the contract level** by this
phase, pending review; it is not considered cleared until reviewed and wired under
B6D3B authorization.

---

## 17. Final authorization status

```
B6D3A IMPLEMENTATION: COMPLETE / IN REVIEW
B6D3B IMPLEMENTATION: NOT AUTHORIZED
REAL-MATCH UNITY TESTING: NOT AUTHORIZED
PLAYER-FACING UNITY: NOT AUTHORIZED
PRODUCTION UNITY: NO-GO
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: UNCONFIGURED
```

This phase added no runtime integration, changed no existing Protocol v1 wire
shape, used no real match, ran no Unity, configured no feature flag, and performed
no deployment. `MatchRoomPanel` and `MatchRenderer3D` were untouched; the server
and Unity C# were untouched. Production remains **NO-GO** and B6D3B remains
**unauthorized**.
