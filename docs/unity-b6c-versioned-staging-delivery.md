# Unity B6C — Versioned Staging Artifact Delivery

> **Staging only.** B6C adds local tooling to deploy one existing, locally-built
> and verified **B6B** Unity WebGL release to a **dedicated Vercel artifact
> project** as an immutable **preview** deployment, expose it same-origin through
> the main Next.js app via a validated server-only rewrite, and verify it — plus
> a guarded staging-only mock verification route. It adds **no** production
> delivery, **no** production environment variables, **no** Vercel alias, **no**
> CI Unity build, **no** committed WebGL output, and **no** change to the live
> match renderer, gameplay, realtime authority, or the same-origin postMessage
> contract.
>
> The B6A production decision (`docs/unity-b6a-production-readiness-audit.md`)
> remains **NO-GO**. B6C does not flip any production gate to PASS and does not
> authorize B6D.

---

## 1. Scope and non-goals

**B6C adds:**

- A local Windows PowerShell command that validates and deploys **one** existing
  B6B release to a dedicated Vercel artifact project as a **preview** deployment:
  `scripts/unity/deploy-penalty444-webgl-staging.ps1`.
- A committed, reviewable Vercel header template copied into the temporary
  workspace at runtime: `scripts/unity/vercel/penalty444-webgl-staging.vercel.json`.
- A server-only external rewrite in `apps/web/next.config.ts` from
  `/unity/penalty444/staging/:path*` to a validated immutable Vercel artifact
  origin, plus matching staging headers.
- A guarded staging-only React→Unity mock verification route:
  `/dev/unity-staging?version=<release-version>`.
- Independent post-deployment HTTP verification and a local deployment record.

**B6C explicitly does NOT:**

- Upload/publish anything during implementation or review, or publish through Git.
- Create the Vercel project (it must be created manually and pre-exist).
- Configure production environment variables or use `--prod`.
- Assign a Vercel alias (immutable preview URL only).
- Activate Unity in production, change live match feature flags, or replace the
  production React renderer.
- Alter the same-origin postMessage contract, add telemetry, or begin
  device/performance qualification.
- Install Unity in CI or begin B6D.

## 2. Architecture (text diagram)

```
Local B6B release (git-ignored, immutable, verified)
  apps/web/public/unity/penalty444/releases/<version>/
        │  (deploy script: verify → copy, source untouched)
        ▼
Temp ignored workspace (created at runtime only)
  audit-artifacts/unity-staging/<version>-<UTCstamp>/
    ├── releases/<version>/            (copied release)
    ├── vercel.json                    (copied committed template)
    ├── deployment-url.txt             (vercel stdout)
    ├── vercel-deploy-error.txt        (vercel stderr)
    └── staging-deployment.json        (local record)
        │  vercel link --project penalty444-unity-staging   (pre-existing)
        │  vercel deploy   (PREVIEW only, never --prod, no alias)
        ▼
Dedicated Vercel artifact project  →  immutable preview deployment
  https://penalty444-unity-staging-<hash>.vercel.app
     /releases/<version>/index.html            (versioned, immutable)
        ▲
        │  server-only external rewrite (destination host is fixed & validated)
        │  UNITY_STAGING_ARTIFACT_ORIGIN
        │
Main Next.js PREVIEW deployment
  browser-visible, SAME-ORIGIN:
  /unity/penalty444/staging/releases/<version>/index.html
        ▲
        │  iframe (same-origin) + mock postMessage
Guarded viewer:  /dev/unity-staging?version=<version>
```

### Why a separate artifact project

The WebGL artifacts live on their **own** Vercel project so the main app's
deployment, headers, and routing are never entangled with large immutable build
output. The artifact project is consumed **only** through the main app's
same-origin rewrite.

### Why the cross-origin bridge stays unchanged

The browser only ever sees the **same-origin** path
`/unity/penalty444/staging/...`. The rewrite proxies to the artifact origin
server-side, so the iframe and its `postMessage` traffic remain same-origin and
the existing `event.origin === location.origin` / `event.source === iframe`
checks are preserved unchanged. Direct cross-origin iframe integration of the
artifact project remains unsupported (no wildcard CORS, no cross-origin
isolation).

## 3. Immutable versioned hosted path

- Hosted (artifact origin): `/releases/<release-version>/index.html`
- Browser-visible (main app, same-origin):
  `/unity/penalty444/staging/releases/<release-version>/index.html`

