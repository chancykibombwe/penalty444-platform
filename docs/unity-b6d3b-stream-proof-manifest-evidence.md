# B6D3B — STREAM-PROOF MANIFEST EVIDENCE (PROVENANCE)

> **Status: AUTHENTICATED EVIDENCE PROMOTION ONLY.** This PR promotes four
> manifest metadata records for the pinned Unity WebGL release
> `b6b-local-fb840878-d` into a small tracked fixture, authenticated against a
> manifest SHA-256 already recorded in tracked documentation. It creates **no**
> streaming harness, **no** route, **no** runtime/test code, **no** package or
> lockfile change, and configures **no** environment or deployment. It reads **no**
> WebGL artifact body.

---

## 1. Purpose and authorization status

The separately-authorized B6D3B streaming feasibility harness requires an exact,
tracked, verifiable reference for the Unity WebGL artifacts it will later stream —
specifically the wasm/data/framework/loader **relative path, compressed byte count,
SHA-256, and content encoding** — so that a future protected-preview measurement can
prove the streamed bytes are byte-identical to the source (no decompression, no
re-encoding, no truncation).

That per-file evidence did **not** exist in the tracked repository (only a manifest
*self-checksum* was recorded). This task promotes exactly the four required records
into a tracked fixture, under a narrow read-only override, authenticated against the
tracked manifest SHA-256.

- **B6D3B STREAM-PROOF MANIFEST EVIDENCE:** this task — AUTHORIZED, evidence-only.
- **B6D3B STREAMING HARNESS:** remains **NOT AUTHORIZED** until this PR is reviewed
  and merged.
- **B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT:** **NOT AUTHORIZED.**
- **PRODUCTION UNITY:** **NO-GO.**

---

## 2. Exact baseline SHA

- **Repository:** `chancykibombwe/penalty444-platform`; protected branch `master`.
- **`origin/master`:** `850ed624441c373ed49f5820513fc5f3df4bc78f`.
- **Branch:** `docs/unity-b6d3b-stream-proof-manifest-evidence`, created from the
  exact `origin/master` above in a separate clean worktree; confirmed clean before
  writing.

---

## 3. Why the streaming harness previously stopped

The streaming-harness task correctly halted at its explicit stop-condition: the
exact wasm relative path and per-file SHA-256 could not be established from **tracked**
repository evidence. `git grep` over the committed tree found:

- **no** per-file artifact content SHA-256 (wasm/data/framework/loader) in any
  tracked file;
- **no** tracked JSON manifest fixture with per-file hashes under `apps/web/**`;
- only **manifest-file self-checksums** in tracked docs (hashes of the whole
  `manifest.json`, not of the artifact bytes).

The matching per-file records existed only under the main checkout's **untracked**
`audit-artifacts/unity-staging/**/manifest.json`, which the harness task was not
authorized to inspect. This evidence-promotion task provides the narrow override.

---

## 4. Narrow read-only source authorization

Authorized for this task, and nothing more:

1. Filename-only search for `manifest.json` under the bounded namespace
   `audit-artifacts/unity-staging/**/manifest.json`.
2. Compute SHA-256 of those `manifest.json` files (byte-preserving
   `Get-FileHash -Algorithm SHA256`).
3. Read and parse **only** the single manifest whose SHA-256 exactly matches the
   tracked expected manifest SHA for release `b6b-local-fb840878-d`.
4. Extract **only** the four required file records (wasm, data, framework, loader)
   plus minimal manifest metadata.

Explicitly **not** authorized (and not done): reading/hashing any artifact body;
opening arbitrary audit-artifact files; copying the full untracked manifest into the
repository; modifying/moving/staging/committing anything from `audit-artifacts`;
touching Unity untracked files or `ProjectSettings`; creating the harness;
configuring or deploying anything.

---

## 5. Tracked manifest checksum evidence

The expected manifest SHA-256 for the pinned release is recorded in tracked
documentation:

- `docs/unity-b6c-versioned-staging-delivery.md` §14.3 — release
  **`b6b-local-fb840878-d`**, source commit
  `fb840878d94de7275f6ffb4818e2d59b38cc1fca`, Unity 6000.4.2f1, **17 files**,
  **manifest SHA-256 `be290569c2f22cc8481a641bbfd720795790ced4e271042f45f367441f6444ae`**.

This 64-character hex value is unambiguous and is bound specifically to release
`b6b-local-fb840878-d`. (A different release, `b6d2b-5226d3c1-a`, is recorded in
`docs/unity-b6d2b-unity-consumption-runtime.md` with a different manifest SHA and
total; it is **not** the pinned release for this fixture and was not used.)

---

## 6. Manifest authentication procedure

1. Read the full expected SHA-256 from the tracked doc (§5).
2. Enumerate candidate `manifest.json` files (filename-only) under
   `audit-artifacts/unity-staging/`.
3. Compute each candidate's SHA-256 with `Get-FileHash -Algorithm SHA256`.
4. Match against the tracked expected SHA.

**Observed candidates (5 archival snapshots, all byte-identical):**

| Snapshot dir (release `b6b-local-fb840878-d`) | manifest.json SHA-256 |
|---|---|
| `…-20260715T061607Z` | `be290569…f6444ae` |
| `…-20260715T061655Z` | `be290569…f6444ae` |
| `…-20260715T161631Z` | `be290569…f6444ae` |
| `…-20260715T161814Z` | `be290569…f6444ae` |
| `…-20260716T103609Z` | `be290569…f6444ae` |

