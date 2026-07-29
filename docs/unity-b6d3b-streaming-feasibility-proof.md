# B6D3B — Unity WebGL Streaming Feasibility Harness (Proof)

> Disposable research harness. NOT a player-facing feature, NOT the final
> `/unity-arena/player` route, NOT the final `/unity-arena/artifact/[...path]`
> route, NOT a cohort/session system, NOT a Unity renderer, NOT a production
> route. Everything here lives under `/api/dev/unity-stream-proof/**` and
> `apps/web/src/lib/unity-stream-proof/**` and may be deleted wholesale.

## 1. Purpose and authorization

This harness exists to later determine — under a separately authorized
protected-preview measurement — whether a Vercel/Next.js **Node** route can
stream the pinned, pre-compressed Unity WebGL artifacts (especially the
`~8.19 MB` `.wasm.gz`) **without**:

- buffering the full response,
- hitting the non-streaming function-body limit (~4.5 MB),
- transparently decompressing the `.gz` artifacts,
- double-compressing or re-encoding them,
- changing their compressed byte count,
- changing their SHA-256,
- corrupting `Content-Type` / `Content-Encoding`,
- breaking `HEAD` or `Range` behaviour.

Authorization status when this harness was built (historical):

- B6D3A IMPLEMENTATION: COMPLETE AND LOCKED
- B6D3B PLANNING REVIEW: COMPLETE AND LOCKED
- B6D3B AUTHORIZATION PACKAGE: COMPLETE AND LOCKED
- B6D3B STREAM-PROOF MANIFEST EVIDENCE: COMPLETE AND LOCKED
- **B6D3B STREAMING HARNESS: AUTHORIZED** (this document)
- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: **NOT AUTHORIZED** *(at build
  time; the measurement was subsequently authorized and executed — see §14)*
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- PLAYER-FACING UNITY / PRODUCTION UNITY: NOT AUTHORIZED / NO-GO

The harness-creation task **created** the harness, its tests, and the §14
procedure, and executed no measurement. The protected-preview measurement was
**separately authorized and has since been executed and closed out**: the **raw**
Node transport is **PASS** and the **built-in fetch** transport is
**FAIL — RANGE** (§14, §16). Current authorization state is in §19–§20; PR-1,
PR-2, player-facing Unity and production Unity all remain unauthorized / NO-GO.

## 2. Exact baseline SHA

The harness branch `test/unity-b6d3b-streaming-feasibility` was created from
`origin/master`:

```
61d7b8ebf78e51acb77697f37af8e03ae63add92
```

## 3. Merged tracked evidence

The sole authoritative per-file evidence is the merged, tracked fixture:

```
apps/web/src/lib/unity-stream-proof/fixtures/b6b-local-fb840878-d.manifest.json
```

It is **inspect/import only** and was **not modified**. Pinned release
`b6b-local-fb840878-d`:

| Field | Value |
| --- | --- |
| source manifest SHA-256 | `be290569c2f22cc8481a641bbfd720795790ced4e271042f45f367441f6444ae` |
| source file count | `17` |
| source total bytes | `10585492` |

| label | path | bytes | SHA-256 | contentEncoding | derived Content-Type |
| --- | --- | --- | --- | --- | --- |
| wasm | `Build/b6b-local-fb840878-d.wasm.gz` | `8583356` | `cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b` | `gzip` | `application/wasm` |
| data | `Build/b6b-local-fb840878-d.data.gz` | `1866605` | `b1f91a0117c62de5ef3734d0a2c757e078ce607778f09deccbe664a3e5368339` | `gzip` | `application/octet-stream` |
| framework | `Build/b6b-local-fb840878-d.framework.js.gz` | `88984` | `d757c33a4c0be14e18adbfb3078f8ef19baed6091f360f2c07133f99155e1eee` | `gzip` | `application/javascript` |
| loader | `Build/b6b-local-fb840878-d.loader.js` | `26982` | `de61c3bc8500cb8ff080d6a0791cc7cf53f2128368d94a5dd9dadbf0291dc71d` | `identity` | `application/javascript` |

`Content-Type` is **derived** from the reviewed suffix mapping; it is deliberately
NOT stored in the fixture (which records only source-manifest evidence).

## 4. Non-goals

This harness is NOT and does not create:

