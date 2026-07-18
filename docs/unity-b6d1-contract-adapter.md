# Unity B6D1 — Versioned Presentation Contract and Sanitizing Adapter

> **Scope: B6D1 only.** This is standalone, presentation-only TypeScript
> groundwork. It is **not** wired into the live match, **not** connected to
> Unity, and **changes no runtime behavior**. B6D2 is **not** authorized;
> production remains **NO-GO**.

---

## 1. Scope

B6D1 delivers a versioned Unity **presentation** message contract and a
**sanitizing adapter** (plus unit tests) that maps untrusted authoritative socket
payloads into that contract. Nothing here activates Unity, opens a socket, reads
Supabase, or touches `MatchRoomPanel` / `MatchRenderer3D`. It is pure library +
test code for a later, separately-reviewed integration.

## 2. Master base commit

`4dda172447401a5729715e63154fb2b7593794d0`

## 3. Exact files

**New (application/test):**
- `apps/web/src/components/match/unityPresentationProtocol.ts` — the versioned
  envelope, payload types, validators, `matchInstanceId` derivation, and the
  sequence/instance reference logic.
- `apps/web/src/components/match/unityPresentationAdapter.ts` — the sanitizing
  builders (`round_result`, `match_state_sync`, terminal `match:end`).
- `apps/web/src/components/match/unityPresentationAdapter.test.ts` — the unit
  tests.

**Test-runner:**
- `apps/web/package.json` — added `tsx` dev dependency + a narrow
  `test:unity-presentation` script.
- `apps/web/package-lock.json` — lock entry for `tsx` (3 packages).

**CI:** `.github/workflows/ci.yml` — a single **test step** added to the existing
Web job (see §11). No new job, no secrets, no Node-version/concurrency/permissions/
trigger/realtime/deploy change.

**Docs:** this file + a B6D section update in
`docs/unity-webgl-build-pipeline.md`.

**Intentionally untouched:** `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`,
`matchPresentation.ts` (imported for types only), `lib/socket/client.ts`,
`apps/realtime-server/**`, `packages/shared/**`, `unity/**`,
`apps/web/public/unity/**`, Vercel, and Supabase. (The GitHub Actions change is
**only** the added Web test step above.)

## 4. Contract version

`type: "PENALTY444_MATCH_EVENT"`, `protocolVersion: 1`.

Envelope (both events):

```
{
  type: "PENALTY444_MATCH_EVENT",
  protocolVersion: 1,
  matchInstanceId: string,   // non-empty
  sequence: number,          // positive safe integer
  event: "round_result" | "match_state_sync",
  emittedAt?: number,        // when present: finite non-negative safe integer
  payload: ...
}
```

Canonical vocabulary (`Lane`, `ShotResult`, `MatchPhase`) is **imported** from
`matchPresentation.ts` and never duplicated. The envelope carries **no** auth
token, Supabase session/token, Socket.IO credentials, wallet/stake/commission/
payout, email, or unnecessary PII. Unity stays presentation-only.

## 5. matchInstanceId decision

The server's internal string `matchInstanceId` is **not currently forwarded to
the browser**, so B6D1 deliberately derives the protocol identifier from the
browser-available `roomCode` + numeric `matchInstance` — **no server change**.

`deriveMatchInstanceId(roomCode, matchInstance)`:
- format `<UPPERCASE_TRIMMED_ROOM_CODE>:<POSITIVE_MATCH_INSTANCE>` (e.g. `ABCD12:3`);
- `roomCode` must be non-empty after trimming and alphanumeric (so the `:`
  delimiter stays unambiguous and no whitespace/PII/token can enter the id);
- `matchInstance` must be a positive safe integer;
- malformed input returns `null` (never throws);
- contains no player ids, auth info, or tokens.

## 6. Result / state split

Because scores are **not** atomic with `match:result` (§8), the result animation
and the scoreboard are two separate messages.

**`round_result`** (drives the shot animation only):
```
{ round, kickerLane, keeperLane, result, statusMessage? }
```
- **No scores, no maxRounds, no phase.** No winner/score/timeout/result
  calculation.
- Lanes + result come only from the authoritative `match:result`; the adapter
  maps `kickerPick → kickerLane`, `keeperPick → keeperLane`, constructs a **new**
  allowlisted payload (never spreads the raw object), strips unknown/sensitive
  fields, and returns `null` on any malformed required field.

**`match_state_sync`** (drives the scoreboard/phase only):
```
{ scores, round, maxRounds, phase, suddenDeathRound? }
```
- Scores are **copied from an authoritative snapshot**, never inferred from
  `round_result`.
- Built from a **complete** snapshot. `match:update` (`index.ts:720-739`) is
  complete and is accepted directly.

## 7. Terminal `match:end` limitation

