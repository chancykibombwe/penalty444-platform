import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { UNRANKED_MATCHES_THRESHOLD } from "../../../lib/player/ranks";
import {
  computeGlobalRankFromRows,
  deriveRecentForm,
  deriveStreak,
  type CompetitiveStats,
} from "../../../lib/player/stats";
import CompetitiveProfileCard from "../../../components/player/CompetitiveProfileCard";
import AchievementGrid from "../../../components/player/AchievementGrid";
import TrophiesPreview from "../../../components/player/TrophiesPreview";
import RecentForm from "../../../components/player/RecentForm";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type PlayerStatsRow = {
  user_id: string;
  username: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  goals_for: number;
  goals_against: number;
  rank_points: number;
};

type RankRow = {
  user_id: string;
  rank_points: number;
  wins: number;
  matches: number;
  goals_for: number;
};

type MatchResultRow = {
  room_code: string;
  match_instance: number;
  match_type: string;
  player_one_id: string;
  player_one_username: string;
  player_one_score: number;
  player_two_id: string;
  player_two_username: string;
  player_two_score: number;
  winner_id: string | null;
  loser_id: string | null;
  is_draw: boolean;
  created_at: string | null;
};

type DisplayMatch = {
  key: string;
  result: "W" | "D" | "L";
  opponent: string;
  opponentUsername: string;
  score: string;
  dateLabel: string;
};

