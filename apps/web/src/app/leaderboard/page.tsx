import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import RankBadge from "../../components/player/RankBadge";
import {
  resolvePlayerTier,
  UNRANKED_MATCHES_THRESHOLD,
  type RankTier,
} from "../../lib/player/ranks";

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
  rank_points: number;
};

type LeaderboardPlayer = {
  id: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  goalsFor: number;
  rankPoints: number;
  winRate: number;
};

function resolveTierForRow(row: LeaderboardPlayer): RankTier {
  return resolvePlayerTier({
    rating: row.rankPoints,
    matchesPlayed: row.matches,
  });
}

function getPodiumClass(index: number) {
  switch (index) {
    case 0:
      return "border-yellow-300/70 bg-[linear-gradient(180deg,_rgba(113,63,18,0.55),_rgba(9,9,11,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_36px_90px_rgba(234,179,8,0.22)] ring-1 ring-yellow-200/15";
    case 1:
      return "border-slate-300/60 bg-[linear-gradient(180deg,_rgba(51,65,85,0.48),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(148,163,184,0.12)] ring-1 ring-white/10";
    case 2:
      return "border-amber-600/70 bg-[linear-gradient(180deg,_rgba(120,53,15,0.44),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(180,83,9,0.16)] ring-1 ring-amber-200/10";
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
      rankPoints: row.rank_points,
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
  options: {
    search?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (options.search) {
    params.set("search", options.search);
  }

  return `/leaderboard?${params.toString()}`;
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
  const trimmed = (username ?? "").trim();
  if (trimmed.length > 0) {
    return `/profile/${encodeURIComponent(trimmed)}`;
  }
  return `/players/${userId}`;
}

function rankNumberColor(rank: number) {
  if (rank === 1) return "text-yellow-300";
  if (rank === 2) return "text-zinc-300";
  if (rank === 3) return "text-amber-400";
  return "text-zinc-500";
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
    limit?: string;
  }>;
}) {
  const { search: rawSearch, page: rawPage, limit: rawLimit } =
    await searchParams;
  const search = rawSearch?.trim() ?? "";
  const hasActiveSearch = search.length > 0;
  const page = parsePage(rawPage);
  const limit = parseLimit(rawLimit);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const statsSelect =
    "user_id, username, matches, wins, losses, draws, goals_for, rank_points";

  const RANKED_MATCH_FLOOR = UNRANKED_MATCHES_THRESHOLD;

  let statsQuery = supabase
    .from("player_stats")
    .select(statsSelect)
    .eq("game_id", "penalty444")
    .gte("matches", RANKED_MATCH_FLOOR);

  if (hasActiveSearch) {
    statsQuery = statsQuery.ilike("username", `%${search}%`);
  }

  const [statsResult, placementCountResult] = await Promise.all([
    statsQuery
      .order("rank_points", { ascending: false })
      .order("wins", { ascending: false })
      .order("matches", { ascending: false })
      .order("goals_for", { ascending: false })
      .range(from, to),
    supabase
      .from("player_stats")
      .select("user_id", { count: "exact", head: true })
      .eq("game_id", "penalty444")
      .lt("matches", RANKED_MATCH_FLOOR)
      .gt("matches", 0),
  ]);

  const placementPlayerCount = placementCountResult.count ?? 0;

  const error = statsResult.error;
  if (error) {
    console.error("Failed to load leaderboard stats:", error.message);
  }

  const leaderboard = buildLeaderboard(
    (statsResult.data ?? []) as PlayerStatsRow[]
  );
  const topPlayers = leaderboard.slice(0, 3);

  const clearSearchHref = buildLeaderboardHref({ page, limit });
  const previousPageHref = buildLeaderboardHref({
    search,
    page: page - 1,
    limit,
  });
  const nextPageHref = buildLeaderboardHref({
    search,
    page: page + 1,
    limit,
  });
  const showNextPage = leaderboard.length === limit;

  // Show podium only on page 1 with no active search
  const showPodium = !error && topPlayers.length > 0 && page === 1 && !hasActiveSearch;
  // When podium is shown, the list starts from rank 4
  const listPlayers = showPodium ? leaderboard.slice(topPlayers.length) : leaderboard;
  const listRankOffset = showPodium ? topPlayers.length : from;

  return (
    <section
      className="space-y-3 rounded-[1.75rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.08),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.06),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-3 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:space-y-4 sm:p-5 md:rounded-[2rem] md:p-6 lg:p-8"
      aria-label="444 ARENA Leaderboard"
    >
      {/* ── Header ── */}
      <header className="flex flex-col gap-2 sm:gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.32em] text-yellow-300/70 sm:text-xs">
            Competitive Arena
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
            444 ARENA Rankings
          </h1>
          <p className="mt-1 text-xs text-zinc-500 sm:mt-2 sm:text-sm">
            Global rankings from verified Penalty444 match results.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="rounded-lg border border-yellow-600/35 bg-yellow-900/20 px-2.5 py-1 text-xs font-bold text-yellow-200/90 sm:rounded-xl sm:px-4 sm:py-1.5">
            Global · All Time
          </span>
          <span className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-2.5 py-1 text-xs font-bold text-zinc-400 sm:rounded-xl sm:px-4 sm:py-1.5">
            Season: Coming Soon
          </span>
          {placementPlayerCount > 0 ? (
            <span
              className="rounded-lg border border-cyan-500/40 bg-cyan-900/20 px-2.5 py-1 text-xs font-bold text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.14)] sm:rounded-xl sm:px-4 sm:py-1.5"
              title="Players still completing their placement matches"
            >
              {placementPlayerCount} in placement
            </span>
          ) : null}
        </div>
      </header>

      {/* ── Error state ── */}
      {error ? (
        <div className="rounded-2xl border border-red-800/60 bg-red-950/40 p-4 text-sm text-red-200 sm:p-5">
          Could not load leaderboard. Please refresh.
        </div>
      ) : null}

      {/* ── Podium — top 3 — page 1 only, no search ── */}
      {showPodium ? (
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3 md:gap-5">
          {topPlayers.map((player, index) => {
            const rank = index + 1;
            const rankColor = rankNumberColor(rank);
            // Visual podium order: silver(2) left, gold(1) center, bronze(3) right
            const orderClass =
              index === 0 ? "order-2" : index === 1 ? "order-1" : "order-3";
            const liftClass =
              index === 0
                ? "-mt-3 sm:-mt-5 md:-mt-7"
                : "mt-3 sm:mt-5 md:mt-7";
            return (
              <div
                key={player.id}
                className={`${orderClass} ${liftClass} flex flex-col rounded-2xl border p-2.5 sm:p-4 md:rounded-[1.75rem] md:p-6 ${getPodiumClass(index)}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={`text-base font-black leading-none sm:text-xl md:text-3xl ${rankColor}`}
                  >
                    #{rank}
                  </span>
                  <RankBadge
                    tier={resolveTierForRow(player)}
                    rating={player.rankPoints}
                    matchesPlayed={player.matches}
                    showRating={false}
                    variant="chip"
                  />
                </div>

                <div className="mt-2.5 flex flex-col items-center text-center sm:mt-4">
                  {hasValidUserId(player.id) ? (
                    <Link
                      href={buildPlayerProfileHref(player.id, player.username)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/70 text-xs font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:border-white/30 sm:h-14 sm:w-14 sm:text-base md:h-20 md:w-20 md:text-xl"
                    >
                      {getInitials(player.username)}
                    </Link>
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/70 text-xs font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] sm:h-14 sm:w-14 sm:text-base md:h-20 md:w-20 md:text-xl">
                      {getInitials(player.username)}
                    </div>
                  )}

                  {hasValidUserId(player.id) ? (
                    <Link
                      href={buildPlayerProfileHref(player.id, player.username)}
                      className="mt-1.5 max-w-full truncate text-xs font-black text-white transition hover:text-yellow-100 sm:mt-2 sm:text-sm md:text-xl"
                    >
                      {player.username}
                    </Link>
                  ) : (
                    <p className="mt-1.5 max-w-full truncate text-xs font-black text-white sm:mt-2 sm:text-sm md:text-xl">
                      {player.username}
                    </p>
                  )}

                  <p className="mt-0.5 text-xl font-black tabular-nums text-white sm:mt-1 sm:text-3xl md:text-5xl">
                    {player.rankPoints}
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500 sm:text-[10px]">
                    pts
                  </p>
                </div>

                <div className="mt-2 rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-center text-[9px] font-semibold text-zinc-400 sm:mt-3 sm:text-xs">
                  {player.wins}W · {player.losses}L · {player.draws}D
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Search ── */}
      <form
        action="/leaderboard"
        method="get"
        className="flex flex-col gap-2 rounded-xl border border-zinc-800/70 bg-black/40 p-3 sm:flex-row sm:items-center sm:gap-3 sm:rounded-2xl sm:p-4"
      >
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="limit" value={limit} />
        <input
          type="search"
          name="search"
          defaultValue={search}
          placeholder="Search player username…"
          className="w-full rounded-lg border border-zinc-700/80 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none sm:rounded-xl sm:px-4 sm:py-2.5"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4 sm:py-2.5"
          >
            Search
          </button>
          {hasActiveSearch ? (
            <Link
              href={clearSearchHref}
              className="text-sm font-semibold text-yellow-200/80 hover:text-yellow-100"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {/* ── Mobile card list — hidden on md+ ── */}
      {(!showPodium || listPlayers.length > 0) ? (
        <div className="space-y-1.5 md:hidden">
          {listPlayers.length === 0 ? (
            hasActiveSearch ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-5 text-center text-sm text-zinc-400">
                {`No players found for "${search}".`}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center">
                <p className="text-sm text-zinc-400">
                  No ranked players yet. Complete 10 placement matches to appear.
                </p>
                <Link
                  href="/lobby"
                  className="inline-flex rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-white hover:border-zinc-500"
                >
                  Start Playing
                </Link>
              </div>
            )
          ) : (
            listPlayers.map((player, index) => {
              const rank = listRankOffset + index + 1;
              return (
                <div
                  key={player.id}
                  className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"
                >
                  <div
                    className={`w-6 shrink-0 text-center text-sm font-black sm:w-8 sm:text-base ${rankNumberColor(rank)}`}
                  >
                    {rank}
                  </div>

                  {hasValidUserId(player.id) ? (
                    <Link
                      href={buildPlayerProfileHref(player.id, player.username)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-black/60 text-xs font-black text-white transition hover:border-zinc-500 sm:h-10 sm:w-10"
                    >
                      {getInitials(player.username)}
                    </Link>
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-black/60 text-xs font-black text-white sm:h-10 sm:w-10">
                      {getInitials(player.username)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className="block truncate text-sm font-bold text-white transition hover:text-yellow-100"
                      >
                        {player.username}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-bold text-white">
                        {player.username}
                      </span>
                    )}
                    <RankBadge
                      tier={resolveTierForRow(player)}
                      rating={player.rankPoints}
                      matchesPlayed={player.matches}
                      showRating={false}
                      variant="chip"
                      className="mt-0.5"
                    />
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black tabular-nums text-yellow-200 sm:text-base">
                      {player.rankPoints}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      {player.wins}W {player.losses}L
                    </p>
                  </div>

                  {hasActiveSearch && hasValidUserId(player.id) ? (
                    <Link
                      href={buildChallengeHref(player.id, player.username)}
                      className="shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-950/20 px-2 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60 sm:px-2.5"
                    >
                      Challenge
                    </Link>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* ── Desktop table — hidden below md ── */}
      {(!showPodium || listPlayers.length > 0) ? (
        <div className="hidden overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/60 shadow-[0_28px_80px_rgba(0,0,0,0.45)] md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-900/60">
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-5 py-3.5 font-black">Rank</th>
                  <th className="px-5 py-3.5 font-black">Player</th>
                  <th className="px-5 py-3.5 font-black">Tier</th>
                  <th className="px-5 py-3.5 font-black tabular-nums">Points</th>
                  <th className="px-5 py-3.5 font-black">W</th>
                  <th className="px-5 py-3.5 font-black">L</th>
                  <th className="px-5 py-3.5 font-black">D</th>
                  <th className="px-5 py-3.5 font-black">Played</th>
                  <th className="px-5 py-3.5 font-black">Win %</th>
                </tr>
              </thead>

              <tbody>
                {listPlayers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-10 text-center text-zinc-400"
                    >
                      {hasActiveSearch ? (
                        <p className="text-sm">{`No players found for "${search}".`}</p>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-sm">
                            No ranked players yet. Complete 10 placement matches
                            to appear.
                          </p>
                          <Link
                            href="/lobby"
                            className="inline-flex rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-white hover:border-zinc-500"
                          >
                            Start Playing
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  listPlayers.map((player, index) => {
                    const rank = listRankOffset + index + 1;
                    return (
                      <tr
                        key={player.id}
                        className="border-t border-zinc-800/60 transition hover:bg-zinc-800/30"
                      >
                        <td
                          className={`px-5 py-4 text-base font-black tabular-nums ${rankNumberColor(rank)}`}
                        >
                          #{rank}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {hasValidUserId(player.id) ? (
                              <Link
                                href={buildPlayerProfileHref(
                                  player.id,
                                  player.username
                                )}
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
                                href={buildPlayerProfileHref(
                                  player.id,
                                  player.username
                                )}
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
                                href={buildChallengeHref(
                                  player.id,
                                  player.username
                                )}
                                className="shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-950/20 px-2.5 py-1 text-xs font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.12)] hover:border-cyan-300/60 hover:text-cyan-50"
                              >
                                Challenge
                              </Link>
                            ) : null}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <RankBadge
                            tier={resolveTierForRow(player)}
                            rating={player.rankPoints}
                            matchesPlayed={player.matches}
                            showRating={false}
                            variant="chip"
                          />
                        </td>
                        <td className="px-5 py-4 text-lg font-black tabular-nums text-yellow-100">
                          {player.rankPoints}
                        </td>
                        <td className="px-5 py-4 text-white">{player.wins}</td>
                        <td className="px-5 py-4 text-white">
                          {player.losses}
                        </td>
                        <td className="px-5 py-4 text-white">{player.draws}</td>
                        <td className="px-5 py-4 text-zinc-400">
                          {player.matches}
                        </td>
                        <td className="px-5 py-4 font-bold text-white">
                          {player.winRate}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-black/40 px-4 py-3 sm:rounded-2xl">
        {page > 1 ? (
          <Link
            href={previousPageHref}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4 sm:py-2.5"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {showNextPage ? (
          <Link
            href={nextPageHref}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4 sm:py-2.5"
          >
            Next →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