- the final `/unity-arena/player` route,
- the final `/unity-arena/artifact/[...path]` route,
- the cohort session / capability system,
- a Unity renderer or any player-facing UI,
- any match / realtime integration,
- a production route or a permanently public artifact URL,
- any change to MatchRoomPanel, MatchRenderer3D, UnityPresentationHost,
  useViewerPresentation, presentation protocol/adapter/shadow/identity/
  correlation modules, `next.config.ts`, `package.json`, any lockfile,
  middleware, Supabase/auth, env files, Vercel config, realtime server,
  `packages/shared`, Unity files, or `ProjectSettings.asset`.

No dependency was added. No artifact body was committed.

## 5. Proof-only architecture

```
apps/web/src/lib/unity-stream-proof/
  fixtures/b6b-local-fb840878-d.manifest.json   (merged; unchanged)
  manifest.ts        load + strictly validate the fixture; derive Content-Type;
                     exact-path resolution (no arbitrary lookup)
  security.ts        constant-time bearer compare; env gate; origin validation
                     (https-only unless loopback-http is explicitly injected);
                     path allowlisting; ordered evaluateGate()
  streamProxy.ts     fetchTransport() + rawTransport(); non-buffering instrumented
                     ReadableStream; sanitized response headers; diagnostics;
                     createProofRequestHandler({ allowHttp }) factory
                     (allowHttp defaults to false)

apps/web/src/app/api/dev/unity-stream-proof/[transport]/[...path]/route.ts
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  const live = createProofRequestHandler();   // allowHttp: false → HTTPS-only
  export const GET  = live.GET;
  export const HEAD = live.HEAD;
```

The route file exports **only** route-segment fields (`runtime`, `dynamic`, `GET`,
`HEAD`); the reusable, injectable handler lives in `streamProxy.ts` so tests can
supply loopback-HTTP injection without adding non-route exports (which the
Next-generated route type-check rejects). The handler composes the pure modules,
all gating collapses to a single indistinguishable 404, and the transports
perform the only outbound request and never buffer the whole body.

**Live route is HTTPS-only.** `createProofRequestHandler()` defaults to
`allowHttp: false`, so the deployed `GET`/`HEAD` require an `https:` artifact
origin. A loopback `http:` origin is reachable **only** through the explicit
test-injected handler `createProofRequestHandler({ allowHttp: true })`; this is a
dependency-injection seam, **not** a `NODE_ENV` check. Non-loopback `http:` is
denied in every mode.

## 6. Environment and access gate

Server-only variables (designed and consumed here, **not configured** by this
task, and never written to any env file):

- `UNITY_STREAM_PROOF_ENABLED` — must equal `"true"`.
- `UNITY_STREAM_PROOF_BEARER` — required non-empty secret.
- `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN` — validated absolute origin.

The route returns an **indistinguishable 404** when any of the following hold
(evaluated before any upstream work):

- `VERCEL_ENV === "production"`,
- `UNITY_STREAM_PROOF_ENABLED !== "true"`,
- bearer env absent,
- `Authorization` missing / malformed / invalid,
- artifact origin absent / invalid,
- transport unknown,
- path not exactly allowlisted.

Because no proof variables are configured, any automatically created Vercel
preview returns 404. Authorization is `Authorization: Bearer <secret>` only — no
query-string auth, no cookie auth. Bearer comparison is constant-time
(fixed-width SHA-256 digests + `timingSafeEqual`, with a length equality guard),
so unequal-length inputs are handled safely. The secret and the origin are never
placed in response bodies or logs.

## 7. Manifest and path security

`manifest.ts` fails closed on: unsupported `schemaVersion`, unexpected
`releaseId`, wrong manifest SHA / file count / total, duplicate labels or paths,
missing required labels, invalid byte values, invalid SHA-256 values, invalid
`contentEncoding`, and unsupported suffix→Content-Type mapping. It offers only
exact-path resolution (no arbitrary lookup).

`security.ts` accepts a route path only if **every** segment matches the
conservative charset `^[A-Za-z0-9._-]+$` (and is not `.`/`..`) **and** the joined
path exactly equals one fixture record path (case-sensitive). This rejects `..`,
single/repeated percent-encoding, backslashes and encoded backslashes, absolute
and protocol-relative URLs, leading-slash / drive-letter paths, null bytes, empty
or extra segments, unknown files, case mismatches, and mixed separators. User
path input is **never** passed to `new URL()` before allowlist resolution; the
only upstream URL constructed is `validated bare origin + derived versioned
artifact path` (see §7.1).

