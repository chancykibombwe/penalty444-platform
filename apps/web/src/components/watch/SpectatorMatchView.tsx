"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MatchAtmosphereLayer from "../match/MatchAtmosphereLayer";
import { supabase } from "../../lib/supabase/client";
import {
  fetchWatchableMatch,
  watchableStatusLabel,
  type WatchableMatch,
} from "../../lib/live/watch";
import LivePulseBadge from "../live/LivePulseBadge";
import WatchMatchHeader from "./WatchMatchHeader";

/**
 * SpectatorMatchView — the full read-only watch surface.
 *
 * Hard rules enforced by this component (Phase 8 §STEP 9):
 *   - Never opens a gameplay socket.
 *   - Never emits `match:pick`, `room:join`, `match:rematch*`,
 *     `match:abortEarly`, `match:forfeit`, etc.
 *   - No lane buttons, no rematch / forfeit / abort buttons.
 *   - Pick lanes are NEVER rendered (DB never exposes pre-reveal picks,
 *     so this property is inherent to the data source).
 *
 * Polling: every `pollMs` (default 6s) the snapshot is re-fetched from
 * Supabase. Keeps the spectator view alive while staying well under the
 * realtime-server traffic budget.
 */
type Props = {
  roomCode: string;
  initialMatch?: WatchableMatch | null;
  pollMs?: number;
};

