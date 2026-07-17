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

**Gzip-only.** The committed Vercel template ships **gzip** rules only, so B6C
accepts gzip B6B releases only: it requires `manifest.compressionMode == "gzip"`
and exactly one each of `Build/*.framework.js.gz`, `Build/*.data.gz`,
`Build/*.wasm.gz` (plus exactly one loader). A Brotli or identity release is
rejected with: *"B6C staging delivery currently supports gzip B6B releases only."*
Brotli support is intentionally out of scope for this PR; B6B output is unchanged.

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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unity/deploy-penalty444-webgl-staging.ps1 -ReleaseVersion "b6b-local-fb840878-d" -VercelProject "penalty444-unity-staging" -ValidateOnly
```

**Real staging deploy (requires Vercel CLI + `vercel login`):**

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unity/deploy-penalty444-webgl-staging.ps1 -ReleaseVersion "b6b-local-fb840878-d" -VercelProject "penalty444-unity-staging"
```

`-VercelTeam` is optional; when supplied it must match the same
`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` shape (e.g. `-VercelTeam "my-vercel-team"`)
and is passed to Vercel as `--scope`.

`-ReleaseVersion` uses the same B6B contract (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
plus an explicit `..` rejection). `-ValidateOnly` performs the full source
verification, validates parameters and the committed template, confirms a
content-clean tracked tree and the planned workspace path, optionally notes
whether the Vercel CLI is present, and then exits without creating a workspace,
copying files, linking, deploying, or making any network request.

## 8. ValidateOnly vs. real deploy

- **ValidateOnly:** verification + configuration summary only. No side effects.
- **Real deploy:** requires the Vercel CLI, confirms `vercel whoami` (tokens are
  never printed/inspected), verifies the **pre-existing** artifact project via
  `vercel project inspect <project> [--scope <team>]` (failing clearly if it does
  not exist — never auto-creating a project), creates the workspace, links, runs
  `vercel deploy` **without `--prod`**, captures stdout/stderr/exit code, resolves
  exactly one immutable preview deployment URL via the dedicated parser (see
  §8.1), then runs HTTP verification and writes the local record.

### 8.1 Deployment-URL parsing (Vercel CLI 56.2.0)

Vercel CLI **56.2.0** emitted **structured JSON** on stdout during the first
runtime. `Resolve-VercelDeploymentUrl` supports exactly two strict contracts:

- **JSON form** — when trimmed stdout begins with `{`, the whole stdout is parsed
  with `ConvertFrom-Json` (no regex/plain fallback on failure). It requires
  top-level `status == "ok"`, a `deployment` object with `id` matching
  `^dpl_[A-Za-z0-9]+$`, a non-empty `deployment.url`, `deployment.readyState ==
  "READY"`, and a `deployment.target` property that is **null/empty** (confirming
  a preview / non-prod deployment). The immutable origin is taken **only** from
  `deployment.url`. `inspectorUrl`, `deploymentApiUrl`, `message`, and `next[]`
  (including any suggested `vercel deploy --prod`) are **ignored** and are never a
  URL source. Property reads are guarded (`PSObject.Properties`) so a missing
  field fails cleanly rather than throwing under `Set-StrictMode`.
- **Plain-URL form** — when stdout does not begin with `{`, it requires **exactly
  one** non-empty line that IS a bare `^https://[A-Za-z0-9.-]+\.vercel\.app/?$`
  URL. No prose scanning, no embedded-URL extraction, no reading stderr for a URL.

The single candidate then passes the retained `System.Uri` validation (https,
`*.vercel.app` host, no credentials/query/fragment, path `/`, default port) and is
normalized to scheme + authority. The **exact project/production alias**
(`https://<VercelProject>.vercel.app`, i.e.
`https://penalty444-unity-staging.vercel.app`) is explicitly **rejected** with a
message that B6C requires the *generated immutable preview* URL, not the
project/production alias. The random generated hostname is **not** required to
have any particular hash length or team-suffix format — `deployment.url` plus the
URL constraints are the source of truth. `deployment-url.txt` retains the
complete unmodified stdout; the extracted URL never replaces it.

### Windows PowerShell 5.1 native-process discipline

