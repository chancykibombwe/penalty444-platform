"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchTopRival,
  type RivalLabel,
  type RivalSummary,
} from "../../lib/social/rivals";
import HeadToHeadSummary from "./HeadToHeadSummary";
import {
  AddRivalButton,
  ChallengePlayerButton,
  ViewProfileButton,
} from "./SocialActions";

/**
 * RivalCard — the user's biggest current rival, derived live from
 * `match_results`. Mounted on the Account page and on profile pages
 * (when the viewer is looking at their own profile).
 *
 * If a `rival` prop is provided we render it directly. Otherwise we
 * fetch the top rival for `viewerUserId` and render the result.
 *
 * Empty state ("no rivalry yet") is honest — no fake opponents.
 */
type Props = {
  viewerUserId: string | null;
  rival?: RivalSummary | null;
  /** Headline override; defaults to "Top Rival". */
  title?: string;
};

const LABEL_TONE: Record<RivalLabel, { border: string; text: string; bg: string }> =
  {
    "Heating up": {
      border: "border-orange-400/55",
      text: "text-orange-100",
      bg: "bg-orange-500/10",
    },
    "You lead this matchup": {
      border: "border-emerald-400/55",
      text: "text-emerald-100",
      bg: "bg-emerald-500/10",
    },
    "They have your number": {
      border: "border-rose-400/55",
      text: "text-rose-100",
      bg: "bg-rose-500/10",
    },
    "Even rivalry": {
      border: "border-cyan-400/55",
      text: "text-cyan-100",
      bg: "bg-cyan-500/10",
    },
    "Run it back": {
      border: "border-amber-400/55",
      text: "text-amber-100",
      bg: "bg-amber-500/10",
    },
    "New rivalry": {
      border: "border-zinc-700",
      text: "text-zinc-100",
      bg: "bg-zinc-900/70",
    },
  };

export default function RivalCard({
  viewerUserId,
  rival: providedRival,
  title = "Top Rival",
}: Props) {
  const [rival, setRival] = useState<RivalSummary | null>(
    providedRival ?? null
  );
  const [loading, setLoading] = useState<boolean>(
    providedRival === undefined && Boolean(viewerUserId)
  );

  useEffect(() => {
    if (providedRival !== undefined) {
      setRival(providedRival);
      setLoading(false);
      return;
    }
    if (!viewerUserId) {
      setRival(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await fetchTopRival(supabase, viewerUserId);
      if (cancelled) return;
      setRival(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [viewerUserId, providedRival]);

  if (loading) {
    return <RivalSkeleton />;
  }

  if (!rival) {
    return (
      <section
        className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-xl sm:p-5"
        aria-label="Top rival"
      >
        <Header title={title} />
        <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          No rivalry yet — play someone 3+ times to start a head-to-head.
        </p>
      </section>
    );
  }

  const tone = LABEL_TONE[rival.label];

  return (
    <section
      className={`rounded-3xl border bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-4 shadow-xl sm:p-5 ${tone.border} ${tone.bg}`}
      aria-label="Top rival"
    >
      <Header title={title} />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-black uppercase tracking-[0.28em] ${tone.text}`}
          >
            {rival.label}
          </p>
          <h3 className="mt-1 truncate text-2xl font-black tracking-tight text-white sm:text-3xl">
            {rival.opponentUsername}
          </h3>
          <p className="mt-1 text-sm text-zinc-300">{rival.flavor}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ViewProfileButton username={rival.opponentUsername} variant="ghost" />
          <ChallengePlayerButton username={rival.opponentUsername} />
          <AddRivalButton />
        </div>
      </div>

      <div className="mt-4">
        <HeadToHeadSummary head={rival} compact />
      </div>
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/45 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-rose-100">
        <span aria-hidden>⚔</span>
        {title}
      </span>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        Derived from match history
      </p>
    </div>
  );
}

function RivalSkeleton() {
  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-xl sm:p-5"
      aria-hidden
    >
      <div className="h-3 w-32 animate-pulse rounded bg-zinc-800/80" />
      <div className="mt-4 space-y-2">
        <div className="h-5 w-40 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-800/60" />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-2xl border border-zinc-800/80 bg-zinc-950/60"
          />
        ))}
      </div>
    </section>
  );
}
