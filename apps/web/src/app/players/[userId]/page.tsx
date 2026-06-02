import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { resolvePlayerTier, UNRANKED_MATCHES_THRESHOLD } from "../../../lib/player/ranks";
import { getPlacementStatus } from "../../../lib/player/progression";
import { computeGlobalRankFromRows } from "../../../lib/player/stats";

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
  tier: string;
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

function getInitials(username: string) {
  const initials = username
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "?";
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
  const opponent = isPlayerOne
    ? match.player_two_username
    : match.player_one_username;
  const myScore = isPlayerOne ? match.player_one_score : match.player_two_score;
  const opponentScore = isPlayerOne
    ? match.player_two_score
    : match.player_one_score;

  return {
    key: `${match.room_code}-${match.match_instance}`,
    result,
    opponent,
    score: `${myScore} - ${opponentScore}`,
    dateLabel: formatMatchDate(match.created_at),
  };
}

/**
 * Resolve a trustworthy tier label from rank_points using the shared rank
 * helper — never the raw DB `tier` string. Players still in placement
 * (matches < UNRANKED_MATCHES_THRESHOLD) are shown "Placement".
 */
function resolveTierDisplay(
  rankPoints: number | null | undefined,
  matches: number | null | undefined
): { label: string; badgeClass: string } {
  if (getPlacementStatus(matches).inPlacement) {
    return {
      label: "Placement",
      badgeClass: "border-cyan-500/45 bg-cyan-950/35 text-cyan-200",
    };
  }
  const tier = resolvePlayerTier({
    rating: rankPoints ?? null,
    matchesPlayed: matches ?? null,
  });
  return {
    label: tier.label,
    badgeClass: `${tier.borderClass} ${tier.bgClass} ${tier.textClass}`,
  };
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-black tracking-tight text-white">
        {value}
      </p>
    </div>
  );
}

function PlayerNotFound() {
  return (
    <section className="space-y-8 rounded-[2rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.10),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:p-7 lg:p-9">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.34em] text-yellow-300/70">
          Player Profile
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">
          Player not found
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-500 sm:text-base">
          This player does not have a Penalty444 ranked profile yet.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <p className="text-zinc-400">
          Check the spelling or browse the leaderboard for active competitors.
        </p>
        <Link
          href="/leaderboard"
          className="mt-4 inline-flex rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-white hover:border-zinc-500"
        >
          View Leaderboard
        </Link>
      </div>
    </section>
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
    "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier";

  const [statsResult, rankResult, seasonResult, matchesResult] =
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
    ]);

  if (statsResult.error || !statsResult.data) {
    return <PlayerNotFound />;
  }

  const stats = statsResult.data as PlayerStatsRow;
  const rankRows = (rankResult.data ?? []) as RankRow[];
  const globalRank = computeGlobalRankFromRows(
    rankRows,
    userId,
    stats.matches
  );

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

  const displayName = stats.username;
  const tierDisplay = resolveTierDisplay(stats.rank_points, stats.matches);
  const rankPoints = stats.rank_points ?? 0;

  return (
    <section className="space-y-8 rounded-[2rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.10),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:p-7 lg:p-9">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.34em] text-yellow-300/70">
          Player Profile
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">
          {displayName}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-500 sm:text-base">
          Public Penalty444 ranked profile and arena stats.
        </p>
        {activeSeason ? (
          <div className="mt-4 inline-flex flex-col rounded-xl border border-yellow-500/30 bg-yellow-950/20 px-4 py-3 shadow-lg shadow-black/30">
            <p className="text-sm font-semibold text-yellow-100">
              {activeSeason.name} · Active
            </p>
            {seasonCountdown ? (
              <p className="mt-1 text-xs font-medium text-yellow-200/80">
                {seasonCountdown}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-[1.75rem] border border-zinc-800/80 bg-black/45 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.45)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/70 text-3xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(0,0,0,0.45)]">
              {getInitials(displayName)}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                  {displayName}
                </h2>
                <span
                  className={`inline-flex rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide ${tierDisplay.badgeClass}`}
                >
                  {tierDisplay.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-500">
                Penalty444 ranked competitor
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
            <div className="rounded-2xl border border-yellow-300/20 bg-yellow-950/10 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-300/70">
                Rank Points
              </p>
              <p className="mt-2 text-4xl font-black tracking-tighter text-yellow-100">
                {rankPoints}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-700/80 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                Global Rank
              </p>
              <p className="mt-2 text-4xl font-black tracking-tighter text-white">
                {globalRank ? `#${globalRank}` : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Matches" value={stats.matches} />
        <StatCard label="Wins" value={stats.wins} />
        <StatCard label="Losses" value={stats.losses} />
        <StatCard label="Draws" value={stats.draws} />
        <StatCard label="Goals For" value={stats.goals_for} />
        <StatCard label="Goals Against" value={stats.goals_against} />
      </div>

      <div className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-black/45 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-400">Season Rankings</span>
        <span className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Coming soon
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-black/45 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <div className="border-b border-zinc-800/80 px-5 py-4">
          <h2 className="text-lg font-black text-white">Recent Matches</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Latest Penalty444 arena results.
          </p>
        </div>
        {matchHistoryUnavailable ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            Match history unavailable.
          </p>
        ) : displayedMatches.length > 0 ? (
          <div>
            {displayedMatches.map((match) => (
              <div
                key={match.key}
                className="flex flex-col gap-3 border-t border-zinc-800/80 px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-black ${getResultBadgeClass(
                      match.result
                    )}`}
                  >
                    {match.result}
                  </span>
                  <div>
                    <p className="font-semibold text-white">
                      vs {match.opponent}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {match.dateLabel}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm sm:justify-end">
                  <span className="font-semibold text-white">{match.score}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-zinc-500">
            No match history yet.
          </p>
        )}
      </div>
    </section>
  );
}
