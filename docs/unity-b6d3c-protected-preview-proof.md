# B6D3C — Protected-Preview MOCK Proof Harness

Status: **harness only — the proof has NOT been executed.**
This head is **not proof-executable as it stands**: the route is a 404 everywhere,
no environment variable is configured, and even on a correctly-configured Preview
the proof does not start until an operator presses Run (§5.2).
Baseline: `231264be0946941933face8c0d4442adc952d414` (master, after PR #220).
Route: `/dev/unity-b6d3c` (404 on every environment today).

---

## 1. Purpose

B6D3C builds the **isolated runtime-proof surface and the deterministic proof
machinery** for the player-facing Unity path. Its single job is to make it
possible, later and under separate authorization, to observe the ALREADY-MERGED
production code paths behaving correctly on a protected Vercel Preview — using
**synthetic mock data only**.

The paths exercised are all already on master:

| Merged path | Origin | Exercised how |
| --- | --- | --- |
| `useUnityPlayerFacingGate` | PR-2 (#220) | imported and used unchanged |
| `UnityPresentationHost` → `MatchRenderer3D` | PR-2 (#220) | mounted unchanged |
| viewer-presentation adapter (`buildViewerPresentation`) | PR-2 (#220) | called through `projectProofFeed` |
| B6D3A identity + correlation contracts | PR #212 | reached via the adapter |
| PR-1 cohort routes (`status`, `session`, `/unity-arena/player`, `/unity-arena/artifact/**`) | PR #219 | called by the merged gate and the iframe |
| compiled Unity Protocol v1 consumer | B6D2B | receives every envelope, returns every ack |

Nothing in this change modifies any of them.

## 2. What this change is NOT

This commit does **not**:

- configure any environment variable, on any environment;
- activate the proof route on any Preview or anywhere else;
- execute the proof;
- activate player-facing Unity for a real match;
- load `MatchRoomPanel`, open a Socket.IO connection, or import a socket client;
- read or use a real room, opponent, result, match, wallet or balance;
- touch Production in any way;
- authorize B6D3D.

The route is a 404 everywhere until an operator sets a server-side flag in a
separate, separately-authorized step. Production can never be that environment
(§4).

## 3. Files

| File | Kind | Role |
| --- | --- | --- |
| `apps/web/src/app/dev/unity-b6d3c/page.tsx` | new | server component; both gates; renders the client |
| `apps/web/src/app/dev/unity-b6d3c/UnityB6D3CProofClient.tsx` | new | the harness: banner, host, evidence, report |
| `apps/web/src/app/dev/unity-b6d3c/unityB6D3CProof.ts` | new | pure proof plan, projection, sanitization, report |
| `apps/web/src/app/dev/unity-b6d3c/unityB6D3CProof.test.ts` | new | 85 tests (route, plan, sanitization, client guards, correction regressions) |
| `docs/unity-b6d3c-protected-preview-proof.md` | new | this document |
| `apps/web/package.json` | modified | test registration only — no dependency change |

No merged file is modified. No Unity C#, realtime-server, shared package, CI
workflow or lockfile is touched.

## 4. Route gating

`page.tsx` evaluates two gates, in this exact order:

1. `process.env.VERCEL_ENV === "production"` → `notFound()`.
   Checked **first and unconditionally**, so enabling the flag on Production
   cannot expose the route. `VERCEL_ENV` (not `NODE_ENV`) is used because Vercel
   Previews also run with `NODE_ENV=production`.
2. `process.env.B6D3C_PROOF_ROUTE_ENABLED !== "true"` → `notFound()`.

Both failures return an ordinary Next.js 404 — the same opaque answer PR-1 gives
for every cohort-gate failure.

The page takes **no arguments**: no `searchParams`, no `params`, no `headers()`,
no `cookies()`. Nothing about the rendered harness is request-derived. It is also
`force-dynamic` with `revalidate = 0`, so a gated dev surface is never cached or
prerendered.

The gate is never a `NEXT_PUBLIC_*` flag. Public flags are inlined into the client
bundle and are therefore a build-time convenience, not a boundary.

## 5. Client preconditions and the operator-initiated contract

### 5.1 Public preconditions

The harness renders its banner and precondition panel unconditionally. The proof
cannot start until every one of these holds:

- `NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true"`
- `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true"`
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED === "true"`
- `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED === "true"`
- `NEXT_PUBLIC_UNITY_BUILD_URL === "/unity-arena/player"` (the PR-1 protected entry)

These are exactly the four public flags `MatchRoomPanel` composes, plus the
requirement that the build URL is the protected entry point rather than any other
origin.

The precondition panel renders **booleans and the gate state only** — never a
flag value, URL, origin, token or identity.

### 5.2 The exact operator-initiated contract

The contract is **not** the vaguer "nothing runs on mount". It is:

> **Neither a cohort request nor the Unity renderer begins before the operator
> presses Run.**

Three pieces of explicit state enforce it:

| State | Gates | Initial |
| --- | --- | --- |
| `operatorRequested` | the COHORT REQUESTS | `false` |
| `proofActivated` | the HOST (and therefore the iframe) | `false` |
| `proofRunEpoch` | the host's React `key` | `0` |

The merged hook is called as
`useUnityPlayerFacingGate({ requested: preconditionsMet && operatorRequested })`,
so while `operatorRequested` is false it performs no Supabase read and issues no
fetch. The host is passed

```
playerFacingAuthorized = operatorRequested && proofActivated && gate === "authorized"
```

so a gate that merely *became* `authorized` mounts nothing — activation
additionally requires the operator's press and the explicit activation step. On
mount the surface is the React underlay and zero Unity iframes.

### 5.3 Run sequence

1. verify the public preconditions (§5.1) — nothing happens if they fail;
2. clear every prior ref and state value;
3. start the network observation window (§11.1), before any cohort request;
4. set `operatorRequested = true`, which lets the merged gate run;
5. wait, bounded, for the gate to resolve;
   - `denied` or unresolved ⇒ record a bounded `gate_denied` / `timeout` row,
     stay React-only, and **do not start the proof**;
6. record the ready-event baseline **before** the host may activate;
7. set `proofActivated = true`;
8. require a **fresh** ready event, strictly after that baseline, before step 1
   can pass — a stale readiness signal cannot satisfy it;
9. run the deterministic 16-step sequence.

### 5.4 Local reset

A second control, **Reset local proof state**, is disabled while a run is active.
It deactivates the host, drops `operatorRequested`, clears the gate/run state,
returns to instance A and its identity, clears the host feed, the acknowledgement
and send-confirmation refs, the rows and report, the ready count, the iframe
maximum, the network categories and observation timestamp, the harness-fault flag
and the one-run guard, and increments `proofRunEpoch`.

`UnityPresentationHost` carries `key={proofRunEpoch}`, so the reset **remounts**
it. Without that, the merged host's per-instance terminal failure from step 15
would survive into the next local run and every subsequent run would start in
`UNITY_FAILED_REACT_FALLBACK`.

Fallback induction stays automatic in step 15; there is no manual fallback
control.

## 6. Mock data model

All gameplay data is synthetic and defined in the pure module:

- `MOCK_VIEWER_ID = "b6d3c-mock-viewer-…0001"`
- `MOCK_OPPONENT_ID = "b6d3c-mock-oppon-…0002"`
- `PROOF_INSTANCE_A = "B6D3C01:1"`, `PROOF_INSTANCE_B = "B6D3C01:2"`
- `PROOF_FOREIGN_INSTANCE = "B6D3C99:1"` (a different room entirely)

The synthetic ids appear **only on the raw input side**, exactly where the live
shadow path would place real player ids. They are then removed by the merged
adapter, which re-keys every `match_state_sync` to `LEFT`/`RIGHT`. The tests
assert both halves: the raw fixtures *do* contain the ids, and the projected
feeds *do not*.

`B6D3C01:2` is a same-room, higher-numbered instance so the compiled gate treats
it as a legal transition; `B6D3C99:1` is a different room so it is a foreign
instance rather than an invalid transition.

## 7. Channels

| Channel | Meaning |
| --- | --- |
| `host` | through the real `UnityPresentationHost` → `MatchRenderer3D` FIFO path |
| `direct-negative` | proof-only injection of an already-sanitized envelope straight to the single proof iframe |
| `harness` | a local observation (readiness, reload, induced error, DOM count) |

**Every positive lifecycle assertion uses the `host` channel.** Direct injection
is used only for the duplicate, stale and foreign-instance negatives, because the
production path deliberately filters those out *before* Unity — the merged
adapter drops foreign instances and the renderer refuses to enqueue them. Without
a direct channel those envelopes could never reach the compiled consumer, and the
consumer's own gate would go unproven. A unit test enforces that every
`direct-negative` step expects a rejection, and only `stale_or_duplicate` or
`foreign_instance`.

## 8. The proof plan (16 steps, gates A–J)

| # | Gate | Channel | What is proven |
| --- | --- | --- | --- |
| 1 | A | harness | the single proof iframe reaches `ready` |
| 2 | A | host | bootstrap `match_state_sync` seq 1, scores 0/0, round 1, NORMAL |
| 3 | B | host | `round_result` seq 2 GOAL applies and carries **no** score |
| 4 | B | host | the authoritative sync seq 3 carries the score change |
| 5 | C | harness | the ACKNOWLEDGEMENTS for seq 1 and seq 3 still report 0/0 and 0/1 — plus `UNITY_READY_VISIBLE` and exactly one iframe |
| 6 | D | direct | duplicate sequence 3 → `stale_or_duplicate` |
| 7 | D | direct | stale sequence 2 → `stale_or_duplicate` |
| 8 | E | harness | a foreign-instance envelope never survives the merged adapter |
| 9 | E | direct | the compiled consumer rejects it directly → `foreign_instance` |
| 10 | G | host | seq 4 SUDDEN_DEATH, scores 3/3, `suddenDeathRound` exactly 1 |
| 11 | F | host | transition to `B6D3C01:2` accepted at sequence exactly 1 |
| 12 | F | direct | the superseded instance is still rejected → `foreign_instance` |
| 13 | H | harness | same-origin reload of the one iframe → fresh `ready` |
| 14 | H | host | post-reload complete bootstrap at sequence **5** (> 1) is accepted |
| 15 | I | harness | a native iframe `error` → the COMPLETE fail-open contract (§10.1) |
| 16 | J | harness | no synthetic id in any projection, evidence row or report |

**Gate C is proven from the acknowledgements, never from visibility.** Step 5
locates the two normalized applied acknowledgements for instance `B6D3C01:1`
sequence 1 and sequence 3, requires `appliedEvent = match_state_sync` and the
exact instance and sequence, and compares the numeric score values as multisets
against `[0,0]` and `[0,1]`. The outer live scores are deliberately set ahead of
both queued envelopes, so a host that substituted them would report `1/0` for the
bootstrap and fail. This is the exact defect found and fixed during PR-2 review,
re-checked here against the compiled consumer.

Step 5 emits **two acknowledgement-derived evidence rows** — one per snapshot —
so both distinct scoreboards are visibly recorded in the table, plus a harness row
for the host observation. `UNITY_READY_VISIBLE` and exactly one iframe are
ADDITIONAL requirements; gate C passes only when the score conditions **and** the
host conditions all pass.

The plan is immutable (`Object.freeze`), contiguously numbered, and contains no
clock or randomness — `buildRawHostInputs` returns byte-identical output on every
call, which the tests assert.

## 9. Expectations vs. the compiled gate

The expectations were written against the merged
`UnityPresentationProtocolV1.cs` instance gate, not guessed:

- `round_result`: requires an active instance, a matching instance id, and a
  strictly higher sequence.
- `match_state_sync`, no active instance: **any** positive sequence bootstraps
  (this is why step 14 uses sequence 5).
- `match_state_sync`, same instance: sequence must strictly increase, else
  `stale_or_duplicate`.
- `match_state_sync`, different instance: a different room, or an instance number
  that does not increase, is `foreign_instance`; a legal same-room upgrade with a
  sequence other than 1 is `invalid_instance_transition`.

Acknowledgement score values are compared as a **multiset** (both sides sorted),
because the consumer makes no ordering guarantee. A genuinely wrong scoreboard
still fails; a unit test covers exactly that.

`suddenDeathRound` is checked too. Step 10's expectation carries the exact value
`1`, and a normalized acknowledgement satisfies it only when it contains that
value — a different value, or its absence, fails. The merged acknowledgement
normalizer is NOT modified: it already preserves `suddenDeathRound` for a
SUDDEN_DEATH state sync, and only the B6D3C-side expectation and evidence row are
extended. The value is retained in sanitized evidence and rendered as a bounded
numeric `sdRound` column.

## 10. Isolation invariants

Enforced at runtime by the client:

- **At most one Unity iframe.** A `MutationObserver` scoped to the harness
  container records the maximum count ever observed; `buildProofReport` fails the
  run if it exceeds 1. The proof-iframe resolver returns `null` unless there is
  exactly one, so a second iframe also breaks every direct injection rather than
  silently targeting the wrong frame.
- **Container-scoped DOM access only.** There is no `document.querySelector*`,
  `getElementById` or `getElementsByTagName` anywhere in the harness.
- **Strict inbound listener.** A message is accepted only when
  `event.origin === window.location.origin` **and** `event.source` is exactly the
  one proof iframe's `contentWindow`.
- **Explicit outbound origin.** Direct injections pass
  `window.location.origin` — never `"*"`.
- **Bounded timeouts.** `short` 1.5 s, `standard` 6 s, `load` 30 s, polled at
  50 ms against a `Date.now()` deadline. No interval, no unbounded wait.
- **Operator-initiated.** Neither a cohort request nor the Unity renderer begins
  before the operator presses Run (§5.2). A guard prevents a second run without a
  reset.
- **No harness network.** The client contains no `fetch`, `XMLHttpRequest`,
  `WebSocket` or `EventSource`. Every request during the proof is issued by the
  merged gate or by the iframe itself.
- **Two controls.** The harness renders exactly two `<button>` elements — Run and
  Reset local proof state. There is no pick, room-join, rematch, matchmaking,
  stake, wallet or manual-fallback control.

### 10.1 The complete fail-open contract

Step 15 dispatches a native `error` event on the real proof iframe and then
requires **all nine** of these fixed booleans. Host state and iframe count alone
are deliberately insufficient — a terminal host that had unmounted the React
underlay, left the renderer's "unavailable" card behind, or silently remounted an
iframe would still be a broken fallback:

| Field | Requirement |
| --- | --- |
| `hostTerminal` | host state is `UNITY_FAILED_REACT_FALLBACK` |
| `iframeCountZero` | zero Unity iframes inside the harness container |
| `unityUnderlayPresent` | `[data-unity-underlay]` is still in the DOM |
| `proofUnderlayPresent` | `[data-b6d3c-underlay]` is still in the DOM |
| `underlayVisible` | the underlay carries `opacity-100` and not `opacity-0` |
| `unitySlotAbsent` | `[data-unity-slot]` is gone |
| `noUnavailableCard` | no "3D preview unavailable" renderer card exists |
| `stableNoRemount` | nothing remounts during a bounded stability window |
| `instanceStillTerminal` | the same instance is still terminal at the end of it |

They are booleans only — no free text, no DOM content, no identity — and they are
retained in the evidence row's `fallback` field and rendered as a compact bounded
column.

### 10.2 Evidence-row lifecycle

**No successful report retains an unresolved outbound `pending` row.**

For a HOST dispatch the harness records the acknowledgement and send-confirmation
starting indices, adds the projected message to the host FIFO, waits for the
matching sanitized `onMessageSent` summary from the MERGED host, then waits for
the matching normalized acknowledgement. Only after **both** succeed are the
outbound row and the inbound acknowledgement row retained, both as `pass`. A
timeout or mismatch instead adds a bounded `missing_send_confirmation`,
`missing_acknowledgement` or `unexpected_outcome` failure row.

The `onMessageSent` summary is reduced to `{event, matchInstanceId, sequence}` —
the message id is deliberately dropped, since instance + sequence + event already
identifies the dispatch uniquely in this deterministic plan and carries strictly
less data.

For a DIRECT negative dispatch the envelope is posted to the exact iframe at the
exact origin and the outbound and inbound rows are retained only after the
expected rejection arrives; otherwise a bounded failure row is added.

A transient pending indicator may appear in the UI, but it is separate state: no
`pending` row ever enters `rowsRef` or the report. `buildProofReport` additionally
refuses to report `pass` while any row is `pending`.

## 11. Sanitization

Two layers:

1. **Projection.** Raw id-keyed envelopes go into the merged adapter; only
   `LEFT`/`RIGHT`-keyed envelopes come out. The harness re-implements none of it.
2. **Evidence.** Every retained row is built field-by-field from a fixed key set:
   step, gate, direction, event, protocol version, instance, sequence, applied
   event, result, phase, score values, player count, rejection reason, host state,
   iframe count, status, failure category. No raw JSON, no free text, no identity.

Failure reasons are constrained to a bounded `SafeFailureCategory` union, and
rejection reasons to the merged `REJECT_REASONS` allowlist, so an arbitrary
error string can never be displayed.

`assertNoProhibitedValues` is the final net: `buildProofReport` throws rather than
emitting a report that contains a synthetic identifier or a prohibited field name
(`token`, `cookie`, `authorization`, `email`, `sub`, `secret`, `wallet`,
`socket`, `roomCode`, `matchId`, `raw…`). The client treats that throw as a
harness fault and shows **no report at all**.

Requests are reduced to bounded categories — `cohort_status`, `cohort_session`,
`protected_player_entry`, `protected_unity_artifact`, `other_same_origin_static`,
`third_party_auth`, `prohibited` — and the URL, query string, headers and cookies
are never read, stored or rendered. Anything gameplay-authoritative
(`ws:`/`wss:`, `/socket.io`, a realtime host, `/match`, `/pick`, `/room`,
`/wallet`, `/economy`, `/payout`) or from an unexpected origin classifies as
`prohibited` and fails the run.

### 11.1 The network observation window

Observation is **operator-started**, not mount-started, so pre-run Preview traffic
is never collected and never counted as isolation. At the operator's press, and
before any cohort request, the harness clears the category set, records
`performance.now()` as the observation start, and creates the
`PerformanceObserver`. `buffered: true` is used so nothing is missed once the run
begins, but every replayed entry whose `startTime` is earlier than the recorded
start is discarded. The observer is disconnected after the final report, on reset,
and on unmount.

Unexpected post-start cross-origin or gameplay traffic still fails the proof.

If `PerformanceObserver` is unavailable or cannot start, the harness records a
bounded `network_observation_unavailable` failure row and sets the harness-fault
flag, rather than silently claiming network isolation.

### 11.2 Harness-fault semantics

Any unexpected exception does **both** things, so a fault can never be reduced to
a UI label on an otherwise-passing report:

1. an explicit bounded `harness_error` failure row is added for the ACTIVE step, and
2. `harnessFault: true` is passed to `buildProofReport`, which forces
   `overall: "fail"` regardless of the collected evidence.

A report that would have contained something prohibited is not shown at all, and
that too sets the harness-fault flag.

## 12. Known observation limits

Stated plainly so a future report is not over-read:

- **Sub-resource visibility.** The parent page's `PerformanceObserver` sees the
  iframe navigation (`/unity-arena/player`) but not the artifact requests the
  Unity build makes *inside* the iframe — those belong to the iframe's own
  performance timeline. Artifact delivery therefore has to be confirmed from the
  PR-1 route behaviour and the browser network panel, not from the harness table.
- **Host state after an instance transition.** The merged host records readiness
  per instance and Unity only emits `ready` once per document load, so after
  step 11 the host sits in `UNITY_LOADING` (React underlay visible, Unity still
  receiving and applying events) until the step 13 reload produces a fresh
  `ready`. This is existing merged behaviour, observed here and **not changed**
  by B6D3C; it is recorded in the evidence rows rather than hidden. Whether a
  rematch should re-reveal Unity without a reload is a question for B6D3D.
- **Induced failure is a native `error` event**, dispatched on the real iframe
  element. It exercises the merged `onError` → `markUnavailable` → host terminal
  path exactly, but it is an induced failure, not a naturally-occurring one.
- The harness proves **presentation** behaviour only. It says nothing about
  matchmaking, settlement, economy or server authority.

## 13. Test coverage

`apps/web/src/app/dev/unity-b6d3c/unityB6D3CProof.test.ts` — 85 tests, run by
`npm run test:unity-presentation` (and therefore by the existing CI step; no
workflow change was needed):

- **Route contract** — production denied first, explicit opt-in, two `notFound()`
  calls, never `NODE_ENV`, never a `NEXT_PUBLIC` gate, no request-derived input,
  `force-dynamic`, no match/socket/Supabase import in any of the three files.
- **Plan** — contiguous and frozen, every gate covered, all positive evidence on
  the host channel, direct injection restricted to host-filtered negatives, all
  reasons in the merged allowlist, transition/foreign/bootstrap expectations
  matched to the compiled gate, feeds deterministic.
- **Sanitization** — raw fixtures carry the ids, projections do not; detectors
  fire; `assertNoProhibitedValues` throws; evidence rows expose only the allowed
  key set; a leaky report refuses to build.
- **Acknowledgements** — matched per step; score order ignored but a wrong
  scoreboard still fails; malformed acks dropped.
- **Network classification** — gameplay paths prohibited, expected paths safe,
  cross-origin prohibited unless it is the auth origin.
- **Client guards** — merged host and gate reused (no second renderer,
  coordinator, emitter or queue), all five preconditions required, strict
  origin+source listener, explicit target origin, container-scoped DOM,
  one-iframe invariant, bounded timeouts, banner text, exactly two controls,
  categories-only retention, and a purity check on the pure module (no
  `process.env`, `window`, `document`, `fetch`, `postMessage`, timers, clock or
  React import).
- **Operator initiation** — the cohort hook requires `operatorRequested`; both
  initiation flags start `false`; host activation requires operator + activation +
  `authorized`; the denial check precedes activation; the ready baseline is
  captured before activation and step 1 needs a strictly-later ready event;
  preconditions and the one-run guard are checked before anything happens.
- **Reset** — inert while running, deactivates the host, clears every
  accumulator, clears the one-run guard, and increments the epoch that re-keys the
  host.
- **Evidence lifecycle** — the merged `onMessageSent` is wired and is not a
  no-op; a host dispatch waits for confirmation *then* acknowledgement and retains
  rows only afterwards; no `pending` row is ever pushed; outbound `pass` + inbound
  `pass` classifies a gate as `pass`; a missing confirmation or acknowledgement
  fails it; a realistic complete 16-step evidence set reaches overall `PASS` with
  zero pending rows; send summaries normalize to bounded values and match by
  identity.
- **Gate C** — the two exact snapshots; passes only on the acknowledged
  per-envelope scores; fails when the bootstrap was overwritten by the live
  scores; fails on a missing snapshot; ignores the wrong instance, event kind and
  rejections; emits one acknowledgement-derived row per snapshot; the client
  proves it from acknowledgements, not visibility.
- **`suddenDeathRound`** — step 10 requires exactly 1; positive and negative
  matcher cases including absence; retained in evidence and displayed.
- **Fail-open** — the contract cannot pass from host state and iframe count
  alone: each of the other seven booleans is individually required; the row fails
  on any false; the client probes every DOM condition.
- **Harness and network faults** — a harness fault always forces overall failure;
  a pending row can never appear in a passing report; pre-run entries are filtered
  by start time; observation is started at the press before the cohort requests
  and never on mount; the observer is disconnected after completion, on reset and
  on unmount; an unavailable observer is a bounded failure, not silent success; an
  exception adds a bounded row AND sets the report flag.

Source assertions are made against **comment-stripped** code, so prose naming a
forbidden thing cannot masquerade as a violation — nor hide one.

## 14. Validation performed on this change

| Check | Result |
| --- | --- |
| `npm run test:unity-presentation` | 395 passed (310 pre-B6D3C + 85 B6D3C), 0 failed |
| `npm run test:unity-security-delivery` | 170 passed, 0 failed |
| B6D3B streaming harness tests | 67 passed, 0 failed |
| `npx tsc --noEmit` (web) | clean |
| `npm run build` (web) | see §18 |
| `npx tsc --noEmit` / `npm run build` (realtime-server) | see §18 |
| `git diff --check` | clean |

## 15. Banner and operator-facing framing

The harness renders an unmissable banner on every render, before anything else:

```
B6D3C PROTECTED-PREVIEW MOCK PROOF
MOCK EVENTS ONLY
NO REAL MATCH
PRODUCTION NO-GO
```

with the pinned baseline SHA and route beneath it. The surface cannot be mistaken
for a match: there is no scoreboard, no timer, no opponent, no pick control and
no result text.

## 16. What a future, separately-authorized execution would require

Listed for completeness. **None of it is done, requested or authorized here.**

1. A decision to run the proof at all.
2. A Preview deployment of this branch, with Vercel deployment protection on.
3. Server-side `B6D3C_PROOF_ROUTE_ENABLED=true` scoped to **Preview only**.
4. The four public Unity flags and `NEXT_PUBLIC_UNITY_BUILD_URL` set on Preview.
5. Cohort membership for the operator account and the PR-1 signing secret present.
6. An operator with browser access to the protected Preview.
7. That operator pressing **Run mock proof**. Nothing self-starts: with all six
   above satisfied, the surface still issues no cohort request and mounts no Unity
   iframe until the press (§5.2).

Every one of those is a separate authorization. Setting any of them on Production
is prohibited, and would in any case be defeated by the §4 ordering.

## 17. Reporting rules for a future execution

If the proof is ever run, the report must contain only what the harness already
retains: gate results, bounded failure categories, sanitized evidence rows (including
the fixed fail-open booleans and the bounded `suddenDeathRound`), the harness-fault
flag, the maximum iframe count and request categories.

It must **never** contain: a user password, a Supabase access or refresh token,
the `p444_unity_cohort` cookie value, `UNITY_COHORT_SIGNING_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, the artifact origin, full authenticated request
headers, or a full Preview URL.

## 18. Build verification

Recorded at commit time in the pull request description; see §14 for the test
counts. Any build failure blocks the change — the harness is additive and must
not perturb the existing production build.

## 19. Relationship to B6D3D

B6D3C ends here. It produces a proof surface and a proof plan; it does not
produce a result, and it does not authorize activating player-facing Unity for a
real match. Any decision about a real match, about production flags, or about
B6D3D is out of scope for this change and requires its own review.
