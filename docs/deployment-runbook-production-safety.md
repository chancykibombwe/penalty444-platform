# Deployment Runbook & Production Safety Gates

> Documentation only. No app code, realtime server, Socket.IO, Supabase
> migration, auth, wallet/economy, tournaments, admin, or Home changes are made
> by this PR. This runbook contains **no secret values** — every credential is
> referred to as `set` / `configured` / `masked/secret`.

---

## 1. Purpose

This runbook prevents **configuration drift** between the codebase's safe
defaults and what is actually configured in production, before opening a
controlled wider beta. The full platform audit found that the single biggest
production risk is not a code defect but a *config* one — most critically, the
realtime server running without `SOCKET_JWT_ENFORCE=true` on Railway, which
would let a scripted client spoof another player's identity.

**Scope of this launch — read this first:**

- **Controlled wider beta only** — a bounded, invited tester group.
- **Free Play only** — every match is free; there is no entry cost.
- **Not a public launch.**
- **Not a real-money launch.**
- **Wallet remains Coming Soon / read-only.** No money movement of any kind.

If any statement above is not true of the environment you are about to open to
testers, stop and reconcile before inviting anyone.

---

## 2. Required production services

| Service | Role | Notes |
|---|---|---|
| **GitHub** — `chancykibombwe/penalty444-platform` | Source of truth | `master` is the source of truth; all changes land via **PR-only workflow** (no direct pushes to `master`). |
| **Vercel** | Frontend + Next.js server routes/API | Hosts `apps/web`. Root Directory must be `apps/web`. |
| **Railway** | Realtime backend | Hosts the Socket.IO / Express realtime server (`apps/realtime-server`). |
| **Supabase** | Database + Auth | Postgres with RLS, Supabase Auth, migrations. |

Ground rules:

- `master` is the **source of truth**. Production deploys track `master`.
- **PR-only workflow.** No hotfixes committed directly to `master`.
- A change is not "done" until it is merged to `master` **and** the relevant
  service has redeployed and is healthy.

---

## 3. Critical production safety gates

Verify **every** gate below before inviting testers. The one marked **HARD
BLOCKER** is non-negotiable.

| Gate | Required value / status | Where to check | Why it matters | Blocks beta? |
|---|---|---|---|---|
| **`SOCKET_JWT_ENFORCE=true`** | **`true`** | Railway → realtime service → Variables | **HARD BLOCKER.** If not `true`, any scripted socket client can claim an arbitrary `playerId` (player IDs are not secret) and hijack/cancel another player's room or match. | **YES — HARD BLOCKER** |
| `NODE_ENV=production` | `production` | Railway → Variables | Enables production CORS allow-list behavior and disables dev-only fallbacks. | YES |
| `SUPABASE_SERVICE_ROLE_KEY` server-side only | `set` (masked/secret), **never** `NEXT_PUBLIC_*` | Railway + Vercel (server env) | The service role bypasses RLS; exposing it to the frontend would hand clients full DB write access. | YES |
| `REALTIME_INTERNAL_SECRET` | `set` (masked/secret) where required | Railway + Vercel (server env) | Authenticates internal server-to-server calls to the realtime backend; a missing/empty value breaks or opens internal routes. | YES |
| `ALLOWED_ORIGINS` | `set` and **not empty** | Railway → Variables | In production an empty allow-list is fatal-at-boot by design; it is the browser CORS gate for the socket server. | YES |
| `NEXT_PUBLIC_REALTIME_URL` | `set` → points to the **Railway** realtime backend | Vercel → Variables | If it points at localhost or a stale host, the frontend can't reach realtime and matches won't start. | YES |
| `NEXT_PUBLIC_ECONOMY_MODE=off` | `off` | Vercel (and Railway if referenced) | Keeps the client economy surfaces fully disabled/fail-closed. | YES |
| `ECONOMY_ENABLED=false` | `false` | Railway → Variables | Master switch for any economy/escrow/settlement code path. | YES |
| `ECONOMY_TEST_MODE=false` | `false` | Railway → Variables | Prevents test-economy behavior from being live. | YES |
| `ECONOMY_REAL_MONEY_ENABLED=false` | `false` | Railway → Variables | Prevents any real-money code path from being reachable. | YES |
| `ECONOMY_RECONCILIATION_ENABLED=false` | `false` | Railway → Variables | Keeps the reconciliation worker off. | YES |
| `ADMIN_EMAILS` server-side only | `set` (masked/secret), **never** `NEXT_PUBLIC_*` | Vercel (server env) | Sole allow-list gating admin routes; must never be client-readable. | YES |
| `CRON_SECRET` server-side | `set` (masked/secret) | Vercel (server env) | Protects internal cron/tick endpoints. | YES |
| Vercel latest production deployment healthy | Latest deploy = **Ready**, no runtime errors | Vercel → Deployments | A broken frontend build = no beta. | YES |
| Railway latest backend deployment healthy | Latest deploy = **running**, booted cleanly | Railway → Deployments / logs | A backend that fails to boot = no realtime = no matches. | YES |
| Supabase migrations applied | All migrations applied to the production project | Supabase → Database / migration history | Missing migrations = missing RLS lockdowns / tables. | YES |