All `git` and `vercel` calls go through a **single reviewed helper**
(`Invoke-Native`) that captures stdout, stderr, and the real exit code
**separately**. Under `Set-StrictMode` + `ErrorActionPreference=Stop`, PS 5.1
otherwise turns harmless native stderr — Git CRLF/line-ending warnings, Vercel
progress — into a terminating `NativeCommandError`. The helper redirects stderr
to a temp file with the preference temporarily relaxed, so a **zero exit with
warnings succeeds** and a **non-zero exit still fails**, and stderr text is never
mixed into parsed stdout path lists. The operator does **not** need
`git update-index --assume-unchanged` (or any `reset`/`restore`/`checkout`/`add`/
renormalize/global-config change) to run the script — the content-clean vs.
status-metadata-only policy is unchanged and the wrapper never alters Git state.

## 9. Post-deployment HTTP verification

Independently checks HTTP 200 for `index.html`, `manifest.json`,
`manifest.sha256`, the loader, the gzip framework/data/wasm artifacts, and at
least one `TemplateData` file; asserts gzip `Content-Type`/`Content-Encoding` on
the `.gz` payloads and `X-Content-Type-Options: nosniff` / `X-Frame-Options:
SAMEORIGIN` / immutable `Cache-Control` on the release path. Requests use bounded
timeouts, do not retry indefinitely, keep redirects **disabled**, and never
download/execute remote scripts.

**Bounded readiness polling.** A brand-new deployment's generated hostname can
take ~15 s to resolve, so verification runs under **one shared, monotonic,
strictly-bounded 90-second window** (a single `System.Diagnostics.Stopwatch`, not
wall-clock, covering **all** hosted verification — never a fresh window per file),
polling roughly every **2 seconds**. `index.html` is the propagation gate; the
remaining files are verified under the **same** window. The window is enforced
strictly: **every request timeout is clamped to the remaining shared time**
(`min(20 s, remaining)`), the elapsed clock is **re-checked after every request**
so a **late HTTP 200 arriving after the window is not accepted**, and the poll
**sleep is clamped to the remaining time** (`min(2 s, remaining)`) so no wait
overshoots the window. **Transient** conditions are retried until the window
elapses: network failures with **no** HTTP response (DNS/name-resolution, connect,
timeout, transport) and transient HTTP statuses **404, 408, 425, 429, 500, 502,
503, 504**. Each retry prints a concise wait message with the attempt number and
last condition. On expiry a **single centralized deadline-failure helper** reports
the deployment URL, last path, attempt count, final condition, and the configured
total window, notes the deployment may exist and the workspace is preserved, and
**never** deletes/redeploys/promotes/aliases. Only HTTP readiness requests retry —
deployment creation is never automatically retried.

**Fail-fast (non-transient).** The wrapper fails **immediately**, without
retrying, for: a `301/302/307/308` redirect to Vercel Authentication
(`sso-api` / `/sso` / `vercel.com/sso` / `vercel.com/login` / `authenticate`,
using the targeted protection message below); any other unexpected redirect;
**400 / 401 / 403** and any other non-transient 4xx; malformed URLs; the project
alias; and header mismatches after an HTTP 200. Authentication/permission failures
are never treated as propagation delays.

**Protected-preview message.** On a redirect to Vercel Authentication the message
states: the immutable preview is protected by Vercel Authentication; B6C requires
the dedicated artifact preview to be **anonymously reachable** for the main app's
server-side rewrite; change protection **only** on `penalty444-unity-staging`,
**not** on the main application project `penalty444-platform-at1y`; do **not** use
the production/project alias; and re-run after adjusting protection. (No bypass
secret is implemented here.)

**No duplicate deployment on verification failure.** If verification fails after
Vercel reports a `READY` deployment, the operator must inspect the preserved
workspace and the deployment before rerunning. The script cannot automatically
delete, replace, promote, or redeploy, and adds no automatic deployment retries.

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

**Staging-only is enforced in code.** If `VERCEL_ENV === "production"` and
`UNITY_STAGING_ARTIFACT_ORIGIN` is non-empty, the web build **fails** with a
clear B6C staging-only error, so a Vercel production deployment can never contain
the staging rewrite. `VERCEL_ENV` (not `NODE_ENV`) is used because Vercel preview
builds also run with `NODE_ENV=production`. The `/dev/unity-staging` page
additionally returns `notFound()` whenever `VERCEL_ENV === "production"`. Unset,
local, CI, and preview behavior are unchanged.

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
template parse, and web/realtime typecheck+build (unset, valid-preview-origin,
invalid-origin, and forbidden-production scenarios). A Windows + Vercel operator
run is required before this tooling is trusted, and the artifact project must be
created manually first.

