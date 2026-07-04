"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import {
  fetchMatchHistory,
  formatMatchDate,
  type MatchHistoryEntry,
} from "../../../lib/matches/matchHistory";
import MatchResultBadge from "../../matches/MatchResultBadge";
import LiveStripEmpty from "../../live/LiveStripEmpty";
import DesktopPanel from "./DesktopPanel";

/**
 * RecentMatchesPanel — desktop Home "RECENT MATCHES" panel.
 *
 * Read-only: resolves the viewer from the existing Supabase session and reads
 * their recent completed matches via the existing `lib/matches/matchHistory`
 * helper (public-read `match_results`, viewer-scoped). No writes, no sockets,
 * no gameplay/settlement/wallet changes. Logged-out or empty → safe branded
 * empty state (LiveStripEmpty) — never fake matches.
 */

const PREVIEW_COUNT = 5;

export default function RecentMatchesPanel() {
  const [entries, setEntries] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelledRef.current) return;

      const viewerId = session?.user.id ?? null;
      setLoggedIn(Boolean(viewerId));

      if (!viewerId) {
        setLoading(false);
        return;
      }

      const result = await fetchMatchHistory(viewerId, 0);
      if (cancelledRef.current) return;

      if (result.ok) {
        setEntries(result.entries.slice(0, PREVIEW_COUNT));
      }
      setLoading(false);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <DesktopPanel
      title="RECENT MATCHES"
      action={loggedIn ? { href: "/matches", label: "VIEW ALL →" } : undefined}
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-arena-muted">
          Loading your matches…
        </p>
      ) : !loggedIn ? (
        <LiveStripEmpty
          message="Sign in to see your recent matches."
          pill="Signed out"
          ctaHref="/auth/login"
          ctaLabel="Sign in →"
        />
      ) : entries.length === 0 ? (
        <LiveStripEmpty
          message="No completed matches yet. Play a free match to build your history."
          pill="No matches yet"
          ctaHref="/lobby"
          ctaLabel="Find a match →"
        />
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/matches/${entry.id}`}
                className="flex items-center gap-3 rounded-xl border border-arena-border bg-black/30 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/60 focus-visible:ring-inset"
              >
                <MatchResultBadge result={entry.result} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    vs {entry.opponentUsername}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded border border-zinc-700/70 bg-black/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                      {entry.matchTypeLabel}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {formatMatchDate(entry.createdAt)}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-zinc-300">
                  {entry.myScore}–{entry.opponentScore}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DesktopPanel>
  );
}
