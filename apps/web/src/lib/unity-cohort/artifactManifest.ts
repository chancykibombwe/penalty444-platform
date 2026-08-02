/**
 * B6D3B PR-1 — FINAL pinned artifact manifest (server-only, pure).
 *
 * Production-scoped allowlist for the protected `/unity-arena/artifact/**` route.
 * This module is deliberately independent of the disposable proof harness: it does
 * NOT import `apps/web/src/lib/unity-stream-proof/**`. The byte counts, SHA-256
 * digests and encodings below were transcribed from the tracked, CI-verified
 * evidence fixture (`unity-stream-proof/fixtures/b6b-local-fb840878-d.manifest.json`,
 * source-manifest SHA-256 `be290569c2f22cc8481a641bbfd720795790ced4e271042f45f367441f6444ae`,
 * independently HTTP-verified in B6C §14.3 and streamed byte-exactly in the B6D3B
 * protected-preview measurement).
 *
 * Only the FOUR core build files needed by the minimal trusted entry HTML are
 * allowlisted. `index.html` and `TemplateData/**` are deliberately NOT served.
 *
 * The upstream path is derived internally from the compile-time-pinned release id
 * plus the record's own release-relative path; it is NEVER request-controlled.
 */

export const ARTIFACT_RELEASE_ID = "b6b-local-fb840878-d" as const;

export const ARTIFACT_LABELS = ["loader", "framework", "data", "wasm"] as const;
export type ArtifactLabel = (typeof ARTIFACT_LABELS)[number];

export type ArtifactContentEncoding = "gzip" | "identity";

