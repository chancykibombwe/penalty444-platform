"use client";

import { useMemo } from "react";
import type { FeaturedLiveMatch } from "../../lib/live/activity";
import FeaturedLiveMatchCard from "./FeaturedLiveMatchCard";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Tournament Live Spotlight — feature-card surface for the tournament
 * detail page. Picks the single most important active match in the
 * bracket (finals > semifinals > in_progress > ready) and renders it as
 * a hero-emphasis FeaturedLiveMatchCard.
 *
 * Pure derivation from the matches/entries that the tournament detail
 * page already loads — no extra Supabase calls, no realtime subscription.
 * This keeps the spotlight perfectly in sync with the bracket panel
 * directly below it and avoids any double-fetch overhead.
 */
type BracketMatch = {
  id: string;
  tournament_id: string;
  status: string | null;
  round_number: number | null;
  next_match_id: string | null;
  entry_one_id: string | null;
  entry_two_id: string | null;
  room_code: string | null;
};

type EntryLike = {
  id: string;
  username: string | null;
};

type Props = {
  tournamentId: string;
  tournamentName: string;
  matches: BracketMatch[];
  entries: EntryLike[];
};

export default function TournamentLiveSpotlight({
  tournamentId,
  tournamentName,
  matches,
  entries,
}: Props) {
  const featured = useMemo(
    () => pickSpotlightMatch(tournamentId, tournamentName, matches, entries),
    [tournamentId, tournamentName, matches, entries]
  );

  if (!featured) return null;

  return (
    <section
      className={`rounded-3xl border bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-4 shadow-xl sm:p-5 ${
        featured.isFinal
          ? "border-yellow-300/55 shadow-[0_0_36px_rgba(250,204,21,0.18)]"
          : featured.status === "in_progress"
            ? "border-cyan-400/40 shadow-[0_0_28px_rgba(34,211,238,0.18)]"
            : "border-zinc-800"
      }`}
      aria-label="Tournament spotlight"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label={featured.isFinal ? "Live Final" : "Tournament Spotlight"}
            tone={
              featured.isFinal
                ? "amber"
                : featured.status === "in_progress"
                  ? "cyan"
                  : "neutral"
            }
            pulsing={featured.status === "in_progress"}
            size="md"
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {featured.reason}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <FeaturedLiveMatchCard match={featured} emphasis="hero" />
      </div>
    </section>
  );
}

function pickSpotlightMatch(
  tournamentId: string,
  tournamentName: string,
  matches: BracketMatch[],
  entries: EntryLike[]
): FeaturedLiveMatch | null {
  if (matches.length === 0) return null;

  const entryNameById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.id) entryNameById.set(entry.id, (entry.username ?? "").trim());
  }

  // Total rounds in this bracket for semifinal detection.
  let totalRounds = 0;
  for (const match of matches) {
    if (match.round_number && match.round_number > totalRounds) {
      totalRounds = match.round_number;
    }
  }

  function score(match: BracketMatch): FeaturedLiveMatch | null {
    const isFinal = match.next_match_id === null;
    const isSemifinal =
      !isFinal &&
      match.round_number !== null &&
      totalRounds > 0 &&
      match.round_number === totalRounds - 1;
    const status =
      match.status === "in_progress"
        ? "in_progress"
        : match.status === "ready"
          ? "ready"
          : null;
    if (!status) return null;

    let priority: FeaturedLiveMatch["priority"];
    let reason: string;
    if (status === "in_progress" && isFinal) {
      priority = 1;
      reason = "Final · LIVE";
    } else if (status === "in_progress" && isSemifinal) {
      priority = 2;
      reason = "Semifinal · LIVE";
    } else if (status === "in_progress") {
      priority = 3;
      reason = "Bracket · LIVE";
    } else {
      priority = 4;
      reason = isFinal
        ? "Final · Ready"
        : isSemifinal
          ? "Semifinal · Ready"
          : "Bracket · Ready";
    }

    const playerOne = entryNameById.get(match.entry_one_id ?? "") || "";
    const playerTwo = entryNameById.get(match.entry_two_id ?? "") || "";

    const roundLabel = isFinal
      ? "Final"
      : isSemifinal
        ? "Semifinal"
        : match.round_number
          ? `Round ${match.round_number}`
          : "Bracket";

    return {
      id: match.id,
      tournamentId,
      tournamentName,
      roundLabel,
      playerOne: playerOne || "TBD",
      playerTwo: playerTwo || "TBD",
      isFinal,
      isSemifinal,
      status,
      roomCode: match.room_code,
      priority,
      reason,
    };
  }

  const candidates = matches
    .map(score)
    .filter((value): value is FeaturedLiveMatch => value !== null)
    .sort((a, b) => a.priority - b.priority);

  return candidates[0] ?? null;
}
