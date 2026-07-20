# B6D2B — Unity Protocol v1 Consumption and Controlled Staging Runtime Proof

> **Status:** implementation complete; clean-worktree Unity build + staging
> runtime proof recorded below. **Presentation-only.** React and the Node
> realtime server remain the sole authority. **Production remains NO-GO,
> reproducibility remains BLOCKED, and B6D3 remains unauthorized.**

## 1. Scope

B6D2B teaches the Unity **prototype** to validate and consume the already-merged
B6D1 "Protocol v1" presentation envelopes, and proves it end-to-end through the
guarded same-origin `/dev/unity-staging` route using deterministic **mock**
Protocol v1 events.

B6D2B **does**:

- validate + consume versioned `round_result` and `match_state_sync` envelopes;
- apply them as **presentation-only** state (no score math, no result derivation);
- enforce **match-instance and sequence protection** inside Unity;
- return **sanitized** applied/rejected acknowledgements;
- rebuild an immutable local B6B release from the exact committed feature head;
- deploy that release to the dedicated staging artifact project as **PREVIEW only**;
- validate it through the guarded same-origin staging route.

B6D2B **does NOT**: enable `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`; test the new
protocol in a real match; make Unity player-facing; touch production
config/aliases/env; change the server, Supabase, gameplay rules, or
wallet/economy. It does not begin B6D3.

- **Base branch:** `master`
- **Required starting master:** `392be46ddfe397faec0efb76b353ce0144a7b59d`
- **Feature branch:** `unity/phase-b6d2b-unity-consumption-proof`

## 2. Exact source files

Unity runtime (presentation-only):

- `unity/Penalty444Client/Assets/Scripts/UnityPresentationProtocolV1.cs` (+ `.meta`)
- `unity/Penalty444Client/Assets/Scripts/UnityBridgeReceiver.cs`
- `unity/Penalty444Client/Assets/Scripts/PenaltySceneController.cs`
- `unity/Penalty444Client/Assets/Plugins/WebGL/Penalty444WebBridge.jslib`

Unity validation:

- `unity/Penalty444Client/Assets/Editor/Penalty444PresentationProtocolValidation.cs` (+ `.meta`)

Guarded staging harness (web):

- `apps/web/src/app/dev/unity-staging/UnityStagingClient.tsx`
- `apps/web/src/app/dev/unity-staging/unityStagingProtocol.ts`
- `apps/web/src/app/dev/unity-staging/unityStagingProtocol.test.ts`
- `apps/web/package.json`

Documentation:

- `docs/unity-b6d2b-unity-consumption-runtime.md` (this file)
- `docs/unity-webgl-build-pipeline.md` (B6D section)

No other tracked file is changed. **No Unity package or npm dependency was
added.** `package-lock.json`, `Packages/manifest.json`, and
`Packages/packages-lock.json` are unchanged. The local
`unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` status is left
**untouched** (never staged, reset, or normalized). Generated WebGL output and
runtime evidence remain **untracked**.

## 3. Protocol v1 Unity parser

`UnityPresentationProtocolV1.Parse(string json)` is **exception-safe, bounded,
deterministic, and WebGL/IL2CPP-safe**. It opens no network connection and reads
no auth/Socket.IO/Supabase/wallet data.

Because `JsonUtility` cannot safely deserialize an arbitrary
`Record<string, number>` score map, the file implements its own small
**structural JSON reader** (`JsonReader` → `JsonValue` tree). It never uses regex
to parse nested JSON and never adds Newtonsoft.Json.

Envelope validated:

```
{ type, protocolVersion, matchInstanceId, sequence, emittedAt?, event, payload }
```

- `type` must be exactly `PENALTY444_MATCH_EVENT`;
- `protocolVersion` must be exactly `1` (a valid but non-1 version →
  `unsupported_version`, never legacy);
- `matchInstanceId` must be `<UPPERCASE_ALPHANUMERIC_ROOM_CODE>:<POSITIVE_INSTANCE_NUMBER>`;
- `sequence` must be a positive integer;
- `emittedAt`, when present, must be a non-negative integer;
- `event` must be `round_result` or `match_state_sync` (`staging_begin` /
  `match_end` / `reset` are legacy-only and are rejected if versioned);
