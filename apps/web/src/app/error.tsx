"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-20 text-center">
      <span
        className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-amber-500 text-2xl font-black text-zinc-950 shadow-[0_0_24px_rgba(34,211,238,0.35)]"
        aria-hidden
      >
        444
      </span>

      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-tight text-white">
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
          onClick={unstable_retry}
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:from-cyan-300"
        >
          Reload
        </button>
        <Link
          href="/"
          className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-bold text-white hover:border-zinc-500"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