`UNITY_STREAM_PROOF_ARTIFACT_ORIGIN` must parse as an absolute URL, be `https:`
for the deployed/live route, contain no username/password, no query, no fragment,
and normalize to a **bare origin** (pathname exactly `/`). `http:` is accepted
**only** for loopback hosts (`127.0.0.0/8`, `localhost`, `::1`) **and only** when a
caller explicitly injects `allowHttp: true` — which the live route never does. It
is never returned from request input, never logged, never echoed. Redirects to
another origin are rejected.

### 7.1 Versioned upstream artifact path

The B6C dedicated artifact deployment does **not** host WebGL Build files at
`/Build/…`; it hosts the pinned immutable release under
`/releases/<release-version>/…` (see `docs/unity-b6c-versioned-staging-delivery.md`
§3). The harness therefore derives the upstream deployment path from
`buildUpstreamArtifactPath(record)` as exactly:

```
releases/${EXPECTED_RELEASE_ID}/${record.path}
```

using **only** the compile-time-pinned `EXPECTED_RELEASE_ID`
(`b6b-local-fb840878-d`) and the already-validated fixture `ArtifactRecord.path`
(release-relative, e.g. `Build/b6b-local-fb840878-d.wasm.gz`).

- **Artifact origin (bare, immutable Vercel preview):**
  `https://<immutable-artifact-preview>.vercel.app`
- **Derived upstream artifact path:**
  `/releases/b6b-local-fb840878-d/Build/<artifact>`
- **Example wasm final upstream shape:**
  `https://<immutable-artifact-preview>.vercel.app/releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.wasm.gz`

The release prefix is **compile-time/pinned, not request-controlled**: no request
query, request pathname text, request header, user-provided release version, or
environment-provided pathname can alter it. `/releases/<version>` is therefore
**never** placed inside `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN` — an origin carrying a
non-root path (e.g. `https://host/releases/b6b-local-fb840878-d`) is **rejected**
by origin validation, because the origin **stays bare** and the versioned prefix is
derived internally. The pinned evidence **fixture stays unchanged** and continues
to store release-relative artifact metadata (e.g. `Build/b6b-local-fb840878-d.wasm.gz`).
This derived versioned path is the one exercised by the completed
protected-preview measurement (§14).

## 8. Built-in fetch transport

`fetchTransport` uses the platform `fetch()` (Undici) with `redirect: "manual"`,
rejecting every 3xx / opaque redirect. It forwards `Range` when supplied and
returns a streamed body. It never calls `arrayBuffer()`, `blob()`, `text()`, or
`json()`.

**Full-lifecycle abort/timeout.** The transport uses two distinct phases whose
timers/listeners survive header return and are removed exactly once at a terminal
point:

- a **header-phase timeout** remains active until `fetch()` returns headers
  (a stall here fails `headers_timeout`, HTTP 504);
- after headers, a **body inactivity timeout** (reset on each chunk) remains
  active until stream completion, cancellation or error (a stall after the first
  chunk fails `body_timeout`, and aborts the upstream via the `AbortController`);
- the client-abort listener stays connected to the upstream `AbortController` for
  the entire streamed response — an abort after the first chunk yields
  `client_abort`;
- consumer cancellation of the response body cancels the upstream request (via
  the reader), and diagnostics emit exactly once.

Because Undici may transparently decompress a gzip response and drop
`Content-Encoding`, this transport **fails closed** for a gzip artifact whenever
the upstream response no longer advertises `content-encoding: gzip` (a detectable
byte/header transformation), and it **omits `Content-Length`** for gzip because
the body may be transformed. It does not claim deployed byte identity.
**Fetch mode cannot be marked PASS from unit tests** — only a protected-preview
measurement can prove deployed compressed length, SHA-256, gzip validity, and
headers. **That measurement has now been executed: fetch is classified
`FAIL — RANGE`** (empty `Range` entity body despite correct `206` metadata; the
full download was deliberately not run, so deployed fetch byte identity remains
untested and unclaimed). See §14.4.

## 9. Raw Node HTTP/HTTPS transport

`rawTransport` uses built-in `node:http` / `node:https` / `node:stream` only (no
dependency, no zlib/gunzip/Brotli). It selects the protocol from the validated
origin, rejects redirects, preserves the raw compressed bytes, forwards `Range`,
preserves `200` / `206` / `416`, supports `HEAD` without a body, and converts the
`IncomingMessage` to a Web stream via `Readable.toWeb()` (no chunk concatenation,
no whole-body retention).

**Three distinct bounded timeout phases**, each cleaned up exactly once with no
timer firing after successful completion:

1. **connection timeout** — armed at request start, cleared when the socket
   `connect`/`secureConnect`s (fails `connect_timeout`, HTTP 504);
2. **response-header timeout** — armed after connection, cleared when the response
   callback begins (fails `headers_timeout`, HTTP 504);
3. **response-body inactivity timeout** — armed after headers, reset on each
   chunk, active until complete/cancel/error; a stall destroys the upstream
   response/request and yields `body_timeout`.

Client abort destroys both the request and any active response; `connect_timeout`,
`headers_timeout`, `body_timeout`, `client_abort`, `upstream_abort` and
`upstream_error` are classified accurately in diagnostics. The request factory is
injectable so the connection-timeout phase can be tested deterministically without
any external network request.

The protected-preview measurement has now exercised this transport end-to-end:
**raw is classified `PASS`** — exact `8,583,356` bytes, exact SHA-256, gzip
preserved, and a 544-chunk streamed transfer that exceeded the ~4.5 MB
non-streaming limit without a platform body-limit failure. This records deployed
streaming feasibility only; it is **not** a claim of production readiness. See
§14.3.

## 10. Response-header contract

Response-header construction knows the transport, the status, the pinned artifact
record, and the safe (already-stripped) upstream headers. Successful authorized
`200`/`206` responses set:

- `Cache-Control: private, no-store`
- `Vary: Authorization`
- `X-Content-Type-Options: nosniff`
- `Content-Type` from the reviewed suffix mapping

**Content-Encoding (fail closed on contradiction, before streaming).** A `gzip`
record requires upstream `Content-Encoding: gzip` on **both** transports (fetch
would have dropped it if it decompressed); an `identity` record accepts only an
absent or explicit `identity` encoding. Any detectable contradiction fails closed
with `header_mismatch`.

**Content-Length.** For a raw full `200`: if the upstream declares a length that
differs from the pinned byte count, it fails closed with `byte_mismatch` before
streaming; when absent, the streamed total is compared at terminal completion and
a differing completed length becomes `byte_mismatch` (not `complete`). For fetch,
`Content-Length` is **omitted for gzip** (possible transparent transform) and only
echoed for `identity` when it matches the pinned count. For `206`, a partial
`Content-Length` is preserved only when consistent with the partial span.

**Accept-Ranges is never fabricated.** It is set only when the upstream value is
exactly `bytes`; an absent or unknown upstream value stays absent.

**Content-Range / 416.** A syntactically safe `Content-Range` is preserved for
`206`, and `Content-Range: bytes */<total>` is preserved for `416`. A `416`
returns status 416 with **no upstream body** (the upstream 416 body is
destroyed/cancelled and never forwarded — no upstream error page leaks) and
carries **no artifact `Content-Encoding` and no artifact `Content-Length`**.

Stripped from upstream: `Server`, `Via`, `X-Powered-By`, `Location`,
`Set-Cookie`, `ETag`, upstream cache directives (`Cache-Control`/`Age`/`Expires`/
`CDN-Cache-Control`/`Surrogate-Control`), and host/origin-identifying headers
(e.g. `X-Vercel-*`, `CF-Ray`, `CF-Cache-Status`), plus unknown headers. `404`
denials carry no detail, no origin, no secret, no fixture information, and no
cacheable protected body.

## 11. Streaming diagnostics

Identity-free aggregate diagnostics are collected without buffering and emitted
once at a terminal point via an injectable callback or a minimal server logger.
Permitted fields only: `transport`, artifact `label`, `upstreamStatus`,
`firstChunkMs`, `totalDurationMs`, `chunkCount`, `totalBytes`, `rangeUsed`, and a
`reason` from: `complete`, `client_abort`, `upstream_abort`, `connect_timeout`,
`headers_timeout`, `body_timeout`, `redirect_rejected`, `upstream_error`,
`byte_mismatch`, `header_mismatch`. Never recorded: bearer, origin, full URL,
cookies, identity, room code, match data, player ids, or response body bytes.
Diagnostics never appear in the artifact response body.

## 12. Automated test matrix

Node `node:test` via `tsx`, loopback in-process mock servers only — no internet,
no Vercel, no real artifact body (the real 8.19 MB wasm is never embedded).

- **manifest.test.ts** — fixture loads; release/source metadata; exactly four
  records; exact paths/sizes/hashes/encodings; derived MIME; invalid variants
  fail closed.
