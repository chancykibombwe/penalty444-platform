# Security Policy

> Penalty444 is a private project. This file documents the responsible
> disclosure expectation for any contributor or external reviewer who
> notices a security issue.

## Scope

This policy covers the code in this repository:

* `apps/web` — Next.js client + server routes.
* `apps/realtime-server` — Socket.IO + economy services.
* `supabase/migrations` — schema, RLS, and RPCs.

It does **not** cover:

* Third-party providers (Supabase, Vercel) — report directly to them.
* The Unity prototype client in `/Library`, `/Build`, etc. — out of scope.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems**, even while the
repository is private. If the repo ever transitions to public, the issue
tracker is indexed and reachable.

Instead:

1. Email the maintainer directly. Replace `<your-contact>` below before the
   first external collaborator joins:

   ```
   security@<your-contact>
   ```

2. Include:
   * A clear description of the issue.
   * Reproduction steps (or a proof-of-concept) — keep it minimal.
   * Affected component (web, realtime-server, DB).
   * Whether you have already exploited the issue against production data.

3. Wait for acknowledgement before disclosing further.

We aim to acknowledge within 72 hours and to ship a fix or mitigation
within 30 days for high-severity issues.

## In-scope vulnerability classes

* **Authentication / authorisation** — JWT bypass, RLS bypass, service-role
  exposure, session fixation.
* **Economy integrity** — double-pay, double-refund, ledger forgery,
  escrow manipulation, settlement skip.
* **Data exposure** — direct DB read of `wallets`, `wallet_ledger_entries`,
  `escrow_locks`, `settlement_events`, `audit_events` from a non-service
  context.
* **Server-side request forgery / SSRF** — abuse of `/internal/*` endpoints
  without the `x-realtime-internal-secret`.
* **Secret leakage** — service role key, internal secret, cron secret found
  in browser bundles, repo history, logs, or error pages.
* **Denial of service** — resource exhaustion via room creation,
  reconciliation flooding, or socket abuse.

## Out-of-scope (please do not report)

* Lack of HSTS / security headers in local dev.
* Self-XSS in your own browser.
* Reports requiring physical access or a privileged operator.
* Issues in third-party dependencies that have an upstream advisory but no
  exploit demonstrated against this app.

## Secret leakage incident response

If a secret (service role key, internal secret, cron secret, OAuth token)
is committed to git, even briefly:

1. **Rotate immediately** in the upstream provider (Supabase project
   settings → API keys, etc.).
2. `git rm --cached <file>` and re-commit. If the secret is in a previous
   commit, force-pushing alone is not enough — assume it leaked.
3. Update every consumer (CI, Vercel, local `.env`) with the new value.
4. Run `rg <secret-fragment> .` against the working tree to confirm no
   stragglers.
5. Document the incident in an internal post-mortem (see
   `docs/pre-real-money-checklist.md`).

## Hardening references

* `docs/database-security.md` — RLS audit + verification SQL.
* `docs/socket-auth-plan.md` — JWT enforcement rollout.
* `docs/pre-real-money-checklist.md` — launch blockers.
* `docs/economy-operations.md` — recovery / reconciliation runbook.
* `docs/supabase-security-checklist.md` — Supabase project posture.
* `docs/github-security-checklist.md` — GitHub repo posture.