`match:end` (`index.ts:1347`) carries **only** `{ scores }` — no round / maxRounds
/ phase. `buildTerminalStateSyncEnvelope` may therefore only combine:
- the final authoritative scores from `match:end`; **and**
- round / maxRounds / phase / suddenDeathRound from the **last complete
  authoritative snapshot for the same `matchInstanceId`**.

If that prior snapshot is absent or belongs to another instance, it returns
`null` (never fabricates the missing fields). **The server also emits a full
match state after `match:end`; that later authoritative `match:update` is the
PREFERRED complete terminal sync** (via `buildMatchStateSyncEnvelope`); the
combiner is a defensive fallback only.

**Repo-fact limitation [Not yet fully defined].** `match:rejoinState`
(`rooms.ts:464-484`) as currently emitted does **not** carry `scores` or
`maxRounds`, so a **raw** `match:rejoinState` is intentionally **rejected** by
`buildMatchStateSyncEnvelope` (it is not a complete snapshot) rather than
fabricated. On reconnect, the complete snapshot comes from the `match:update` the
server also emits. Adding `scores`/`maxRounds` to `match:rejoinState` would be a
server change and is **out of B6D1 scope**.

## 8. Authoritative score-correlation rule

1. `round_result` is emitted immediately from the authoritative `match:result`.
2. It never contains or implies a post-result score.
3. `match_state_sync` is emitted independently whenever a **complete**
   authoritative snapshot is received.
4. The scoreboard uses **only** the latest accepted `match_state_sync`.
5. React never increments or otherwise derives a score for Unity.
6. There is **no** "join with the latest `match:update`" assumption.
7. A pre-result snapshot may preserve the old score; that is valid **historical**
   authoritative state and is **not** relabeled as a post-result score.
8. A later authoritative state-sync applies the server's updated score.
9. Result animation does **not** wait for a score snapshot.
10. Missing state-sync means the Unity scoreboard does not change.

Verified by the server ordering: `room.scores` is incremented at `index.ts:1598`
**before** `match:result` is emitted at `:1624`, and `match:result` carries no
scores — so a "join with the latest update" could present a pre-increment score.
B6D1 does **not** alter live React behavior; this is contract/adapter behavior
only.

## 9. Sanitization guarantees

- Every output is built **field-by-field**; raw payloads are never spread into
  protocol output.
- Unknown / benign extra fields are **stripped** (ignored), not rejected, as long
  as every required presentation field is valid.
- Sensitive fields never reach output — verified by test for: `authToken`,
  `accessToken`, `refreshToken`, `supabaseToken`, `session`, `jwt`, `socket`,
  `socketId`, `cookie`, `wallet`, `walletBalance`, `stakeAmount`, `commission`,
  `payout`, `email`, `serviceRoleKey`, `authorization`.
- Scores are validated defensively: own enumerable keys only; player-id keys must
  be **non-empty and have no leading/trailing whitespace** (whitespace-only ids
  rejected); finite non-negative integer values; a **new** cloned object (no
  reference to the source); dangerous keys `__proto__` / `prototype` /
  `constructor` rejected (prototype-pollution guard).
- `statusMessage` is normalized (control chars → space, trimmed, capped at 200);
  a non-string `statusMessage` is omitted, not trusted.

### 9.1 Exception-safety at the untrusted boundary

The untrusted **parsing / building / gating** functions — `validateEnvelope`,
`sanitizeScores`, `PresentationSequenceGate.accept`, and every `build*` adapter —
return a controlled `null` (or a `{ accepted: false, … }` decision) and **never
throw**, even against hostile inputs:

- **Strict plain-record rule:** `isPlainRecord` accepts **only** an ordinary
  object whose prototype is `Object.prototype`, or an `Object.create(null)`
  record. It rejects arrays, `Date`/`Map`/`Set`, class instances, functions,
  `null`, and revoked/hostile Proxies; prototype inspection is wrapped in
  try/catch so a throwing `getPrototypeOf` trap yields "not a plain record".
- **Hostile getters / Proxies:** `validateEnvelope` snapshots each top-level field
  once and wraps the whole inspection in try/catch, so a throwing getter on
  `type` / `protocolVersion` / `matchInstanceId` / `sequence` / `emittedAt` /
  `event` / `payload` / any payload field / nested scores returns `null`.
  `sanitizeScores` wraps the full path (plain-record check, `Object.keys`,
  per-property read, output construction), so a Proxy whose `ownKeys`,
  `getOwnPropertyDescriptor`, or value getter throws — or a revoked Proxy —
  yields `null`. `PresentationSequenceGate.accept` adds defense-in-depth try/catch
  and, on any rejection (including a caught throw), leaves `activeInstanceId` and
  `lastAccepted` **unchanged** (it never silently adopts an instance).

## 10. Sequence / instance behavior