### 14.1 First runtime (Windows) — evidence and outcome (B6C remains YELLOW)

A first authorized Windows runtime was executed. Honest record:

- PowerShell **parser: PASS**.
- **ValidateOnly: PASS**.
- **Build D** (`b6b-local-fb840878-d`) source verification: **PASS**.
- Release **copy + copied-release re-verification: PASS**.
- `vercel link` / `vercel deploy` created a preview **successfully**. Vercel CLI
  **56.2.0** emitted **structured JSON** on stdout; the immutable preview origin
  is taken **only** from `deployment.url`
  (`https://penalty444-unity-staging-m0901fode-chancykibombwes-projects.vercel.app`),
  gated on `status=ok`, `readyState=READY`, and `target=null` (see §8.1). The
  plain-URL stdout form remains supported as a separate strict format; arbitrary
  embedded-URL extraction is prohibited and the project alias is rejected.
- The wrapper then **exited 1 during HTTP verification**: the artifact request
  returned **HTTP 302 to Vercel SSO** — the dedicated preview is protected by
  Vercel Authentication and is not anonymously reachable.
- A production/project **alias returning 200 is *not* acceptable evidence**;
  verification must pass against the generated **immutable** deployment URL.
- The run also required **local PS 5.1 fixes** (native stderr handling and URL
  parsing) that were **not** part of the committed head; those fixes are now
  rewritten cleanly into the committed script (see §8 native-process discipline
  and §9 protected-preview detection).
- A **corrected committed-head rerun remains required**. **B6C remains YELLOW**;
  the production decision remains **NO-GO**; **B6D remains unauthorized**. No
  runtime gate is marked PASS.

### 14.1a Corrected-head rerun — DNS/readiness propagation (still YELLOW)

A corrected-head rerun was executed after disabling protection **only** on
`penalty444-unity-staging`:

- Parser **PASS**; ValidateOnly **PASS, exit 0**; **no `assume-unchanged` flag
  used**; the original immutable preview became anonymously reachable (HTTP 200).
- The rerun exposed a final orchestration defect: two deployments both **created
  successfully**, but the **first** (`dpl_A3B6DGY3Qh53ScHZv3UQ1KmH1ibv`) failed
  verification with **exit 1 only because its generated hostname did not resolve
  immediately** — it became reachable ~**15 s** later — forcing the operator to
  rerun the entire deployment purely for propagation.
- The **second** deployment passed **all** artifact HTTP/MIME/gzip/header
  verification, wrote `staging-deployment.json`, and exited **0**:
  - deployment ID `dpl_4yEsG8YSFzdg9sFyuLAxMuqLzxyV`
  - immutable URL
    `https://penalty444-unity-staging-42qkvl348-chancykibombwes-projects.vercel.app`
  - `target=null`, no production deployment, no alias, tracked tree clean,
    generated WebGL + audit workspaces untracked.
- **This proves the artifact path and headers work.** The wrapper is now hardened
  with the **bounded 90-second readiness polling** described in §9 so a fresh
  deployment's DNS/readiness delay no longer forces a needless redeploy.
  **Deployment creation itself is never automatically retried** — only HTTP
  readiness/verification requests retry.
- The successful immutable preview remains
  `https://penalty444-unity-staging-42qkvl348-chancykibombwes-projects.vercel.app`.
  Artifact-project preview protection is disabled **only** on
  `penalty444-unity-staging`; main-app preview integration has **not** begun.
- The polling correction still needs a Windows rerun to confirm. **B6C remains
  YELLOW**; production remains **NO-GO**; **B6D remains unauthorized**; no runtime
  gate is marked final PASS.

### 14.1b Windows PowerShell 5.1 source-encoding fix (ASCII-only)

A pristine checkout of committed head `453eb9ac` **failed** the Windows
PowerShell **5.1** parser (e.g. `Line 531: Unexpected token 'inspect'` /
`Missing closing ')'`, with cascading missing-brace errors). The cause was
**non-ASCII punctuation inside executable strings** — Unicode em dashes (`U+2014`)
in messages such as `"…never creates another deployment — inspect…"` and
`"…(bad request / auth / permission) — not a propagation delay."` — which PS 5.1
mis-tokenizes when the file has no UTF-8 BOM. Replacing those em dashes with ASCII
hyphens locally allowed the parser to pass.

