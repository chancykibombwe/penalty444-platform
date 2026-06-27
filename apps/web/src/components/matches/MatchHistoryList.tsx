"use client";

/**
 * Match History list (v1, read-only).
 *
 * Resolves the viewer from the Supabase session, fetches their completed
 * matches (newest first), and renders them with simple result/type filters
 * and a "Load more" button. Loading / empty / error states included.
 *
 * Read-only: no gameplay, settlement, progression, or wallet writes.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchMatchHistory,
  formatMatchDate,
  type MatchHistoryEntry,
} from "../../lib/matches/matchHistory";
import MatchResultBadge from "./MatchResultBadge";

type FilterKey =
  | "all"
  | "wins"
  | "losses"
  | "draws"
  | "public"
  | "private"
  | "tournament";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wins", label: "Wins" },
  { key: "losses", label: "Losses" },
  { key: "draws", label: "Draws" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "tournament", label: "Tournament" },
];

function matchesFilter(entry: MatchHistoryEntry, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "wins":
      return entry.result === "W";
    case "losses":
      return entry.result === "L";
    case "draws":
      return entry.result === "D";
    case "public":
      return entry.matchTypeKey === "public";
    case "private":
      return entry.matchTypeKey === "private";
    case "tournament":
      return entry.matchTypeKey === "tournament";
  }
}

export default function MatchHistoryList() {
  const [entries, setEntries] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const viewerIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (cancelledRef.current) return;

    const viewerId = session?.user.id ?? null;
    viewerIdRef.current = viewerId;

    if (!viewerId) {
      setError("Could not load match history.");
      setLoading(false);
      return;
    }

    const result = await fetchMatchHistory(viewerId, 0);
    if (cancelledRef.current) return;

    if (result.ok) {
      setEntries(result.entries);
      setHasMore(result.hasMore);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void loadInitial();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadInitial]);

  async function loadMore() {
    const viewerId = viewerIdRef.current;
    if (!viewerId || loadingMore) return;

    setLoadingMore(true);
    const result = await fetchMatchHistory(viewerId, entries.length);
    if (cancelledRef.current) return;

    if (result.ok) {
      setEntries((prev) => [...prev, ...result.entries]);
      setHasMore(result.hasMore);
    } else {
      setError(result.error);
    }
    setLoadingMore(false);
  }

  const visible = entries.filter((entry) => matchesFilter(entry, filter));

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
                active
                  ? "border-[#3B9EFF]/55 bg-[#3B9EFF]/15 text-[#9AD2FF]"
                  : "border-zinc-800 bg-black/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            Loading match history…
          </p>
        ) : error ? (
          <p className="px-4 py-10 text-center text-sm text-red-300/80">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-zinc-400">
              No completed matches yet. Play a free match to build your history.
            </p>
            <Link
              href="/lobby"
              className="mt-3 inline-flex rounded-xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-4 py-2 text-sm font-black text-white transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              Find a Match
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            No matches for this filter.
          </p>
        ) : (
          <ul>
            {visible.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/matches/${entry.id}`}
                  className="flex items-center gap-3 border-t border-[#1B2433] px-4 py-3 transition-colors first:border-t-0 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/60 focus-visible:ring-inset"
                >
                  <MatchResultBadge result={entry.result} />
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-black tabular-nums text-zinc-300">
                      {entry.myScore}–{entry.opponentScore}
                    </span>
                    <span className="text-zinc-600" aria-hidden>
                      ›
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && !error && hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-xl border border-zinc-700/80 px-5 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