- **Sender** (`PresentationSequenceEmitter`): sequence starts at `1` for a match
  instance, increases monotonically in send order, and resets to `1` on a new
  `matchInstanceId`.
- **Receiver gate** (`PresentationSequenceGate`): the active instance change must
  be **explicit** (`beginInstance`), never silently inferred from an incoming
  message; a duplicate or lower sequence for the active instance is rejected
  (`stale-or-duplicate`); a message from any other instance is rejected
  (`foreign-instance`); an unvalidatable envelope is rejected
  (`invalid-envelope`); accepting before an instance is set returns
  `no-active-instance`. This is TypeScript reference behavior only; **no Unity C#
  is modified in B6D1.**

**Trusted vs. untrusted, precisely.** `PresentationSequenceGate.accept` (and all
parsing/building) operate on **untrusted** messages and never throw. The explicit
**controller-setup** methods `PresentationSequenceEmitter.next` and
`PresentationSequenceGate.beginInstance` are **trusted control APIs**: the caller
must pass an already-validated `matchInstanceId`, and they throw on an invalid id
(a programmer error), rather than silently degrading. So "never throws" applies to
the untrusted boundary, not to these two trusted setup calls.

## 11. Complete test inventory

`apps/web/src/components/match/unityPresentationAdapter.test.ts` — **58 tests**,
all passing via `npm run test:unity-presentation` (Node `node:test` + `tsx`), and
run in the GitHub **Web CI job** (`.github/workflows/ci.yml`, step "Unity
presentation contract tests", after `npm ci` and before the TypeScript check).
Tests assert **exact output keys** (via `deepStrictEqual`), not only selected
values. Coverage:

**Contract & envelope:** valid protocol-1 envelope; invalid protocol version;
empty `matchInstanceId`; invalid `sequence`; invalid `emittedAt` (+ valid `0`);
unknown event; deterministic `roomCode`+`matchInstance` identifier; malformed
identifier → null; sequence-emitter reset on new instance; gate requires explicit
active instance; duplicate-sequence rejection; stale/lower-sequence rejection;
foreign/previous-instance rejection; invalid-envelope rejection.

**Round result:** valid GOAL/SAVE/DRAW; `kickerPick`/`keeperPick` mapping; **no
scores/phase/maxRounds** in output (exact keys); invalid lane/result/round;
missing required field; `statusMessage` sanitized/normalized (+ non-string
omitted, + 200-char cap); unknown extra fields stripped; wallet/auth/socket fields
stripped; adapter never derives result or score.

**State sync:** valid NORMAL; valid SUDDEN_DEATH; `match:update` snapshot accepted;
**raw `match:rejoinState` rejected** (documented limitation); scores cloned not
referenced; dangerous score keys rejected; invalid score value rejected; invalid
phase/round/maxRounds; wallet/auth/socket fields stripped; result-with-no-state
(no score presented); state before AND after `round_result` (order-independent);
duplicate state snapshot; stale pre-result score preserved + later score applies;
reconnect full-state resync; no local score computation; terminal `match:end` with
same-instance prior → combined; terminal with no prior → null; terminal with
foreign-instance prior → null; terminal scores still sanitized.

**Sanitization units:** `sanitizeScores`; `normalizeStatusMessage`.

**Robustness:** null / arrays / strings / numbers / functions / NaN / Infinity;
invalid build opts; getters that throw never crash the adapter.

**Hostile inputs (exception-safety):** `validateEnvelope` with a throwing
top-level `type` getter, a throwing `payload` getter, and a throwing nested
payload-field getter (each → `null`, no throw); `sanitizeScores` with a Proxy
whose `ownKeys` trap throws, whose descriptor trap throws, and a revoked Proxy
(each → `null`, no throw); `validateEnvelope` containing hostile scores;
`PresentationSequenceGate.accept` on a hostile envelope (→ `invalid-envelope`,
does not throw, does not advance `lastSequence`, later valid sequence 1 still
accepted); `Date`/`Map`/`Set`/class instances rejected as score maps;
`Object.create(null)` with valid entries accepted and cloned; whitespace-only and
leading/trailing-whitespace player ids rejected.

## 12. What remains intentionally unintegrated

- No import of this module by `MatchRoomPanel` / `MatchRenderer3D` or any runtime
  component.
- No socket wiring, no Supabase, no React state, no feature-flag change.
- The existing `MatchRenderer3D` bridge contract is untouched and unused by B6D1.
- No Unity C# change; no server change; no Vercel/Supabase change; no generated
  WebGL output. The **only** CI change is the added Web test step (§11) that runs
  these unit tests — no runtime, deployment, or job-structure change.

## 13. Status

- **Production remains NO-GO.**
- **Production reproducibility remains BLOCKED.**
- **B6D2 is NOT authorized** — it requires a separate approval after B6D1 review.
