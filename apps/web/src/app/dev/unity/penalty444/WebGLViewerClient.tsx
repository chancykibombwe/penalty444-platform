"use client";

/**
 * Dev-only Unity WebGL viewer — client half.
 *
 * Loads the local, git-ignored WebGL build at /unity/penalty444/index.html in a
 * plain iframe for manual viewing. If that output is not present locally, it
 * shows a clear instruction box instead — so the route still renders (and the
 * app still builds) when the build output is absent.
 *
 * Passive by design: NO postMessage listeners are registered, so React never
 * receives Unity events and never sends any. No Socket.IO, no Supabase, no auth
 * tokens, no wallet/economy, no gameplay authority.
 */

import { useEffect, useState } from "react";

const BUILD_INDEX_URL = "/unity/penalty444/index.html";

const CONSTRAINTS = [
  "No live match state",
  "No postMessage",
  "No Socket.IO",
  "No Supabase",
  "No wallet/economy",
  "No gameplay authority",
];

export default function WebGLViewerClient() {
  const [status, setStatus] = useState<"checking" | "present" | "missing">(
    "checking"
  );

  // Runtime existence check (dev-only route). A HEAD request avoids importing
  // or bundling the git-ignored output, so the page compiles/builds whether or
  // not the build is present.
  useEffect(() => {
    let cancelled = false;
    fetch(BUILD_INDEX_URL, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setStatus(res.ok ? "present" : "missing");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#070A0F] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
            Dev Only
          </span>
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
            Not for users
          </span>
        </div>

        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          Dev-only Unity WebGL viewer
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Loads local git-ignored WebGL output from{" "}
          <code className="text-zinc-400">/unity/penalty444/</code>. Manual
          viewing only — not wired to the live match page.
        </p>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          {CONSTRAINTS.map((c) => (
            <li
              key={c}
              className="rounded border border-zinc-800/70 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400"
            >
              {c}
            </li>
          ))}
        </ul>

        <div className="mt-6">
          {status === "checking" ? (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-zinc-800/60 bg-black/60">
              <p className="font-mono text-sm text-zinc-500">
                Checking for local build…
              </p>
            </div>
          ) : status === "missing" ? (
            <div
              className="rounded-xl border-2 border-dashed border-amber-700/60 bg-amber-950/20 p-6"
              role="status"
            >
              <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
                WebGL output not found
              </p>
              <p className="mt-3 text-sm text-zinc-300">
                Unity WebGL output was not found locally. Run the B3 WebGL build
                and output to{" "}
                <code className="text-zinc-100">
                  apps/web/public/unity/penalty444/
                </code>
                .
              </p>
              <p className="mt-3 text-xs text-zinc-500">
                The build output is intentionally git-ignored and not committed,
                so it will not exist on a fresh clone or on Vercel. See{" "}
                <code className="text-zinc-400">
                  docs/unity-webgl-build-pipeline.md
                </code>{" "}
                §6 for the build steps, then reload this page.
              </p>
            </div>
          ) : (
            <iframe
              title="Penalty444 Unity WebGL build (dev-only viewer)"
              src={BUILD_INDEX_URL}
              className="aspect-video w-full rounded-xl border border-zinc-800/60 bg-black"
            />
          )}
        </div>

        <p className="mt-4 text-[11px] text-zinc-600">
          This route is manually typed only (not linked from the navbar, home,
          lobby, or match pages) and is 404 in production unless explicitly
          enabled on the server.
        </p>
      </div>
    </div>
  );
}
