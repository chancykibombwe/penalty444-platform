"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-zinc-950 text-white">
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 text-center">
          <span
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-amber-500 text-2xl font-black text-zinc-950"
            aria-hidden
          >
            444
          </span>

          <div className="space-y-2">
            <h1 className="text-2xl font-black text-white">
              Something went wrong
            </h1>
            <p className="text-zinc-400">
              Please report this if it keeps happening.
            </p>
            {error.digest ? (
              <p className="font-mono text-[11px] text-zinc-600">
                ref: {error.digest}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:from-cyan-300"
            >
              Reload
            </button>
            <a
              href="/"
              className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-bold text-white hover:border-zinc-500"
            >
              Back to Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