- `payload` is validated per the exact B6D1 contract.

**Routing:** a top-level `protocolVersion` selects the strict versioned path;
messages without it fall through to the legacy bridge.

### 3.1 Parser safety limits

- reject null/empty input;
- maximum input length **16 KiB**;
- maximum nesting depth **8**;
- maximum protocol string length **512** characters;
- maximum score entries **16**;
- reject **duplicate JSON object keys** where they affect protocol interpretation
  (root envelope, payload, scores);
- reject **fractional, negative, non-finite, or overflowing** score values
  (numbers keep their raw token so integer-ness is enforced exactly);
- reject dangerous score keys `__proto__`, `prototype`, `constructor`;
- reject **empty, whitespace-only, or whitespace-padded** score keys;
- **never log raw JSON; never log score-map player IDs.**

Unknown fields are ignored only **after** the required allowlisted fields
validate, and never surface in any output/ack.

## 4. `round_result` application

Versioned payload `{ round, kickerLane, keeperLane, result, statusMessage? }`:

- `round` positive integer; lanes `LEFT|CENTER|RIGHT`; result `GOAL|SAVE|DRAW`;
- Unity **displays the supplied result** and **never** compares lanes to derive it;
- Unity **never calculates or increments a score**;
- `statusMessage` is optional, bounded presentation text.

`PenaltySceneController.ShowRoundResultVersioned(...)` uses the **authoritative
supplied `round`** (not the local visual counter). The legacy/editor mock overload
`ShowRoundResult(...)` and all `[ContextMenu]` mocks are preserved unchanged.

## 5. `match_state_sync` application

Versioned payload `{ scores, round, maxRounds, phase, suddenDeathRound? }`:

- `scores` is a non-empty object of sanitized player-id keys → non-negative
  integer values; `round`/`maxRounds` positive; `phase` `NORMAL|SUDDEN_DEATH`;
  `suddenDeathRound` optional non-negative integer.

Unity **never** calculates who scored, who won, whether the match ended, whether
a result is `GOAL`/`SAVE`, the next round, or sudden-death progression.

`PenaltySceneController.ApplyMatchStateSyncVersioned(...)` copies the supplied
state, updates the existing `scoreboardText` and `roundStatusText`, plays **no**
result animation, and submits/alters nothing.

### 5.1 Identity-neutral scoreboard limitation

Player-facing identity/order is **not yet defined**. Score keys are used **only**
to compute a deterministic order (sorted by sanitized key with ordinal
comparison); the keys are then **discarded** — only numeric values are displayed.
The scoreboard renders an explicitly **identity-neutral** summary, e.g.:

```
Scores: 0 / 1
Round 2 / 5 · NORMAL
```

For `SUDDEN_DEATH`, the supplied `suddenDeathRound` is shown, e.g.
`Round 6 / 5 · SUDDEN_DEATH (SD 1)`.

This proves Unity **applied the numeric state**. It does **not** define which
visual side belongs to which player. A player-facing scoreboard remains
**unauthorized** for B6D3 review.

## 6. Instance and sequence gate

`PresentationInstanceGate.Evaluate(...)` never mutates state; the receiver calls
`Commit(...)` **only after** the scene application succeeds.

- **A. Fresh receiver / bootstrap:** with no active instance, the first accepted
  message must be a complete `match_state_sync`, with **any positive sequence**
  (so post-reload the parent may resume at the next existing sequence, not 1).
- **B. Same instance:** require `sequence > lastSequence`; duplicate/lower →
  `stale_or_duplicate`.
- **C. `round_result`:** rejected before an active state (`no_active_instance`);
  must match the active instance (`foreign_instance`); must have a higher sequence.
