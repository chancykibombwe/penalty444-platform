"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type HomeTournamentPreviewData = {
  /** Display name. Falls back to "Friday Night Cup" if missing. */
  name: string;
  /** "Live Event", "Ready Phase", "Registration", "Final" etc. */
  statusLabel: string;
  /** Round label e.g. "Semifinals". */
  roundLabel: string;
  playersRemaining: number;
  matchesLive: number;
  /** Optional ISO start time for a "Starts in" countdown. */
  startsAtIso?: string | null;
  /** Optional href; defaults to /tournaments. */
  href?: string;
};

type Props = {
  data?: HomeTournamentPreviewData;
};

const MOCK_DATA: HomeTournamentPreviewData = {
  name: "Friday Night Cup",
  statusLabel: "Live Event",
  roundLabel: "Semifinals",
  playersRemaining: 4,
  matchesLive: 2,
  startsAtIso: null,
  href: "/tournaments",
};

function formatCountdown(targetIso: string | null | undefined, nowMs: number): string | null {
  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) return null;
  const diff = targetMs - nowMs;
  if (diff <= 0) return "Live now";
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function HomeTournamentPreview({ data = MOCK_DATA }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!data.startsAtIso) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [data.startsAtIso]);

  const countdown = formatCountdown(data.startsAtIso, nowMs);
  const isLive = data.statusLabel.toLowerCase().includes("live");
  const href = data.href ?? "/tournaments";

  return (
    <section
      className="relative overflow-hidden rounded-3xl border-2 border-cyan-500/40 bg-gradient-to-br from-zinc-950 via-zinc-950 to-black p-5 shadow-2xl sm:p-6"
      aria-label="Live tournament preview"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-cyan-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`home-live-pulse inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
                isLive
                  ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100"
                  : "border-amber-400/55 bg-amber-500/15 text-amber-100"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full shadow-[0_0_8px_currentColor] ${
                  isLive ? "bg-cyan-300" : "bg-amber-300"
                }`}
                aria-hidden
              />
              {isLive ? "Live Now" : data.statusLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200">
              🏆 Featured
            </span>
          </div>

          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">
            Tournament
          </p>
          <h2 className="mt-1 break-words text-2xl font-black tracking-tight text-white sm:text-3xl">
            <span className="bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              {data.name}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            {data.roundLabel} · {data.playersRemaining} players remaining
          </p>
        </div>

        {countdown ? (
          <div className="shrink-0 rounded-2xl border border-amber-400/45 bg-amber-950/40 px-4 py-3 text-center shadow-lg">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/90">
              {countdown === "Live now" ? "Status" : "Starts in"}
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-amber-100 sm:text-2xl">
              {countdown}
            </p>
          </div>
        ) : null}
      </div>

      <dl className="relative mt-5 grid grid-cols-3 gap-2 border-t border-zinc-800/80 pt-4 sm:gap-4">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Players left
          </dt>
          <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
            {data.playersRemaining}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Round
          </dt>
          <dd className="mt-1 text-base font-black text-white sm:text-lg">
            {data.roundLabel}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Live matches
          </dt>
          <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
            {data.matchesLive}
          </dd>
        </div>
      </dl>

      <Link
        href={href}
        className="relative mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-amber-500 px-5 py-3 text-sm font-black tracking-wide text-zinc-950 shadow-[0_0_28px_rgba(34,211,238,0.32)] transition-transform hover:scale-[1.01] hover:from-cyan-300 hover:to-amber-400 sm:w-auto"
      >
        View Tournament
        <span aria-hidden>→</span>
      </Link>
    </section>
  );
}
