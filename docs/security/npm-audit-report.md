# npm audit report — Hardening Sprint 5

> Captured `2026-05-23` on branch `feat/runtime-security-hardening`.
> Companion to `docs/security/runtime-security.md`.
> JSON snapshots are kept alongside this file as
> `.tmp-audit-{web,realtime}-{before,after}.json` (gitignored — see
> `.gitignore`); regenerate by re-running the commands at the bottom.

## Summary

| Workspace | Before | After | Resolved | Remaining |
| --- | --- | --- | --- | --- |
| `apps/web` | 5 (1 high, 4 moderate) | **2 moderate** | 1 high + 2 moderate | `postcss <8.5.10` transitive via `next` (×2 paths) |
| `apps/realtime-server` | 6 moderate | **0** | 6 moderate | — |

Both `npx tsc --noEmit` workspaces remain green after the upgrades.

## Resolved vulnerabilities

### apps/web

| Package | Severity | Advisory | Fix path |
| --- | --- | --- | --- |
| `next` 16.2.3 → `^16.2.6` | **high** | Multiple advisories incl. [GHSA-3g8h-86w9-wvmq](https://github.com/advisories/GHSA-3g8h-86w9-wvmq), [GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r), [GHSA-mg66-mrh9-m8jx](https://github.com/advisories/GHSA-mg66-mrh9-m8jx) (cache poisoning, SSRF via WebSocket upgrades, DoS) | Patch bump within same minor; updated `package.json` `next` and `eslint-config-next` to `^16.2.6`. |
| `brace-expansion` (transitive via `@typescript-eslint/typescript-estree`) | moderate | [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2) — large numeric range DoS | `npm audit fix` |
| `ws` (transitive via `engine.io-client`) | moderate | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) — uninitialized memory disclosure | `npm audit fix` |

### apps/realtime-server

| Package | Severity | Advisory | Fix path |
| --- | --- | --- | --- |
| `qs` (via `body-parser`, `express`) | moderate | [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) — DoS on null/undefined comma-format | `npm audit fix` |
| `ws` (via `engine.io`, `socket.io-adapter`) | moderate | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) — uninitialized memory disclosure | `npm audit fix` |

## Remaining (knowingly accepted)

### `postcss <8.5.10` — moderate — [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)

* **Where:** transitive in `next/node_modules/postcss` (×2 paths: build-time CSS pipeline only; not in the runtime browser bundle).
* **Why not fixed:** `npm audit fix --force` would install `next@9.3.3`, a major-major regression that breaks every Next.js 16 feature this app uses (App Router, server components, etc.). Not safe.
* **Risk profile:** the CVE is XSS via unescaped `</style>` in stringify output. Penalty444 does not feed user-controlled CSS through any postcss code path — all stylesheets are author-written under `apps/web/src` and go through the Tailwind v4 pipeline. The exploit surface is build-time only.
* **Mitigation today:** the build runs in our CI/dev machines, never with attacker-controlled input. The risk is therefore practically zero for our deployment.
* **Fix horizon:** track the next minor of `next` (16.3+) which is expected to include a postcss range bump; or adopt `next@17` when the project targets Node 20 LTS.

## Reproducing this report

```bash
# Baseline
cd apps/web        && npm audit
cd ../realtime-server && npm audit

# Capture machine-readable before snapshot
cd ../web        && npm audit --json > docs/security/.tmp-audit-web-before.json
cd ../realtime-server && npm audit --json > docs/security/.tmp-audit-realtime-before.json

# Apply safe fixes
cd ../web        && npm audit fix
cd ../realtime-server && npm audit fix

# Capture after snapshot
cd ../web        && npm audit --json > docs/security/.tmp-audit-web-after.json
cd ../realtime-server && npm audit --json > docs/security/.tmp-audit-realtime-after.json
```

`--force` is intentionally NOT in the loop. Any future PR that needs to
run it must:

1. Open with the audit fix output captured before/after.
2. Justify each major version bump.
3. Re-run `npx tsc --noEmit` and full local QA.
4. Update this document.

## Operational note

GitHub Dependabot has been reporting 80+ vulnerabilities on `master`.
Most of those originated in npm sub-trees that this Sprint 5 fix-up
removes. Re-check Dependabot 24h after this PR merges to confirm the
count drops to single digits.
