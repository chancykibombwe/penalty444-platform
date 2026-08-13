/**
 * B6D3B PR-1 — pinned artifact manifest + path-security tests.
 * Node `node:test` via `tsx`. Pure; no network.
 *
 * The pinned values are cross-checked here against the dedicated authenticated
 * B6D2B evidence fixture so the final runtime table can never silently drift.
 * The fixture is read as DATA in this test only (via JSON), and the runtime
 * module never imports it.
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
  new URL("./fixtures/b6d2b-5226d3c1-a.authenticated.json", import.meta.url),
);

function byLabel(label: string): ArtifactRecord {
  const r = ARTIFACT_RECORDS.find((x) => x.label === label);
  assert.ok(r, `missing pinned record ${label}`);
  return r;
}

// ── pinned table ──────────────────────────────────────────────────────────────

test("exactly four records with the pinned release id", () => {
  assert.equal(ARTIFACT_RECORDS.length, 4);
  assert.equal(ARTIFACT_RELEASE_ID, "b6d2b-5226d3c1-a");
  assert.deepStrictEqual(
    ARTIFACT_RECORDS.map((r) => r.label).sort(),
    [...ARTIFACT_LABELS].sort(),
  );
});

test("exact bytes, full SHA-256, encodings and content types", () => {
  assert.deepStrictEqual(byLabel("loader"), {
    label: "loader",
    path: "Build/b6d2b-5226d3c1-a.loader.js",
    bytes: 26982,
    sha256: "e92d0faa491f054c30b24c9613de894496fcb33aff6ebe2744f45a8570e3b034",
    contentEncoding: "identity",
    contentType: "application/javascript",
  });
  assert.deepStrictEqual(byLabel("framework"), {
    label: "framework",
    path: "Build/b6d2b-5226d3c1-a.framework.js.gz",
    bytes: 90655,
    sha256: "f020ebbb33b00559d6dc18ad186811cef2681b0343de5af38778ca81cf677c22",
    contentEncoding: "gzip",
    contentType: "application/javascript",
  });
  assert.deepStrictEqual(byLabel("data"), {
    label: "data",
    path: "Build/b6d2b-5226d3c1-a.data.gz",
    bytes: 1877549,
    sha256: "c786dc7d7544ed22ca4da786773b7e573347ad37451e3e89b78e4296dc1586e4",
    contentEncoding: "gzip",
    contentType: "application/octet-stream",
  });
  assert.deepStrictEqual(byLabel("wasm"), {
    label: "wasm",
    path: "Build/b6d2b-5226d3c1-a.wasm.gz",
    bytes: 8688964,
    sha256: "8f4058436a541710878b4534a6edf97ac34a615099cbde920e3c187f9bac6d94",
    contentEncoding: "gzip",
    contentType: "application/wasm",
  });
});

test("pinned values match the authenticated B6D2B evidence fixture exactly", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    releaseId: string;
    sourceCommit: string;
    unityVersion: string;
    manifestSha256: string;
    files: Array<{
      label: string;
      path: string;
      bytes: number;
      sha256: string;
      contentEncoding: string;
    }>;
  };
  assert.equal(fixture.releaseId, ARTIFACT_RELEASE_ID);
  assert.equal(fixture.sourceCommit, "5226d3c125f3a274fc7d8589f3aa77642a3c5991");
  assert.equal(fixture.unityVersion, "6000.4.2f1");
  assert.equal(
    fixture.manifestSha256,
    "00205da3ecc88557a1f138d5b57486e4920fe5ef33a02962c340cf61b28dc79e",
  );
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
  assert.equal(MAX_ARTIFACT_BYTES, 8688964);
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
  assert.equal(resolveArtifactRecord(["build", "b6d2b-5226d3c1-a.wasm.gz"]), null);
  assert.equal(resolveArtifactRecord(["Build", "B6D2B-5226D3C1-A.WASM.GZ"]), null);
});

test("extra or reordered segments denied", () => {
  assert.equal(resolveArtifactRecord(["Build", "b6d2b-5226d3c1-a.wasm.gz", "extra"]), null);
  assert.equal(resolveArtifactRecord(["b6d2b-5226d3c1-a.wasm.gz", "Build"]), null);
});

// ── traversal / encoding attacks ──────────────────────────────────────────────

test("traversal, encoding, absolute-URL and drive-letter attacks all denied", () => {
  const attacks: unknown[][] = [
    ["..", "secret"],
    [".", "Build", "b6d2b-5226d3c1-a.wasm.gz"],
    ["Build", "..", "..", "etc", "passwd"],
    ["%2e%2e", "secret"], // single-encoded traversal (post-decode)
    ["%252e%252e", "secret"], // double-encoded
    ["..%2fsecret"],
    ["Build\\b6d2b-5226d3c1-a.wasm.gz"], // backslash
    ["Build%5Cb6d2b"], // encoded backslash
    ["/etc/passwd"], // leading slash / separator inside a segment
    ["https://evil.example.com/x"], // absolute URL
    ["//evil.example.com/x"], // protocol-relative
    ["C:", "Windows"], // drive letter
    ["Build", "b6d2b\u0000.wasm.gz"], // null byte
    ["Build", " b6d2b-5226d3c1-a.wasm.gz"], // whitespace
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
  assert.equal(isSafePathSegment("b6d2b-5226d3c1-a.wasm.gz"), true);
  assert.equal(isSafePathSegment("Build"), true);
});

// ── pinned upstream path + ETag ───────────────────────────────────────────────

test("upstream path is the internally pinned versioned release path", () => {
  assert.equal(
    buildUpstreamArtifactPath(byLabel("wasm")),
    "releases/b6d2b-5226d3c1-a/Build/b6d2b-5226d3c1-a.wasm.gz",
  );
  for (const r of ARTIFACT_RECORDS) {
    const p = buildUpstreamArtifactPath(r);
    assert.equal(p, `releases/${ARTIFACT_RELEASE_ID}/${r.path}`);
    assert.equal(p.startsWith("releases/b6d2b-5226d3c1-a/"), true);
    assert.equal(p.startsWith("Build/"), false, "must never be a bare /Build path");
  }
});

test("ETag is derived deterministically from the pinned SHA-256", () => {
  assert.equal(artifactETag(byLabel("wasm")), `"sha256-${byLabel("wasm").sha256}"`);
  assert.equal(artifactETag(byLabel("wasm")), artifactETag(byLabel("wasm")));
  assert.notEqual(artifactETag(byLabel("wasm")), artifactETag(byLabel("data")));
});
