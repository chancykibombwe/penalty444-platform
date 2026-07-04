# Controlled Beta Release Checklist

**Date:** 2026-07-04
**Branch:** `docs/controlled-beta-release-checklist`
**PR:** PR #176 — Controlled Beta Release Checklist (docs-only)
**Based on:** PR #175 — Wider Beta Readiness Check (`docs/wider-beta-readiness-check.md`, merged `83dbed01`), final recommendation **READY FOR CONTROLLED WIDER BETA**, with two YELLOW watch items:

1. Deployment / infrastructure — no single consolidated deployment runbook.
2. Browser / device sanity — manual real-browser pass still needed at 360 / 390 / 1280 / 1440.

This document turns that readiness audit into an actionable release plan for inviting **controlled wider beta testers**. It is an operations checklist, not a feature spec — it does not change any product behavior.

---

## 1. Release status

- **Release type:** Controlled Wider Beta
- **Product:** 444 ARENA / Penalty444
- **Mode:** Free Play Beta
- **Home UI status:** Locked (PR #164–#174, see `docs/final-home-ui-audit.md`)
- **Readiness status:** Ready for controlled wider beta (per PR #175)
- **Not public launch.**
- **Not real-money launch.**

## 2. Scope of this beta

### What testers may do
- Sign up / log in
- Enter Lobby
- Create a private room
- Join a room by code
- Use public offers / quick match if available
- Play Penalty444 matches
- Test reconnect / disconnect behavior
- Submit feedback
- View account / stats / leaderboard

### What testers must NOT expect
- Deposits
- Withdrawals
- Cash prizes
- Real-money staking
- A live wallet
- All future games (Chess444 / Draught444 / Crush444 / Card444) working — these remain **Coming Soon**
- Tournaments as paid competitions — tournaments are **Free Entry** only

## 3. Pre-release manual checks

Checklist for Chancy / manual tester, to be run against the live production URL:

- [ ] Open production Home on desktop **1280px**
- [ ] Open production Home on desktop **1440px**
- [ ] Open production Home on mobile **360px**
- [ ] Open production Home on mobile **390px**
- [ ] Confirm no horizontal overflow at any of the above widths
- [ ] Confirm **PLAY FREE** CTA works
- [ ] Confirm Lobby opens
- [ ] Confirm login / signup works
- [ ] Confirm Wallet says **Coming Soon**
- [ ] Confirm Practice says **Coming Soon**
- [ ] Confirm Chess444 / Draught444 / Crush444 / Card444 are **Coming Soon** (not linked to a fake route)
- [ ] Confirm no unsafe money/reward wording anywhere on the page
- [ ] Confirm feedback / report links are reachable (Account feedback panel, Match-End feedback shortcut, Support/report page)

> This is the manual browser/device pass called out as YELLOW item #2 in PR #175. It must be completed by a human with real browser access before or immediately after wider beta opens.

## 4. Match-flow smoke test

Tester-ready checklist (2 testers, A and B):

- [ ] Tester A logs in
- [ ] Tester B logs in
- [ ] Tester A creates a room
- [ ] Tester B joins by code
- [ ] Both players can pick **LEFT / CENTER / RIGHT**
- [ ] Round result reveals correctly
- [ ] Scoreboard updates
- [ ] Match reaches an end screen
- [ ] Victory / Defeat / Draw displays clearly
- [ ] Match-end feedback link appears
- [ ] Recent match appears if expected
- [ ] No real-money / stake wording appears anywhere in the flow

## 5. Reconnect / disconnect smoke test

- [ ] Start a match
- [ ] One player refreshes / closes their browser
- [ ] The other player sees the 39-second reconnect UI
- [ ] Player reconnects before the timer ends
- [ ] Match recovery works if possible
- [ ] If the player does not reconnect, forfeit / end behavior is clear
- [ ] Logout does not create a confusing active-match state
- [ ] Any issue found here is reported immediately (see §6)

## 6. Feedback and issue triage plan

### Where testers should report
- Account feedback panel (`/account#beta-feedback`)
- Match-end feedback shortcut ("Report issue from this match →")
- Support / report page (`/support#report`)
- WhatsApp / manual channel — if Chancy uses one (see §8 placeholder)

### Triage categories
- **BLOCKER:** cannot log in, cannot enter lobby, cannot pick a lane, match stuck, payment/wallet accidentally active
- **HIGH:** reconnect broken, match result wrong, public offers broken, serious mobile layout problem
- **MEDIUM:** confusing copy, minor visual bug, stats display issue
- **LOW:** small polish, spelling, suggestion

### Response targets
- **Blocker:** same day
- **High:** 24 hours
- **Medium / Low:** batch review

## 7. Tester invite checklist

- [ ] Confirm tester understands it is **Free Play Beta**
- [ ] Confirm tester knows there is no money / cash prizes
- [ ] Confirm tester knows Wallet is **Coming Soon**
- [ ] Confirm tester knows how to report bugs
- [ ] Confirm tester has the link to the live site
- [ ] Confirm tester has basic instructions:
  1. Create account / log in
  2. Go to Lobby
  3. Create or join a room
  4. Play a match
  5. Submit feedback

> Invite wording must stay **private-beta / controlled-beta** only. Do not write final public marketing copy as if launch is live.

## 8. Suggested tester batch plan

Use cautious language — do not invent exact tester numbers as final facts:

- **Batch 1:** small controlled group
- **Batch 2:** expand only if no blockers from Batch 1
- **Batch 3:** broader invite only after match / lobby / reconnect remain stable across Batch 1 and 2

Placeholders (to be filled in by Chancy, not assumed here):
- Target tester count: **TBD by Chancy**
- Start date: **TBD**
- Invite channel: **TBD**
- Support contact: **TBD**

## 9. Go / No-Go checklist

| Item | Required status | Current status | Owner | Notes |
|---|---|---|---|---|
| Home UI locked | Locked | ✅ Locked (PR #174) | — | `docs/final-home-ui-audit.md` — READY FOR WIDER BETA HOME UI LOCK |
| Wider beta readiness audit merged | Merged | ✅ Merged (PR #175, `83dbed01`) | — | Final recommendation: READY FOR CONTROLLED WIDER BETA |
| Production deploy healthy | Healthy | ⚠️ Not independently re-verified in this PR | Chancy | Confirm current Vercel deployment status before inviting testers |
| Manual browser pass completed | Completed | ❌ Not yet completed | Chancy / manual tester | YELLOW item #2 from PR #175 — see §3 |
| Login works | Working | ✅ Per PR #175 §2 (source-grounded) | — | Manual confirmation still recommended in §3 |
| Lobby works | Working | ✅ Per PR #175 §3 (source-grounded) | — | Manual confirmation still recommended in §3 |
| Private room works | Working | ✅ Per PR #175 §3/§5 (source-grounded) | — | Confirm live in §4 smoke test |
| Public offers checked | Checked | ✅ Per PR #175 §3 (source-grounded) | — | Confirm live in §4 smoke test |
| Match flow checked | Checked | ✅ Per PR #175 §4 (source-grounded) | — | Confirm live in §4 smoke test |
| Reconnect checked | Checked | ✅ Per PR #175 §5 (source-grounded) | — | Confirm live in §5 smoke test |
| Feedback links checked | Checked | ✅ Per PR #175 §6 (source-grounded) | — | Confirm reachable in §3 |
| Wallet / economy safe | Safe | ✅ GREEN (PR #175 §8) | — | Economy flags default `off`/`false`; no active money-movement surface |
| Admin protected | Protected | ✅ GREEN (PR #175 §10) | — | Server-only `ADMIN_EMAILS` gate; no admin UI leak |
| Tester invite message approved | Approved | ❌ Not yet drafted/approved | Chancy | Use §7 checklist + controlled-beta wording only |
| Support / triage process ready | Ready | ✅ Defined in §6 of this doc | — | Channels + categories + response targets defined |

## 10. Stop conditions

Pause the beta immediately if any of the following occur:

- Users cannot log in
- Users cannot start matches
- Players cannot pick LEFT / CENTER / RIGHT
- Matches freeze or fail to end
- Results / stats are seriously wrong
- Wallet / deposit / withdraw / cash-prize wording appears active anywhere
- Admin pages are exposed to non-admins
- Multiple testers report the same blocker

## 11. Beta release decision

**READY AFTER MANUAL CHECKS**

The readiness audit (PR #175) is green across all safety-critical areas — auth, wallet/economy, tournaments, admin, match flow, reconnect/forfeit, and feedback/support all came back GREEN with no fake data, fake routes, or active money-movement surfaces found. However, PR #175 explicitly flagged that its browser/device sanity check was **source-grounded only** (no live browser access in that environment), and the deployment runbook consolidation is still outstanding. Controlled wider beta should open only after the manual pre-release checks in §3 (a real Chrome/Edge pass at 360 / 390 / 1280 / 1440 on the live production URL) are completed by Chancy or a human tester.

## 12. Final notes

- This checklist does not unlock real money.
- This checklist does not activate wallet/economy.
- This checklist does not change game logic.
- This checklist does not merge Unity/3D.
- This checklist is for controlled wider beta only — not a public launch plan.
