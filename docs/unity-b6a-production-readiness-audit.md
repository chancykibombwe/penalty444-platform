# Unity B6A — Production Readiness Audit and Delivery Decision

> Documentation only. This PR adds no code, no Unity source change, no WebGL
> rebuild, no artifact publication, and commits no WebGL output. It is the formal
> gate between the completed B5 prototype sequence and any future B6 production
> renderer work.
>
> Audited against `master` @ `d42980b54be48b7800cbae5452b4eb258e91364a`.

## 1. Executive decision

**B6 production renderer implementation is currently NO-GO.**

This does **not** mean the Unity prototype failed. The prototype has proven the
live presentation bridge end-to-end (see §2). It means production delivery,
performance, compatibility, operational ownership, and rollout safety have **not
yet** been proven. No primary-renderer replacement may begin until the mandatory
gates in §11 are passed. Merging this audit does not authorize any B6B+ work.

## 2. Proven capabilities

Split by how each was proven.

**Code-proven (present and reviewed on `master`):**

- Same-origin `postMessage` bridge (`MatchRenderer3D.tsx`): `event.origin ===
  window.location.origin` **and** `event.source === iframe.contentWindow`, no
  wildcard `postMessage` target.
- Strict inbound event/schema validation (`validateUnityMessage`).
- Presentation-only authority boundary — no socket, no auth/JWT, no Supabase, no
  wallet/economy, no pick submission, no result derivation.
- Live bridge events: `staging_begin`, `round_result`, `match_end`, `reset`
  (React→Unity) and `ready`, `error` (Unity→React).
- React-timed staging→result sequencing (B5B1): `staging_begin` at REVEALING,
  `round_result` at REVEALED via the existing `applyRevealedResult` boundary.
- Match-end + rematch-reset presentation (B5B2), with a pure final-score→
  `winnerId`/`isDraw` classifier that fails open on malformed input.
- Loading / ready / unavailable lifecycle with a 15s presentation-only readiness
  timeout, idempotent `markUnavailable`, iframe removal on failure, and non-
  blocking `onError` (B5B3).
- **No `animation_complete` dependency:** the type/validation plumbing exists but
  `MatchRoomPanel` does not pass `onAnimationComplete`, so nothing gates on it.
- No committed WebGL output; `.gitignore` ignores
  `apps/web/public/unity/penalty444/`.