- **security.test.ts** — constant-time compare (equal / unequal same-length /
  unequal length); canonical Bearer only (no query/cookie auth); origin
  validation (https, loopback-http, creds/query/fragment/path/garbage rejected);
  path allowlist (exact accept; `..`, single/repeat encoding, backslash + encoded
  backslash, absolute/protocol-relative URL, drive letter, null byte, case
  mismatch, extra/empty segment all denied); ordered gate (production first,
  disabled, bearer env, auth missing/malformed/invalid, origin, transport, path).
- **streamProxy.test.ts** — raw: exact bytes/count/SHA preserved,
  `Content-Encoding` + `application/wasm` preserved, unsafe headers stripped,
  **absent `Accept-Ranges` stays absent**, **gzip missing/wrong encoding fails
  closed** (`header_mismatch`), **full `Content-Length` mismatch fails closed**
  (`byte_mismatch`), **completed byte-count mismatch reflected in diagnostics**,
  delayed multi-chunk stays streamed with first chunk before completion, redirect
  rejected, **connect timeout (deterministic, injected request)**, **headers
  timeout**, **body timeout after first chunk**, **successful completion cleans up
  (no later timer, single emission)**, HEAD, Range + `206`/`Content-Range`,
  **`416` preserves safe `Content-Range`, empty body, upstream body not
  forwarded**, pre-aborted + mid-stream client abort (destroys upstream); fetch:
  identity streams (single emission), detectable gzip decompression fails closed,
  **gzip response omits `Content-Length`** (header-build rule), `416` header
  builder (no encoding/length/type), redirect rejected, Range, pre-aborted +
  **mid-stream client abort (cancels upstream)**, **body stall → `body_timeout`**,
  **header-phase timeout**, **successful completion cleans up (single emission)**,
  HEAD; **versioned upstream path**: `buildUpstreamArtifactPath` derives exactly
  `releases/b6b-local-fb840878-d/Build/<artifact>` for all four artifacts, **raw**
  and **fetch** each hit the exact versioned path (never `/Build/…`), the release
  prefix is pinned/record-only (no query/user input can alter it), and an origin
  containing `/releases/<version>` remains rejected (origin stays bare).
- **route.test.ts** — **live handler returns opaque 404 for a loopback `http:`
  origin even with all gates valid** (HTTPS-only); a valid `https:` origin passes
  the origin gate (upstream error, not 404); production/opaque 404s are
  byte-identical across every gate failure (including live loopback-http);
  raw wasm happy path with sanitized headers via the test-injected
  (`allowHttp: true`) handler; HEAD; boundary regression (harness sources import
  no match/presentation/realtime/shared/unity-arena/socket.io/supabase/next-server
  module).

## 13. Local validation results

Run in the clean worktree; no package/lockfile modification resulted.

| Check | Command | Result |
| --- | --- | --- |
| Harness tests | `npx tsx --test <harness files>` | **60 pass / 0 fail** |
| Presentation contract tests | `npm run test:unity-presentation` | **pass / 0 fail** |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **pass** |
| Next production build | `npm run build` | **pass** — route emitted as `ƒ /api/dev/unity-stream-proof/[transport]/[...path]` |
| Realtime build | `npm run build` (apps/realtime-server) | **pass** |
| `git diff --check` | — | clean |

> The build requires the same placeholder public Supabase env used by CI
> (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) for the
> pre-existing `/leaderboard` Server Component; this is unrelated to the harness.

### 13.1 CI enforcement (required GitHub step)

The harness tests are now a **required** step in `.github/workflows/ci.yml`,
added immediately after the Unity presentation contract tests and before the
TypeScript check, using the repository's installed `tsx` (no `package.json`
change):

```yaml
- name: B6D3B streaming harness tests
  run: >-
    npx tsx --test
    src/lib/unity-stream-proof/manifest.test.ts
    src/lib/unity-stream-proof/security.test.ts
    src/lib/unity-stream-proof/streamProxy.test.ts
    'src/app/api/dev/unity-stream-proof/[transport]/[...path]/route.test.ts'
```

Every PR into `master` (and every push to `master`) therefore runs the Unity
presentation tests, the B6D3B harness tests, the TypeScript check, the Next
production build, and the realtime build.

## 14. Protected-preview measurement (EXECUTED — COMPLETE AND LOCKED)

> The procedure below was **separately authorized and executed** against the
> protected Vercel **Preview** only. Results are recorded in §14.1–§14.7.
> **Raw = PASS; built-in fetch = FAIL — RANGE.** Production was **untouched**
> throughout. The bearer value and the approved artifact origin are deliberately
> **not** recorded here.