- **D. New instance:** a foreign instance replaces the active one **only** when
  it is a complete `match_state_sync`, the **room-code prefix matches**, the
  numeric instance suffix is **strictly greater**, and `sequence == 1`. On accept:
  reset the scene, clear prior visual state, apply the snapshot, set the new
  active instance + sequence. Rejections: lower/older instance → `foreign_instance`;
  different room → `foreign_instance`; same-room higher instance with
  `sequence != 1` → `invalid_instance_transition`.
- **E. Transactionality (atomic application):** `activeMatchInstanceId` and
  `lastSequence` are committed **only** after a successful apply. Malformed,
  rejected, or failed messages never consume a sequence or change the active
  instance.

### 6.1 Reload bootstrap rule

After an iframe reload, Unity has no active instance. The parent sends a fresh,
**complete** `match_state_sync` using the next existing sequence (which may be
`> 1`); the gate accepts it as bootstrap, resets the scene, and restores the
scoreboard from that snapshot. **No historical `round_result` is replayed.**

## 7. Legacy compatibility

`UnityBridgeReceiver` still accepts legacy envelopes **without**
`protocolVersion` (`staging_begin`, `round_result`, `match_end`, `reset`) via the
existing `JsonUtility` path; all `[ContextMenu]` mocks and B5/B6C behavior are
preserved. A message with `protocolVersion` present but unsupported is **rejected**
(`unsupported_version`) and **never** reinterpreted as a legacy event.

## 8. Applied / rejected acknowledgement schemas

`Penalty444WebBridge.jslib` adds `Penalty444PostUnityEvent(json)`, which parses
defensively and posts **only** to `window.parent` using `window.location.origin`
as `targetOrigin` (never `"*"`), makes no network request, reads no
cookies/localStorage/auth/wallet, and swallows all bridge exceptions. The
existing `ready` event is unchanged.

**Applied** (`presentation_applied`):

```json
{
  "type": "PENALTY444_UNITY_EVENT",
  "event": "presentation_applied",
  "payload": {
    "protocolVersion": 1,
    "matchInstanceId": "ABCD12:1",
    "sequence": 1,
    "appliedEvent": "round_result" | "match_state_sync",
    "round": 1,
    "result": "GOAL",              // round_result only (no score)
    "phase": "NORMAL",             // state sync only
    "suddenDeathRound": 1,          // state sync + sudden death only
    "scoreValues": [0, 0],          // state sync only — numeric VALUES, ordered
    "playerCount": 2                // state sync only
  }
}
```

**Rejected** (`presentation_rejected`):

```json
{
  "type": "PENALTY444_UNITY_EVENT",
  "event": "presentation_rejected",
  "payload": {
    "protocolVersion": 1,
    "matchInstanceId": "ABCD12:1",  // optional
    "sequence": 3,                    // optional
    "rejectedEvent": "match_state_sync", // optional
    "reason": "stale_or_duplicate"
  }
}
```

Allowlisted `reason` values: `invalid_envelope`, `unsupported_version`,
`no_active_instance`, `stale_or_duplicate`, `foreign_instance`,
`invalid_instance_transition`, `apply_failed`.

### 8.1 Prohibited fields

Acks carry **numeric score values only** in the same deterministic order used by
the debug presentation. They contain **no** player-id keys, usernames, raw
payload, email, auth/session/token, socket data, or wallet/economy fields. Raw
exception text and raw input are never included.

## 9. Unity validation inventory and result

Entry point (deterministic, batch-safe):
`Penalty444.Editor.Penalty444PresentationProtocolValidation.RunFromCommandLine`

**41** checks: parser (1–18), gate (19–32), legacy (33–37), acknowledgement
(38–41). It logs a single PASS summary and fails the Unity process on any
assertion. It modifies no scene/project settings and leaves no tracked asset.

- **Command:** _see §12 — run inside the clean worktree with Unity 6000.4.2f1._
- **Result:** _PENDING (recorded after the clean-worktree run)._

## 10. Web test inventory and result

`npm run test:unity-presentation` now runs three files:
`unityPresentationAdapter.test.ts`, `unityPresentationShadow.test.ts`, and the new
`unityStagingProtocol.test.ts`.

