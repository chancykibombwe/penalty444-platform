# Unity B5B3 — Shadow Readiness & Fail-Open Fallback (PR #202)

> Status: **Optional, default-off, dev-only.** Hardens the lifecycle of the
> optional Unity live shadow preview so a broken, slow, or failing 3D preview can
> never affect the authoritative React match. The preview remains a **secondary**
> shadow renderer; it does not replace the React match renderer.

## Lifecycle states

`MatchRenderer3D` now has a presentation-only status:

- **`loading`** — the iframe is mounted but Unity has not yet emitted `ready`. A
  non-interactive overlay shows "Loading 3D preview…" / "React match remains
  active" (`aria-live="polite"`).
- **`ready`** — Unity emitted the valid `ready` event; the overlay is removed and
  the live scene shows.
- **`unavailable`** — a failure occurred; the iframe is **unmounted** and a
  compact fail-open card is shown: "3D preview unavailable" / "The React match
  continues normally." (a sanitized reason may show in dev only).

## Readiness boundary & timeout

The readiness boundary is the existing, unchanged Unity → React `ready` event
(`{ type: "PENALTY444_UNITY_EVENT", event: "ready", payload: null }`), validated
by the existing same-origin + `event.source === iframe.contentWindow` checks. On
`ready`: the timeout is cleared, status becomes `ready`, the existing `onReady`
fires, and the latest pending message flushes exactly as before.

A presentation-only timeout `UNITY_READY_TIMEOUT_MS = 15_000` (15s) is armed when
the iframe lifecycle begins (mount and on each iframe (re)load). **This timeout
never gates React** — it only decides whether the optional preview becomes
`unavailable`. There is no polling and no automatic retry.

## Failure paths → fail open

A single idempotent `markUnavailable(reason)` handles every failure (repeated
calls are ignored once unavailable; it clears the timeout, sets
`readyRef=false`, sets status `unavailable`, stores a safe reason, and fires
`onError` once, never throwing). It is triggered by:

1. **Readiness timeout** — Unity did not emit `ready` within 15s →
   "3D preview did not become ready."
2. **Native iframe load failure** — the iframe `onError` (network error) →
   "3D preview failed to load."
3. **Unity `error` event** — a valid Unity outbound `error` →
   "3D preview reported an error."
4. **`postMessage` delivery exception** — a caught send failure →
   "3D preview message delivery failed."

In all cases React remains fully operational; the failure surfaces only through
the existing non-blocking `onError` and the fallback card. Raw stack traces,
URLs, tokens, and payload objects are never shown to users (dev-only console
detail may remain).

## Unavailable-state behavior

Once `unavailable`: the iframe is not rendered, no further `postMessage` sends
are attempted (`flushPending` early-returns), and a late `ready` does not
resurrect the preview. React may keep updating the latest presentation prop, but
the renderer stays inert for that mounted lifecycle. **No Retry button** in this
PR — a page reload after fixing configuration is sufficient for this dev-only
phase.

## Preserved from B5A/B5B1/B5B2

- Exact same-origin + `event.source` validation; no wildcard `postMessage`
  target; existing Unity message validation.
- Latest-pending-message behavior and stable message-id deduplication (per iframe
  lifecycle; cleared on load/reload). No queue rewrite, no id changes, no
  acknowledgements.
- No `animation_complete` dependency.

## Flags, Unity source, rebuild

Unchanged flags (`NEXT_PUBLIC_UNITY_MATCH_ENABLED` +
`NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED`, both `"true"`, plus
`NEXT_PUBLIC_UNITY_BUILD_URL`); either false → no iframe, no loading timer, no
lifecycle bookkeeping, no fallback card, React match unchanged. Default-off and
non-production. **No Unity source change** — the existing build already emits
`ready` and `error`, so **no fresh WebGL rebuild is required** (reuse the B5B1/
B5B2 build). Generated WebGL output stays git-ignored and uncommitted.

## Out of scope / future

Production visual replacement, hiding the React result renderer, Unity input,
`pick_selected`, `animation_complete` gating, Unity-controlled timers/progression/
rematch, automatic retries, telemetry/analytics, device/reduced-motion detection,
CDN/service-worker/FPS work, and tournament-specific Unity behavior are **not** in
this PR. **B6** (production renderer replacement) remains future work.
