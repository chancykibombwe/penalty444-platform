# 444 ARENA — Beta Operations & Tester Feedback Pack

**Version:** Controlled Free Play Beta · First Soak  
**Applies to:** Penalty444 (first live game)  
**Status:** Controlled sharing only — not public

---

## 1. Purpose

This document is the operating guide for the first controlled beta test of 444 ARENA / Penalty444. It covers how to invite testers, what to ask them to test, how to collect and triage feedback, how to monitor the live system, and the criteria for expanding or pausing the beta.

The controlled beta is Free Play only. No real money. No deposits. No withdrawals. No cash prizes.

---

## 2. Beta Sharing Rules

Before sending any invite, confirm the following:

- Share with **5–10 trusted testers** only in the first wave.
- Do **not** post publicly.
- No ads, no influencer or social launch.
- No real-money claims of any kind.
- No cash-prize claims of any kind.
- No wallet activation (wallet UI shows Coming Soon).
- No future-game activation (all other games show Coming Soon).
- No claims about upcoming features.
- **No feature development during the first soak** unless a Red issue requires an immediate fix.

---

## 3. Current Beta Link

```
https://penalty444-platform-at1y.vercel.app
```

Vercel Pro is now active. A custom domain may be configured later, but the current beta uses the Vercel production URL until domain setup is completed and fully tested. Do not share a custom domain with testers until the domain checklist (Section 17) is complete.

---

## 4. Tester Invite Message

Copy and send to each tester individually:

---

> Hey [name], I'm running a small closed beta for a project I've been building — 444 ARENA. The first game is Penalty444, a competitive penalty shootout.
>
> It's completely free to play. No deposits, no cash prizes, no real money — just pure skill-based matches.
>
> I'd love for you to give it a try and tell me what breaks, what's confusing, and what feels good. Specifically I want you to test:
>
> - Signing up and logging in
> - Creating a private room and sharing the code with a friend
> - Playing a full match
> - Quick Match (matched against a random opponent)
> - Navigating on your phone if possible
> - Trying to reconnect if you get disconnected
>
> The link is: **https://penalty444-platform-at1y.vercel.app**
>
> If anything goes wrong, please send me: your device, browser, room code (shown in the match URL or lobby), what happened, and a screenshot if you can.
>
> Thanks — this is exactly the kind of feedback I need before a wider launch.

---

## 5. Tester Checklist

Share this with testers, or use it to guide a walkthrough session.

### Account

- [ ] Sign up with a new email
- [ ] Log in
- [ ] Log out
- [ ] Return later and log back in

### Lobby

- [ ] Open the lobby
- [ ] Create a private room
- [ ] Copy the room code and share it
- [ ] Join a room using a code from another player
- [ ] Try Quick Match (matched with a random opponent)
- [ ] Try creating or accepting an Open Challenge (public offer)

### Match

- [ ] Both players reach the match room
- [ ] Timer is visible and counting down
- [ ] Choose LEFT, CENTER, or RIGHT before time runs out
- [ ] Match progresses through multiple rounds
- [ ] Result screen appears after the final round
- [ ] Rematch option is visible
- [ ] Back to lobby works after the match

### Reconnect

- [ ] Close one player's browser tab during an active match
- [ ] Reopen it quickly (within ~30 seconds)
- [ ] Confirm the player reconnects and the match resumes
- [ ] If comfortable: stay disconnected long enough to trigger forfeit, and confirm the right player wins

### Pages

- [ ] How to Play (`/games/penalty444`)
- [ ] Leaderboard (`/leaderboard`)
- [ ] Account (`/account`)
- [ ] Wallet (`/wallet`) — should show Coming Soon, not live controls
- [ ] Tournaments (`/tournaments`)
- [ ] Try a broken URL to confirm 404 page appears

### Mobile

- [ ] Test in portrait mode
- [ ] Tap lobby buttons
- [ ] Create or join a room on mobile
- [ ] Play at least one match round
- [ ] Confirm no important content is hidden or cut off

---

## 6. Tester Bug Report Template

Ask testers to send this when they hit an issue (or fill it in from a call):

```
Tester name:
Date and time:
Device (phone model / laptop):
Browser and version:
Account email or username (optional):
Room code (if in a match):

What were you doing:

What happened:

What you expected:

Screenshot or video attached: yes / no

Was it repeatable: yes / no / once

Severity:
  [ ] Red — cannot play / security issue / wrong winner / wallet appears live
  [ ] Yellow — confusing or broken but match still playable
  [ ] Green — cosmetic issue or suggestion
```

---

## 7. Operator Checklist (Chancy)

### Before Sending Invites

- [ ] Confirm Vercel latest production deploy is green (no failed build)
- [ ] Confirm Railway service is online and healthy
- [ ] Confirm `SOCKET_JWT_ENFORCE=true` in Railway environment variables
- [ ] Confirm `ECONOMY_ENABLED=false` in Railway environment variables
- [ ] Open `/admin` and confirm it loads and is restricted to admin accounts
- [ ] Open Railway log stream (ready to watch during test)
- [ ] Open tester feedback channel (WhatsApp group, DM thread, or issue list)
- [ ] Have two test accounts ready to self-test private room flow before inviting others

