import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-20 text-center">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-500">
          444 ARENA
        </p>
        <h1 className="mt-2 text-5xl font-black tracking-tight text-white">
          404
        </h1>
        <p className="mt-1 text-xl font-bold text-zinc-300">Page not found</p>
        <p className="mt-3 text-zinc-400">
          This page doesn&apos;t exist or may have moved.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:from-cyan-300"
        >
          Home
        </Link>
        <Link
          href="/lobby"
          className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-bold text-white hover:border-zinc-500"
        >
          Play Penalty444
        </Link>
      </div>
    </div>
  );
}
