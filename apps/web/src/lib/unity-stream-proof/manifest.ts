/**
 * B6D3B streaming feasibility harness — MANIFEST MODULE (proof-only).
 *
 * Loads and strictly validates the MERGED, TRACKED per-file evidence fixture
 * (`fixtures/b6b-local-fb840878-d.manifest.json`) and derives the reviewed
 * Content-Type for each of the four pinned artifacts. This module is disposable
 * research infrastructure: it must NEVER be imported by MatchRoomPanel,
 * MatchRenderer3D, UnityPresentationHost, useViewerPresentation, the presentation
 * modules, the realtime server, packages/shared, or any final `/unity-arena`
 * route. It performs no network I/O and reads no artifact body.
 *
 * The fixture deliberately records only source-manifest evidence (path, bytes,
 * sha256, contentEncoding). Content-Type is NOT stored in the fixture; it is
 * derived here from the reviewed, pinned suffix mapping so the fixture stays a
 * pure evidence record.
 */

import rawFixture from "./fixtures/b6b-local-fb840878-d.manifest.json";

export const EXPECTED_RELEASE_ID = "b6b-local-fb840878-d" as const;
export const EXPECTED_MANIFEST_SHA256 =
  "be290569c2f22cc8481a641bbfd720795790ced4e271042f45f367441f6444ae" as const;
export const EXPECTED_SOURCE_FILE_COUNT = 17 as const;
export const EXPECTED_SOURCE_TOTAL_BYTES = 10585492 as const;

export const ARTIFACT_LABELS = ["wasm", "data", "framework", "loader"] as const;
export type ArtifactLabel = (typeof ARTIFACT_LABELS)[number];

export type ContentEncoding = "gzip" | "identity";

/** Reviewed, pinned suffix → Content-Type mapping (B6D3B authorization package). */
export const CONTENT_TYPE_BY_SUFFIX: ReadonlyArray<
  readonly [suffix: string, contentType: string]
> = [
  [".wasm.gz", "application/wasm"],
  [".data.gz", "application/octet-stream"],
  [".framework.js.gz", "application/javascript"],
  [".loader.js", "application/javascript"],
];

const SHA256_RE = /^[0-9a-f]{64}$/;

export interface ArtifactRecord {
  readonly label: ArtifactLabel;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly contentEncoding: ContentEncoding;
  /** Derived, not stored in the fixture. */
  readonly contentType: string;
}

export interface ProofManifest {
  readonly releaseId: string;
  readonly sourceManifest: {
    readonly sha256: string;
    readonly fileCount: number;
    readonly totalBytes: number;
  };
  readonly records: ReadonlyArray<ArtifactRecord>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`unity-stream-proof manifest invalid: ${message}`);
    this.name = "ManifestError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSafePositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/** Derive the reviewed Content-Type from an allowlisted suffix, or throw. */
export function deriveContentType(path: string): string {
  for (const [suffix, contentType] of CONTENT_TYPE_BY_SUFFIX) {
    if (path.endsWith(suffix)) return contentType;
  }
  throw new ManifestError(`unsupported suffix/content-type mapping for "${path}"`);
}

/**
 * Strictly validate an arbitrary parsed manifest object and return the runtime
 * representation. Fails closed (throws ManifestError) on any invariant breach so
 * invalid fixtures can never widen the proof allowlist.
 */
export function parseManifest(raw: unknown): ProofManifest {
  if (!isPlainObject(raw)) throw new ManifestError("root is not an object");

  if (raw.schemaVersion !== 1) throw new ManifestError("unsupported schemaVersion");
  if (raw.releaseId !== EXPECTED_RELEASE_ID)
    throw new ManifestError("unexpected releaseId");

  const src = raw.sourceManifest;
  if (!isPlainObject(src)) throw new ManifestError("sourceManifest missing");
  if (src.sha256 !== EXPECTED_MANIFEST_SHA256)
    throw new ManifestError("source manifest SHA mismatch");
  if (src.fileCount !== EXPECTED_SOURCE_FILE_COUNT)
    throw new ManifestError("source fileCount mismatch");
  if (src.totalBytes !== EXPECTED_SOURCE_TOTAL_BYTES)
    throw new ManifestError("source totalBytes mismatch");

  const files = raw.files;
  if (!Array.isArray(files)) throw new ManifestError("files is not an array");
  if (files.length !== ARTIFACT_LABELS.length)
    throw new ManifestError("files must contain exactly four records");

  const seenLabels = new Set<string>();
  const seenPaths = new Set<string>();
  const records: ArtifactRecord[] = [];

  for (const entry of files) {
    if (!isPlainObject(entry)) throw new ManifestError("file record not an object");
    const { label, path, bytes, sha256, contentEncoding } = entry;

    if (typeof label !== "string" || !ARTIFACT_LABELS.includes(label as ArtifactLabel))
      throw new ManifestError(`invalid label ${JSON.stringify(label)}`);
    if (seenLabels.has(label)) throw new ManifestError(`duplicate label ${label}`);
    seenLabels.add(label);

    if (typeof path !== "string" || path.length === 0)
      throw new ManifestError(`invalid path for ${label}`);
    if (seenPaths.has(path)) throw new ManifestError(`duplicate path ${path}`);
    seenPaths.add(path);

    if (!isSafePositiveInt(bytes))
      throw new ManifestError(`invalid bytes for ${label}`);
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256))
      throw new ManifestError(`invalid sha256 for ${label}`);
    if (contentEncoding !== "gzip" && contentEncoding !== "identity")
      throw new ManifestError(`invalid contentEncoding for ${label}`);

    records.push({
      label: label as ArtifactLabel,
      path,
      bytes,
      sha256,
      contentEncoding,
      contentType: deriveContentType(path),
    });
  }

  for (const required of ARTIFACT_LABELS) {
    if (!seenLabels.has(required))
      throw new ManifestError(`missing required label ${required}`);
  }

  return {
    releaseId: raw.releaseId as string,
    sourceManifest: {
      sha256: src.sha256 as string,
      fileCount: src.fileCount as number,
      totalBytes: src.totalBytes as number,
    },
    records,
  };
}

let cached: ProofManifest | null = null;

/** Load + validate the tracked fixture (cached). Throws on any invariant breach. */
export function loadProofManifest(): ProofManifest {
  if (cached === null) cached = parseManifest(rawFixture as unknown);
  return cached;
}

/**
 * Resolve a candidate relative path to exactly one fixture record, or null.
 * Case-sensitive, exact-match only. No arbitrary path lookup.
 */
export function resolveRecordByPath(
  candidatePath: string,
  manifest: ProofManifest = loadProofManifest(),
): ArtifactRecord | null {
  for (const r of manifest.records) {
    if (r.path === candidatePath) return r;
  }
  return null;
}
