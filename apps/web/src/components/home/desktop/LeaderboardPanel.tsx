"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTopPlayers, type TopPlayer } from "../../../lib/leaderboard/topPlayers";
import LiveStripEmpty from "../../live/LiveStripEmpty";
import DesktopPanel from "./DesktopPanel";

/**
 * LeaderboardPanel — desktop Home "LEADERBOARD" panel.
 *
 * Read-only: reads the top players by rank points from the existing public
 * `player_stats` table via `lib/leaderboard/topPlayers` (mirrors the full
 * Leaderboard page ordering). No writes, no schema/RLS changes. Empty result
 * → safe branded empty state — never fake players or fake ranks.
 */

const PREVIEW_COUNT = 5;

const RANK_ACCENT: Record<number, string> = {
  1: "text-arena-gold",
  2: "text-zinc-200",
  3: "text-amber-600",
};

export default function LeaderboardPanel() {
  const [players, setPlayers] = useState<TopPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    void (async () => {
      const rows = await fetchTopPlayers(PREVIEW_COUNT);
      if (cancelledRef.current) return;
      setPlayers(rows);
      setLoading(false);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <DesktopPanel
      title="LEADERBOARD"
      action={{ href: "/leaderboard", label: "VIEW ALL →" }}
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-arena-muted">
          Loading leaderboard…
        </p>
      ) : players.length === 0 ? (
        <LiveStripEmpty
          message="The leaderboard is warming up. Play ranked free matches to climb it."
          pill="Beta warming up"
          ctaHref="/lobby"
          ctaLabel="Play free →"
        />
      ) : (
        <ul className="space-y-1.5">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-3 rounded-xl border border-arena-border bg-black/30 px-3 py-2"
            >
              <span
                className={`w-6 shrink-0 text-center text-sm font-black tabular-nums ${
                  RANK_ACCENT[player.rank] ?? "text-arena-muted"
                }`}
              >
                {player.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                  <span className="truncate">{player.username}</span>
                  {player.provisional ? (
                    <span className="shrink-0 rounded border border-zinc-700/70 bg-black/40 px-1 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-zinc-500">
                      Placement
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {player.wins}W · {player.losses}L · {player.matches} played
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-black tabular-nums text-arena-primary">
                  {player.rankPoints.toLocaleString()}
                </span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-600">
                  pts
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DesktopPanel>
  );
}
