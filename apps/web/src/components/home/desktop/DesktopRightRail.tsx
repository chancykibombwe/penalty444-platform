"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import {
  EMPTY_COUNTS,
  fetchPlatformLiveCounts,
  type PlatformLiveCounts,
} from "../../../lib/live/activity";
import { useVisibleInterval } from "../../../lib/polling/useVisibleInterval";
import LiveStripEmpty from "../../live/LiveStripEmpty";
import DesktopPanel from "./DesktopPanel";

/**
 * DesktopRightRail — right rail for the Home Desktop V1 layout.
 *
 * Four panels, all beta-safe and read-only / display-only:
 *   • LIVE ARENA      — real platform live counts (read-only). Its action is
 *                       "VIEW LOBBY →" — active rooms are the lobby, never
 *                       labelled "tournaments".
 *   • BETA CHALLENGES — safe branded info panel (no fake challenge data).
 *   • ONLINE PLAYERS  — safe branded empty state; we do NOT fake presence /
 *                       online counts (presence lives on the realtime server,
 *                       which this layout PR must not touch).
 *   • INVITE FRIENDS  — invite-only share entry. No earning / rewards wording.
 *
 * No writes, no sockets, no gameplay/wallet/economy changes.
 */
export default function DesktopRightRail() {
  return (
    <aside className="space-y-4" aria-label="Arena side panels">
      <LiveArenaPanel />
      <BetaChallengesPanel />
      <OnlinePlayersPanel />
      <InviteFriendsPanel />
    </aside>
  );
}

function LiveArenaPanel() {
  const [counts, setCounts] = useState<PlatformLiveCounts | null>(null);

  useVisibleInterval(
    async (signal) => {
      const next = await fetchPlatformLiveCounts(supabase);
      if (signal.aborted) return;
      setCounts(next);
    },
    { intervalMs: 30_000 }
  );

  const data = counts ?? EMPTY_COUNTS;
  const isLoading = counts === null;
  const totalLive = data.liveMatches + data.liveTournaments;

  return (
    <DesktopPanel
      title="LIVE ARENA"
      action={{ href: "/lobby", label: "VIEW LOBBY →" }}
    >
      {isLoading ? (
        <p className="py-4 text-center text-sm text-arena-muted">Loading…</p>
      ) : totalLive === 0 ? (
        <LiveStripEmpty
          message="The arena is quiet right now. Be the first to start a live match."
          pill="Beta warming up"
          ctaHref="/lobby"
          ctaLabel="Enter Lobby →"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <LiveCountTile label="Live Matches" value={data.liveMatches} pulse />
          <LiveCountTile
            label="Live Tournaments"
            value={data.liveTournaments}
            pulse
          />
        </div>
      )}
    </DesktopPanel>
  );
}

function LiveCountTile({
  label,
  value,
  pulse = false,
}: {
  label: string;
  value: number;
  pulse?: boolean;
}) {
  const showPulse = pulse && value > 0;
  return (
    <div className="rounded-xl border border-arena-primary/35 bg-arena-primary/10 px-2.5 py-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-[#9AD2FF]">
          {label}
        </span>
        {showPulse ? (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-arena-primary"
            aria-hidden
          />
        ) : null}
      </div>
      <p className="mt-0.5 text-xl font-black tabular-nums text-white">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function BetaChallengesPanel() {
  return (
    <DesktopPanel title="BETA CHALLENGES">
      <div className="rounded-xl border border-arena-border bg-black/30 px-3 py-3">
        <p className="text-sm font-bold text-white">Free-play skill challenges</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-400">
          Challenge a friend to a 1v1 or jump into a public room. All skill —
          no entry fees, no stakes.
        </p>
        <Link
          href="/lobby"
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-arena-primary transition-colors hover:text-[#9AD2FF] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-arena-primary/60"
        >
          Create a room <span aria-hidden>→</span>
        </Link>
      </div>
    </DesktopPanel>
  );
}

function OnlinePlayersPanel() {
  return (
    <DesktopPanel title="ONLINE PLAYERS">
      <LiveStripEmpty
        message="Live presence is warming up in beta. Head to the lobby to find opponents."
        pill="Presence soon"
        ctaHref="/lobby"
        ctaLabel="Enter Lobby →"
      />
    </DesktopPanel>
  );
}

function InviteFriendsPanel() {
  const [copied, setCopied] = useState(false);

  async function copyInvite() {
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(origin || "https://444arena.app");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <DesktopPanel title="INVITE FRIENDS">
      <div className="rounded-xl border border-arena-border bg-black/30 px-3 py-3">
        <p className="text-sm font-bold text-white">Bring a friend to the arena</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-400">
          Share 444 ARENA and settle it in a free 1v1. Free-play beta only.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyInvite()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-arena-primary/45 bg-arena-primary/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#9AD2FF] transition-colors hover:bg-arena-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          >
            {copied ? "Link copied ✓" : "Copy invite link"}
          </button>
          <Link
            href="/lobby"
            className="text-[11px] font-black uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/60"
          >
            Create room →
          </Link>
        </div>
      </div>
    </DesktopPanel>
  );
}