### Procedure (as executed)

1. Use only the **automatic** Vercel preview deployment created from the draft
   harness PR (do not manually trigger a deployment).
2. Configure for **Preview scope only**:
   - `UNITY_STREAM_PROOF_ENABLED=true`
   - `UNITY_STREAM_PROOF_BEARER=<strong random secret>`
   - `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN=<approved artifact origin>`
3. Redeploy only after a separately issued measurement authorization.
4. Never put the bearer in a URL, screenshot, PR comment, or tracked file.
5. Use `curl.exe --raw` (or an equivalent raw-byte client).
6. Test the exact wasm through both the `fetch` and `raw` transports.
7. Capture: HTTP status; response headers; time-to-first-byte; total duration;
   downloaded byte count; downloaded SHA-256; gzip validity; `Content-Type`;
   `Content-Encoding`; `Content-Length` when present; `HEAD`; a bounded `Range`
   request; the unauthorized 404; the disabled 404.
8. Compare exact bytes and SHA-256 against the merged fixture.
9. Inspect sanitized server logs for aggregate diagnostics only.
10. Confirm neither bearer nor origin appears in logs.
11. Remove all three Preview variables after evidence capture.
12. Redeploy or invalidate the preview so the proof route returns 404.

Real secrets and the approved upstream origin are intentionally omitted here.

### 14.1 Measurement scope

- **Surface:** protected Vercel **Preview** only. **Production was untouched**
  (no production variable, deployment, alias, or route change).
- **Branch:** `test/unity-b6d3b-streaming-feasibility`
- **Measured commit:** `91fec3c3f52aeabebf5abd636f7f8453e0f48ec3`
- **Exact pinned artifact:** `Build/b6b-local-fb840878-d.wasm.gz`
- **Expected compressed bytes:** `8,583,356`
- **Expected SHA-256:**
  `cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b`
- The **bearer value is never** recorded here, and the **approved artifact
  origin is not published** in this or any tracked file.

### 14.2 Security-gate evidence

- An **unauthorized request issued before** the measurement returned
  **HTTP 404**, body `Not Found` — identical to every other gate failure.
- Proof access used a **server-only bearer**, supplied as an `Authorization:
  Bearer` header.
- The bearer was **never** placed in a URL, query string, screenshot, or tracked
  file.
- Runtime diagnostics contained **aggregate fields only**.
- **No bearer and no artifact origin appeared** in any inspected log.

### 14.3 Raw `node:http` / `node:https` transport — **PASS**

**Authenticated `HEAD`:**

| Field | Value |
| --- | --- |
| Status | `HTTP 200` |
| `Content-Type` | `application/wasm` |
| `Content-Encoding` | `gzip` |
| `Accept-Ranges` | `bytes` |
| `Cache-Control` | `private, no-store` |
| `Vary` | `Authorization` |
| `X-Vercel-Cache` | `BYPASS` |

**Corrected bounded one-byte `Range` request** (see the client note in §14.5):

| Field | Value |
| --- | --- |
| Status | `HTTP 206` |
| `Content-Range` | `bytes 0-0/8583356` |
| `Content-Length` | `1` |
| `Content-Encoding` | `gzip` |
| Body length | `1` |
| Body hex | `1F` (gzip magic first byte) |

**Full raw download:**

| Field | Value |
| --- | --- |
| Status | `HTTP 200`, client exit `0` |
| Downloaded bytes | `8,583,356` |
| Saved-file bytes | `8,583,356` |
| SHA-256 | `cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b` — **exact match** |
| gzip magic | `1F 8B` |
| gzip validation | `true` |
| `Content-Type` | `application/wasm` |
| `Content-Encoding` | `gzip` |
| `Content-Length` | `8,583,356` |
| `Accept-Ranges` | `bytes` |
| `Cache-Control` | `private, no-store` |
| `Vary` | `Authorization` |
| `X-Vercel-Cache` | `BYPASS` |

**Client-observed timing** (end-to-end over the network, measured at the client):
TTFB ≈ **2.85 s**; total ≈ **24.75 s**.

**Server-function diagnostics** (sanitized, emitted inside the deployed route —
these measure the function's own streaming work, **not** client network time, so
they are legitimately much smaller than the client-observed figures):

```
transport: raw
upstreamStatus: 200
firstChunkMs: 51.161586
totalDurationMs: 236.15623700000003
chunkCount: 544
totalBytes: 8583356
rangeUsed: false
reason: complete
```

