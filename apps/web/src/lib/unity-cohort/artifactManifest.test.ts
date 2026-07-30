/**
 * B6D3B PR-1 — pinned artifact manifest + path-security tests.
 * Node `node:test` via `tsx`. Pure; no network.
 *
 * The pinned values are cross-checked here against the tracked, CI-verified
 * evidence fixture so the final runtime table can never silently drift. The
 * fixture is read as DATA in this test only (via JSON), and the runtime module
 * never imports the proof-only manifest module.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_LABELS,
  ARTIFACT_RECORDS,
  ARTIFACT_RELEASE_ID,
  ArtifactManifestError,
  artifactETag,
  assertManifestIntegrity,
  buildUpstreamArtifactPath,
  deriveContentType,
  isSafePathSegment,
  MAX_ARTIFACT_BYTES,
  resolveArtifactRecord,
  type ArtifactRecord,
} from "./artifactManifest";

const FIXTURE_PATH = fileURLToPath(
  new URL("../unity-stream-proof/fixtures/b6b-local-fb840878-d.manifest.json", import.meta.url),
);

function byLabel(label: string): ArtifactRecord {
  const r = ARTIFACT_RECORDS.find((x) => x.label === label);
  assert.ok(r, `missing pinned record ${label}`);
  return r;
}

// ── pinned table ──────────────────────────────────────────────────────────────

test("exactly four records with the pinned release id", () => {
  assert.equal(ARTIFACT_RECORDS.length, 4);
  assert.equal(ARTIFACT_RELEASE_ID, "b6b-local-fb840878-d");
  assert.deepStrictEqual(
    ARTIFACT_RECORDS.map((r) => r.label).sort(),
    [...ARTIFACT_LABELS].sort(),
  );
});

test("exact bytes, full SHA-256, encodings and content types", () => {
  assert.deepStrictEqual(byLabel("loader"), {
    label: "loader",
    path: "Build/b6b-local-fb840878-d.loader.js",
    bytes: 26982,
    sha256: "de61c3bc8500cb8ff080d6a0791cc7cf53f2128368d94a5dd9dadbf0291dc71d",
    contentEncoding: "identity",
    contentType: "application/javascript",
  });
  assert.deepStrictEqual(byLabel("framework"), {
    label: "framework",
    path: "Build/b6b-local-fb840878-d.framework.js.gz",
    bytes: 88984,
    sha256: "d757c33a4c0be14e18adbfb3078f8ef19baed6091f360f2c07133f99155e1eee",
    contentEncoding: "gzip",
    contentType: "application/javascript",
  });
  assert.deepStrictEqual(byLabel("data"), {
    label: "data",
    path: "Build/b6b-local-fb840878-d.data.gz",
    bytes: 1866605,
    sha256: "b1f91a0117c62de5ef3734d0a2c757e078ce607778f09deccbe664a3e5368339",
    contentEncoding: "gzip",
    contentType: "application/octet-stream",
  });
  assert.deepStrictEqual(byLabel("wasm"), {
    label: "wasm",
    path: "Build/b6b-local-fb840878-d.wasm.gz",
    bytes: 8583356,
    sha256: "cff67683b8a9ee3850c19a96b70109deb817827e7d709227a0d45820d47d409b",
    contentEncoding: "gzip",
    contentType: "application/wasm",
  });
});

test("pinned values match the tracked CI-verified evidence fixture exactly", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    releaseId: string;
    files: Array<{ label: string; path: string; bytes: number; sha256: string; contentEncoding: string }>;
  };
  assert.equal(fixture.releaseId, ARTIFACT_RELEASE_ID);
  for (const record of ARTIFACT_RECORDS) {
    const src = fixture.files.find((f) => f.label === record.label);
    assert.ok(src, `fixture missing ${record.label}`);
    assert.equal(record.path, src.path, `${record.label} path drift`);
    assert.equal(record.bytes, src.bytes, `${record.label} byte drift`);
    assert.equal(record.sha256, src.sha256, `${record.label} SHA-256 drift`);
    assert.equal(record.contentEncoding, src.contentEncoding, `${record.label} encoding drift`);
  }
});

test("MAX_ARTIFACT_BYTES equals the largest pinned artifact", () => {
  assert.equal(MAX_ARTIFACT_BYTES, 8583356);
});

test("manifest integrity self-check passes for the pinned table", () => {
  assert.doesNotThrow(() => assertManifestIntegrity());
});

// ── integrity fails closed ────────────────────────────────────────────────────

test("integrity check fails closed on every invariant breach", () => {
  const good = byLabel("wasm");
  const cases: Array<ArtifactRecord[]> = [
    [good], // wrong count
    [...ARTIFACT_RECORDS, good] as ArtifactRecord[], // duplicate label+path
    ARTIFACT_RECORDS.map((r) => (r.label === "wasm" ? { ...r, bytes: 0 } : r)), // invalid bytes
    ARTIFACT_RECORDS.map((r) => (r.label === "wasm" ? { ...r, bytes: 1.5 } : r)),
    ARTIFACT_RECORDS.map((r) => (r.label === "wasm" ? { ...r, sha256: "ZZ" } : r)), // bad hash
    ARTIFACT_RECORDS.map((r) => (r.label === "wasm" ? { ...r, sha256: good.sha256.toUpperCase() } : r)),
    ARTIFACT_RECORDS.map((r) =>
      r.label === "wasm" ? ({ ...r, contentEncoding: "br" } as unknown as ArtifactRecord) : r,
    ), // bad encoding
    ARTIFACT_RECORDS.map((r) => (r.label === "wasm" ? { ...r, contentType: "text/plain" } : r)), // type mismatch
  ];
  for (const [i, records] of cases.entries()) {
    assert.throws(() => assertManifestIntegrity(records), ArtifactManifestError, `case ${i} must fail closed`);
  }
});

test("unsupported suffix has no content type", () => {
  assert.throws(() => deriveContentType("Build/thing.exe"), ArtifactManifestError);
  assert.throws(() => deriveContentType("index.html"), ArtifactManifestError);
});

// ── exact-match resolution ────────────────────────────────────────────────────

test("resolves each allowlisted path by exact match", () => {
  for (const r of ARTIFACT_RECORDS) {
    assert.equal(resolveArtifactRecord(r.path.split("/")), r);
  }
});

test("unknown files and non-allowlisted assets are denied", () => {
  for (const p of [
    ["index.html"],
    ["TemplateData", "style.css"],
    ["Build", "manifest.json"],
    ["Build", "other.wasm.gz"],
    ["Build"],
    [],
  ]) {
    assert.equal(resolveArtifactRecord(p), null, `must deny ${p.join("/")}`);
  }
});

test("case mismatch denied (exact, case-sensitive match only)", () => {
  assert.equal(resolveArtifactRecord(["build", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveArtifactRecord(["Build", "B6B-LOCAL-FB840878-D.WASM.GZ"]), null);
});

test("extra or reordered segments denied", () => {
  assert.equal(resolveArtifactRecord(["Build", "b6b-local-fb840878-d.wasm.gz", "extra"]), null);
  assert.equal(resolveArtifactRecord(["b6b-local-fb840878-d.wasm.gz", "Build"]), null);
});

// ── traversal / encoding attacks ──────────────────────────────────────────────

test("traversal, encoding, absolute-URL and drive-letter attacks all denied", () => {
  const attacks: unknown[][] = [
    ["..", "secret"],
    [".", "Build", "b6b-local-fb840878-d.wasm.gz"],
    ["Build", "..", "..", "etc", "passwd"],
    ["%2e%2e", "secret"], // single-encoded traversal (post-decode)
    ["%252e%252e", "secret"], // double-encoded
    ["..%2fsecret"],
    ["Build\\b6b-local-fb840878-d.wasm.gz"], // backslash
    ["Build%5Cb6b"], // encoded backslash
    ["/etc/passwd"], // leading slash / separator inside a segment
    ["https://evil.example.com/x"], // absolute URL
    ["//evil.example.com/x"], // protocol-relative
    ["C:", "Windows"], // drive letter
    ["Build", "b6b\u0000.wasm.gz"], // null byte
    ["Build", " b6b-local-fb840878-d.wasm.gz"], // whitespace
    ["Build", ""], // empty segment
    ["Build", null],
    ["Build", 42],
    ["Build", {}],
  ];
  for (const a of attacks) {
    assert.equal(resolveArtifactRecord(a), null, `must deny ${JSON.stringify(a)}`);
  }
});

test("segment allowlist rejects the dangerous shapes directly", () => {
  for (const bad of ["", ".", "..", "a/b", "a\\b", "a:b", "a%2e", "a b", "a\u0000", "a\n"]) {
    assert.equal(isSafePathSegment(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
  assert.equal(isSafePathSegment("b6b-local-fb840878-d.wasm.gz"), true);
  assert.equal(isSafePathSegment("Build"), true);
});

// ── pinned upstream path + ETag ───────────────────────────────────────────────

test("upstream path is the internally pinned versioned release path", () => {
  assert.equal(
    buildUpstreamArtifactPath(byLabel("wasm")),
    "releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.wasm.gz",
  );
  for (const r of ARTIFACT_RECORDS) {
    const p = buildUpstreamArtifactPath(r);
    assert.equal(p, `releases/${ARTIFACT_RELEASE_ID}/${r.path}`);
    assert.equal(p.startsWith("releases/b6b-local-fb840878-d/"), true);
    assert.equal(p.startsWith("Build/"), false, "must never be a bare /Build path");
  }
});

test("ETag is derived deterministically from the pinned SHA-256", () => {
  assert.equal(artifactETag(byLabel("wasm")), `"sha256-${byLabel("wasm").sha256}"`);
  assert.equal(artifactETag(byLabel("wasm")), artifactETag(byLabel("wasm")));
  assert.notEqual(artifactETag(byLabel("wasm")), artifactETag(byLabel("data")));
});