export default function SpectatorMatchView({
  roomCode,
  initialMatch = null,
  pollMs = 6000,
}: Props) {
  const [match, setMatch] = useState<WatchableMatch | null>(initialMatch);
  const [loading, setLoading] = useState(initialMatch === null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load(initial: boolean) {
      const next = await fetchWatchableMatch(supabase, roomCode);
      if (cancelled || !mountedRef.current) return;
      setMatch(next);
      if (initial) setLoading(false);
    }

    if (initialMatch === null) {
      void load(true);
    }
    const interval = window.setInterval(() => void load(false), pollMs);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [roomCode, pollMs, initialMatch]);

  if (loading) {
    return <WatchSkeleton />;
  }

  if (!match) {
    return <WatchNotFound roomCode={roomCode} />;
  }

  const accent = match.tournament?.isFinal
    ? "gold-final"
    : match.tournament
      ? "gold"
      : "cyan";

  return (
    <div className="relative z-10 space-y-6">
      <MatchAtmosphereLayer accent={accent} intense={match.tournament?.isFinal} />

      <WatchMatchHeader match={match} />

      <SpectatorScoreboard match={match} />

      <SpectatorRoundPanel match={match} />

      <SpectatorFooter match={match} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Scoreboard
 * ----------------------------------------------------------------------- */

function SpectatorScoreboard({ match }: { match: WatchableMatch }) {
  const final = match.finalScore;
  const showScores = final !== null;
  const winnerSide = final
    ? final.isDraw
      ? null
      : final.winnerId === match.playerOne.userId
        ? "p1"
        : final.winnerId === match.playerTwo.userId
          ? "p2"
          : null
    : null;

  return (
    <section
      className="grid grid-cols-2 gap-3 sm:gap-5"
      aria-label="Spectator scoreboard"
    >
      <SpectatorPlayerCard
        name={match.playerOne.username}
        score={showScores ? final?.playerOne ?? 0 : null}
        isWinner={winnerSide === "p1"}
        isFinal={match.tournament?.isFinal ?? false}
      />
      <SpectatorPlayerCard
        name={match.playerTwo.username}
        score={showScores ? final?.playerTwo ?? 0 : null}
        isWinner={winnerSide === "p2"}
        isFinal={match.tournament?.isFinal ?? false}
      />
    </section>
  );
}

function SpectatorPlayerCard({
  name,
  score,
  isWinner,
  isFinal,
}: {
  name: string;
  score: number | null;
  isWinner: boolean;
  isFinal: boolean;
}) {
  const border = isWinner
    ? isFinal
      ? "border-yellow-300/65 shadow-[0_0_32px_rgba(250,204,21,0.32)]"
      : "border-emerald-400/55 shadow-[0_0_24px_rgba(52,211,153,0.25)]"
    : "border-zinc-800";

  return (
    <div
      className={`min-w-0 rounded-3xl border bg-zinc-950/95 p-4 shadow-xl transition-all sm:p-5 md:rounded-[2rem] md:p-7 ${border}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
          {isWinner ? "Winner" : "Player"}
        </p>
        {isWinner ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] ${
              isFinal
                ? "bg-yellow-400/20 text-yellow-100 ring-1 ring-yellow-300/60"
                : "bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-400/55"
            }`}
          >
            {isFinal ? "Champion" : "Won"}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-zinc-400 sm:text-sm md:mt-2">
        {name}
      </p>
      <div className="mt-3 flex items-end justify-between gap-2 md:mt-4 md:gap-4">
        <p className="text-5xl font-black tabular-nums text-white sm:text-6xl md:text-7xl">
          {score === null ? "—" : score}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Round / status panel
 * ----------------------------------------------------------------------- */

function SpectatorRoundPanel({ match }: { match: WatchableMatch }) {
  const status = watchableStatusLabel(match);
  const isLive = status.tone === "live";
  const isFinal = match.finalScore !== null;

  if (isFinal) {
    return (
      <section
        className="rounded-3xl border border-yellow-300/40 bg-yellow-500/5 px-4 py-5 text-center shadow-[0_0_28px_rgba(250,204,21,0.16)]"
        aria-label="Match result"
      >
        <LivePulseBadge label="Match Ended" tone="amber" pulsing={false} />
        <p className="mt-3 text-xl font-black tracking-tight text-yellow-100 sm:text-2xl">
          {match.finalScore?.isDraw
            ? "Match ended in a draw"
            : `${match.playerOne.username} ${match.finalScore?.playerOne} – ${match.finalScore?.playerTwo} ${match.playerTwo.username}`}
        </p>
        <p className="mt-1 text-xs font-semibold text-zinc-400">
          Spectator view · Result locked
        </p>
      </section>
    );
  }

  if (isLive) {
    return (
      <section
        className="rounded-3xl border border-cyan-400/45 bg-cyan-500/5 px-4 py-5 text-center shadow-[0_0_24px_rgba(34,211,238,0.18)]"
        aria-label="Live match status"
      >
        <LivePulseBadge label="Picks Locked" tone="cyan" />
        <p className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">
          Picks locked — reveal incoming
        </p>
        <p className="mt-1 text-xs font-semibold text-zinc-400">
          Live scores update after each resolved round.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-5 text-center"
      aria-label="Match status"
    >
      <LivePulseBadge
        label={status.label}
        tone={status.tone === "ready" ? "amber" : "neutral"}
        pulsing={status.tone === "ready"}
      />
      <p className="mt-3 text-base font-semibold text-zinc-200 sm:text-lg">
        {status.tone === "ready"
          ? "Players are getting ready"
          : "Preparing live spectator view…"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Scoreboard updates automatically.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Footer + back affordances
 * ----------------------------------------------------------------------- */

function SpectatorFooter({ match }: { match: WatchableMatch }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-800/80 bg-black/40 px-4 py-3 text-[11px] font-semibold text-zinc-400">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
          Read-only
        </span>
        <span className="text-zinc-500">
          You cannot affect this match.
        </span>
      </div>
      {match.tournament ? (
        <Link
          href={`/tournaments/${match.tournament.id}`}
          className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
        >
          Tournament page →
        </Link>
      ) : (
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
        >
          Back home →
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Loading / empty states
 * ----------------------------------------------------------------------- */

function WatchSkeleton() {
  return (
    <div className="relative z-10 space-y-6" aria-hidden>
      <MatchAtmosphereLayer accent="cyan" />
      <div className="h-28 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-950/70" />
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <div className="h-44 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-950/70" />
        <div className="h-44 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-950/70" />
      </div>
      <div className="h-24 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-950/70" />
    </div>
  );
}

function WatchNotFound({ roomCode }: { roomCode: string }) {
  return (
    <div className="relative z-10 space-y-4">
      <MatchAtmosphereLayer accent="cyan" />
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center shadow-xl">
        <LivePulseBadge label="Waiting" tone="neutral" pulsing={false} />
        <h2 className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">
          Preparing live spectator view…
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Room{" "}
          <span className="font-mono text-zinc-200">
            {roomCode.toUpperCase()}
          </span>{" "}
          hasn&apos;t broadcast yet, or has already wrapped.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-bold text-zinc-200 hover:border-cyan-400/55 hover:text-cyan-100"
          >
            Back home
          </Link>
          <Link
            href="/tournaments"
            className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 hover:border-amber-300/60"
          >
            Browse tournaments
          </Link>
        </div>
      </section>
    </div>
  );
}