export interface ArtifactRecord {
  readonly label: ArtifactLabel;
  /** Release-relative path, e.g. `Build/<release>.wasm.gz`. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly contentEncoding: ArtifactContentEncoding;
  readonly contentType: string;
}

/** Reviewed, pinned suffix → Content-Type mapping. */
export const CONTENT_TYPE_BY_SUFFIX: ReadonlyArray<readonly [suffix: string, contentType: string]> = [
  [".wasm.gz", "application/wasm"],
  [".data.gz", "application/octet-stream"],
  [".framework.js.gz", "application/javascript"],
  [".loader.js", "application/javascript"],
];

const SHA256_RE = /^[0-9a-f]{64}$/;

/** The exact four allowlisted core artifacts. Frozen; no runtime mutation. */
export const ARTIFACT_RECORDS: ReadonlyArray<ArtifactRecord> = Object.freeze([
  Object.freeze({
    label: "loader" as const,
    path: "Build/b6b-local-fb840878-d.loader.js",
    bytes: 26982,
    sha256: "de61c3bc8500cb8ff080d6a0791cc7cf53f2128368d94a5dd9dadbf0291dc71d",
    contentEncoding: "identity" as const,
    contentType: "application/javascript",
  }),
  Object.freeze({
    label: "framework" as const,
    path: "Build/b6b-local-fb840878-d.framework.js.gz",
    bytes: 88984,
    sha256: "d757c33a4c0be14e18adbfb3078f8ef19baed6091f360f2c07133f99155e1eee",
    contentEncoding: "gzip" as const,
    contentType: "application/javascript",
  }),
  Object.freeze({
    label: "data" as const,
    path: "Build/b6b-local-fb840878-d.data.gz",
    bytes: 1866605,
    sha256: "b1f91a0117c62de5ef3734d0a2c757e078ce607778f09deccbe664a3e5368339",
    contentEncoding: "gzip" as const,
    contentType: "application/octet-stream",
  }),
  Object.freeze({
    label: "wasm" as const,
    path: "Build/b6b-local-fb840878-d.wasm.gz",
    bytes: 8583356,
    sha256: "cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b",
    contentEncoding: "gzip" as const,
    contentType: "application/wasm",
  }),
]);

/** Largest pinned artifact — used as the hard streaming ceiling. */
export const MAX_ARTIFACT_BYTES = ARTIFACT_RECORDS.reduce((m, r) => (r.bytes > m ? r.bytes : m), 0);

export class ArtifactManifestError extends Error {
  constructor(message: string) {
    super(`unity-cohort artifact manifest invalid: ${message}`);
    this.name = "ArtifactManifestError";
  }
}

/** Derive the reviewed Content-Type from an allowlisted suffix, or throw. */
export function deriveContentType(path: string): string {
  for (const [suffix, contentType] of CONTENT_TYPE_BY_SUFFIX) {
    if (path.endsWith(suffix)) return contentType;
  }
  throw new ArtifactManifestError(`unsupported suffix/content-type mapping for "${path}"`);
}

/**
 * Self-check the pinned table: exactly four records, unique labels and paths,
 * positive integer byte counts, well-formed lowercase SHA-256, valid encoding, and
 * a Content-Type that matches the reviewed suffix mapping. Throws on any breach so
 * an invalid table can never widen the allowlist.
 */
export function assertManifestIntegrity(
  records: ReadonlyArray<ArtifactRecord> = ARTIFACT_RECORDS,
): void {
  if (records.length !== ARTIFACT_LABELS.length) {
    throw new ArtifactManifestError("must contain exactly four records");
  }
  const seenLabels = new Set<string>();
  const seenPaths = new Set<string>();
  for (const r of records) {
    if (!ARTIFACT_LABELS.includes(r.label)) {
      throw new ArtifactManifestError(`invalid label ${JSON.stringify(r.label)}`);
    }
    if (seenLabels.has(r.label)) throw new ArtifactManifestError(`duplicate label ${r.label}`);
    seenLabels.add(r.label);

    if (typeof r.path !== "string" || r.path.length === 0) {
      throw new ArtifactManifestError(`invalid path for ${r.label}`);
    }
    if (seenPaths.has(r.path)) throw new ArtifactManifestError(`duplicate path ${r.path}`);
    seenPaths.add(r.path);

    if (!Number.isSafeInteger(r.bytes) || r.bytes <= 0) {
      throw new ArtifactManifestError(`invalid bytes for ${r.label}`);
    }
    if (typeof r.sha256 !== "string" || !SHA256_RE.test(r.sha256)) {
      throw new ArtifactManifestError(`invalid sha256 for ${r.label}`);
    }
    if (r.contentEncoding !== "gzip" && r.contentEncoding !== "identity") {
      throw new ArtifactManifestError(`invalid contentEncoding for ${r.label}`);
    }
    if (deriveContentType(r.path) !== r.contentType) {
      throw new ArtifactManifestError(`content-type mismatch for ${r.label}`);
    }
  }
  for (const required of ARTIFACT_LABELS) {
    if (!seenLabels.has(required)) {
      throw new ArtifactManifestError(`missing required label ${required}`);
    }
  }
}

// ── Path security ─────────────────────────────────────────────────────────────

/**
 * A single route segment is safe only if it is a non-empty string of the
 * conservative charset used by the pinned Unity artifact names. This rejects `.`,
 * `..`, forward and back slashes, colons (scheme / drive letter), percent signs
 * (single AND double encoding), null bytes, whitespace and control characters.
 * Exact manifest matching below is the real gate; this is defence in depth.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function isSafePathSegment(seg: unknown): seg is string {
  if (typeof seg !== "string") return false;
  if (seg.length === 0) return false;
  if (seg === "." || seg === "..") return false;
  return SAFE_SEGMENT_RE.test(seg);
}

/**
 * Resolve dynamic `[...path]` segments (already percent-decoded once by Next) to
 * exactly one allowlisted record, or null. Case-sensitive, exact match only; no
 * arbitrary lookup. Raw request text is NEVER passed to `new URL()` before this
 * resolution succeeds.
 */
export function resolveArtifactRecord(
  segments: readonly unknown[],
  records: ReadonlyArray<ArtifactRecord> = ARTIFACT_RECORDS,
): ArtifactRecord | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  for (const seg of segments) {
    if (!isSafePathSegment(seg)) return null;
  }
  const candidate = (segments as string[]).join("/");
  for (const r of records) {
    if (r.path === candidate) return r;
  }
  return null;
}

/**
 * Derive the upstream deployment path. The B6C artifact deployment hosts each
 * immutable release under `/releases/<release>/…`, so the path is exactly
 * `releases/<pinned release id>/<record path>`. Uses ONLY the compile-time release
 * id and the already-validated record — never request input.
 */
export function buildUpstreamArtifactPath(record: ArtifactRecord): string {
  return `releases/${ARTIFACT_RELEASE_ID}/${record.path}`;
}

/**
 * Deterministic strong ETag derived from the PINNED SHA-256 (never forwarded from
 * upstream, so no upstream identifier can leak through it).
 */
export function artifactETag(record: ArtifactRecord): string {
  return `"sha256-${record.sha256}"`;
}