All five are **bit-identical** (one unique SHA-256), and that unique value equals
the tracked expected SHA. They are five archival snapshots of the **same** release
build, i.e. a single unique authenticated manifest content — not multiple *distinct*
manifests. There is therefore no ambiguity about which manifest content is
authenticated. The authenticated manifest was read from the
`…-20260716T103609Z` snapshot; any snapshot yields identical records.

---

## 7. Authenticated release identity

From the authenticated manifest (cross-checked against tracked docs):

- `schemaVersion`: **1**
- `releaseVersion`: **`b6b-local-fb840878-d`**
- `buildTarget`: WebGL; `unityVersion`: 6000.4.2f1
- `sourceCommit`: `fb840878d94de7275f6ffb4818e2d59b38cc1fca`
- `compressionMode`: gzip
- `totalArtifactBytes`: **10,585,492** (matches tracked docs)
- `fileCount`: **17** (files array length = 17)
- exactly one each of `*.wasm.gz`, `*.data.gz`, `*.framework.js.gz`, `*.loader.js`
- **Sum of all 17 per-file `bytes` = 10,585,492**, equal to `totalArtifactBytes`.

All cross-checks PASS. No value from any prompt was substituted where tracked
evidence or the authenticated manifest was authoritative.

---

## 8. Extracted tracked fixture

Promoted to `apps/web/src/lib/unity-stream-proof/fixtures/b6b-local-fb840878-d.manifest.json`
(records ordered wasm, data, framework, loader):

| label | path | bytes | sha256 | contentEncoding |
|---|---|---:|---|---|
| wasm | `Build/b6b-local-fb840878-d.wasm.gz` | 8,583,356 | `cff67683…d47d409b` | gzip |
| data | `Build/b6b-local-fb840878-d.data.gz` | 1,866,605 | `b1f91a01…e5368339` | gzip |
| framework | `Build/b6b-local-fb840878-d.framework.js.gz` | 88,984 | `d757c33a…155e1eee` | gzip |
| loader | `Build/b6b-local-fb840878-d.loader.js` | 26,982 | `de61c3bc…291dc71d` | identity |

The fixture also records `sourceManifest.sha256`, `sourceManifest.fileCount` (17)
and `sourceManifest.totalBytes` (10,585,492). No `Content-Type` is included because
the source manifest records none. No upstream origin, local filesystem path,
timestamp, machine name, user information, TemplateData record, or artifact body is
included.

---

## 9. Validation results

Fixture validated without reading any artifact body:

- JSON parses successfully.
- `schemaVersion` = 1; `releaseId` = `b6b-local-fb840878-d`.
- `sourceManifest.sha256` equals the tracked expected SHA (§5).
- `sourceManifest.fileCount` = 17; `sourceManifest.totalBytes` = 10,585,492.
- exactly four records; labels exactly wasm/data/framework/loader.
- all four `path` values unique; all four labels unique.
- every `sha256` is exactly 64 lowercase hexadecimal characters.
- every `bytes` is a positive safe integer.
- gzip records (wasm/data/framework) carry `contentEncoding: "gzip"`; loader carries
  the source value `"identity"`.
- no local absolute path, no upstream origin, no bearer/token/session/user data.

---

## 10. Security and privacy constraints

- No WebGL artifact body was read, copied, hashed, staged, or committed.
- Only `manifest.json` files were hashed (for authentication) and exactly one was
  parsed (the authenticated match).
- The tracked fixture and this document contain no absolute Windows paths, no
  usernames, no machine identifiers, no upstream origin, and no secrets.
- The bounded source namespace is identified only as
  `audit-artifacts/unity-staging/**/manifest.json`.

---

## 11. Limitations

- This fixture is **integrity evidence** for byte-identity comparisons in the future
  streaming harness (compare streamed length + SHA-256 against these records).
- It does **not** prove deterministic Unity artifact reproducibility from source;
  **B6D3E reproducibility remains separately BLOCKED**.
- It authenticates the manifest's recorded per-file hashes against a tracked
  manifest self-checksum; it does not re-derive the artifacts.

---

## 12. Next authorization gate

- The B6D3B streaming feasibility harness remains **NOT AUTHORIZED** until this
  evidence PR is reviewed and merged.
- After merge, the harness may consume this tracked fixture as its allowlist and
  expected-hash source.
- Protected-preview streaming measurement, B6D3B PR-1 (security/delivery), PR-2
  (React integration), B6D3C, and B6D3D remain **NOT AUTHORIZED**.

---

## 13. Final status

```
B6D3B STREAM-PROOF MANIFEST EVIDENCE: COMPLETE / IN REVIEW
B6D3B STREAMING HARNESS: BLOCKED UNTIL EVIDENCE PR MERGES
B6D3B PROTECTED-PREVIEW STREAMING MEASUREMENT: NOT AUTHORIZED
B6D3B SECURITY/DELIVERY PR-1: NOT AUTHORIZED
B6D3B REACT INTEGRATION PR-2: NOT AUTHORIZED
B6D3C: NOT AUTHORIZED
B6D3D REAL-MATCH TESTING: NOT AUTHORIZED
PLAYER-FACING UNITY: NOT AUTHORIZED
PRODUCTION UNITY: NO-GO
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: UNCONFIGURED
```

No artifact body was read, copied, hashed, or committed. No prohibited file was
changed. `unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` and all
untracked directories remain untouched. No environment was configured; no
deployment, Unity run, or real match occurred.
