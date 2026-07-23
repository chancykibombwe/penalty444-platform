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

Authorization status when this harness was built:

- B6D3A IMPLEMENTATION: COMPLETE AND LOCKED
- B6D3B PLANNING REVIEW: COMPLETE AND LOCKED
- B6D3B AUTHORIZATION PACKAGE: COMPLETE AND LOCKED
- B6D3B STREAM-PROOF MANIFEST EVIDENCE: COMPLETE AND LOCKED
- **B6D3B STREAMING HARNESS: AUTHORIZED** (this document)
- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: **NOT AUTHORIZED**
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- PLAYER-FACING UNITY / PRODUCTION UNITY: NOT AUTHORIZED / NO-GO

This task **creates** the harness, its tests, and this procedure. It **does not
execute** any protected-preview measurement, configure any environment variable,
or trigger any deployment.

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
  security.ts        constant-time bearer compare; env gate; origin validation;
                     path allowlisting; ordered evaluateGate()
  streamProxy.ts     fetchTransport() + rawTransport(); non-buffering instrumented
                     ReadableStream; sanitized response headers; diagnostics

apps/web/src/app/api/dev/unity-stream-proof/[transport]/[...path]/route.ts
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  GET + HEAD → evaluateGate → runTransport → sanitized Response | opaque 404
```

The route composes the pure modules. All gating collapses to a single
indistinguishable 404. The transports perform the only outbound request and never
buffer the whole body.

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
only upstream URL constructed is `validated origin + fixture record path`.

`UNITY_STREAM_PROOF_ARTIFACT_ORIGIN` must parse as an absolute URL, be `https:`
(preview) — `http:` is permitted **only** for loopback hosts as local test
injection — contain no username/password, no query, no fragment, and normalize to
a bare origin. It is never returned from request input, never logged, never
echoed. Redirects to another origin are rejected.

## 8. Built-in fetch transport

`fetchTransport` uses the platform `fetch()` (Undici) with `redirect: "manual"`,
rejecting every 3xx / opaque redirect. It forwards `Range` when supplied,
propagates client abort, applies a bounded `AbortController` timeout, and returns
a streamed body. It never calls `arrayBuffer()`, `blob()`, `text()`, or `json()`.

Because Undici may transparently decompress a gzip response and drop
`Content-Encoding`, this transport **fails closed** for a gzip artifact whenever
the upstream response no longer advertises `content-encoding: gzip` (a detectable
byte/header transformation). It does **not** fabricate `Content-Length` when the
declared length is not verifiably equal to the pinned compressed byte count.
**Fetch mode cannot be marked PASS from unit tests** — only a protected-preview
measurement can prove deployed compressed length, SHA-256, gzip validity, and
headers.

## 9. Raw Node HTTP/HTTPS transport

`rawTransport` uses built-in `node:http` / `node:https` / `node:stream` only (no
dependency, no zlib/gunzip/Brotli). It selects the protocol from the validated
origin, rejects redirects, preserves the raw compressed bytes, forwards `Range`,
preserves `200` / `206` / `416`, supports `HEAD` without a body, and converts the
`IncomingMessage` to a Web stream via `Readable.toWeb()` (no chunk concatenation,
no whole-body retention). It applies bounded connect/header/body timeout handling
and destroys the upstream request on client abort or timeout.

## 10. Response-header contract

Successful authorized responses set:

- `Cache-Control: private, no-store`
- `Vary: Authorization`
- `X-Content-Type-Options: nosniff`
- `Content-Type` from the reviewed suffix mapping
- `Content-Encoding` from the fixture/upstream consistency check
- `Content-Length` only when verified accurate for the returned compressed bytes
- `Accept-Ranges`; `Content-Range` and `206`/`416` where applicable
- no `Set-Cookie`, no public caching, no `s-maxage`

Stripped from upstream: `Server`, `Via`, `X-Powered-By`, `Location`,
`Set-Cookie`, upstream cache directives (`Cache-Control`/`Age`/`Expires`/
`CDN-Cache-Control`), and host/origin-identifying headers (e.g. `X-Vercel-*`,
`CF-Ray`), plus unknown headers. `404` denials carry no detail, no origin, no
secret, no fixture information, and no cacheable protected body.

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
  `Content-Encoding` + `application/wasm` preserved, delayed multi-chunk stays
  streamed with first chunk before completion, redirect rejected, timeout, HEAD,
  Range + `206`/`Content-Range`, `416`, pre-aborted + mid-stream client abort
  (destroys upstream), unsafe headers stripped; fetch: identity streams,
  detectable gzip decompression fails closed, redirect rejected, Range, abort,
  timeout, HEAD.
- **route.test.ts** — production/opaque 404s are byte-identical across every gate
  failure; raw wasm happy path with sanitized headers; HEAD; boundary regression
  (harness sources import no match/presentation/realtime/shared/unity-arena/
  socket.io/supabase module).

## 13. Local validation results

Run in the clean worktree; no package/lockfile modification resulted.

| Check | Command | Result |
| --- | --- | --- |
| Harness tests | `npx tsx --test <harness files>` | **42 pass / 0 fail** |
| Presentation contract tests | `npm run test:unity-presentation` | **226 pass / 0 fail** |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **pass** |
| Next production build | `npm run build` | **pass** — route emitted as `ƒ /api/dev/unity-stream-proof/[transport]/[...path]` |
| Realtime build | `npm run build` (apps/realtime-server) | **pass** |
| `git diff --check` | — | clean |

> The build requires the same placeholder public Supabase env used by CI
> (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) for the
> pre-existing `/leaderboard` Server Component; this is unrelated to the harness.

## 14. Protected-preview measurement procedure (DOCUMENT ONLY — NOT EXECUTED)

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

Current status (no preview measurement executed):

| Transport | Status |
| --- | --- |
| fetch | NOT TESTED (deployed) |
| raw | NOT TESTED (deployed) |

## 17. Fallback decision

- **If both transports fail:** do not authorize B6D3B PR-1; recommend the bounded
  cookie-aware same-origin reverse-proxy / CDN architecture from the merged
  authorization package; no permanently public artifact URL; no capability query
  string; production remains NO-GO.
- **If only raw passes:** recommend raw Node HTTP/HTTPS streaming for PR-1 and
  prohibit built-in fetch for pre-compressed Unity artifacts.
- **If both pass:** record both as technically eligible; a separate PR-1
  implementation authorization is still required.

## 18. Cleanup and rollback

The harness is self-contained under `apps/web/src/lib/unity-stream-proof/**`,
`apps/web/src/app/api/dev/unity-stream-proof/**`, and this document. Rollback =
delete those paths (and this PR); nothing else imports them, so removal is
side-effect-free. After any measurement, remove the three Preview env variables
and redeploy/invalidate so the route returns 404.

## 19. Remaining authorization gates

- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: NOT AUTHORIZED
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- B6D3C / B6D3D REAL-MATCH TESTING: NOT AUTHORIZED
- PLAYER-FACING UNITY: NOT AUTHORIZED
- PRODUCTION UNITY: NO-GO
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`: UNCONFIGURED

## 20. Final status

- B6D3B STREAM-PROOF MANIFEST EVIDENCE: COMPLETE AND LOCKED
- B6D3B STREAMING HARNESS: COMPLETE / IN REVIEW
- B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: NOT AUTHORIZED
- B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
- B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
- B6D3C: NOT AUTHORIZED
- B6D3D REAL-MATCH TESTING: NOT AUTHORIZED
- PLAYER-FACING UNITY: NOT AUTHORIZED
- PRODUCTION UNITY: NO-GO
- `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`: UNCONFIGURED
