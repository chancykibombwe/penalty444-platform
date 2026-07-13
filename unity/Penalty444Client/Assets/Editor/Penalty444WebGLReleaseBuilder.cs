// Penalty444 — B6B local WebGL release builder (Editor-only).
//
// LOCAL RELEASE TOOLING ONLY. This script builds the existing
// `Penalty444Prototype` scene to WebGL into a NEW immutable, versioned, and
// git-ignored release directory, then writes a machine-readable artifact
// manifest + a manifest checksum. It is invoked in batchmode from the
// PowerShell wrapper (scripts/unity/build-penalty444-webgl-release.ps1).
//
// It does NOT publish/upload artifacts, configure storage/CDN, touch Vercel,
// install Unity in CI, activate Unity in production, or modify PlayerSettings,
// package files, project settings, compression settings, scenes, build
// settings, or any gameplay/presentation script. It uses the committed project
// configuration as-is and reads the pinned Unity version from ProjectVersion.txt.
//
// B6B establishes a repeatable LOCAL command with a pinned editor version,
// immutable local output, source metadata, and per-file checksums. It does NOT
// by itself prove cross-machine reproducibility, bit-for-bit determinism,
// production hosting/performance/compatibility. See
// docs/unity-b6b-local-release-build.md and the B6A audit.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Penalty444.Editor
{
    /// <summary>
    /// Command-line WebGL release builder. Single entry point:
    /// <see cref="BuildFromCommandLine"/>. Never mutates project configuration.
    /// </summary>
    public static class Penalty444WebGLReleaseBuilder
    {
        private const string Game = "penalty444";
        private const string BuildScene = "Assets/Scenes/Penalty444Prototype.unity";
        // Repo-relative, under the existing git-ignored parent
        // apps/web/public/unity/penalty444/. Each release is its own immutable
        // subfolder; the builder refuses to reuse an existing one.
        private const string ReleaseRootRelative =
            "apps/web/public/unity/penalty444/releases";

        private static readonly Regex VersionPattern =
            new Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", RegexOptions.CultureInvariant);
        private static readonly Regex CommitPattern =
            new Regex("^[0-9a-fA-F]{40}$", RegexOptions.CultureInvariant);

        /// <summary>
        /// Batchmode entry point. Validates inputs + environment, builds the
        /// fixed scene to a new versioned directory, validates artifacts, and
        /// writes manifest.json + manifest.sha256. Any failure exits non-zero
        /// and leaves a partial directory in place for inspection.
        /// </summary>
        public static void BuildFromCommandLine()
        {
            try
            {
                RunBuild();
                Log("release build completed successfully.");
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                // Message only — never dump environment/secrets/stack to logs.
                LogError(e.Message);
                EditorApplication.Exit(1);
            }
        }

        private static void RunBuild()
        {
            // ── 1. Parse uniquely-prefixed arguments ─────────────────────────
            string releaseVersion = GetArg("-penalty444ReleaseVersion");
            string sourceCommit = GetArg("-penalty444SourceCommit");
            string previousVersion = GetArg("-penalty444PreviousVersion") ?? "";
            string releaseNotesB64 = GetArg("-penalty444ReleaseNotesBase64");

            // ── 2/3. Validate required inputs ────────────────────────────────
            if (string.IsNullOrEmpty(releaseVersion) || !VersionPattern.IsMatch(releaseVersion))
                throw new Exception(
                    "Invalid -penalty444ReleaseVersion. Must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$.");

            if (string.IsNullOrEmpty(sourceCommit) || !CommitPattern.IsMatch(sourceCommit))
                throw new Exception(
                    "Invalid -penalty444SourceCommit. Must be a full 40-character hex Git SHA.");
            sourceCommit = sourceCommit.ToLowerInvariant();

            if (!string.IsNullOrEmpty(previousVersion) && !VersionPattern.IsMatch(previousVersion))
                throw new Exception(
                    "Invalid -penalty444PreviousVersion. Must match the release-version pattern or be empty.");

            string releaseNotes = DecodeReleaseNotes(releaseNotesB64);
            if (string.IsNullOrEmpty(releaseNotes.Trim()))
                throw new Exception("Release notes are empty after Base64 decoding.");

            // ── 4. Validate the active editor version against ProjectVersion.txt
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string recordedVersion = ReadProjectEditorVersion(projectRoot);
            if (!string.Equals(recordedVersion, Application.unityVersion, StringComparison.Ordinal))
                throw new Exception(
                    $"Unity editor version mismatch. Running {Application.unityVersion}, " +
                    $"project pins {recordedVersion} (ProjectVersion.txt).");

            // ── 5. Validate WebGL build support ──────────────────────────────
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
                throw new Exception("WebGL Build Support is not installed for this Unity editor.");

            // ── 6. Confirm the fixed scene exists ────────────────────────────
            string sceneFullPath = Path.Combine(projectRoot, BuildScene);
            if (!File.Exists(sceneFullPath))
                throw new Exception($"Build scene not found: {BuildScene}.");

            // ── 8. Resolve the NEW immutable versioned output directory ──────
            // Repo root is two levels above the Unity project
            // (<repo>/unity/Penalty444Client). Output is repo-relative and
            // git-ignored.
            string repoRoot = Directory.GetParent(projectRoot).Parent.FullName;
            string releaseDir = Path.Combine(repoRoot, ReleaseRootRelative, releaseVersion);
            if (Directory.Exists(releaseDir))
                throw new Exception(
                    $"Release directory already exists (immutable): {releaseVersion}. " +
                    "Choose a new version. This builder never overwrites a release.");

            Directory.CreateDirectory(releaseDir);
            Log($"building scene={BuildScene} target=WebGL version={releaseVersion}");

            // ── 7/9/10/11. Build with the committed configuration as-is ──────
            // CleanBuildCache gives a clean build without mutating project
            // settings. No PlayerSettings / scene / build-settings changes.
            var options = new BuildPlayerOptions
            {
                scenes = new[] { BuildScene },
                locationPathName = releaseDir,
                target = BuildTarget.WebGL,
                targetGroup = BuildTargetGroup.WebGL,
                options = BuildOptions.CleanBuildCache,
            };

            BuildReport report = BuildPipeline.BuildPlayer(options);

            // ── 12/13. Any non-success result is a failure ───────────────────
            if (report.summary.result != BuildResult.Succeeded)
                throw new Exception(
                    $"WebGL build did not succeed (result={report.summary.result}, " +
                    $"errors={report.summary.totalErrors}).");

            // ── §6. Validate required artifact categories ────────────────────
            ValidateArtifacts(releaseDir);

            // ── §7. Write manifest.json + manifest.sha256 ────────────────────
            WriteManifest(releaseDir, releaseVersion, previousVersion, sourceCommit, releaseNotes);
        }

        // ── Artifact category validation ─────────────────────────────────────

        private static void ValidateArtifacts(string releaseDir)
        {
            if (!File.Exists(Path.Combine(releaseDir, "index.html")))
                throw new Exception("Artifact validation failed: index.html missing.");

            string buildDir = Path.Combine(releaseDir, "Build");
            if (!Directory.Exists(buildDir))
                throw new Exception("Artifact validation failed: Build/ directory missing.");

            string[] build = Directory.GetFiles(buildDir).Select(Path.GetFileName).ToArray();

            int loaders = build.Count(f => f.EndsWith(".loader.js", StringComparison.Ordinal));
            if (loaders != 1)
                throw new Exception(
                    $"Artifact validation failed: expected exactly one Build/*.loader.js, found {loaders}.");

            RequireCategory(build, "framework", f =>
                f.EndsWith(".framework.js", StringComparison.Ordinal) ||
                f.EndsWith(".framework.js.gz", StringComparison.Ordinal) ||
                f.EndsWith(".framework.js.br", StringComparison.Ordinal));

            RequireCategory(build, "data", f =>
                f.EndsWith(".data", StringComparison.Ordinal) ||
                f.EndsWith(".data.gz", StringComparison.Ordinal) ||
                f.EndsWith(".data.br", StringComparison.Ordinal));

            RequireCategory(build, "wasm", f =>
                f.EndsWith(".wasm", StringComparison.Ordinal) ||
                f.EndsWith(".wasm.gz", StringComparison.Ordinal) ||
                f.EndsWith(".wasm.br", StringComparison.Ordinal));

            string templateDir = Path.Combine(releaseDir, "TemplateData");
            if (!Directory.Exists(templateDir) ||
                Directory.GetFiles(templateDir, "*", SearchOption.AllDirectories).Length == 0)
                throw new Exception("Artifact validation failed: TemplateData/ missing or empty.");
        }

        private static void RequireCategory(string[] build, string name, Func<string, bool> match)
        {
            if (!build.Any(match))
                throw new Exception($"Artifact validation failed: no Build/*.{name} artifact found.");
        }

        // ── Manifest generation ──────────────────────────────────────────────

        private static void WriteManifest(
            string releaseDir,
            string releaseVersion,
            string previousVersion,
            string sourceCommit,
            string releaseNotes)
        {
            // Enumerate all generated files, relative to the release dir, using
            // forward slashes. manifest.json / manifest.sha256 are excluded.
            var all = Directory
                .GetFiles(releaseDir, "*", SearchOption.AllDirectories)
                .Select(full => new
                {
                    Rel = ToRelPosix(releaseDir, full),
                    Full = full,
                })
                .Where(x => x.Rel != "manifest.json" && x.Rel != "manifest.sha256")
                .OrderBy(x => x.Rel, StringComparer.Ordinal)
                .ToList();

            var files = new List<FileEntry>();
            long totalBytes = 0;
            long compressedBytes = 0;
            var mainEncodings = new HashSet<string>();

            foreach (var f in all)
            {
                var info = new FileInfo(f.Full);
                long bytes = info.Length;
                string sha = Sha256Hex(f.Full);
                string enc = EncodingFor(f.Rel);

                files.Add(new FileEntry { Path = f.Rel, Bytes = bytes, Sha256 = sha, ContentEncoding = enc });
                totalBytes += bytes;
                if (enc == "gzip" || enc == "br") compressedBytes += bytes;

                if (IsMainPayload(f.Rel)) mainEncodings.Add(enc);
            }

            string compressionMode = DeriveCompressionMode(mainEncodings);

            string json = BuildManifestJson(
                releaseVersion, previousVersion, sourceCommit, releaseNotes,
                Application.unityVersion, compressionMode, totalBytes, compressedBytes, files);

            // UTF-8 without BOM; the checksum is over these exact bytes.
            var utf8NoBom = new UTF8Encoding(false);
            byte[] jsonBytes = utf8NoBom.GetBytes(json);
            string manifestPath = Path.Combine(releaseDir, "manifest.json");
            File.WriteAllBytes(manifestPath, jsonBytes);

            string manifestSha = Sha256Hex(jsonBytes);
            // Standard "<hash>  manifest.json" form (two spaces).
            File.WriteAllBytes(
                Path.Combine(releaseDir, "manifest.sha256"),
                utf8NoBom.GetBytes(manifestSha + "  manifest.json\n"));

            Log($"manifest written files={files.Count} totalBytes={totalBytes} " +
                $"compressedBytes={compressedBytes} compression={compressionMode} manifestSha256={manifestSha}");
        }

        private sealed class FileEntry
        {
            public string Path;
            public long Bytes;
            public string Sha256;
            public string ContentEncoding;
        }

        private static string BuildManifestJson(
            string releaseVersion, string previousVersion, string sourceCommit, string releaseNotes,
            string unityVersion, string compressionMode, long totalBytes, long compressedBytes,
            List<FileEntry> files)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"schemaVersion\": 1,\n");
            sb.Append("  \"game\": ").Append(JsonStr(Game)).Append(",\n");
            sb.Append("  \"releaseVersion\": ").Append(JsonStr(releaseVersion)).Append(",\n");
            sb.Append("  \"buildTarget\": \"WebGL\",\n");
            sb.Append("  \"unityVersion\": ").Append(JsonStr(unityVersion)).Append(",\n");
            sb.Append("  \"sourceCommit\": ").Append(JsonStr(sourceCommit)).Append(",\n");
            sb.Append("  \"scene\": ").Append(JsonStr(BuildScene)).Append(",\n");
            sb.Append("  \"buildTimestampUtc\": ")
              .Append(JsonStr(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)))
              .Append(",\n");
            sb.Append("  \"previousVersion\": ")
              .Append(string.IsNullOrEmpty(previousVersion) ? "null" : JsonStr(previousVersion)).Append(",\n");
            sb.Append("  \"releaseNotes\": ").Append(JsonStr(releaseNotes)).Append(",\n");
            sb.Append("  \"compressionMode\": ").Append(JsonStr(compressionMode)).Append(",\n");
            sb.Append("  \"totalArtifactBytes\": ").Append(totalBytes.ToString(CultureInfo.InvariantCulture)).Append(",\n");
            sb.Append("  \"compressedPayloadBytes\": ").Append(compressedBytes.ToString(CultureInfo.InvariantCulture)).Append(",\n");
            sb.Append("  \"fileCount\": ").Append(files.Count.ToString(CultureInfo.InvariantCulture)).Append(",\n");
            sb.Append("  \"files\": [");
            for (int i = 0; i < files.Count; i++)
            {
                var f = files[i];
                sb.Append(i == 0 ? "\n" : ",\n");
                sb.Append("    {\n");
                sb.Append("      \"path\": ").Append(JsonStr(f.Path)).Append(",\n");
                sb.Append("      \"bytes\": ").Append(f.Bytes.ToString(CultureInfo.InvariantCulture)).Append(",\n");
                sb.Append("      \"sha256\": ").Append(JsonStr(f.Sha256)).Append(",\n");
                sb.Append("      \"contentEncoding\": ").Append(JsonStr(f.ContentEncoding)).Append("\n");
                sb.Append("    }");
            }
            sb.Append(files.Count == 0 ? "]\n" : "\n  ]\n");
            sb.Append("}\n");
            return sb.ToString();
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        private static string GetArg(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (string.Equals(args[i], name, StringComparison.Ordinal))
                    return args[i + 1];
            return null;
        }

        private static string DecodeReleaseNotes(string b64)
        {
            if (string.IsNullOrEmpty(b64))
                throw new Exception("Missing -penalty444ReleaseNotesBase64.");
            try
            {
                return new UTF8Encoding(false).GetString(Convert.FromBase64String(b64));
            }
            catch
            {
                throw new Exception("Release notes are not valid Base64.");
            }
        }

        private static string ReadProjectEditorVersion(string projectRoot)
        {
            string path = Path.Combine(projectRoot, "ProjectSettings", "ProjectVersion.txt");
            if (!File.Exists(path))
                throw new Exception("ProjectVersion.txt not found.");
            foreach (string line in File.ReadAllLines(path))
            {
                string t = line.Trim();
                if (t.StartsWith("m_EditorVersion:", StringComparison.Ordinal))
                    return t.Substring("m_EditorVersion:".Length).Trim();
            }
            throw new Exception("m_EditorVersion not found in ProjectVersion.txt.");
        }

        private static string ToRelPosix(string root, string full)
        {
            string rel = full.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return rel.Replace('\\', '/');
        }

        private static string EncodingFor(string relPath)
        {
            if (relPath.EndsWith(".gz", StringComparison.Ordinal)) return "gzip";
            if (relPath.EndsWith(".br", StringComparison.Ordinal)) return "br";
            return "identity";
        }

        private static bool IsMainPayload(string relPath)
        {
            return relPath.StartsWith("Build/", StringComparison.Ordinal) &&
                   (Contains(relPath, ".framework.js") || Contains(relPath, ".data") || Contains(relPath, ".wasm"));
        }

        private static bool Contains(string s, string sub) => s.IndexOf(sub, StringComparison.Ordinal) >= 0;

        private static string DeriveCompressionMode(HashSet<string> mainEncodings)
        {
            if (mainEncodings.Count == 0) return "identity";
            if (mainEncodings.Count == 1) return mainEncodings.First() == "gzip" ? "gzip"
                                               : mainEncodings.First() == "br" ? "br" : "identity";
            return "mixed";
        }

        private static string Sha256Hex(string filePath)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(filePath))
                return ToHex(sha.ComputeHash(stream));
        }

        private static string Sha256Hex(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return ToHex(sha.ComputeHash(bytes));
        }

        private static string ToHex(byte[] hash)
        {
            var sb = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        private static string JsonStr(string value)
        {
            if (value == null) return "null";
            var sb = new StringBuilder(value.Length + 2);
            sb.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        private static void Log(string msg) => Debug.Log("[B6B] " + msg);
        private static void LogError(string msg) => Debug.LogError("[B6B] " + msg);
    }
}
