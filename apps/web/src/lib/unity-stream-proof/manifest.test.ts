/**
 * B6D3B streaming feasibility harness — manifest tests.
 * Runs on Node `node:test` via `tsx`. No network, no artifact body.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  loadProofManifest,
  parseManifest,
  deriveContentType,
  resolveRecordByPath,
  ManifestError,
  ARTIFACT_LABELS,
  EXPECTED_RELEASE_ID,
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_SOURCE_FILE_COUNT,
  EXPECTED_SOURCE_TOTAL_BYTES,
} from "./manifest";

function validRaw() {
  return {
    schemaVersion: 1,
    releaseId: EXPECTED_RELEASE_ID,
    sourceManifest: {
      sha256: EXPECTED_MANIFEST_SHA256,
      fileCount: EXPECTED_SOURCE_FILE_COUNT,
      totalBytes: EXPECTED_SOURCE_TOTAL_BYTES,
    },
    files: [
      { label: "wasm", path: "Build/b6b-local-fb840878-d.wasm.gz", bytes: 8583356, sha256: "cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b", contentEncoding: "gzip" },
      { label: "data", path: "Build/b6b-local-fb840878-d.data.gz", bytes: 1866605, sha256: "b1f91a0117c62de5ef3734d0a2c757e078ce607778f09deccbe664a3e5368339", contentEncoding: "gzip" },
      { label: "framework", path: "Build/b6b-local-fb840878-d.framework.js.gz", bytes: 88984, sha256: "d757c33a4c0be14e18adbfb3078f8ef19baed6091f360f2c07133f99155e1eee", contentEncoding: "gzip" },
      { label: "loader", path: "Build/b6b-local-fb840878-d.loader.js", bytes: 26982, sha256: "de61c3bc8500cb8ff080d6a0791cc7cf53f2128368d94a5dd9dadbf0291dc71d", contentEncoding: "identity" },
    ],
  };
}

test("tracked fixture loads with expected release + source metadata", () => {
  const m = loadProofManifest();
  assert.equal(m.releaseId, EXPECTED_RELEASE_ID);
  assert.equal(m.sourceManifest.sha256, EXPECTED_MANIFEST_SHA256);
  assert.equal(m.sourceManifest.fileCount, EXPECTED_SOURCE_FILE_COUNT);
  assert.equal(m.sourceManifest.totalBytes, EXPECTED_SOURCE_TOTAL_BYTES);
});

test("tracked fixture has exactly four records with correct labels", () => {
  const m = loadProofManifest();
  assert.equal(m.records.length, 4);
  assert.deepEqual(
    m.records.map((r) => r.label).sort(),
    [...ARTIFACT_LABELS].sort(),
  );
});

test("tracked fixture: exact paths, sizes, hashes, encodings", () => {
  const m = loadProofManifest();
  const byLabel = Object.fromEntries(m.records.map((r) => [r.label, r]));

  assert.equal(byLabel.wasm.path, "Build/b6b-local-fb840878-d.wasm.gz");
  assert.equal(byLabel.wasm.bytes, 8583356);
  assert.equal(byLabel.wasm.sha256, "cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b");
  assert.equal(byLabel.wasm.contentEncoding, "gzip");

  assert.equal(byLabel.data.bytes, 1866605);
  assert.equal(byLabel.data.contentEncoding, "gzip");

  assert.equal(byLabel.framework.bytes, 88984);
  assert.equal(byLabel.framework.contentEncoding, "gzip");

  assert.equal(byLabel.loader.path, "Build/b6b-local-fb840878-d.loader.js");
  assert.equal(byLabel.loader.bytes, 26982);
  assert.equal(byLabel.loader.contentEncoding, "identity");
});

test("derived MIME mapping matches reviewed suffix table", () => {
  const m = loadProofManifest();
  const byLabel = Object.fromEntries(m.records.map((r) => [r.label, r]));
  assert.equal(byLabel.wasm.contentType, "application/wasm");
  assert.equal(byLabel.data.contentType, "application/octet-stream");
  assert.equal(byLabel.framework.contentType, "application/javascript");
  assert.equal(byLabel.loader.contentType, "application/javascript");
});

test("deriveContentType throws on unknown suffix", () => {
  assert.throws(() => deriveContentType("Build/whatever.bin"), ManifestError);
});

test("resolveRecordByPath is exact-match only", () => {
  const wasm = resolveRecordByPath("Build/b6b-local-fb840878-d.wasm.gz");
  assert.equal(wasm?.label, "wasm");
  assert.equal(resolveRecordByPath("Build/does-not-exist.gz"), null);
  assert.equal(resolveRecordByPath("build/b6b-local-fb840878-d.wasm.gz"), null); // case
});

test("parseManifest accepts a well-formed manifest", () => {
  const m = parseManifest(validRaw());
  assert.equal(m.records.length, 4);
});

test("parseManifest fails closed on invalid variants", () => {
  const mutations: Array<(r: ReturnType<typeof validRaw>) => unknown> = [
    (r) => ({ ...r, schemaVersion: 2 }),
    (r) => ({ ...r, releaseId: "other" }),
    (r) => ({ ...r, sourceManifest: { ...r.sourceManifest, sha256: "0".repeat(64) } }),
    (r) => ({ ...r, sourceManifest: { ...r.sourceManifest, fileCount: 16 } }),
    (r) => ({ ...r, sourceManifest: { ...r.sourceManifest, totalBytes: 1 } }),
    (r) => ({ ...r, files: r.files.slice(0, 3) }), // missing required label
    (r) => ({ ...r, files: [...r.files, r.files[0]] }), // duplicate label + path
    (r) => { const c = validRaw(); c.files[1].path = c.files[0].path; return c; }, // duplicate path
    (r) => { const c = validRaw(); (c.files[0] as { bytes: number }).bytes = -1; return c; },
    (r) => { const c = validRaw(); (c.files[0] as { sha256: string }).sha256 = "xyz"; return c; },
    (r) => { const c = validRaw(); (c.files[0] as { contentEncoding: string }).contentEncoding = "br"; return c; },
    (r) => { const c = validRaw(); (c.files[0] as { path: string }).path = "Build/bad.bin.gz"; return c; }, // unsupported suffix
    () => null,
    () => ({}),
    () => ({ ...validRaw(), files: "nope" }),
  ];
  for (const mutate of mutations) {
    assert.throws(() => parseManifest(mutate(validRaw())), ManifestError);
  }
});
