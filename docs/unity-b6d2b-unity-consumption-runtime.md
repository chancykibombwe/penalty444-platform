# B6D2B — Unity Protocol v1 Consumption and Controlled Staging Runtime Proof

> **Status:** Unity implementation complete; clean-worktree validation/build
> succeeded; the **identical compiled WebGL artifact** passed the controlled A–H
> runtime proof (§15). The protected main-preview `/dev/unity-staging` harness
> **could not be driven non-interactively** — Vercel SSO returned **HTTP 302** —
> so the literal harness-route run is **not** claimed as executed. The equivalent
> artifact-runtime proof is **accepted as sufficient for B6D2B**; running the exact
> harness route remains a **documented, non-blocking follow-up** that **must be
> completed before B6D3 runtime authorization**. **Presentation-only.** React and
> the Node realtime server remain the sole authority. **Production remains NO-GO,
> reproducibility remains BLOCKED, and B6D3 remains unauthorized.**

## 1. Scope

B6D2B teaches the Unity **prototype** to validate and consume the already-merged
B6D1 "Protocol v1" presentation envelopes, and proves it end-to-end using
deterministic **mock** Protocol v1 events. The runtime proof was executed against
the **identical compiled WebGL artifact** (`b6d2b-5226d3c1-a`); the branch-preview
`/dev/unity-staging` harness was deployed, but its interactive execution was
**blocked by Vercel SSO (HTTP 302)**, so the substitute artifact-runtime proof is
accepted for B6D2B and the literal harness-route execution is **deferred until
before B6D3 runtime approval** (see §15).

B6D2B **does**:

- validate + consume versioned `round_result` and `match_state_sync` envelopes;
- apply them as **presentation-only** state (no score math, no result derivation);
- enforce **match-instance and sequence protection** inside Unity;
- return **sanitized** applied/rejected acknowledgements;
- rebuild an immutable local B6B release from the exact committed feature head;
- deploy that release to the dedicated staging artifact project as **PREVIEW only**;
- prove the compiled artifact through the equivalent artifact-runtime proof, with
  the guarded same-origin `/dev/unity-staging` harness deployed for the deferred
  literal run.

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

**41** numbered cases: parser (1–18), gate (19–32), legacy (33–37),
acknowledgement (38–41). These expand to **57 individual assertions**. It logs a
single PASS summary and fails the Unity process on any assertion. It modifies no
scene/project settings and leaves no tracked asset.

- **Command:** `Unity.exe -batchmode -quit -projectPath unity\Penalty444Client -executeMethod Penalty444.Editor.Penalty444PresentationProtocolValidation.RunFromCommandLine` (Unity 6000.4.2f1, run inside the clean worktree).
- **Result:** **PASS — `[B6D2B validation] PASS - all 57/57 presentation-protocol checks passed.`** (exit code 0).

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
- **Exact HEAD:** `5226d3c125f3a274fc7d8589f3aa77642a3c5991` (equals the feature
  commit; `git status --porcelain` empty before running Unity).
- Validation: `Penalty444.Editor.Penalty444PresentationProtocolValidation.RunFromCommandLine`
  with Unity **6000.4.2f1** → **PASS (57/57), exit code 0**.
- Release build via the committed B6B builder/wrapper, version
  **`b6d2b-5226d3c1-a`** → **built** (WebGL, gzip, new immutable release dir; no
  existing release overwritten; no output committed).
- Manifest `schemaVersion 1`, `sourceCommit` =
  `5226d3c125f3a274fc7d8589f3aa77642a3c5991`, **17 files**, all file hashes
  verified, manifest self-checksum verified.
  Manifest SHA-256: **`00205da3ecc88557a1f138d5b57486e4920fe5ef33a02962c340cf61b28dc79e`**.
  Total artifact bytes 10,703,699; compressed payload 10,657,168 (gzip).

## 13. Staging artifact preview deployment

Artifact project `penalty444-unity-staging`
(`prj_8EtTOwiCOUgkghXw3GlYSaVOld64`), team `chancykibombwes-projects`
(`team_qBdaTOMQrGQnsZfiMVzyDNB4`). **PREVIEW only** (`target: null`; no `--prod`;
no alias).

- **Deployment ID:** `dpl_2bHdvjmYFYbSW7iprDFmTHPgt4Ua` — `readyState: READY`,
  `target: null` (PREVIEW).
- **Immutable origin:** `https://penalty444-unity-staging-4eszetkck-chancykibombwes-projects.vercel.app`
- **Artifact base:** `…/releases/b6d2b-5226d3c1-a`
- HTTP verification via the deploy wrapper (`verificationStatus: passed`):
  index/loader/framework.gz/data.gz/wasm.gz/manifest/checksum all reachable; MIME
  correct; `Content-Encoding: gzip` on framework/data/wasm; immutable cache
  (`Cache-Control: public, max-age=31536000, immutable`); `X-Content-Type-Options:
  nosniff`; `X-Frame-Options: SAMEORIGIN` where required. 17 files, gzip.

## 14. Main branch-preview configuration

Main app project `penalty444-platform-at1y`
(`prj_q7zD1nMUcia8Ky2wjNwtiNSEz6EX`). Branch-only, **Preview environment only**,
for `unity/phase-b6d2b-unity-consumption-proof`:

- `UNITY_STAGING_ARTIFACT_ORIGIN=https://<immutable-artifact-preview>`
- `UNITY_STAGING_ROUTE_ENABLED=true`

Not Production, not Development, not all-previews, not master, not the artifact
project. `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` is **not** configured; no alias.