The transfer completed in **544 chunks** totalling **8,583,356 bytes** — i.e. the
completed multi-chunk transfer **exceeded the ~4.5 MB non-streaming function-body
limit without any platform body-limit failure**, confirming genuine streaming
rather than buffering.

**Classification: PASS.**

### 14.4 Built-in `fetch` transport — **FAIL — RANGE**

**Authenticated `HEAD` passed:**

| Field | Value |
| --- | --- |
| Status | `HTTP 200` |
| `Content-Type` | `application/wasm` |
| `Content-Encoding` | `gzip` |
| `Accept-Ranges` | `bytes` |
| `Cache-Control` | `private, no-store` |
| `Vary` | `Authorization` |
| `Content-Length` | absent — **as designed** for the fetch gzip path (§10) |
| `X-Vercel-Cache` | `BYPASS` |

**One-byte `Range` response metadata was correct:**

| Field | Value |
| --- | --- |
| Status | `HTTP 206` |
| `Content-Encoding` | `gzip` |
| `Content-Range` | `bytes 0-0/8583356` |
| `Content-Type` | `application/wasm` |
| `Accept-Ranges` | `bytes` |

**Decisive failure — the entity body was empty:**

| Field | Observed | Expected |
| --- | --- | --- |
| Client body bytes | `0` | `1` |
| Body hex | *(empty)* | `1F` |
| Outward `Content-Length` | `0` | `1` |

**Server-function diagnostics confirm the failure occurs inside the deployed
fetch path** (not at the client):

```
transport: fetch
upstreamStatus: 206
firstChunkMs: null
totalDurationMs: 124.22412000000003
chunkCount: 0
totalBytes: 0
rangeUsed: true
reason: complete
```

`chunkCount: 0` / `totalBytes: 0` / `firstChunkMs: null` show the fetch path
produced **no body chunks at all** despite a correct upstream `206`.

The **full fetch download was deliberately not run** after this bounded, decisive
failure — so **fetch full-download byte/SHA-256 identity was never tested** and is
**not** claimed here.

**Classification: FAIL — RANGE.**

This is a failure of **empty `Range` body delivery despite correct `206`
metadata** — it is **not** a failure of the approved upstream artifact: the raw
transport served the **same upstream `Range`** correctly (`1F`) and delivered the
**complete artifact** with an exact SHA-256 match (§14.3).

### 14.5 Measurement-client note (not a transport failure)

A preliminary raw `Range` invocation used the client's `--raw` mode and therefore
saved only the HTTP **chunk-terminator framing** — bytes `30 0D 0A 0D 0A` —
rather than the entity body. Server diagnostics for that same request showed the
raw transport had emitted **exactly one byte**, so the transport was behaving
correctly. The corrected request explicitly advertised `Accept-Encoding: gzip` and
allowed the client to strip transfer framing; it then returned the expected
compressed byte `1F`. **This preliminary result is a measurement-client artifact
and is explicitly NOT classified as a transport failure.**

### 14.6 Post-measurement cleanup

- **Deleted all proof variables:** `UNITY_STREAM_PROOF_ENABLED`,
  `UNITY_STREAM_PROOF_BEARER`, the branch-specific
  `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN`, and the older Preview-wide
  `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN`.
- **Production variables were untouched.**
- **Cleanup Preview redeploy:** deployment `dpl_WL32UpWUoDD2pL4RX3gFikBQNyNb`,
  state **READY**, `target: Preview` (`target = null`), same branch and same
  measured commit.
- **Final disabled-route check:** `HTTP 404`, body `Not Found`.
- The cleanup deployment's runtime log showed the **404 with no
  `unity-stream-proof` transport diagnostic**, confirming the gate stopped the
  request **before any upstream work**.
- **DPAPI bearer backup deleted**; bearer **removed from the PowerShell session**.
- Downloaded measurement evidence remains **preserved locally and untracked**.

### 14.7 Measurement outcome

| Transport | Classification |
| --- | --- |
| raw (`node:http`/`node:https`) | **PASS** |
| built-in `fetch` | **FAIL — RANGE** |

Measurement environment cleanup: **COMPLETE**. The proof route is **disabled
again** and returns 404.

## 15. Evidence acceptance criteria

A transport is **PASS** only when the protected preview proves:

- the 8,583,356-byte wasm download completes,
- no ~4.5 MB non-streaming body failure,
- first byte arrives before total completion,
- downloaded raw bytes equal exactly `8,583,356`,
- downloaded SHA-256 equals
  `cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b`,
