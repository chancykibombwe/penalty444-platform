# 444 ARENA / PENALTY444 — FULL PLATFORM AUDIT

> Read-only audit. No code was changed. No PR opened by this audit itself.
> Produced against `master` (see §2). Supersedes the frontend-only readiness
> view in `docs/wider-beta-readiness-check.md` (PR #175) by adding
> realtime-server, Supabase/RLS, and economy-subsystem coverage that the
> earlier pass could not see from the web app alone.

---

## 1. Executive summary

**Overall readiness rating: RED — NOT READY (blockers are small, targeted fixes, not a rearchitecture).**

The platform is architecturally sound and, in most areas, genuinely well
hardened: match resolution is server-authoritative, the economy subsystem is
fail-closed by design, admin routes verify tokens server-side and fail closed,
RLS broadly denies client writes to stats/results/wallet tables, and the Home
UI / free-play policy surfaces are clean. The earlier "READY FOR CONTROLLED
WIDER BETA" conclusion was reasonable **given it only had visibility into the
web frontend**. Looking at the realtime server and the raw Supabase migrations
changes that picture: this deeper pass found a small number of real
correctness/security holes — most of them one-to-few-line fixes — that should
be closed before inviting wider testers.

**Can wider beta continue?** Controlled internal testing with the current small
group can continue. **Inviting *new/wider* testers should wait** until the
blockers below are fixed and one production env var is confirmed. None of the
blockers require deep changes — they are: a couple of missing `REVOKE`
statements on Supabase objects, a room-code uniqueness guard, and confirming
`SOCKET_JWT_ENFORCE=true` is actually set on the Railway realtime server.

**Corrective PRs needed before inviting testers:** yes — see §15 for the safe
sequence. The good news is the top-priority fixes are small and low-risk.

---

## 2. Audit method

- **Branch / commit inspected:** `master` as of the latest merged commit
  `be7b0bae` ("PR #174 — Final Home UI Audit"). Audit performed from working
  branch `audit/wider-beta-readiness-check`.
- **Scope:** `apps/web` (Next.js 16 App Router), `apps/realtime-server`
  (Socket.IO + Express), `packages/shared`, `supabase/migrations` (12 files),
  `docs/` (29 files), root/realtime `.env.example`. `unity/` was treated as a
  parked, out-of-scope 3D prototype and not audited.
- **Method:** ten parallel source-grounded sub-audits (repo/build/deploy/test,
  auth/session, lobby/rooms, realtime socket security, match logic,
  Supabase/RLS, wallet/economy, tournaments, admin/feedback,
  account/stats/Home). Every finding is cited to an exact `file:line`.
- **Commands run:** `git status/branch/log`, `cat package.json`,
  `find apps -name package.json`, `npx tsc --noEmit` on both apps.
- **Environment limitations (could not verify — must be checked operationally):**
  1. **`npm run build` cannot complete in this sandbox** — it fails at static
     page collection with `supabaseUrl is required` because there is no
     `.env.local`/Supabase credentials here. This is a sandbox limitation, not
     a code defect.
  2. **`npx tsc` reports a false deprecation error** (TS5101/TS5107) because
     the sandbox resolves an ambient global TypeScript 6.0.2 instead of each
     app's pinned 5.9.3/5.8.3. Running the projects' own pinned `tsc` passes
     clean (verified for `apps/web`; `apps/realtime-server` has no
     `node_modules` in this sandbox so its pinned typecheck could not be run
     here — should be confirmed in CI).
  3. **Live database grants/schema could not be queried** — the Supabase MCP
     required interactive approval unavailable in this run. The RLS blockers in
     §9 are therefore inferred from migration SQL plus standard Supabase
     default-grant behavior; each needs a one-command operator confirmation
     (queries provided in §9).
  4. **No live production browser pass** — the sandbox cannot reach the Vercel
     URL, so device/viewport findings (§11) are code-level (Tailwind breakpoint
     analysis), not rendered pixels.

---

## 3. Critical findings (BLOCKERs and headline HIGHs)

| ID | Severity | Area | Finding | Evidence | Impact | Recommended fix | Blocks beta? |
|---|---|---|---|---|---|---|---|
| DB-1 | BLOCKER | Supabase RPC | `economy_apply_ledger_entry` (SECURITY DEFINER) revokes only `FROM PUBLIC`, never from `anon`/`authenticated`, and has no `auth.uid()` check in its body | `supabase/migrations/20260522104000_economy_foundation_v1.sql:399-528` vs the correct pattern in `20260610120000_revoke_legacy_wallet_rpc_grants.sql:32-34` | An authenticated client could call the RPC directly to self-credit/fabricate wallet ledger entries, bypassing server settlement — the exact class of bug a sibling migration already fixed for the legacy wallet RPCs. Impact is latent while wallet is off/unshown, but violates the documented security posture. | Add `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` for this function | yes |
| DB-2 | BLOCKER | Supabase view | `audit_events_recent` view created with no `security_invoker=true` and no `REVOKE`, so underlying `audit_events` RLS (intentionally client-locked) is bypassed through the view | `supabase/migrations/20260523093000_economy_recovery_v1.sql:119-131` | If Supabase default grants apply (they do elsewhere in this repo), any client can `select * from audit_events_recent` and read 14 days of economy audit trail (`actor_id`, `event_type`, `payload`) — contradicts `docs/database-security.md:71-72` | Recreate `WITH (security_invoker = true)` and/or `REVOKE ALL ... FROM anon, authenticated` | yes |
| MATCH-1 | BLOCKER | Match persistence | 5-char random room codes are generated with no collision/history check; a recycled code collides with an old `match_results` row and the new match's save is silently dropped as a "benign duplicate" | `apps/realtime-server/src/room/codes.ts:9-11`; `room/lifecycle.ts:150,270`; `index.ts:1191-1236`; and `supabase/migrations/20260522093000_match_results_idempotency.sql` (its own step deletes pre-existing dupes — evidence this already happened) | A completed match's stats/results silently never persist and tournament advancement never runs; no error shown to players. Probability is low at beta scale but impact is corrupt/lost results. | Key persistence + idempotency on the existing UUID `matchInstanceId` (or loop room-code generation until unused), not the human room code | yes |
| AUTH-1 | BLOCKER *(conditional)* | Realtime identity | `SOCKET_JWT_ENFORCE` defaults soft/off and is only made fatal-at-boot when economy is also enabled (it isn't today), so nothing forces it on for Free Play | `apps/realtime-server/src/security/jwt.ts:31`; `socketIdentity.ts:57-123`; `config/env.ts:174-196` | If the Railway env does not have `SOCKET_JWT_ENFORCE=true`, any scripted socket client can claim an arbitrary `playerId` (readable off the public leaderboard) and hijack/cancel another player's room/match. `.env.example` says `true`, but nothing enforces it at runtime. | Confirm `SOCKET_JWT_ENFORCE=true` on Railway **before inviting testers**; make it fatal-at-boot in production unconditionally | yes, unless env confirmed |
| MATCH-2 | HIGH | Sudden death / tournaments | The 10-cycle sudden-death cap can end a match as a DRAW, and tournament advancement explicitly refuses to advance on a draw → bracket slot stuck forever | `apps/realtime-server/src/gameplay/suddenDeath.ts:22-44`; `config.ts:17`; `index.ts:813-824,1728-1731` | A tournament can permanently stall with no automated recovery | Force a decisive tiebreak for tournament sudden death, or give `advanceTournamentFromRoom` a draw fallback | no (fix before tournaments feature widely) |
| MATCH-4 | HIGH | Disconnect fairness | A disconnect inside the 5s `EARLY_CANCEL_MS` window is NOT given the early-cancel carve-out that a voluntary forfeit gets; it runs the full 39s grace and can record a real loss for a match with zero picks | `apps/realtime-server/src/socket/matchActions.ts:383-392` (forfeit carve-out) vs `index.ts:2254-2420` (disconnect handler, no early-window check); `gameplay/disconnectGrace.ts:120-121` | Unfair recorded loss on an accidental early drop | Extend the early-cancel carve-out to the disconnect handler | no |
| ACCT-1 | HIGH | Stats integrity | `player_stats` update is a read-modify-write with no atomic increment / optimistic guard, so concurrent match completions for the same user can lose an update | `apps/realtime-server/src/player/progression.ts:209-225,265-282,340-353` | A player finishing two matches near-simultaneously can silently lose a win/streak/rating update | Use an atomic SQL increment or an optimistic `.eq("matches", prevMatches)` guard with retry | no |

---

## 4. Foundation / architecture findings

| ID | Severity | Area | Finding | Why it matters | Recommended fix |
|---|---|---|---|---|---|
| REPO-2 | HIGH | CI | No `.github` directory at all — zero CI (no lint/typecheck/build/test gate on push or PR) | Regressions in economy fail-closed logic, RLS, or match rules can merge to master unnoticed | Add a GitHub Actions workflow running pinned `tsc --noEmit` (both apps) + `eslint` on every PR |
| REPO-1 | MEDIUM | TS config | `apps/realtime-server` has `strict:false`; `apps/web` has `strict:true` | The realtime server owns economy/escrow/match logic — the code that most needs strict null/type checking — yet has the weaker guarantees | Enable `strict:true` on the realtime server, fix incrementally |
| REPO-4 | MEDIUM | Shared types | `packages/shared` is orphaned (no npm workspace, imported by neither app); `Lane`/`MatchResult` types are independently re-declared in both apps | False impression of a shared contract; the real GOAL/SAVE types can drift silently | Wire it into a real workspace and import from it, or delete it |
| REPO-3 | LOW | Dead file | Empty 0-byte `apps/web/src/app/lib/socket/client.ts` shadows the real 515-line `apps/web/src/lib/socket/client.ts` | A future import could land in the wrong (empty) file | Delete the empty file + parent dirs |
| REPO-5 | LOW | Docs | Two overlapping "release readiness" docs with no cross-reference (`beta-release-readiness-checklist.md` vs `wider-beta-readiness-check.md`) | A reader may treat the stale one as current gating criteria | Add a "superseded by" banner or merge |
| REPO-6 | LOW | Docs | `apps/web/README.md` is unmodified create-next-app boilerplate | No project-specific entry point for new contributors | Replace with a real README |

---

## 5. Security and abuse findings

| ID | Severity | Attack scenario | Current protection | Gap | Recommended fix |
|---|---|---|---|---|---|
| LOBBY-2 | HIGH (BLOCKER if JWT enforce off) | Non-host cancels a victim's room/offer by emitting `room:cancel`/`publicOffer:cancel` with the victim's `playerId` (readable off the public offers feed) | `assertSocketUserMatchesPlayer` — but it returns `ok:true` when no JWT is presented and enforcement is off | Authorization is string-equality on a client-supplied, non-secret `playerId` | Bind cancel/join/create auth to a verified `socket.data.userId` unconditionally, not only when `SOCKET_JWT_ENFORCE=true` |
| RT-7 | MEDIUM (HIGH if JWT enforce off) | Same as LOBBY-2, via `room:cancel` | Every *match* action checks `socketId===socket.id`; `room:cancel` does not | `room:cancel` lacks the socket-binding check its siblings have | Add a `resolvePlayerForSocket`-style socketId check to `room:cancel` |
| LOBBY-1 | HIGH (masked today) | Two guests claim the same public offer simultaneously | Single capacity check *before* two `await`s, no re-check after | TOCTOU: currently masked because economy-off makes the awaits synchronous no-ops; becomes a real 3-player/double-escrow race once stakes are non-zero | Re-validate capacity+offer existence after the awaits, or claim optimistically |
| AUTH-5 | HIGH | Two tabs / reload race join same room; loser's actions silently dropped | Last-writer-wins on socketId rebind | Demoted tab shows picks as locked that the server never receives → confusing timeout/forfeit | Reject/kick a duplicate join or explicitly notify the demoted tab |
| RT-16 | MEDIUM | Flood `spectator:join`/`player:register`/`tournament:subscribe` (not rate-limited) | `rateLimit.ts` is applied to gameplay/room events but not these five | Unbounded CPU/log/Map churn, no cost to attacker | Add `allowSocketAction()` guards to those handlers |
| RT-11 | MEDIUM | Long-running memory growth | `pruneTransportDiagnostics()` exists but is never called | `presenceByRoomPlayer`/`lastDisconnectAtByPlayer` grow unbounded per match over uptime | Wire pruning into disconnect/room-cleanup |
| RT-15 | LOW | Non-browser client omits `Origin` to bypass CORS allowlist | Prod CORS is a real allowlist for browsers | `isOriginAllowed` returns true for a falsy origin | Document that CORS is browser-only; rely on JWT enforcement for scripting |
| DB-5 | LOW | Timing side-channel on `CRON_SECRET` | `token === secret` non-constant-time compare | Theoretical only (network jitter dominates) | Use `crypto.timingSafeEqual` |
| LOBBY-5 / MATCH-1 | (see §3) | Room-code collision | none | root cause shared with BLOCKER MATCH-1 | fix once, in codes.ts/persistence |

---

## 6. Match logic findings

| ID | Severity | Flow | Finding | Repro | Expected | Actual | Recommended fix |
|---|---|---|---|---|---|---|---|
| MATCH-1 | BLOCKER | Result persistence | Room-code collision drops match save (see §3) | New room reuses an old 5-char code with same `match_instance` | Every match saved once | Save dropped as "benign duplicate"; progression/advancement skipped | Persist/idempotency-key on UUID `matchInstanceId` |
| MATCH-2 | HIGH | Sudden death | 10-cycle cap can end in DRAW; tournament won't advance on draw | Two evenly matched players reach cap in a tournament match | Decisive winner | Bracket stuck forever | Decisive tiebreak or draw-fallback advancement |
| MATCH-3 | HIGH | Round/pick race | `match:pick` carries no round number; a latency/reconnect-buffered pick applies to whatever round is live on arrival | Emit a pick just before a brief disconnect; Socket.IO flushes it on reconnect a round later | Stale-round pick rejected | Stale lane silently locked for the wrong round/role | Include round (+matchInstance) in payload; server rejects round mismatch |
| MATCH-4 | HIGH | Disconnect vs early-cancel | Disconnect in the 5s early window runs full 39s forfeit grace, unlike voluntary forfeit which is blocked there | Disconnect at t=1s after start, don't return | No-penalty cancel (parity with forfeit carve-out) | Recorded loss for a 0-pick match | Extend early-cancel carve-out to disconnect handler |
| MATCH-5 | MEDIUM | Rematch | No vote-expiry; requester can be stuck on "Rematch Requested" forever while server deletes room silently at 60s | Request rematch, opponent never responds | Clean "opponent didn't respond" state | UI stuck; room gone with no emit | Add rematch-vote expiry + `match:rematch:expired` emit |
| MATCH-6 | MEDIUM | Active-match recovery | Navbar/Home read `getActiveMatch()` without `expectedPlayerId`; only the match room itself clears a mismatched entry | Log out A, log in B on shared device | Resume indicator scoped to current player | B transiently sees A's room code | Pass `expectedPlayerId`; add auth-change listener in `ActiveMatchRecovery` |
| MATCH-7 | LOW | Both disconnect | If both players disconnect with no pick, the first-processed becomes loser; an absent "winner" is credited | Both drop same round | Draw/mutual cancel | Absent player credited a win | Check `opponent.present` before crediting |

**Rule set confirmed correct:** `resolveShot.ts:7-13` implements same-lane→SAVE,
different-lane→GOAL, kicker-timeout→SAVE, keeper-timeout→GOAL,
both-timeout→DRAW exactly. The client always renders the server-sent result
(the dev-only integrity assertion never drives the UI), so frontend/backend
cannot disagree in production.

---

## 7. Auth / session findings

| ID | Severity | Flow | Finding | Impact | Recommended fix |
|---|---|---|---|---|---|
| AUTH-1 | BLOCKER (conditional) | Socket identity | `SOCKET_JWT_ENFORCE` soft-defaults; only fatal when economy on (see §3) | Identity spoofing if prod env not `true` | Confirm env; make fatal-at-boot in prod unconditionally |
| AUTH-2 | BLOCKER (contingent on AUTH-1) | Identity exposure | Real `playerId`s are returned to every client via the leaderboard query | Removes the "guess the victim id" barrier for AUTH-1 | Treat `SOCKET_JWT_ENFORCE=true` as absolute pre-beta requirement |
| AUTH-4 | HIGH | Account switch | Navbar "Resume Match" reads active match with no player check; logout never calls `clearActiveMatch()` | B sees A's stale room code (confirmed non-exploitable for data — join is server-rejected and MatchRoomPanel clears on mount — but real UX/confusion bug) | `getActiveMatch(currentUserId)` + `clearActiveMatch()` on logout |
| AUTH-5 | HIGH | Two tabs | Silent last-writer-wins, demoted tab's actions dropped (see §5) | Confusing self-forfeit/timeout | Reject/notify duplicate join |
| AUTH-3 | MEDIUM | Guest isolation | App shell opens a live socket for every visitor (incl. anonymous); guest game logic itself never touches sockets | The real boundary is 100% server-side enforcement (AUTH-1), not "client never connects" | Scope socket components to authed routes / short-circuit when no session |
| AUTH-6 | MEDIUM | Expired session | `RequireAuth` only reads cached `getSession()`; a mid-session revoke shows a "logged-in" shell with error banners instead of forcing re-login | Stale authed UI | Force sign-out + redirect on auth-error responses |
| AUTH-7 | MEDIUM | Logout mid-match | Clean server-side (uniform 39s grace); no confirmation the player is about to forfeit | Minor UX | Optional pre-logout warning if active match |
| AUTH-8 | LOW (confirmed correct) | Route guards | `/lobby` and `/match/[roomCode]` **are** wrapped in `RequireAuth`; no protected data/socket-join before the check clears | Corrects any assumption these were unguarded | None — note it's client-only (no SSR/middleware) |
| AUTH-9 | LOW | Env doc | Both `.env.example` files now correctly say `SOCKET_JWT_ENFORCE=true` (a past drift is resolved) | Doc correct, but doc ≠ runtime (see AUTH-1) | Runtime enforcement |

---

## 8. Realtime / socket findings

Confirmed **safe** (briefly, since these were checked and hold): lane validation
(`isValidLane`, RT-1), pick double-submit/replay guards (RT-2), late-pick
rejection via `isResolving` (RT-3), server-derived role (RT-4), room-existence
checks (RT-5), identity binding on all *match* actions (RT-6), same-user
multi-connection can't corrupt match state (RT-8), rematch idempotency (RT-9),
disconnect-grace timer non-stacking with a generation counter (RT-10),
reconnect/mid-reveal resume with authoritative `match:rejoinState` and
remaining-time-only timer resume (RT-12), ended-match action rejection (RT-13),
`match:abortEarly`/`forfeit` independent authorization ladders (RT-14). CORS in
prod is a real allowlist that's fatal-if-empty (RT-15 caveat noted in §5).

Open items: RT-7 (`room:cancel` missing socket binding — §5), RT-11 (diagnostics
memory leak — §5), RT-16 (five unratelimited events — §5), RT-17 (LOW: duplicate
`room:join` listener in `index.ts:1976-1992` doubles emit traffic; read-only, no
security impact — consolidate).

---

## 9. Supabase / RLS / data findings

| ID | Severity | Table/API | Finding | Risk | Recommended fix |
|---|---|---|---|---|---|
| DB-1 | BLOCKER | `economy_apply_ledger_entry` RPC | Only `REVOKE ... FROM PUBLIC`, never `anon`/`authenticated`; no `auth.uid()` in body (see §3) | Self-credit/fabricate wallet ledger via direct PostgREST RPC call | Add `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + grant service_role |
| DB-2 | BLOCKER | `audit_events_recent` view | No `security_invoker`, no `REVOKE` (see §3) | Client-readable 14-day economy audit trail | `security_invoker=true` and/or revoke from anon/authenticated |
| DB-3 | MEDIUM (BLOCKER if PII present) | `profiles` | `profiles_select_anyone USING (true)` is all-column public read; the migration's own comment flags email/phone as a concern; table predates migrations so its columns can't be confirmed from source | If `profiles` has `email`/`phone`, they're exposed via `select=*` regardless of what app code requests | Confirm schema; if PII present, use a public-safe view/column allowlist |
| DB-4 | MEDIUM | `tournaments` | `tournaments_update_creator` has no `status='draft'` restriction (contradicts `docs/rls-audit-checklist.md`); lockdown trigger only protects lifecycle/economy columns, not `max_players`/`rounds_per_match`/`format` | Creator can shrink `max_players` below registered count or change format mid-tournament | Add `status='draft'` gate or freeze metadata after draft |
| DB-5 | LOW | `/api/internal/tournaments/tick` | Non-constant-time `CRON_SECRET` compare | Theoretical timing side-channel | `crypto.timingSafeEqual` |

**Operator verification queries** (read-only; run against the production DB to
confirm DB-1/DB-2/DB-3 before fixing):
```sql
-- DB-1: does authenticated/anon have EXECUTE on the ledger RPC?
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_name = 'economy_apply_ledger_entry';
-- DB-2: grants + security_invoker on the view
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'audit_events_recent';
SELECT reloptions FROM pg_class WHERE relname = 'audit_events_recent';
-- DB-3: does profiles contain PII columns?
SELECT column_name FROM information_schema.columns
WHERE table_name = 'profiles' AND table_schema = 'public';
```

**Confirmed safe (checked, no finding):** `player_stats`, `match_results`,
`season_player_stats`, `tournament_matches`, `wallets`, `wallet_ledger_entries`,
`escrow_locks` have no client write policies + explicit `REVOKE`
(`20260523080000`). `beta_feedback` and `lobby_chat_messages` enforce
`user_id = auth.uid()` on INSERT (no impersonation). `admin_audit_log` has zero
client policies + `REVOKE ALL`. `tournament_entries` INSERT requires
authenticated + `user_id = auth.uid()`. `.ilike` searches are parameterized
(no injection). Service-role usage is confined to server-only modules
(`lib/supabase/admin.ts`, realtime `config`), never a `"use client"` file.

---

## 10. Wallet / economy safety findings

**Overall: fail-closed design is genuinely strong.** `ECONOMY_ENABLED` defaults
false (strict `=== "true"`); `getPublicEconomyMode()` defaults `"off"` for any
value except exactly `"test"`/`"live"`; `/wallet` is an unconditional redirect
with no searchParam handling; `WalletPanel` never fabricates a balance; wallet
RLS is SELECT-only; the legacy stake RPC grants were already revoked. No path
moves real money today.

| ID | Severity | Surface | Finding | Real money accidentally? | Recommended fix |
|---|---|---|---|---|---|
| ECON-1 | HIGH | `wallet/stakes.ts:29-165` | Legacy stake path (`lockStake`/`settleStakes`/`refundBothStakes`) has no self-contained kill-switch; safety depends on 3 call sites hardcoding `0`/`"Free"` | No today (all 3 verified hardcoded); yes if any call site is later re-wired to forward client stake | Add an `ECONOMY_ENABLED`/`LEGACY_STAKES_DISABLED` guard inside `stakes.ts` itself |
| ECON-2 | HIGH | `escrow.ts:68`, `settlement.ts:58,294`, `wallet.ts:194` | Low-level economy fns gate on raw `ECONOMY_ENABLED` boolean, not the safer `getEconomyMode()==="off"` used by the integration wrappers; `reconciliation.ts:38` already calls a low-level fn directly | No today (current callers use wrappers); risk grows as direct callers expand | Have low-level fns check `getEconomyMode()==="off"` too |
| ECON-3 | MEDIUM | `tournaments_insert_creator` policy | INSERT doesn't restrict `entry_fee_minor`/`prize_pool_minor` (UPDATE trigger only guards UPDATE) | No (no UI sets them; settlement refuses payout while economy off) | Extend protection to BEFORE INSERT |
| ECON-4 | MEDIUM | `TournamentEntryActions.tsx:100-113` | The "Could not reserve entry fee" string is NOT strictly unreachable — it fires whenever `NEXT_PUBLIC_ECONOMY_MODE` is exactly `test`/`live` AND the lock returns `ok:false` for *any* reason (incl. expired session) | No money moves (server independently gates), but a confusing economy-flavored error can surface if that env is mis-set | Keep `NEXT_PUBLIC_ECONOMY_MODE=off`; make auth-related lock failures show a generic "please sign in" message |
| ECON-5 | LOW | `config/env.ts:218` | `ECONOMY_RECONCILIATION_ENABLED` is printed/documented as an OFF-by-default safety control but nothing branches on it (reconciliation gates on `ECONOMY_ENABLED` only) | No | Wire it as a real second gate or drop the misleading framing |

---

## 11. UI / navigation / mobile findings

| ID | Severity | Surface | Finding | Device/viewport | Recommended fix |
|---|---|---|---|---|---|
| HOME-2 | HIGH | Global Navbar Wallet pill | `WalletPill` is a real `<Link href="/wallet">` that silently redirects to `/account`, unlike the disabled "Soon" spans used in BottomMobileNav/DesktopSidebar | All viewports/routes where Navbar renders | Make it a disabled span consistent with the other surfaces |
| HOME-1 | HIGH | Coming-Soon games grid | `GameCard` (carousel-sized `w-[78%] ... md:w-[300px]`) is reused inside the non-scrolling `GamesGrid` with no `overflow-hidden` ancestor → overflows its cell | ~768–1023px (tablet/iPad portrait, still on mobile Home layout) | Give GameCard a grid-mode variant or constrain width in `GamesGrid` |
| ACCT-2 | MEDIUM | Account page | On `player_stats` fetch failure the UI shows the error banner AND the full all-zero "New Player" profile (not mutually exclusive), and prints the raw Supabase error string | N/A | Make error and content mutually exclusive; don't surface raw error text |
| HOME-3 | LOW | Desktop Home | At `lg+`, global Navbar nav row and Home `DesktopSidebar` both render the same 6 destinations (intentional "additive" chrome, redundant not broken) | ≥1024px | Consider hiding one at lg+ |

**Confirmed clean:** all Home hero/quick-action/games/nav hrefs resolve to real
routes; coming-soon games use empty `href` + `comingSoon` guard so they never
render as links; mobile Home chrome and global Navbar use the *same* `md`
breakpoint on both sides (no double-render gap); Home renders safely logged-out;
new-player defaults never fabricate a rank. (Live 360/390/1280/1440 browser pass
still required — see §2 limitation 4.)

---

## 12. Deployment / infrastructure findings

| ID | Severity | Config/doc | Finding | Risk | Recommended fix |
|---|---|---|---|---|---|
| DEPLOY-1 | MEDIUM | Runbook | No single consolidated deployment runbook tying Vercel + Railway + Supabase + env vars (the platform's own audit already flagged this YELLOW) | Operators cross-reference ~10 files; risk of a mis-set var (e.g. `NEXT_PUBLIC_REALTIME_URL` left at localhost) | Author `docs/deployment-runbook.md` with the full env matrix |
| DEPLOY-2 | LOW | Env docs | Four vars read by code are undocumented in `.env.example` (`TOURNAMENT_MATCH_JOIN_MS`, `TOURNAMENT_OPPONENT_JOIN_MS`, `VERCEL_ENV`, `UNITY_PROTOTYPE_ROUTE_ENABLED`) — all have safe defaults | Discoverability only | Add them with descriptions |
| DEPLOY-3 | LOW | CI/typecheck | `apps/realtime-server` pinned typecheck couldn't run in this sandbox (no `node_modules`) | Server strict-equivalent typecheck unverified here | Run it in CI (see REPO-2) |
| DEPLOY-4 | — (confirmed clean) | Secrets | No server-only secret is ever `NEXT_PUBLIC_`-prefixed anywhere; the only hits are comments warning against it | N/A | None |

**Positive:** `.env.example` (both files) is comprehensive and conservative
(`ECONOMY_ENABLED=false`, `ECONOMY_REAL_MONEY_ENABLED=false`,
`NEXT_PUBLIC_ECONOMY_MODE=off`, `SOCKET_JWT_ENFORCE=true`, prod CORS fatal-if-empty).

---

## 13. Test coverage gaps

| ID | Priority | Missing test | Why needed | Suggested type |
|---|---|---|---|---|
| TEST-1 | HIGH | Any test at all — zero exist across both apps (no jest/vitest/playwright) | No regression protection on gameplay/economy/security | Stand up vitest for both TS projects |
| TEST-2 | HIGH | `resolveShot`/`getPointWinnerRole`/`resolveMatchOutcome` | These decide every round winner and match outcome (and future settlement) | Unit |
| TEST-3 | HIGH | `isValidLane` / lane-injection guard | File's own comment documents a real prior `GUARANTEED_GOAL` exploit this guard closed | Unit (assert rejection of non-string/lowercase/alias/whitespace) |
| TEST-4 | MEDIUM | Economy env fail-closed matrix + RLS policies | The "must never regress silently" logic before real money | Integration (`env.ts` matrix) + pgTAP RLS tests |

---

## 14. Risk register

| Area | Status | Risk | Required action | Owner |
|---|---|---|---|---|
| Supabase RLS (ledger RPC, audit view) | RED | Client self-credit / audit-trail read (DB-1/DB-2) | Add REVOKEs + verify grants | Manual (SQL) / Cursor |
| Match persistence | RED | Room-code collision drops results (MATCH-1) | Key idempotency on UUID matchInstanceId | Cursor |
| Realtime identity | RED (conditional) | Spoof/hijack if `SOCKET_JWT_ENFORCE` not true on Railway (AUTH-1/2, LOBBY-2, RT-7) | Confirm env; add unconditional boot-fatal check | Manual + Cursor |
| Tournaments | YELLOW | Sudden-death draw stalls bracket (MATCH-2); bye-by-registration-order (TOURN-1) | Decisive tiebreak; randomize byes | Cursor |
| Disconnect fairness | YELLOW | Early-window disconnect = recorded loss (MATCH-4) | Extend early-cancel carve-out | Cursor |
| Stats integrity | YELLOW | Concurrent stat-write race (ACCT-1) | Atomic increment / optimistic guard | Cursor |
| Profiles PII | YELLOW | All-column public read (DB-3) — pending schema check | Confirm columns; scope policy | Manual |
| Economy defense-in-depth | YELLOW | Kill-switch depends on call-site discipline (ECON-1/2) | Central guards | Later |
| UI (Wallet pill, tablet grid overflow) | YELLOW | HOME-1/HOME-2 | Disabled span; grid variant | Cursor |
| Feedback pipeline | YELLOW | No server rate limit (FEED-1); match context lost (FEED-3) | DB rate limit; pass room code | Cursor |
| CI / tests | YELLOW | No CI, zero tests (REPO-2, TEST-1..4) | Add CI + core unit tests | Cursor/ChatGPT |
| Deployment runbook | YELLOW | No consolidated runbook (DEPLOY-1) | Author it | ChatGPT/Manual |
| Admin / moderation | GREEN | — | — | — |
| Wallet money movement | GREEN | Fail-closed; no active path | Keep flags off | — |
| Home routing / free-play copy | GREEN | No fake routes; copy clean | Live browser pass | Manual |
| Match rule correctness | GREEN | SAVE/GOAL/DRAW verified correct | — | — |

---

## 15. Recommended PR sequence (safe order)

1. **PR — RLS grant lockdown (BLOCKER).**
   - Scope: revoke `anon`/`authenticated` on `economy_apply_ledger_entry`;
     recreate `audit_events_recent` with `security_invoker=true` + revoke.
     Run the §9 verification queries first.
   - Files: one new `supabase/migrations/*.sql`.
   - Risk: low (additive lockdown, no app code). Must not touch other policies.

2. **PR — Room-code / match-persistence idempotency (BLOCKER).**
   - Scope: key result-save idempotency on the existing UUID `matchInstanceId`
     instead of the human room code (or loop room-code gen until unused).
   - Files: `apps/realtime-server/src/room/codes.ts` or `index.ts` save path,
     possibly one migration.
   - Risk: medium — touches match persistence; needs careful testing. Must not
     change match rules.

3. **Manual/ops — confirm `SOCKET_JWT_ENFORCE=true` on Railway (BLOCKER, no code)**,
   then a small PR making it fatal-at-boot in production unconditionally +
   binding `room:cancel`/`publicOffer:cancel` auth to the verified socket user.
   - Files: `apps/realtime-server/src/config/env.ts`, `socket/rooms.ts`,
     `socket/publicOffers.ts`, `security/socketIdentity.ts`.
   - Risk: medium (auth path). Must not weaken existing match-action checks.

4. **PR — Tournament robustness:** decisive sudden-death tiebreak / draw-fallback
   advancement (MATCH-2), randomize round-1 byes (TOURN-1).

5. **PR — Disconnect fairness:** extend early-cancel carve-out to the disconnect
   handler (MATCH-4); both-absent mutual-forfeit (MATCH-7).

6. **PR — Stats concurrency:** atomic `player_stats` increment/optimistic guard
   (ACCT-1).

7. **PR (docs/UI, low risk):** Wallet pill → disabled span (HOME-2), tablet
   games-grid overflow (HOME-1), feedback rate limit + match-context (FEED-1/3),
   deployment runbook (DEPLOY-1).

8. **PR — Foundation:** add CI (REPO-2) + first unit tests for
   `resolveShot`/`resolveMatchOutcome`/`isValidLane` (TEST-2/3).

**Must not touch in any of the above:** the verified-correct match rule set in
`resolveShot.ts`; the fail-closed economy flag defaults; the working admin
auth gate; PR #162 Unity bridge.

---

## 16. Final recommendation

**NOT READY — BLOCKERS MUST BE FIXED FIRST.**

Controlled testing with the current small group can continue, but **new/wider
testers should not be invited until** (a) the two RLS objects are locked down
(DB-1, DB-2), (b) match-result persistence no longer keys on collidable room
codes (MATCH-1), and (c) `SOCKET_JWT_ENFORCE=true` is confirmed on the Railway
realtime server (AUTH-1). These are small, targeted fixes — a few `REVOKE`
statements, one idempotency-key change, and one env confirmation — not a
rearchitecture. Everything else (tournament draw-stall, disconnect fairness,
stats race, UI polish, CI/tests, runbook) is real and worth fixing soon but
does not, on its own, block a controlled wider beta once the four blocker items
are closed.

This corrects the earlier "READY FOR CONTROLLED WIDER BETA" conclusion, which
was sound for the frontend it could see but did not have visibility into the
realtime server and raw RLS layer where the blockers live.