### During the Test

- [ ] Watch active rooms in `/admin`
- [ ] Watch recent matches in `/admin`
- [ ] Watch player stats for unexpected changes
- [ ] Monitor Railway logs for these labels (see Section 10):
  - `[Security]`
  - `[Disconnect]`
  - `[Settlement]`
  - `[Progression]`
  - `[PublicOffer]`
  - `[Rematch]`
- [ ] Note repeated errors — same pattern more than twice = investigate
- [ ] Record room codes from any failed matches
- [ ] **Pause new invites immediately if any Red issue appears**

### After Each Test Session

- [ ] Collect all tester reports
- [ ] Classify each as Red / Yellow / Green
- [ ] Check `match_results` table if any result issue reported
- [ ] Check `player_stats` if any ranking issue reported
- [ ] Write a short summary of issues found
- [ ] Decide: fix Red issues before inviting more testers, or continue with current group

---

## 8. Red / Yellow / Green Decision Rules

### Red — Pause beta sharing immediately

Stop sending invites and fix before continuing:

- Match cannot start (both players connected but game never begins)
- Match cannot complete (stuck mid-match, no result)
- Wrong winner or wrong result saved
- Match result not saved to the database
- Wallet or deposit controls appear as active (not Coming Soon)
- Withdrawals or transactions appear live
- Admin panel visible to a non-admin account
- Unauthenticated user can enter or affect a multiplayer match
- Repeated realtime disconnects with no recovery across multiple testers
- Private room join consistently fails for authenticated users

### Yellow — Continue with small group only, fix before expanding

- Layout or display issue
- Confusing wording or missing instruction
- Occasional reconnect delay (isolated, not repeated)
- Non-blocking page error (UI renders but one section fails)
- Isolated browser-specific issue
- Unclear or missing feedback after an action

### Green — Log and backlog

- Cosmetic improvement suggestion
- Future feature request
- Minor copy or label change
- Nice-to-have UX improvement

---

## 9. Admin Monitoring Guide

Access `/admin` with an account listed in `ADMIN_EMAILS` (server-side env var, never exposed to the browser).

During beta, use the admin panel to:

- **Recent matches** — confirm matches are completing and results are saved. Check room codes reported by testers against this list.
- **Active rooms** — see currently open rooms. Useful for diagnosing stuck matches.
- **Tournament debug** — inspect tournament state if tournament tests are included.
- **Player snapshot** — check a specific player's stats and match history.
- **Placement / ranked labels** — confirm ranking labels are displaying as expected.

Important:

- There are no destructive admin actions currently active.
- Admin is internal only — do not share the `/admin` URL with testers.
- If the admin panel is accessible to a non-admin account, that is a **Red** issue — stop beta sharing and investigate immediately.

---

## 10. Railway Log Guide

Open the Railway log stream before each test session. These labels are emitted by the realtime server:

| Label | What it means |
|---|---|
| `[Security]` | Auth/identity event — JWT verified, mismatch, rejection, or unauthenticated action |
| `[Disconnect]` | Player disconnected — includes grace period start/expiry |
| `[Settlement]` | Economy settlement (should not appear in Free Play beta — flag if seen) |
| `[Progression]` | Ranking/XP update after a match |
| `[PublicOffer]` | Open challenge created, joined, cancelled, or expired |
| `[Rematch]` | Rematch offer sent, accepted, or declined |
| `[TournamentAdvance]` | Tournament bracket advancing to next round |
| `[Cleanup]` | Stale room or match cleanup |
| `[readiness]` | Pre-match readiness check (both players present before timer starts) |
| `[presence]` | Player presence signal on match page |
| `[match:pick]` | Pick received and locked for a round |
| `[resolveRound]` | Round result calculated and broadcast |

### If logs show repeated `[Security]` unauthenticated rejections after PR #104