To remove the dependence on UTF-8-without-BOM handling entirely, the **whole
wrapper is now ASCII-only** (every character is `U+0000`–`U+007F`): em/en dashes
`-> -`, ellipsis `-> ...`, section sign `-> "section"`, and the decorative
box-drawing comment separators `-> ASCII hyphen separators`. This is a
**source-encoding-only** change — the substitution was verified to reproduce the
prior file byte-for-byte apart from those characters, so polling logic,
transient-status handling, deployment parsing, and MIME/security checks are
**unchanged**. A repo-local check asserts no character exceeds `U+007F`.

**Important:** the earlier ValidateOnly "exit 0" (§14.1a) was produced with a
**locally modified** wrapper temporarily hidden via `git update-index
--skip-worktree`, so it does **not** count as pristine committed-head validation.
A clean Windows **parser + ValidateOnly + final deployment** rerun against the
ASCII-only committed head is **still required**. The monotonic-window
implementation has **not** yet passed a Windows runtime. **B6C remains YELLOW**;
production remains **NO-GO**; **B6D remains unauthorized**.

### 14.1c Main-app runtime — staging route isolation failure + fix (still YELLOW)

A main-app preview runtime test of the guarded route
`/dev/unity-staging?version=b6b-local-fb840878-d` found:

- The artifact loaded same-origin, Unity reached `ready`, and the mock
  `staging_begin` / `round_result` GOAL / SAVE / `match_end` / `reset` all worked;
  negative routes still 404'd. **Presentation/mock verification passed.**
- **But** Chrome Network (Socket filter) showed live/reconnecting
  `socket.io/?EIO=4&transport=websocket` requests **while on the staging route** —
  contradicting the page's **NO SOCKET.IO / NO SUPABASE / NO AUTH / mock-only /
  not-a-live-match** contract. **The staging route failed its isolation gate.**

**Repository cause (not the staging page).** The root `app/layout.tsx` globally
mounted `ActiveMatchRecovery`, `MatchReadyNotification`,
`TournamentMatchReadyNotification`, `Navbar`, `FreePlayNoticeStrip`, and the
footer on **every** route. `ActiveMatchRecovery` (and `MatchReadyNotification`)
call `getSocket()` on mount, which creates the Socket.IO singleton and binds
Supabase auth / reads the access token for the handshake — so the realtime/auth
runtime leaked onto the staging route.

**Fix — route-aware shell (mount-level, not cosmetic).** A new
`apps/web/src/components/layout/RouteAwareAppShell.tsx` (client component using
`usePathname()`) renders, for **exactly** `pathname === "/dev/unity-staging"`,
only a minimal `<main>{children}</main>` — **none** of `ActiveMatchRecovery`,
`MatchReadyNotification`, `TournamentMatchReadyNotification`, `Navbar`,
`FreePlayNoticeStrip`, or the normal footer mount, so their mount-time
`getSocket()` / auth effects never run. Every **other** route renders the exact
existing shell unchanged. `layout.tsx` keeps `<html>`/`<body>`, metadata, and
viewport and delegates body content to the shell. No `disconnectSocket()`
workaround, no cosmetic hiding of network activity, and no change to the Socket.IO
singleton or auth policy — the realtime/auth components simply never mount on the
staging route. `getSocket()` remains **lazy** (the `io()` call is inside
`getSocket`, and each global component calls it only inside a mount `useEffect`),
so merely importing the normal shell does not open a socket.

All staging security gates are unchanged (production `notFound()`,
`UNITY_STAGING_ROUTE_ENABLED`, validated origin + version, same-origin relative
URLs, strict inbound origin/source validation, ready/error allowlist,
manifest/index gates, mock events only). **Isolation is not claimed PASS until the
corrected preview is retested** — the fix was verified here only by typecheck +
build. **B6C remains not final / YELLOW**; production remains **NO-GO**; **B6D
remains unauthorized**.

### 14.2 Configuration prerequisite (anonymous artifact access)

The dedicated `penalty444-unity-staging` artifact project's **preview**
deployments must permit **anonymous** artifact access, so the main app's
server-side rewrite can fetch `/releases/<version>/…` without a Vercel
Authentication redirect. Adjust deployment protection **only** on that dedicated
artifact project. Protection on the **main application project**
(`penalty444-platform-at1y`) must remain **unchanged**. Do not use the
production/project alias, and do not add a protection-bypass secret in this scope.

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