> **Hard blocker restated:** **If `SOCKET_JWT_ENFORCE` is not `true` on Railway,
> do not invite testers.** This is the single most important gate in this
> document.

---

## 4. Vercel environment checklist

**Public, frontend-safe** (`NEXT_PUBLIC_*` — these ship to the browser by
design; none is a secret):

- `NEXT_PUBLIC_SUPABASE_URL` — `set`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — `set`
- `NEXT_PUBLIC_REALTIME_URL` — `set` (Railway realtime backend URL)
- `NEXT_PUBLIC_ECONOMY_MODE=off`

**Server-side only / secret** (never exposed to the browser):

- `SUPABASE_SERVICE_ROLE_KEY` — `set` (masked/secret)
- `ADMIN_EMAILS` — `set` (masked/secret)
- `REALTIME_INTERNAL_SECRET` — `set` (masked/secret)
- `CRON_SECRET` — `set` (masked/secret)

> **Never expose server-only secrets as `NEXT_PUBLIC_` variables.** Anything
> prefixed `NEXT_PUBLIC_` is embedded in the client bundle and readable by every
> visitor. `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `REALTIME_INTERNAL_SECRET`,
> and `CRON_SECRET` must **only** exist as plain (server) env vars.

---

## 5. Railway realtime backend checklist

Required backend env vars:

- `NODE_ENV=production`
- `SOCKET_JWT_ENFORCE=true` — **hard gate**
- `SUPABASE_URL` — `set`
- `SUPABASE_SERVICE_ROLE_KEY` — `set` (masked/secret)
- `REALTIME_INTERNAL_SECRET` — `set` (masked/secret)
- `REALTIME_INTERNAL_URL` — `set` **if used by backend / internal routes**
- `ALLOWED_ORIGINS` — `set` and not empty
- `ECONOMY_ENABLED=false`
- `ECONOMY_TEST_MODE=false`
- `ECONOMY_REAL_MONEY_ENABLED=false`
- `ECONOMY_RECONCILIATION_ENABLED=false`
- `NEXT_PUBLIC_ECONOMY_MODE=off` — **if referenced by deployment config**

> Railway does **not** normally need `ADMIN_EMAILS`, `CRON_SECRET`, or
> `NEXT_PUBLIC_REALTIME_URL` unless the backend code explicitly reads them. Only
> set a variable on a service that actually consumes it — extra secrets are extra
> surface area.

---

## 6. Supabase checklist

- **Auth enabled** and working (login/signup).
- **RLS enabled** on all client-facing tables.
- **Migrations applied** to the production project.
- **Service role key not exposed to the frontend** — server-only, never
  `NEXT_PUBLIC_*`.
- **Anon key used only where expected** (public client reads gated by RLS).
- **Admin tables not public** — `admin_audit_log` and equivalents have no
  `anon` / `authenticated` policies.
- **Wallet / economy client writes blocked** — no client INSERT/UPDATE/DELETE on
  wallet, ledger, or escrow tables.
- **`match_results` / `player_stats` client writes blocked** — these are written
  only by the realtime server via the service role, never by the browser.
- **Tournament RLS watch items remain separate from this docs PR.** The audit's
  tournament RLS notes (e.g. INSERT column-scoping, draft-only metadata edits)
  are tracked as their own corrective work and are **not** in scope here.

---

## 7. Economy / wallet beta lock

For the duration of controlled wider beta:

- **Wallet is Coming Soon / read-only.**
- **No deposits.**
- **No withdrawals.**
- **No cash prizes.**
- **No real-money matches.**
- **No paid tournaments.**
- **Economy flags must stay off** (`ECONOMY_ENABLED`, `ECONOMY_TEST_MODE`,
  `ECONOMY_REAL_MONEY_ENABLED`, `ECONOMY_RECONCILIATION_ENABLED` all `false`;
  `NEXT_PUBLIC_ECONOMY_MODE=off`).

> **Any economy activation requires a separate, audited phase** — its own PRs,
> its own security review, and its own sign-off. It is explicitly out of scope
> for wider beta and for this runbook.

---

## 8. Admin safety

- `ADMIN_EMAILS` must be **server-side only**. 
- **No `NEXT_PUBLIC_ADMIN_EMAILS`** may exist anywhere.
- **Normal users must receive a forbidden / not-authorized** response on admin
  surfaces — no admin UI or data renders for them.
- **Admin APIs require a verified Supabase JWT** — the server validates the
  bearer token cryptographically and compares the verified email against
  `ADMIN_EMAILS`, failing closed if the allow-list is unset.

---

## 9. Pre-invite production smoke checklist

Run this **manually against the live production URL** before inviting testers.
(This can only be done by a human with browser access — it is not something CI
or a sandbox can verify.)

- [ ] Open production Home
- [ ] Check desktop **1280px**
- [ ] Check desktop **1440px**
- [ ] Check mobile **360px**
- [ ] Check mobile **390px**
- [ ] Confirm **no horizontal overflow** at any of the above
- [ ] Confirm **PLAY FREE** opens the Lobby
- [ ] Confirm **login / signup** works
- [ ] Confirm **Lobby** opens
- [ ] Confirm **Create Room** works
- [ ] Confirm **Join Room** works
- [ ] Complete one **2-player match** end-to-end
- [ ] Complete one **disconnect / reconnect** test
- [ ] Confirm **Wallet** says Coming Soon
- [ ] Confirm **Practice** says Coming Soon
- [ ] Confirm **Chess444 / Draught444 / Crush444 / Card444** say Coming Soon
- [ ] Confirm **feedback / report links** work
- [ ] Confirm **no unsafe money/reward wording** appears active

---

## 10. Stop conditions

If **any** of these is observed, **do not invite testers** (or pause an
in-progress invite immediately):

- `SOCKET_JWT_ENFORCE` is not `true`
- production deploy is unhealthy
- Railway backend fails to boot
- users cannot log in
- users cannot enter the lobby
- users cannot pick **LEFT / CENTER / RIGHT**
- a match freezes
- wallet / economy appears active
- deposits / withdrawals / cash-prize wording appears active
- an admin page is exposed to a normal user
- Supabase errors are visible to users

---

## 11. Rollback plan

If a problem is found after opening (or during smoke testing):

1. **Stop invites** — send no further tester invitations.
2. **Pause the tester group** — communicate a short hold to anyone already in.
3. **Revert the latest PR** if the issue is app-code related.
4. **Redeploy the last healthy Vercel build** (Vercel → Deployments →
   promote/redeploy a known-good deployment).
5. **Redeploy the last healthy Railway backend** (Railway → Deployments →
   redeploy a known-good build).
6. **Check Supabase logs** for auth / query / RLS errors.
7. **Document the incident** in feedback / admin notes so it is triaged and not
   lost.

---

## 12. Final beta gate

> **READY TO INVITE CONTROLLED WIDER BETA TESTERS** only after **all** of the
> following are true:
>
> - production env gates verified (§3)
> - **`SOCKET_JWT_ENFORCE=true` confirmed on Railway**
> - economy flags confirmed off
> - Vercel deployment healthy
> - Railway deployment healthy
> - manual browser / device pass completed (§9)
> - one live **2-player** smoke test passed
> - one **reconnect / disconnect** smoke test passed

If any one item is not satisfied, the gate is **not** met.

---

## 13. Current verification status

As of this runbook, **Chancy manually verified the key Vercel and Railway
environment gates** from dashboard values (with secret values masked). No secret
values are pasted into this document.

- **`NODE_ENV=production`** and **`SOCKET_JWT_ENFORCE=true`** are now part of the
  **required Railway hard gate** (§3, §5). `SOCKET_JWT_ENFORCE=true` is the hard
  blocker.
- Vercel and Railway economy flags were verified **off** / `false`, and
  `NEXT_PUBLIC_ECONOMY_MODE=off` on both surfaces.
- Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`,
  `REALTIME_INTERNAL_SECRET`, `CRON_SECRET`) were confirmed `set` and **not**
  exposed as `NEXT_PUBLIC_*`.

This is a point-in-time verification. Re-run §3 and §9 before each new wider-beta
invite wave, since env values and deployments can drift between sessions.
