import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import RankBadge from "../../components/player/RankBadge";
import {
  getRankTier,
  resolvePlayerTier,
  type RankTier,
} from "../../lib/player/ranks";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type LeaderboardTab = "global" | "weekly" | "tournament" | "friends";

const TAB_LABELS: Record<LeaderboardTab, string> = {
  global: "Global",
  weekly: "Weekly",
  tournament: "Tournament",
  friends: "Friends",
};

type LeaderboardScope = "season" | "all-time";

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

type LeaderboardPlayer = {
  id: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  rankPoints: number;
  tier: string;
  winRate: number;
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

function resolveTierForRow(row: LeaderboardPlayer): RankTier {
  // Prefer the rating-derived tier so the new ladder always wins; fall back
  // to legacy DB string when rating is 0/null but tier name is present.
  if (row.rankPoints > 0) {
    return getRankTier(row.rankPoints, row.matches);
  }
  return resolvePlayerTier({
    rating: row.rankPoints,
    matchesPlayed: row.matches,
    legacyTierName: row.tier,
  });
}

function getPodiumClass(index: number) {
  switch (index) {
    case 0:
      return "md:order-2 md:-mt-8 md:scale-[1.08] border-yellow-300/70 bg-[linear-gradient(180deg,_rgba(113,63,18,0.55),_rgba(9,9,11,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_36px_90px_rgba(234,179,8,0.22)] ring-1 ring-yellow-200/15";
    case 1:
      return "md:order-1 md:mt-12 border-slate-300/60 bg-[linear-gradient(180deg,_rgba(51,65,85,0.48),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(148,163,184,0.12)] ring-1 ring-white/10";
    case 2:
      return "md:order-3 md:mt-12 border-amber-600/70 bg-[linear-gradient(180deg,_rgba(120,53,15,0.44),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(180,83,9,0.16)] ring-1 ring-amber-200/10";
    default:
      return "border-zinc-800 bg-zinc-950";
  }
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

function getScopeChipClass(isActive: boolean) {
  return isActive
    ? "rounded-xl border border-yellow-500/30 bg-yellow-950/20 px-4 py-2 text-sm font-semibold text-yellow-100 shadow-lg shadow-black/30"
    : "rounded-xl border border-zinc-700/80 bg-black/45 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/30";
}

function buildLeaderboard(rows: PlayerStatsRow[]): LeaderboardPlayer[] {
  return rows
    .map((row): LeaderboardPlayer => ({
      id: row.user_id,
      username: row.username,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      matches: row.matches,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      rankPoints: row.rank_points,
      tier: row.tier,
      winRate: row.matches > 0 ? Math.round((row.wins / row.matches) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.matches !== a.matches) return b.matches - a.matches;
      return b.goalsFor - a.goalsFor;
    });
}

function parsePage(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 100;
  return Math.min(100, Math.floor(parsed));
}

function buildLeaderboardHref(
  scope: LeaderboardScope,
  options: {
    search?: string;
    page?: number;
    limit?: number;
    tab?: LeaderboardTab;
  } = {}
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({
    scope,
    page: String(page),
    limit: String(limit),
  });

  if (options.search) {
    params.set("search", options.search);
  }
  if (options.tab && options.tab !== "global") {
    params.set("tab", options.tab);
  }

  return `/leaderboard?${params.toString()}`;
}

function parseTab(value: string | undefined): LeaderboardTab {
  if (value === "weekly" || value === "tournament" || value === "friends") {
    return value;
  }
  return "global";
}

function hasValidUserId(userId: string) {
  return userId.trim().length > 0;
}

function buildChallengeHref(userId: string, username: string) {
  const params = new URLSearchParams({
    challengeUserId: userId,
    challengeUsername: username,
  });

  return `/lobby?${params.toString()}`;
}

function buildPlayerProfileHref(userId: string, username?: string | null) {
  // Phase 9: prefer the public `/profile/[username]` route. Fall back to
  // `/players/[userId]` (still supported) when no username is available.
  const trimmed = (username ?? "").trim();
  if (trimmed.length > 0) {
    return `/profile/${encodeURIComponent(trimmed)}`;
  }
  return `/players/${userId}`;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    search?: string;
    page?: string;
    limit?: string;
    tab?: string;
  }>;
}) {
  const {
    scope: rawScope,
    search: rawSearch,
    page: rawPage,
    limit: rawLimit,
    tab: rawTab,
  } = await searchParams;
  const scope: LeaderboardScope =
    rawScope === "all-time" ? "all-time" : "season";
  const tab: LeaderboardTab = parseTab(rawTab);
  const search = rawSearch?.trim() ?? "";
  const hasActiveSearch = search.length > 0;
  const page = parsePage(rawPage);
  const limit = parseLimit(rawLimit);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const seasonResult = await supabase
    .from("seasons")
    .select("id, game_id, season_number, name, starts_at, ends_at, is_active")
    .eq("game_id", "penalty444")
    .eq("is_active", true)
    .order("season_number", { ascending: false })
    .limit(1);

  const activeSeason = !seasonResult.error
    ? ((seasonResult.data?.[0] as SeasonRow | undefined) ?? null)
    : null;
  const seasonCountdown = activeSeason
    ? formatSeasonCountdown(activeSeason.ends_at)
    : null;
  const seasonLabel = activeSeason?.name ?? "Season 1";

  const statsSelect =
    "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier";

  // Phase 6: leaderboard only shows ranked players (matches >= 10). Placement
  // players are surfaced via a separate count badge in the header.
  const RANKED_MATCH_FLOOR = 10;

  const statsResult =
    scope === "all-time"
      ? await (() => {
          let query = supabase
            .from("player_stats")
            .select(statsSelect)
            .eq("game_id", "penalty444")
            .gte("matches", RANKED_MATCH_FLOOR);

          if (hasActiveSearch) {
            query = query.ilike("username", `%${search}%`);
          }

          return query
            .order("rank_points", { ascending: false })
            .order("wins", { ascending: false })
            .order("matches", { ascending: false })
            .order("goals_for", { ascending: false })
            .range(from, to);
        })()
      : activeSeason
        ? await (() => {
            let query = supabase
              .from("season_player_stats")
              .select(statsSelect)
              .eq("game_id", "penalty444")
              .eq("season_id", activeSeason.id)
              .gte("matches", RANKED_MATCH_FLOOR);

            if (hasActiveSearch) {
              query = query.ilike("username", `%${search}%`);
            }

            return query
              .order("rank_points", { ascending: false })
              .order("wins", { ascending: false })
              .order("matches", { ascending: false })
              .order("goals_for", { ascending: false })
              .range(from, to);
          })()
        : { data: [], error: null };

  const placementCountResult = await supabase
    .from("player_stats")
    .select("user_id", { count: "exact", head: true })
    .eq("game_id", "penalty444")
    .lt("matches", RANKED_MATCH_FLOOR)
    .gt("matches", 0);
  const placementPlayerCount = placementCountResult.count ?? 0;

  const error = statsResult.error;
  if (error) {
    // Keep the raw cause in server logs; the UI shows a friendly message.
    console.error("Failed to load leaderboard stats:", error.message);
  }
  const leaderboard = buildLeaderboard((statsResult.data ?? []) as PlayerStatsRow[]);
  const topPlayers = leaderboard.slice(0, 3);
  const hasNoActiveSeason = scope === "season" && !activeSeason;
  const emptyMessage =
    scope === "season"
      ? `No ${activeSeason?.name ?? "Season"} matches yet.`
      : "No completed matches yet.";
  const hrefOptions = { search, page, limit, tab };
  const seasonScopeHref = buildLeaderboardHref("season", hrefOptions);
  const allTimeScopeHref = buildLeaderboardHref("all-time", hrefOptions);
  const clearSearchHref = buildLeaderboardHref(scope, { page, limit, tab });
  const previousPageHref = buildLeaderboardHref(scope, {
    search,
    page: page - 1,
    limit,
    tab,
  });
  const nextPageHref = buildLeaderboardHref(scope, {
    search,
    page: page + 1,
    limit,
    tab,
  });
  const showNextPage = leaderboard.length === limit;
  const tabHrefs: Record<LeaderboardTab, string> = {
    global: buildLeaderboardHref(scope, { search, page: 1, limit, tab: "global" }),
    weekly: buildLeaderboardHref(scope, { search, page: 1, limit, tab: "weekly" }),
    tournament: buildLeaderboardHref(scope, {
      search,
      page: 1,
      limit,
      tab: "tournament",
    }),
    friends: buildLeaderboardHref(scope, {
      search,
      page: 1,
      limit,
      tab: "friends",
    }),
  };
  const isPlaceholderTab = tab !== "global";

  return (
    <section className="space-y-10 rounded-[2rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.10),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:p-7 lg:p-9">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.34em] text-yellow-300/70">
            Competitive Arena
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">
            444 ARENA Rankings
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-500 sm:text-base">
            Live rankings based on saved match results.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="rounded-xl border border-zinc-700/80 bg-black/45 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/30">
            Penalty444
          </div>
          {placementPlayerCount > 0 ? (
            <div
              className="rounded-xl border border-cyan-400/45 bg-cyan-950/30 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]"
              title="Players still completing their placement matches"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">
                In placement
              </span>
              <span className="ml-2 font-black tabular-nums text-white">
                {placementPlayerCount}
              </span>
            </div>
          ) : null}
          <Link
            href={seasonScopeHref}
            className={getScopeChipClass(scope === "season")}
          >
            <span>{seasonLabel}</span>
            {scope === "season" && seasonCountdown ? (
              <span className="mt-1 block text-xs font-medium text-yellow-200/80">
                {seasonCountdown}
              </span>
            ) : null}
          </Link>
          <Link
            href={allTimeScopeHref}
            className={getScopeChipClass(scope === "all-time")}
          >
            All Time
          </Link>
        </div>
      </div>

      <nav
        className="-mx-1 flex gap-2 overflow-x-auto rounded-2xl border border-zinc-800/80 bg-black/45 p-2 shadow-lg shadow-black/30"
        aria-label="Leaderboard tabs"
      >
        {(Object.keys(TAB_LABELS) as LeaderboardTab[]).map((t) => {
          const isActive = tab === t;
          return (
            <Link
              key={t}
              href={tabHrefs[t]}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black uppercase tracking-[0.18em] transition ${
                isActive
                  ? "border border-cyan-300/60 bg-cyan-950/40 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.22)]"
                  : "border border-transparent text-zinc-400 hover:border-zinc-700 hover:text-white"
              }`}
            >
              {TAB_LABELS[t]}
            </Link>
          );
        })}
      </nav>

      {isPlaceholderTab ? (
        <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-6 text-zinc-300 shadow-lg shadow-black/30">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300/85">
            {TAB_LABELS[tab]} leaderboard
          </p>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Coming soon
          </h2>
          <p className="mt-2 max-w-xl text-sm text-zinc-500">
            {tab === "weekly"
              ? "Weekly resets ladder will track 7-day performance once seasonal scoring lands."
              : tab === "tournament"
                ? "Bracket performance points unlock when the tournament scoring system ships."
                : "Connect with friends to see how you stack up. Friend graph coming soon."}
          </p>
          <Link
            href={tabHrefs.global}
            className="mt-4 inline-flex rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:border-zinc-500"
          >
            Back to Global
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 p-5 text-red-200">
          Could not load leaderboard. Please refresh.
        </div>
      ) : null}

      {!isPlaceholderTab && topPlayers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3 md:items-start">
          {topPlayers.map((player, index) => (
            <div
              key={player.id}
              className={`min-h-[310px] rounded-[1.75rem] border p-7 md:min-h-[340px] md:p-8 ${getPodiumClass(
                index
              )}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-4xl font-black tracking-tight text-white">
                  #{index + 1}
                </div>
                <RankBadge
                  tier={resolveTierForRow(player)}
                  rating={player.rankPoints}
                  showRating={false}
                  variant="chip"
                />
              </div>

              <div className="mt-7 flex flex-col items-center text-center">
                {hasValidUserId(player.id) ? (
                  <Link
                    href={buildPlayerProfileHref(player.id, player.username)}
                    className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/70 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(0,0,0,0.45)] transition hover:border-white/30 hover:text-yellow-100 md:h-24 md:w-24 md:text-3xl"
                  >
                    {getInitials(player.username)}
                  </Link>
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/70 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(0,0,0,0.45)] md:h-24 md:w-24 md:text-3xl">
                    {getInitials(player.username)}
                  </div>
                )}
                {hasValidUserId(player.id) ? (
                  <Link
                    href={buildPlayerProfileHref(player.id, player.username)}
                    className="mt-5 max-w-full truncate text-2xl font-black tracking-tight text-white transition hover:text-yellow-100"
                  >
                    {player.username}
                  </Link>
                ) : (
                  <div className="mt-5 max-w-full truncate text-2xl font-black tracking-tight text-white">
                    {player.username}
                  </div>
                )}
                <div className="mt-4 text-6xl font-black tracking-tighter text-white">
                  {player.rankPoints}
                </div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  ranked points
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-xs font-semibold text-zinc-400 shadow-inner">
                <span>
                  {player.wins}W / {player.losses}L / {player.draws}D
                </span>
                <span className="font-semibold text-white">
                  {player.winRate}%
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {isPlaceholderTab ? null : (
      <form
        action="/leaderboard"
        method="get"
        className="flex flex-col gap-3 rounded-2xl border border-zinc-800/80 bg-black/45 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center"
      >
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="limit" value={limit} />
        <input
          type="search"
          name="search"
          defaultValue={search}
          placeholder="Search player username..."
          className="w-full rounded-xl border border-zinc-700/80 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-white hover:border-zinc-500"
          >
            Search
          </button>
          {hasActiveSearch ? (
            <Link
              href={clearSearchHref}
              className="text-sm font-semibold text-yellow-200/80 hover:text-yellow-100"
            >
              Clear search
            </Link>
          ) : null}
        </div>
      </form>
      )}

      {isPlaceholderTab ? null : (
      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-black/45 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left">
            <thead className="bg-black/55">
              <tr className="text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Wins</th>
                <th className="px-4 py-3">Losses</th>
                <th className="px-4 py-3">Draws</th>
                <th className="px-4 py-3">Matches</th>
                <th className="px-4 py-3">Goals For</th>
                <th className="px-4 py-3">Goals Against</th>
                <th className="px-4 py-3">Win Rate</th>
              </tr>
            </thead>

            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                    {hasNoActiveSeason ? (
                      <div className="space-y-2">
                        <p className="text-base font-semibold text-zinc-300">
                          No active season right now.
                        </p>
                        <p className="text-sm text-zinc-500">
                          Season rankings will appear once a season becomes active.
                        </p>
                      </div>
                    ) : hasActiveSearch ? (
                      <p>{`No players found for "${search}".`}</p>
                    ) : (
                      <div className="space-y-4">
                        <p>{emptyMessage}</p>
                        <Link
                          href="/lobby"
                          className="inline-flex rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-white hover:border-zinc-500"
                        >
                          Start Playing
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                leaderboard.map((player, index) => (
                  <tr
                    key={player.id}
                    className="border-t border-zinc-800 hover:bg-zinc-800/40"
                  >
                    <td className="px-4 py-4 text-lg font-black text-zinc-50">
                      #{from + index + 1}
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {hasValidUserId(player.id) ? (
                          <Link
                            href={buildPlayerProfileHref(player.id, player.username)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-black/60 text-xs font-black text-white shadow-inner transition hover:border-zinc-500 hover:text-yellow-100"
                          >
                            {getInitials(player.username)}
                          </Link>
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-black/60 text-xs font-black text-white shadow-inner">
                            {getInitials(player.username)}
                          </div>
                        )}
                        {hasValidUserId(player.id) ? (
                          <Link
                            href={buildPlayerProfileHref(player.id, player.username)}
                            className="font-bold text-white transition hover:text-yellow-100"
                          >
                            {player.username}
                          </Link>
                        ) : (
                          <span className="font-bold text-white">
                            {player.username}
                          </span>
                        )}
                        {hasActiveSearch && hasValidUserId(player.id) ? (
                          <Link
                            href={buildChallengeHref(player.id, player.username)}
                            className="shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-950/20 px-2.5 py-1 text-xs font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.12)] hover:border-cyan-300/60 hover:text-cyan-50"
                          >
                            Challenge
                          </Link>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <RankBadge
                        tier={resolveTierForRow(player)}
                        rating={player.rankPoints}
                        showRating={false}
                        variant="chip"
                      />
                    </td>
                    <td className="px-4 py-4 text-lg font-black text-yellow-100">
                      {player.rankPoints}
                    </td>
                    <td className="px-4 py-4 text-white">{player.wins}</td>
                    <td className="px-4 py-4 text-white">{player.losses}</td>
                    <td className="px-4 py-4 text-white">{player.draws}</td>
                    <td className="px-4 py-4 text-white">{player.matches}</td>
                    <td className="px-4 py-4 text-white">{player.goalsFor}</td>
                    <td className="px-4 py-4 text-white">
                      {player.goalsAgainst}
                    </td>
                    <td className="px-4 py-4 text-white">{player.winRate}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800/80 px-4 py-4">
          {page > 1 ? (
            <Link
              href={previousPageHref}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:border-zinc-500"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {showNextPage ? (
            <Link
              href={nextPageHref}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:border-zinc-500"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
      )}
    </section>
  );
}