The socket auth-ready fix (PR #104) should prevent these for normal authenticated users. If they reappear:

1. Capture the exact log line: timestamp, socketId, userId, room code, event name.
2. Ask the affected tester to log out completely, clear the browser session, and log back in.
3. Retest the private room join flow.
4. If the pattern repeats across multiple testers or sessions, treat as **Red** and pause invites.

### If `[Settlement]` appears in logs

Economy is disabled (`ECONOMY_ENABLED=false`). Settlement code should not run. If it does appear, capture the log line and treat as **Red**.

---

## 11. Vercel Pro Operations Note

Vercel Pro is now active on the project.

- The **production deployment** at `https://penalty444-platform-at1y.vercel.app` is the trusted frontend for testers. Keep it green.
- **Preview deployments** are generated for each pull request — they are for internal PR review only, not for testers.
- Do not change the production domain configuration during the first soak. Any domain migration must follow the checklist in Section 17 before testers receive the new URL.
- Confirm the production deployment is green (all checks passing) before sending each wave of tester invites.
- If a deploy breaks production, pause invites until it is resolved and verified.

---

## 12. Supabase Checks

- **Auth redirect URLs** — the Supabase Dashboard (Authentication → URL Configuration) **Site URL** and **Redirect URLs** must include the production Vercel domain. If they still point to localhost, new account confirmation emails will link back to localhost and testers cannot verify their accounts. Check this before the first invite.
- **New account flow** — self-test signup from the production URL before sending invites. Confirm the confirmation email link opens the production domain, not localhost.
- **`match_results` table** — if a tester reports a wrong result or missing result, query this table for the affected room code.
- **`player_stats` table** — if a tester reports a ranking issue, check this table for the affected userId.
- **Do not manually edit stats** unless there is an explicit plan and the affected player is informed.

---

## 13. Feedback Intake Process

Keep it simple for the first 72 hours:

- One WhatsApp group or direct message thread per tester (or a single group for trusted testers).
- One shared issue list maintained by the operator (a simple notes doc or spreadsheet is fine).

Every reported issue gets:

| Field | Value |
|---|---|
| Severity | Red / Yellow / Green |
| Room code | If available |
| Owner | Who is investigating |
| Status | New / In progress / Fixed / Closed |
| Next action | What needs to happen |

**Red issues** → immediate investigation, create a fix PR before inviting more testers.  
**Yellow issues** → collect and batch, address before expanding to a larger group.  
**Green issues** → log in a backlog, address after beta soak is complete.

---

## 14. First 72-Hour Soak Plan

### Day 0 — Internal smoke test

- Invite 2 internal testers (Chancy + one trusted contact).
- Run private room flow end to end.
- Run quick match.
- Confirm result saves.
- Confirm reconnect works.
- Fix any Red issues before Day 1.

### Day 1 — First tester wave

- Invite 5–10 trusted testers.
- Ask each to complete the Tester Checklist (Section 5).
- Collect first bug reports.
- Monitor Railway logs and `/admin` actively.
- **Do not add features or make non-critical changes during this window.**

### Day 2 — Mobile and reconnect focus

- Ask testers to retry on mobile if they haven't already.
- Specifically test reconnect and public offer flows.
- Review all Yellow issues collected so far.
- Decide whether any Yellow issues are blocking enough to fix before Day 3.

### Day 3 — Assess and decide

- Summarize all Red / Yellow / Green issues.
- If no Red issues remain: consider expanding to 15–25 testers.
- If Red issues remain: fix first, then restart the soak at Day 0 with the same group.
- Record the outcome of the first soak for the project record.

---

## 15. What Not to Change During the Beta Soak

The following must not be modified while testers are active, except to fix a confirmed Red issue:

- Gameplay rules (kick/save mechanic, LEFT/CENTER/RIGHT, same = SAVE / different = GOAL)
- Timer rules and timeout outcomes
- Scoring and round progression
- Ranking formula and XP progression
- Wallet and economy code (must remain disabled)
- Paid features of any kind
- Tournament bracket logic
- Realtime auth enforcement (`assertSocketUserMatchesPlayer`, `SOCKET_JWT_ENFORCE`)
- Supabase schema and RLS policies
- Admin access controls
- Unity integration or prototype code
- Future game implementation

---

## 16. Expansion Criteria

Only invite additional testers (beyond the initial 5–10) when all of the following are true:

- [ ] No Red issues are currently open
- [ ] Private room creation and join works reliably (tested at least 5 times across different devices/browsers)
- [ ] Quick Match works reliably
- [ ] Match result saving is verified (check `match_results`)
- [ ] Reconnect behavior is acceptable (grace period works, forfeit triggers correctly)
- [ ] Wallet remains disabled and shows Coming Soon
- [ ] Admin panel is protected (only accessible to admin accounts)
- [ ] Tester instructions are clear (testers understand this is Free Play only)

---

## 17. Custom Domain Checklist (For Later)

Vercel Pro supports custom domains. Do not set up a custom domain during the first soak. When ready, complete these steps in order:

- [ ] Choose domain
- [ ] Add domain in Vercel dashboard → verify DNS
- [ ] Wait for SSL provisioning
- [ ] Update Supabase Auth **Site URL** to the new domain
- [ ] Add new domain to Supabase Auth **Redirect URLs**
- [ ] Update Railway `ALLOWED_ORIGINS` to include the new domain
- [ ] Self-test signup and login on the new domain (confirm no localhost redirect)
- [ ] Self-test socket connection (create a private room, complete a match)
- [ ] Self-test `/admin` on the new domain
- [ ] Self-test private match end-to-end with two accounts
- [ ] Only then update the tester invite message with the new URL

Do not share the new domain with testers until every step above is checked.

---

## 18. Controlled Beta Statement

**Controlled beta sharing is allowed for a small trusted group only.**

Public launch and real-money mode remain locked until later phases.

No deposits. No withdrawals. No cash prizes. No paid matches. No paid tournaments. Free Play only.

Penalty444 is the only active game. All other games and modes are Coming Soon.