- **Env vars confirmed** via `vercel env ls preview`: both
  `UNITY_STAGING_ARTIFACT_ORIGIN` and `UNITY_STAGING_ROUTE_ENABLED` scoped to
  `Preview (unity/phase-b6d2b-unity-consumption-proof)` only (no Production, no
  Development, no all-previews, no master, not the artifact project).
- `UNITY_STAGING_ARTIFACT_ORIGIN` =
  `https://penalty444-unity-staging-4eszetkck-chancykibombwes-projects.vercel.app`
- **READY main-preview deployment:** `dpl_CJkFCw9HLrFB7FctuGHeEcetiAu9`,
  `target: preview`, URL
  `https://penalty444-platform-at1y-e3f1n2x3y-chancykibombwes-projects.vercel.app`
  (redeployed after the branch-scoped vars were set, so it consumes them). No
  alias created.

## 15. Controlled runtime proof

Intended route: `/dev/unity-staging?version=b6d2b-5226d3c1-a` on the
feature-branch preview only (no real match/room).

**Access constraint:** the main-app preview enforces Vercel Deployment Protection
(SSO). Anonymous and Cursor-browser requests to `/` and `/dev/unity-staging` both
return **HTTP 302 → `vercel.com/sso-api`** (the Cursor browser is not logged in to
Vercel), so the sanctioned harness UI could not be driven without interactive
Vercel authentication. Adding a Protection-Bypass secret was intentionally not
done (production-project protection change, out of B6D2B scope). See
`audit-artifacts/unity-b6d2b/b6d2b-5226d3c1-a/harness-route-blocker.md`.

**Substitute runtime proof (equivalent evidence):** the artifact project is
publicly reachable, so the **identical built WebGL runtime `b6d2b-5226d3c1-a`** was
driven directly at the artifact origin with the same deterministic Protocol v1
envelopes. The bridge same-origin (`e.origin === location.origin`) and same-parent
(`e.source === window.parent`) checks are satisfied for a top-level page, so
delivery matches the same-origin iframe rewrite. **All assertions A–H passed:**

- **A. Delivery/isolation:** Unity boots and posts `ready` (bridge registered);
  same-origin assets; network inventory shows **0** Socket.IO / WebSocket /
  Railway / Supabase / auth / wallet requests.
- **B. State application:** initial `match_state_sync` (0/0, R1, NORMAL) updates
  the scoreboard/round text; `presentation_applied` matches protocolVersion=1,
  instance `ABC123:1`, sequence 1, event, round 1, phase NORMAL, `scoreValues
  [0,0]`, `playerCount 2`; **no player IDs** anywhere.
- **C. Result/state separation:** GOAL `round_result` (seq 2) shows the GOAL
  presentation; scoreboard stays **0/0** (no local increment); only the following
  authoritative sync (seq 3, `scoreValues [1,0]`, R2) changes the score; applied
  acks arrive in order (result ack carries **no** score).
- **D. Ordering protection:** duplicate seq 3 and stale seq 2 both rejected
  `stale_or_duplicate`; scoreboard unchanged (1/0); next higher sequence applies.
- **E. Instance protection:** new instance `ABC123:2` seq 1 resets and applies
  (0/0); prior-instance result rejected `foreign_instance`; different room
  `XYZ999:1` rejected `foreign_instance`; lower instance rejected
  `foreign_instance`; old visual state cleared.
- **F. Reload:** page reload produces a fresh `ready`; a full `match_state_sync`
  with sequence **5** (>1) is accepted as bootstrap (`scoreValues [2,1]`, R3); no
  historical result animation replayed.
- **G. Sudden death:** `SUDDEN_DEATH` state applied exactly — "Round 6 / 5 ·
  SUDDEN_DEATH (SD 1)", `scoreValues [3,3]`, `phase SUDDEN_DEATH`,
  `suddenDeathRound 1`; no local progression computed.
- **H. Legacy compatibility:** legacy `staging_begin`, legacy `round_result`
  ("Round 1: SAVED!"), and legacy `reset` ("Waiting") all work via the preserved
  legacy path (no v1 ack emitted, as expected).

- **Screenshots (01–09) / sanitized event log / network inventory / blocker note:**
  stored locally only under
  `audit-artifacts/unity-b6d2b/b6d2b-5226d3c1-a/` (untracked):
  `runtime-event-log.json`, `network-inventory.json`, `harness-route-blocker.md`,
  and `01…09` PNGs.
- **Network evidence:** 17 resources total — 12 artifact-origin (index + Unity
  `Build/*.gz` + TemplateData + manifest), 3 `vercel.live` (Vercel preview toolbar,
  preview-only), 1 each `cdp.cloud.unity3d.com` / `config.uca.cloud.unity3d.com`
  (Unity engine default diagnostics, not project code, no player/auth/wallet data;
  flagged for B6D3 hardening). **No** Socket.IO/WebSocket/Railway/Supabase/
  auth/session/token/wallet request.

> Follow-up to close the sanctioned route: log into Vercel in the browser, then
> re-run the same 16-step sequence through the harness UI at
> `/dev/unity-staging?version=b6d2b-5226d3c1-a` and capture the evidence table.

## 16. Production safety

- Production homepage `https://penalty444-platform-at1y.vercel.app/` HTTP **200**
  (verified independently, anonymous `curl`).
- Production `https://penalty444-platform-at1y.vercel.app/dev/unity-staging?version=b6d2b-5226d3c1-a`
  HTTP **404** (route disabled in production).
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