- `Content-Type` is `application/wasm`,
- `Content-Encoding` is `gzip` and the output is a valid gzip stream,
- no transparent decompression, no double compression, no truncation,
- `HEAD` behaves correctly,
- `Range` works correctly or is recorded as unsupported by the approved upstream,
- unauthorized and disabled requests return 404,
- production is denied by code and tests,
- no bearer/origin leakage,
- no excessive buffering / memory / platform failure.

**Unit tests alone cannot produce PASS.**

## 16. Failure classifications

Each transport is classified as exactly one of: `PASS`,
`FAIL — BYTE TRANSFORMATION`, `FAIL — HEADER TRANSFORMATION`,
`FAIL — PLATFORM LIMIT`, `FAIL — BUFFERING`, `FAIL — TIMEOUT`, `FAIL — RANGE`,
`FAIL — SECURITY`, `NOT TESTED`.

Current status (protected-preview measurement **executed** — see §14):

| Transport | Status |
| --- | --- |
| fetch | **FAIL — RANGE** (empty `Range` body despite correct `206` metadata; full download deliberately not run) |
| raw | **PASS** (exact 8,583,356 bytes, exact SHA-256, gzip preserved, 544-chunk streamed transfer) |

## 17. Fallback decision

- **If both transports fail:** do not authorize B6D3B PR-1; recommend the bounded
  cookie-aware same-origin reverse-proxy / CDN architecture from the merged
  authorization package; no permanently public artifact URL; no capability query
  string; production remains NO-GO.
- **If only raw passes:** recommend raw Node HTTP/HTTPS streaming for PR-1 and
  prohibit built-in fetch for pre-compressed Unity artifacts.
- **If both pass:** record both as technically eligible; a separate PR-1
  implementation authorization is still required.

### 17.1 Selected outcome — "only raw passes"

The executed measurement (§14) selects the **"only raw passes"** branch:

- **Recommend raw Node `node:http` / `node:https` streaming** for any future
  B6D3B PR-1.
- **Prohibit built-in `fetch`** for pre-compressed Unity WebGL artifacts.

Scope of this recommendation:

- It is a **technical measurement recommendation only**. It authorizes nothing.
- It does **not** claim raw production readiness — only that raw met the §15
  acceptance criteria on a protected preview.
- **B6D3B PR-1 still requires separate explicit authorization.**
- **No final `/unity-arena` route is authorized.**
- **React integration remains unauthorized.**
- **Player-facing Unity remains unauthorized.**
- **Production Unity remains NO-GO.**
- **`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` remains UNCONFIGURED.**

## 18. Cleanup and rollback

The harness is self-contained under `apps/web/src/lib/unity-stream-proof/**`,
`apps/web/src/app/api/dev/unity-stream-proof/**`, and this document. Rollback =
delete those paths (and this PR); nothing else imports them, so removal is
side-effect-free. After any measurement, remove the three Preview env variables
and redeploy/invalidate so the route returns 404.

**Cleanup for the executed measurement is COMPLETE** — all proof variables were
deleted, production variables were untouched, the Preview was redeployed
(`dpl_WL32UpWUoDD2pL4RX3gFikBQNyNb`, READY), and the disabled route returns
`HTTP 404` / `Not Found` with no transport diagnostic. Full detail in §14.6.

## 19. Remaining authorization gates

- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: **COMPLETE AND LOCKED** (§14)
- MEASUREMENT ENVIRONMENT CLEANUP: **COMPLETE** (§14.6)
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- B6D3C / B6D3D REAL-MATCH TESTING: NOT AUTHORIZED
- PLAYER-FACING UNITY: NOT AUTHORIZED
- PRODUCTION UNITY: NO-GO
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`: UNCONFIGURED

## 20. Final status

- B6D3B STREAM-PROOF MANIFEST EVIDENCE: COMPLETE AND LOCKED
- B6D3B STREAMING HARNESS: COMPLETE
- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: COMPLETE AND LOCKED
- RAW NODE TRANSPORT: PASS
- BUILT-IN FETCH TRANSPORT: FAIL — RANGE
- MEASUREMENT ENVIRONMENT CLEANUP: COMPLETE
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- B6D3C: NOT AUTHORIZED
- B6D3D REAL-MATCH TESTING: NOT AUTHORIZED
- PLAYER-FACING UNITY: NOT AUTHORIZED
- PRODUCTION UNITY: NO-GO
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`: UNCONFIGURED
