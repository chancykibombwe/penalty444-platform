# Unity Phase B1 — Passive Bridge Notes

> Status: **Passive stub only.** The `MatchRenderer3D` component exists but is
> NOT mounted into any live page. This is presentation scaffolding for a future
> phase. See `docs/unity-3d-prototype-plan.md` for the full architecture plan.

## What this phase is

Phase B1 re-creates the passive React half of the Unity bridge
(`apps/web/src/components/match/MatchRenderer3D.tsx`) on top of the current
hardened `master`. It replaces the outdated parked draft **PR #162 — Unity
Phase B1 React Bridge Stub** (branch `feat/unity-phase-b1-react-bridge-stub`),
which was based on an old master and must not be merged directly.

The only substantive difference from the PR #162 stub: the shared match
vocabulary (`Lane`, `ShotResult`, `MatchPhase`, `RevealStage`) is now imported
from the canonical `matchPresentation.ts` instead of being duplicated inside
the component, so the bridge types can never drift from the real match types.

## Hard constraints (enforced in code)

`MatchRenderer3D`:

- Renders `null` unless `NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true"`.
- When enabled but `NEXT_PUBLIC_UNITY_BUILD_URL` is missing, shows a safe
  internal placeholder panel.
- When enabled with a build URL, renders only a passive `<iframe>` shell.
- Opens **no** Socket.IO connection.
- Reads **no** Supabase token, JWT, session, or service-role key — and passes
  none to Unity.
- Does **not** submit picks, compute results, update stats/progression, or
  touch wallet/economy.
- Accepts only the known `PENALTY444_UNITY_EVENT` message shape, same-origin
  only, and silently ignores malformed/unknown messages (never throws, never
  executes anything a message asks for).
- Is **not imported by any live page** in this phase.

## Source of truth

The Node.js realtime server remains the single source of truth for all match
logic and results. Unity/3D is passive visual presentation only. Live match
integration (feeding `MatchRenderer3D` already-resolved match state via
`postMessage`) is a later phase and is intentionally out of scope here.

## Env flags (public, build-time only)

- `NEXT_PUBLIC_UNITY_MATCH_ENABLED` — gate. Default off; not set anywhere in
  this PR.
- `NEXT_PUBLIC_UNITY_BUILD_URL` — optional Unity/WebGL build URL for the passive
  iframe shell.

Both are public `NEXT_PUBLIC_*` values. No secrets are introduced.