**Runtime-proven (operator two-player validation recorded in PR #199–#202):**

- Live GOAL/SAVE/DRAW mirroring in the correct React-timed order.
- MATCH OVER shown only after React's match-complete; single occurrence.
- Confirmed-rematch reset returns Unity to idle; visual round counter restarts.
- Reconnect smoke: staging/result sequence continues after refresh/reconnect.
- Fail-open: missing build URL → loading → "3D preview unavailable" at ~15s,
  iframe unmounted, React match fully correct throughout; single transition, no
  error loop.
- Flag-off: no iframe, no timer, no card; React match unchanged.

These are **prototype** passes on localhost / a local build. They are **not**
production evidence (see §11).

## 3. Current production blockers

1. No production artifact delivery path.
2. No automated, reproducible Unity build command committed to the repo.
3. No CI artifact packaging / publishing process (CI `ci.yml` builds only web +
   realtime typecheck/build; it does not install Unity or produce WebGL).
4. No selected object-storage / CDN provider. *(Not yet selected.)*
5. No approved same-origin delivery strategy for a hosted artifact.
6. No immutable, versioned build URL.
7. No artifact manifest / checksum process.
8. No staging environment serving a production-like Unity build.
9. No browser/device compatibility matrix. *(Not yet measured.)*
10. No network-throttled load-time measurements. *(Not yet measured.)*
11. No FPS, memory, thermal, or crash measurements. *(Not yet measured.)*
12. No mobile lifecycle / resource-release validation. *(Not yet measured.)*
13. No production telemetry or error-rate reporting. *(Not yet implemented.)*
14. No gradual rollout mechanism beyond build-time flags.
15. No formal rollback runbook. *(Not yet implemented.)*
16. No completed production art/audio asset inventory or licensing register. The
    current prototype uses basic/primitive visual assets and is **not** a
    finished production art package.
17. No approved user-facing primary-renderer UX. *(Not yet approved.)*
18. No final decision on whether Unity WebGL is acceptable vs a Three.js /
    Babylon.js fallback strategy. *(Not yet selected.)*

These are recorded as blockers only; none is implemented in this PR.

## 4. Production delivery options

### Option A — Commit generated WebGL output to Git — **Rejected for production**

- Large generated binary artifacts; repository growth; machine-generated diffs;
  poor version management. Existing repo policy explicitly keeps the output
  untracked (`.gitignore`).

### Option B — Build Unity inside normal web CI — **Not yet approved**

- Risks: Unity Editor install + licensing in CI; long IL2CPP/WebGL build times;
  large CI runtime/cache; coupling frontend deploys to Unity compilation; harder
  emergency web-only deployment.

### Option C — Build separately, publish immutable versioned artifacts — **Recommended candidate for evaluation (not yet selected)**

- Unity build produced in a separate release process; output uploaded to
  versioned object storage / CDN at an immutable path such as
  `/unity/penalty444/<version>/index.html`; file manifest + SHA-256 checksums;
  current production version selected via configuration; rollback = point config
  back to a previous immutable version.

**Same-origin constraint (applies to all options):** the current React bridge
accepts **only same-origin** iframe messaging. The final design must therefore
provide either (1) a same-origin delivery/proxy/rewrite path, or (2) a
separately-reviewed cross-origin bridge with an explicit origin allowlist and
equivalent `event.source` validation. **Preferred security direction: preserve
the current same-origin contract** unless a reviewed operational reason requires
otherwise. Neither path is implemented in this PR.

## 5. Required artifact release contract (definition only)

A future production artifact release must include: a semantic or timestamped
**version**; an **immutable** artifact folder containing `index.html`,
`loader.js`, the framework file, the data file, the wasm file, and `TemplateData`
assets; plus a `manifest.json` capturing SHA-256 checksums, Unity editor version,
Git source commit SHA, build timestamp, compression mode, total compressed bytes,
per-file bytes, release notes, and the rollback-compatible previous version.

This document defines the contract only. No artifact-generation code is added.

## 6. Performance and compatibility gates (PROPOSED — not approved)

Thresholds are **proposed** until approved, and **none is claimed as passed**:

- Compressed WebGL payload target **≤ 12 MB**; hard review threshold **> 15 MB**.
- Unity `ready` desktop broadband **≤ 8 s at p75**; tested mobile broadband
  **≤ 15 s at p75**.
- No React gameplay blocking at any load duration.
- Sustained prototype framerate: desktop **≥ 45 FPS**, supported mobile
  **≥ 30 FPS**.
- No unbounded memory growth across 10 rounds, match end, rematch, iframe
  failure, and page navigation.
- No browser crash during three consecutive matches.
- React fallback success **100%** in tested failure scenarios.

**Required browser/device matrix** — Desktop: Chrome current, Edge current,
Firefox current, Safari current on macOS (if available). Mobile: Android Chrome
on ≥1 mid-range device, Android Chrome on ≥1 higher-end device, iPhone Safari on
≥1 supported device. Also test: normal broadband, throttled network, cache cold,
cache warm, background/foreground tab, refresh/reconnect, orientation change, and
low-battery/thermal observation where practical. **These tests have not been
run.**

## 7. Security and privacy gates (non-negotiable)

Require: no JWT / Supabase session into Unity; no service-role key; no direct
Socket.IO from Unity; no direct Supabase access; no wallet/economy data; strict
inbound message-schema validation; strict origin validation; strict iframe-window
`event.source` validation; no wildcard `postMessage` target; sanitized user-facing
errors; no sensitive data in telemetry; reviewed iframe headers; reviewed future
CSP impact; reviewed artifact MIME + compression headers; no third-party asset
without a documented license. **Existing authority boundaries remain
non-negotiable.**

## 8. Observability requirements (definition only — not implemented)

Future metrics: Unity requested; Unity ready; readiness duration; readiness
timeout; iframe load error; Unity-reported error; postMessage failure; fallback
activation; browser/device category; build version; match completion while Unity
active; rematch completion while Unity active. **Rules:** no player secrets, no
auth tokens, no raw socket payloads, no full user-agent storage unless approved;
metrics must **never** gate gameplay.

## 9. Rollout plan (future stages)

- **Stage 0** — Internal / local only.
- **Stage 1** — Production-like staging, staff accounts only.
- **Stage 2** — Production shadow preview, allowlisted internal cohort.
- **Stage 3** — Small-percentage optional shadow rollout.
- **Stage 4** — Larger optional rollout after performance/error gates pass.
- **Stage 5** — Primary visual-mode experiment, tightly controlled cohort.
- **Stage 6** — General availability only after explicit approval.

**At every stage:** the React renderer remains available; a global kill switch
must exist; rollback must not require a new Unity build; rollback must not require
a realtime-server deployment; match authority must remain unchanged.

## 10. Rollback runbook requirements (future procedure)

1. Disable the production Unity flag.
2. Confirm the React renderer is primary.
3. Remove or revert the selected Unity build version.
4. Verify match completion, reconnect, and rematch.
5. Review telemetry / error reports.
6. Preserve the failed artifact for investigation.
7. Do not alter server match authority.

The actual production environment controls are **not yet implemented**.

## 11. Go / no-go gate matrix

Statuses are honest; localhost success does **not** mark a production gate passed.

| Gate | Current status | Evidence required | Owner | Blocking? |
|---|---|---|---|---|
| Reproducible build | NOT YET IMPLEMENTED | Committed deterministic build command + Unity version pin | Eng | Yes |
| Artifact publishing | NOT YET IMPLEMENTED | Automated package + upload process | Eng/Ops | Yes |
| Immutable versioning | NOT YET IMPLEMENTED | `/unity/penalty444/<version>/` immutable paths | Eng/Ops | Yes |
| Same-origin delivery | NOT YET SELECTED | Approved same-origin proxy/rewrite (or reviewed cross-origin bridge) | Eng/Security | Yes |
| MIME/compression headers | PROTOTYPE PASS (dev, same-origin `/unity/penalty444/`) | Prod-host header verification for hosted artifact | Eng/Ops | Yes |
| Staging deployment | NOT YET IMPLEMENTED | Prod-like staging serving the build | Ops | Yes |
| Payload size | NOT YET MEASURED | Compressed bytes vs §6 targets | Eng | Yes |
| Cold-load performance | NOT YET MEASURED | p75 ready time, cache-cold, throttled | Eng | Yes |
| Warm-load performance | NOT YET MEASURED | p75 ready time, cache-warm | Eng | Yes |
| Desktop compatibility | NOT YET MEASURED | §6 desktop matrix | QA | Yes |
| Mobile compatibility | NOT YET MEASURED | §6 mobile matrix | QA | Yes |
| Memory stability | NOT YET MEASURED | No unbounded growth across §6 scenarios | Eng | Yes |
| iframe cleanup | PROTOTYPE PASS (B5B3) | Prod-scale confirmation | Eng | Yes |
| Failure fallback | PROTOTYPE PASS (B5B3) | Prod-scale confirmation | Eng | Yes |
| Reconnect | PROTOTYPE PASS (smoke) | Prod-scale confirmation | Eng | Yes |
| Rematch | PROTOTYPE PASS (B5B2) | Prod-scale confirmation | Eng | Yes |
| Security review | NOT YET APPROVED | §7 sign-off (incl. CSP/headers) | Security | Yes |
| Telemetry | NOT YET IMPLEMENTED | §8 metrics, privacy-reviewed | Eng | Yes |
| Rollout controls | NOT YET IMPLEMENTED | Server-side/runtime gating beyond build flags | Eng/Ops | Yes |
| Kill switch | NOT YET IMPLEMENTED | Global disable not requiring Unity/realtime deploy | Eng/Ops | Yes |
| Rollback rehearsal | NOT YET IMPLEMENTED | Executed §10 drill | Ops | Yes |
| Asset licensing | NOT YET IMPLEMENTED | Completed inventory + license register | Product/Eng | Yes |
| Product/UX approval | NOT YET APPROVED | Approved primary-renderer UX | Product | Yes |

## 12. Proposed B6 implementation sequence

- **B6A** — Production readiness audit (this documentation PR).
- **B6B** — Reproducible local release build + artifact manifest. *(Future. No production activation.)*
- **B6C** — Versioned staging artifact delivery. *(Future. Staging only.)*
- **B6D** — Device, browser, and performance qualification. *(Future. Measurements + fixes only.)*
- **B6E** — Production shadow rollout controls + observability. *(Future. Still secondary to React.)*
- **B6F** — Controlled primary-renderer experiment. *(Future. Requires explicit product + engineering approval.)*
- **B6G** — General availability decision. *(Future. Not automatic.)*

**Merging B6A does not authorize B6B automatically.** Each step requires a
separate, scoped PR and review.

## 13. Explicit non-goals

This audit does **not** authorize: production Unity activation; React renderer
replacement; Unity pick input; `pick_selected`; `animation_complete` gating; Unity
gameplay authority; direct Unity sockets; direct Unity Supabase access;
wallet/economy integration; tournament authority; CI Unity installation;
CDN/provider creation; Vercel configuration changes; artifact upload; WebGL output
commit; analytics implementation.

## Appendix — Local artifact observation

**Local artifact measurement not available in this worktree.** The WebGL output
(`apps/web/public/unity/penalty444/`) is git-ignored and is produced only on the
operator's machine; it is absent from this clone, so file count, byte size, and
filenames could not be measured here.

Operator-recorded (from the B5 runtime validations, **not** repo-verified and
**not** a production measurement): the last local build was approximately
**10.6 MB across ~17 generated files**. Unity editor version documented in the
repo: **6000.4.2f1** (`ProjectSettings/ProjectVersion.txt`). The current build is
a successful prototype dry run, not a reproducible or production-approved release.