type SeasonRow = {
  id: string;
  game_id: string;
  season_number: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

function formatSeasonCountdown(endsAt: string) {
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;

  const remaining = end.getTime() - Date.now();
  if (remaining <= 0) return "Season ended";

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (days > 0) return `Ends in ${days}d ${hours}h`;
  return `Ends in ${hours}h ${minutes}m`;
}

function getResultBadgeClass(result: DisplayMatch["result"]) {
  switch (result) {
    case "W":
      return "border-emerald-500/70 bg-emerald-950/70 text-emerald-200";
    case "D":
      return "border-yellow-500/70 bg-yellow-950/70 text-yellow-200";
    case "L":
      return "border-red-500/70 bg-red-950/70 text-red-200";
  }
}

function formatMatchDate(createdAt: string | null) {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function mapMatchForDisplay(match: MatchResultRow, userId: string): DisplayMatch {
  const result: DisplayMatch["result"] = match.is_draw
    ? "D"
    : match.winner_id === userId
      ? "W"
      : "L";
  const isPlayerOne = userId === match.player_one_id;
  const rawOpponent = isPlayerOne
    ? match.player_two_username
    : match.player_one_username;
  const myScore = isPlayerOne ? match.player_one_score : match.player_two_score;
  const opponentScore = isPlayerOne
    ? match.player_two_score
    : match.player_one_score;

  return {
    key: `${match.room_code}-${match.match_instance}`,
    result,
    opponent: rawOpponent || "Opponent",
    opponentUsername: (rawOpponent ?? "").trim(),
    score: `${myScore} - ${opponentScore}`,
    dateLabel: formatMatchDate(match.created_at),
  };
}

function PlayerNotFound() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Player Profile
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Player not found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          This player does not have a Penalty444 ranked profile yet.
        </p>
        <Link
          href="/leaderboard"
          className="mt-5 inline-flex rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-white hover:border-zinc-500"
        >
          View Leaderboard
        </Link>
      </div>
    </div>
  );
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: rawUserId } = await params;
  const userId = rawUserId.trim();

  if (!userId) {
    return <PlayerNotFound />;
  }

  const statsSelect =
    "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points";

  const [statsResult, rankResult, seasonResult, matchesResult, tournamentsResult] =
    await Promise.all([
      supabase
        .from("player_stats")
        .select(statsSelect)
        .eq("game_id", "penalty444")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("player_stats")
        .select("user_id, rank_points, wins, matches, goals_for")
        .eq("game_id", "penalty444")
        .gte("matches", UNRANKED_MATCHES_THRESHOLD)
        .order("rank_points", { ascending: false })
        .order("wins", { ascending: false })
        .order("matches", { ascending: false })
        .order("goals_for", { ascending: false }),
      supabase
        .from("seasons")
        .select(
          "id, game_id, season_number, name, starts_at, ends_at, is_active"
        )
        .eq("game_id", "penalty444")
        .eq("is_active", true)
        .order("season_number", { ascending: false })
        .limit(1),
      supabase
        .from("match_results")
        .select(
          "room_code, match_instance, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, loser_id, is_draw, created_at"
        )
        .or(`player_one_id.eq.${userId},player_two_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("tournaments")
        .select("id")
        .eq("game_id", "penalty444")
        .eq("status", "completed")
        .eq("winner_id", userId),
    ]);

  if (statsResult.error || !statsResult.data) {
    return <PlayerNotFound />;
  }

  const stats = statsResult.data as PlayerStatsRow;
  const rankRows = (rankResult.data ?? []) as RankRow[];
  const globalRank = computeGlobalRankFromRows(rankRows, userId, stats.matches);

  const activeSeason = !seasonResult.error
    ? ((seasonResult.data?.[0] as SeasonRow | undefined) ?? null)
    : null;
  const seasonCountdown = activeSeason
    ? formatSeasonCountdown(activeSeason.ends_at)
    : null;

  const matchHistoryUnavailable = Boolean(matchesResult.error);
  const recentMatches = matchHistoryUnavailable
    ? []
    : ((matchesResult.data ?? []) as MatchResultRow[]);
  const displayedMatches = recentMatches.map((match) =>
    mapMatchForDisplay(match, userId)
  );

  const recentForm = deriveRecentForm(recentMatches, userId, 5);
  const streak = deriveStreak(recentForm);
  const tournamentWins = tournamentsResult.error
    ? 0
    : (tournamentsResult.data?.length ?? 0);

  const competitiveStats: CompetitiveStats = {
    username: stats.username,
    rating: stats.rank_points,
    wins: stats.wins,
    losses: stats.losses,
    draws: stats.draws,
    matches: stats.matches,
    goalsFor: stats.goals_for,
    goalsAgainst: stats.goals_against,
    tournamentWins,
    streak,
    recentForm,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24 sm:pb-6">
      {activeSeason ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/35 bg-yellow-950/20 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" aria-hidden />
          <span className="text-xs font-bold text-yellow-100">
            {activeSeason.name}
          </span>
          {seasonCountdown ? (
            <span className="text-xs font-medium text-yellow-200/70">
              · {seasonCountdown}
            </span>
          ) : null}
        </div>
      ) : null}

      <CompetitiveProfileCard
        username={stats.username}
        subline="Competitor"
        stats={competitiveStats}
        globalRank={globalRank}
      />

      <RecentForm form={recentForm} />

      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-white">
            Recent Matches
          </h2>
          {displayedMatches.length > 0 ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              Last {displayedMatches.length}
            </span>
          ) : null}
        </div>
        <ul>
          {matchHistoryUnavailable ? (
            <li className="px-4 py-6 text-sm text-zinc-500">
              Match history unavailable.
            </li>
          ) : displayedMatches.length > 0 ? (
            displayedMatches.map((match) => (
              <li
                key={match.key}
                className="flex items-center gap-3 border-t border-zinc-800/80 px-4 py-3 first:border-t-0"
              >
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black ${getResultBadgeClass(match.result)}`}
                >
                  {match.result}
                </span>
                <div className="min-w-0 flex-1">
                  {match.opponentUsername.length > 0 ? (
                    <Link
                      href={`/profile/${encodeURIComponent(match.opponentUsername)}`}
                      className="block truncate text-sm font-semibold text-white hover:text-cyan-200"
                    >
                      vs {match.opponent}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-semibold text-white">
                      vs {match.opponent}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500">{match.dateLabel}</p>
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-zinc-300">
                  {match.score}
                </span>
              </li>
            ))
          ) : (
            <li className="px-4 py-6 text-sm text-zinc-500">
              No match history yet.
            </li>
          )}
        </ul>
      </div>

      <AchievementGrid stats={competitiveStats} />

      <TrophiesPreview count={tournamentWins} />

      <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800/50 px-3 py-1.5">
        <span className="text-xs font-semibold text-zinc-500">
          Season Rankings
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
          · Coming soon
        </span>
      </div>
    </div>
  );
}
