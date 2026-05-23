# GitHub Security Checklist

> Hardening Sprint 3 — repository posture before opening collaboration or
> going to real money.

## Repository visibility

- [ ] Repository confirmed **private**. Verify in
      `Settings → General → Danger Zone → Change visibility`.
- [ ] If the repository is ever moved to public, every secret in git history
      MUST be rotated FIRST (see `SECURITY.md` → Secret leakage incident
      response).

## Secrets & env files

- [ ] No real `.env`, `.env.local`, `.env.production` is tracked.
      Verify with:
      ```
      git ls-files | grep -E '\.env($|[^.])'
      ```
      Expected output: nothing except `.env.example` files.
- [ ] `.gitignore` blocks every `.env*` except `.env.example`. Confirmed in
      Hardening Sprint 3.
- [ ] `apps/realtime-server/.env` was previously tracked with a real
      Supabase service-role key and a real `REALTIME_INTERNAL_SECRET`.
      As of Sprint 3 it is `git rm --cached`'d. **Both keys MUST be
      rotated** in Supabase Studio + the realtime server config because
      the leak is permanent in the git history.
- [ ] GitHub Secret Scanning enabled (auto on private repos with GitHub
      Advanced Security; not available on every plan).
- [ ] Push protection enabled (`Settings → Code security and analysis →
      Secret scanning → Push protection`).

## Default branch & merge protection

- [ ] Default branch is `master` (current state). Pick `master` OR `main`
      and stay consistent — do not flip-flop.
- [ ] Once a second contributor exists, enable **Branch protection rules**
      on default:
      * Require pull request before merging.
      * Require at least 1 approving review.
      * Require status checks: `web tsc`, `realtime-server tsc`.
      * Disallow force pushes.
      * Disallow deletions.
- [ ] Direct pushes to `master` are acceptable while solo. Stop once the
      first external collaborator joins.

## Dependabot & vulnerability scanning

- [ ] Dependabot Alerts enabled
      (`Settings → Code security and analysis → Dependabot alerts`).
- [ ] Dependabot Security Updates enabled
      (auto-PRs for vulnerable dependencies).
- [ ] Dependabot Version Updates considered (optional weekly PR) — keep
      off until the project has a CI pipeline that runs tests on PRs.
- [ ] Code scanning (CodeQL) — currently unavailable on free private repos
      without GHAS. Note the gap in `docs/pre-real-money-checklist.md`.

## Migration review

- [ ] Every Supabase migration in a PR must be reviewed against
      `docs/database-security.md` before merge:
      * Does it enable RLS on every new table?
      * Does it grant only the necessary `INSERT / UPDATE / DELETE`?
      * Are constraints non-breaking against existing rows?
* No migration may be applied directly in Supabase Studio against
  production without first being committed to this repo.

## CI / GitHub Actions

- [ ] No GitHub Actions workflow currently uses production secrets. If you
      add one, scope secrets to the minimum needed and prefer
      `environments: { staging }` separation before real money.
- [ ] Never `echo $SECRET` in a workflow step.
- [ ] Pin third-party actions to a SHA, not `@master`.

## Repo-level admin

- [ ] Two-factor authentication required for every contributor account.
- [ ] Owner account uses a hardware key.
- [ ] No legacy SSH keys; only currently-trusted devices.
- [ ] `Settings → Webhooks` audited; no third-party webhooks active.

## Pre-public-release blockers (if you ever flip to public)

- [ ] Run `rg -n 'eyJ[A-Za-z0-9_-]{20,}\.eyJ' .git` to find any JWT-shaped
      secrets in git history. Rotate every match.
- [ ] Run `rg -n '(?i)password|secret|token|key' .git` and review hits.
- [ ] Move every credential to a fresh Supabase project; archive the old
      one.
- [ ] Re-read `SECURITY.md` and update the email address.