Each preview deployment is immutable; a new release version is a new path. The
immutable **preview deployment URL itself** is the staging artifact origin —
alias-based promotion/rollback is deliberately out of scope for B6C.

## 4. B6B release verification (before any workspace or network call)

The deploy script independently re-verifies the source release: `manifest.json`
+ `manifest.sha256` exist, the self-checksum matches, `schemaVersion` is 1,
`game` is `penalty444`, `releaseVersion` matches the request, `buildTarget` is
WebGL, `unityVersion` is non-empty, `sourceCommit` is a 40-hex SHA that exists in
this repo (`git cat-file -e <sha>^{commit}`), `scene` is
`Assets/Scenes/Penalty444Prototype.unity`, `files[]` is non-empty, every path is
relative/`/`-style/segment-safe and resolves beneath the release dir, every
listed file exists with matching bytes + SHA-256, paths are unique, exactly one
`Build/*.loader.js` exists, framework/data/wasm categories exist, and
`TemplateData/` is non-empty. It also compares the **complete recursive file
set**: the only allowed non-manifest files are `manifest.json` and
`manifest.sha256` — any other undeclared file (logs, tokens, `.env`, `.vercel`)
blocks the deploy. The source release is never modified.

## 5. Deployment workspace

Created only at runtime (never during implementation/review) under the ignored
`audit-artifacts/unity-staging/<version>-<UTCstamp>/`. The script refuses to
overwrite an existing workspace, copies the release into
`<workspace>/releases/<version>/`, copies the committed template to
`<workspace>/vercel.json`, and re-verifies the copied release before deploying.
The workspace (with `deployment-url.txt`, `vercel-deploy-error.txt`, and
`staging-deployment.json`) is left in place for operator inspection and is never
auto-deleted.

## 6. Correct WebGL headers

The committed template (`penalty444-webgl-staging.vercel.json`) sets, per
versioned release path:

| Path | Headers |
|---|---|
| `…/Build/*.framework.js.gz` | `Content-Type: application/javascript`, `Content-Encoding: gzip`, `Content-Disposition: inline`, immutable `Cache-Control`, `X-Content-Type-Options: nosniff` |
| `…/Build/*.wasm.gz` | `Content-Type: application/wasm`, `Content-Encoding: gzip`, `Content-Disposition: inline`, immutable `Cache-Control`, `X-Content-Type-Options: nosniff` |
| `…/Build/*.data.gz` | `Content-Type: application/octet-stream`, `Content-Encoding: gzip`, `Content-Disposition: inline`, immutable `Cache-Control`, `X-Content-Type-Options: nosniff` |
| `/releases/:version/:path*` | `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, immutable `Cache-Control` |

No wildcard CORS, no `Access-Control-Allow-Origin: *`, no CSP relaxation, no
cross-origin isolation, no credentials, no redirects to the main app.

The main app additionally sets matching staging headers for
`/unity/penalty444/staging/releases/:version/**` (same MIME/gzip, plus
`CDN-Cache-Control` and `x-vercel-enable-rewrite-caching: 1`), and never weakens
framing/security outside that staging route.

## 7. Commands

Run from the repository root on Windows.

**Validate only (no workspace, no copy, no link, no deploy, no network):**

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unity/deploy-penalty444-webgl-staging.ps1 -ReleaseVersion "b6b-local-fb840878-d" -VercelProject "penalty444-unity-staging" -VercelTeam "<team-slug>" -ValidateOnly
```

**Real staging deploy (requires Vercel CLI + `vercel login`; team optional):**

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unity/deploy-penalty444-webgl-staging.ps1 -ReleaseVersion "b6b-local-fb840878-d" -VercelProject "penalty444-unity-staging"
```

`-ReleaseVersion` uses the same B6B contract (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
plus an explicit `..` rejection). `-ValidateOnly` performs the full source
verification, validates parameters and the committed template, confirms a
content-clean tracked tree and the planned workspace path, optionally notes
whether the Vercel CLI is present, and then exits without creating a workspace,
copying files, linking, deploying, or making any network request.

## 8. ValidateOnly vs. real deploy

- **ValidateOnly:** verification + configuration summary only. No side effects.
- **Real deploy:** requires the Vercel CLI, confirms `vercel whoami` (tokens are
  never printed/inspected), creates the workspace, links to the **pre-existing**
  project (failing with a clear message if it does not exist — never
  auto-creating a project), runs `vercel deploy` **without `--prod`**, captures
  stdout/stderr/exit code, requires exactly one `https://*.vercel.app` URL, then
  runs HTTP verification and writes the local record.

## 9. Post-deployment HTTP verification

Independently checks HTTP 200 for `index.html`, `manifest.json`,
`manifest.sha256`, the loader, the framework/data/wasm artifacts, and at least
one `TemplateData` file; asserts gzip `Content-Type`/`Content-Encoding` on the
`.gz` payloads and `X-Content-Type-Options: nosniff` / `X-Frame-Options:
SAMEORIGIN` / immutable `Cache-Control` on the release path. Requests use bounded
timeouts, do not retry indefinitely, do not follow redirects to unrelated
origins, and never download/execute remote scripts.

## 10. Local deployment record

`staging-deployment.json` (written only inside the ignored workspace) records
`schemaVersion`, `game`, `releaseVersion`, `deploymentUrl`, `artifactBaseUrl`,
Vercel project, Vercel team (or `null`), `sourceCommit`, `unityVersion`,
`manifestSha256`, `fileCount`, `totalArtifactBytes`, `compressedPayloadBytes`,
`compressionMode`, `deployedAtUtc`, and the verification status. It contains **no**
tokens, auth data, environment variables, user profile data, or absolute machine
paths.

## 11. Same-origin external rewrite + environment variables

`apps/web/next.config.ts` reads the **server-only** `UNITY_STAGING_ARTIFACT_ORIGIN`
(never `NEXT_PUBLIC_`). When absent, no staging rewrite is added and local/CI/
production behavior is unchanged. When set, it is strictly validated: parsed with
`URL`, `https:` only, no credentials, no query, no fragment, pathname `/`,
hostname ending in `.vercel.app`, normalized to an origin with no trailing slash;
a non-empty invalid value **fails the web build**. The rewrite maps
`/unity/penalty444/staging/:path*` → `<validated-origin>/:path*`. The destination
host is fixed to the validated origin and can never be chosen by a request, so it
is **not** an open proxy.

There are **no production environment variables** in B6C. The staging origin is
set on the main **preview** deployment only.

## 12. Guarded staging viewer

`/dev/unity-staging?version=<release-version>` returns `notFound()` unless
`UNITY_STAGING_ROUTE_ENABLED=true` **and** `UNITY_STAGING_ARTIFACT_ORIGIN` is
configured, and the `version` query param (rejecting arrays) matches the B6B
version contract with an explicit `..` rejection. The server builds only
same-origin relative URLs from the validated version and never accepts an origin
or complete URL from the query. The client shows a
**STAGING ONLY / MOCK EVENTS / NOT LIVE MATCH** banner, fetches and validates the
manifest, checks `index.html`, iframes the same-origin rewritten URL, listens
only for same-origin `ready`/`error` from that iframe, and sends only mock
`staging_begin` / `round_result` (GOAL/SAVE) / `match_end` / `reset` events. It
never connects Socket.IO/Supabase, never reads auth/wallet/economy, never mounts
`MatchRoomPanel`, and never touches `MatchRenderer3D`.

## 13. Rollback selection

Rollback in B6C is **selection**, not automation: pick a previously-deployed
immutable artifact deployment URL and set it as `UNITY_STAGING_ARTIFACT_ORIGIN`
on the **main preview** deployment only, then redeploy the main preview. No
aliases, no production changes. Alias-based promotion/rollback belongs to a later
reviewed scope.

## 14. Runtime test required before merge

The PowerShell deploy + real Vercel preview deployment and HTTP verification
**cannot** run in the review sandbox (no Windows PowerShell, no Vercel CLI/auth,
no network deploy). Pre-PR validation covers only file-scope hygiene, JSON
template parse, and web/realtime typecheck+build (including an unset build, a
valid-origin build, and an invalid-origin negative build). A Windows + Vercel
operator run is required before this tooling is trusted, and the artifact project
must be created manually first.

## 15. Relationship to B6A/B6B and B6D

- B6C proposes to address, **at staging scope only**, the B6A blockers for
  artifact publishing tooling, an immutable hosted URL, same-origin delivery,
  staging deployment, and MIME/compression verification — none marked PASS until
  the Windows/Vercel runtime validation succeeds.
- Production reproducibility, performance, mobile/desktop qualification, security
  approval, telemetry, production rollout controls, kill switch, rollback
  rehearsal, asset licensing, and product/UX approval all remain **blocked**.
- The B6A decision remains **NO-GO**. **B6C does not authorize B6D**; B6D is a
  separate, future, independently-gated PR.
