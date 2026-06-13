"use client";

import Link from "next/link";
import { useState } from "react";
import {
  fetchHomeFeaturedTournament,
  type HomeFeaturedTournament,
} from "../../lib/tournament/homeFeatured";
import { useVisibleInterval } from "../../lib/polling/useVisibleInterval";
import { supabase } from "../../lib/supabase/client";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "Live Now",
  check_in: "Check-in Open",
  registration: "Registration Open",
};

function formatCountdown(targetIso: string | null | undefined, nowMs: number): string | null {
  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) return null;
  const diff = targetMs - nowMs;
  if (diff <= 0) return "Starting soon";
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function HomeTournamentPreview() {
  const [tournament, setTournament] = useState<HomeFeaturedTournament | null | undefined>(
    undefined
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useVisibleInterval(
    async (signal) => {
      const next = await fetchHomeFeaturedTournament(supabase);
      if (signal.aborted) return;
      setTournament(next);
      setNowMs(Date.now());
    },
    { intervalMs: 30_000 }
  );

  if (tournament === undefined) {
    return (
      <section
        className="h-32 animate-pulse rounded-3xl border border-[#1B2433] bg-[#0D1420]/65"
        aria-label="Loading tournament preview"
        aria-hidden
      />
    );
  }

  if (tournament === null) {
    return (
      <section
        className="rounded-3xl border border-dashed border-[#1B2433] bg-[#0D1420]/60 px-5 py-6 text-center sm:px-6"
        aria-label="Tournament preview"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">
          Tournament
        </p>
        <p className="mt-2 text-sm font-semibold text-zinc-400">
          No public tournaments are live right now.
        </p>
        <Link
          href="/tournaments"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-[#1B2433] bg-[#111827]/70 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-200 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
        >
          View Tournaments
          <span aria-hidden>→</span>
        </Link>
      </section>
    );
  }

  const isLive = tournament.status === "in_progress";
  const countdown = isLive ? null : formatCountdown(tournament.startsAtIso, nowMs);
  const statusLabel = STATUS_LABEL[tournament.status] ?? tournament.status;
  const href = `/tournaments/${tournament.id}`;

  return (
    <section
      className="relative overflow-hidden rounded-3xl border-2 border-cyan-500/40 bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black p-3 shadow-2xl sm:p-3.5"
      aria-label="Featured tournament"
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
              {statusLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-[#1B2433] bg-[#111827]/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200">
              🏆 Featured
            </span>
          </div>

          <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">
            Tournament
          </p>
          <h2 className="mt-1 break-words text-lg font-black tracking-tight text-white sm:text-xl">
            <span className="bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              {tournament.name}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            {tournament.playersCount}{" "}
            {tournament.playersCount === 1 ? "player" : "players"}
            {tournament.currentRound ? ` · Round ${tournament.currentRound}` : ""}
          </p>
        </div>

        {countdown ? (
          <div className="shrink-0 rounded-2xl border border-amber-400/45 bg-amber-950/40 px-3 py-2 text-center shadow-lg">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/90">
              Starts in
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-amber-100 sm:text-xl">
              {countdown}
            </p>
          </div>
        ) : null}
      </div>

      {isLive ? (
        <dl className="relative mt-3.5 grid grid-cols-2 gap-2 border-t border-zinc-800/80 pt-3 sm:gap-4">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Players
            </dt>
            <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
              {tournament.playersCount}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Live matches
            </dt>
            <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
              {tournament.liveMatches}
            </dd>
          </div>
        </dl>
      ) : null}

      <Link
        href={href}
        className="relative mt-3.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-amber-500 px-5 py-2.5 text-sm font-black tracking-wide text-zinc-950 shadow-[0_0_28px_rgba(34,211,238,0.32)] transition-transform hover:scale-[1.01] hover:from-cyan-300 hover:to-amber-400 sm:w-auto"
      >
        View Tournament
        <span aria-hidden>→</span>
      </Link>
    </section>
  );
}