- **Total npm unit tests: 149 — PASS.**
- Coverage for the new file: valid applied `round_result` / `match_state_sync`,
  valid rejected, invalid type/event/protocolVersion/matchInstanceId/sequence/
  appliedEvent/phase/result/scoreValues, excessive scoreValues, non-integer
  score, invalid rejection reason, sensitive-field stripping, hostile getters,
  exact normalized output keys, deterministic proof-step ordering, and
  no-player-id / no-wallet-auth-socket guarantees.

## 11. Web typecheck / build / realtime results

- `apps/web`: `npx tsc --noEmit` → **PASS**; `npm run build` → **PASS**
  (`/dev/unity-staging` present as a static route).
- `apps/realtime-server`: `npx tsc --noEmit` → **PASS**.
- **No Unity build is added to CI.**

## 12. Clean-worktree Unity validation and build

> Built from a **separate clean worktree** at the exact committed feature head so
> the main checkout's local `ProjectSettings.asset` status never affects the
> build.

- **Clean worktree path:** `C:\Users\EL GADO\Desktop\penalty444-b6d2b-build`
- **Exact HEAD:** _PENDING (must equal the reported feature commit)._
- Validation: `Penalty444.Editor.Penalty444PresentationProtocolValidation.RunFromCommandLine`
  with Unity **6000.4.2f1** → **PENDING** (require exit code 0).
- Release build via the committed B6B builder/wrapper, version
  `b6d2b-<SHORT_HEAD>-a` → **PENDING**.
- Manifest `schemaVersion 1`, `sourceCommit` = exact full feature commit, all
  file hashes verified, manifest self-checksum verified → **PENDING**.

## 13. Staging artifact preview deployment

Artifact project `penalty444-unity-staging`
(`prj_8EtTOwiCOUgkghXw3GlYSaVOld64`), team `chancykibombwes-projects`
(`team_qBdaTOMQrGQnsZfiMVzyDNB4`). **PREVIEW only** (`target: null`; no `--prod`;
no alias).

- **Deployment ID / immutable origin:** _PENDING._
- HTTP verification (index/loader/framework.gz/data.gz/wasm.gz/manifest/checksum;
  MIME; `Content-Encoding: gzip`; immutable cache; `nosniff`; `SAMEORIGIN`):
  _PENDING._

## 14. Main branch-preview configuration

Main app project `penalty444-platform-at1y`
(`prj_q7zD1nMUcia8Ky2wjNwtiNSEz6EX`). Branch-only, **Preview environment only**,
for `unity/phase-b6d2b-unity-consumption-proof`:

- `UNITY_STAGING_ARTIFACT_ORIGIN=https://<immutable-artifact-preview>`
- `UNITY_STAGING_ROUTE_ENABLED=true`

Not Production, not Development, not all-previews, not master, not the artifact
project. `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` is **not** configured; no alias.

- **READY main-preview deployment ID / URL:** _PENDING._

## 15. Controlled runtime proof

Route: `/dev/unity-staging?version=<b6d2b-release-version>` on the feature-branch
preview only (no real match/room). Assertions A–H (delivery/isolation, state
application, result/state separation, ordering protection, instance protection,
reload, sudden death, legacy compatibility): _PENDING._

- **Screenshots / sanitized event log / network inventory:** stored locally only
  under `audit-artifacts/unity-b6d2b/<release-version>/` (untracked). _PENDING._
- **Network evidence** (no Socket.IO/WebSocket/Railway/Supabase/auth/wallet
  requests): _PENDING._

## 16. Production safety

- Production homepage HTTP **200**: _PENDING (verified independently)._
- Production `/dev/unity-staging?version=<release-version>` HTTP **404**: _PENDING._
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` not configured/enabled by this task;
  no production Unity iframe; React remains the player-facing renderer; no real
  match behavior changed.

## 17. Boundaries

- **No real match used.**
- The **third** live-shadow flag `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` remains
  **unconfigured**.
- **No proof of player-facing scoreboard identity** (identity-neutral only).
- **Production remains NO-GO.**
- **Reproducibility remains BLOCKED.**
- **B6D3 remains unauthorized.**
