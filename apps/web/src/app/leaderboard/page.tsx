import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import RankBadge from "../../components/player/RankBadge";
import {
  resolvePlayerTier,
  UNRANKED_MATCHES_THRESHOLD,
  type RankTier,
} from "../../lib/player/ranks";
import YourRankBar from "./YourRankBar";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Pure helpers (no side-effects, no data mutation) ────────────────────────

function resolveTierForRow(row: LeaderboardPlayer): RankTier {
  return resolvePlayerTier({
    rating: row.rankPoints,
    matchesPlayed: row.matches,
  });
}

function getInitials(username: string) {
  return (
    username
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function buildLeaderboard(rows: PlayerStatsRow[]): LeaderboardPlayer[] {
  return rows
    .map(
      (row): LeaderboardPlayer => ({
        id: row.user_id,
        username: row.username,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        matches: row.matches,
        goalsFor: row.goals_for,
        rankPoints: row.rank_points,
        winRate:
          row.matches > 0 ? Math.round((row.wins / row.matches) * 100) : 0,
      })
    )
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
  options: { search?: string; page?: number; limit?: number } = {}
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (options.search) params.set("search", options.search);
  return `/leaderboard?${params.toString()}`;
}

function hasValidUserId(userId: string) {
  return userId.trim().length > 0;
}

function buildChallengeHref(userId: string, username: string) {
  return `/lobby?${new URLSearchParams({ challengeUserId: userId, challengeUsername: username }).toString()}`;
}

function buildPlayerProfileHref(userId: string, username?: string | null) {
  const trimmed = (username ?? "").trim();
  return trimmed.length > 0
    ? `/profile/${encodeURIComponent(trimmed)}`
    : `/players/${userId}`;
}

function rankColor(rank: number) {
  if (rank === 1) return "text-yellow-300";
  if (rank === 2) return "text-zinc-300";
  if (rank === 3) return "text-amber-400";
  return "text-zinc-500";
}

// ─── Podium card styling per index (0=gold, 1=silver, 2=bronze) ──────────────

const PODIUM = [
  {
    accent: "text-yellow-300",
    border: "border-yellow-400/40",
    bg: "bg-gradient-to-b from-yellow-900/20 to-zinc-950/95",
    glow: "shadow-[0_0_28px_rgba(234,179,8,0.15),inset_0_1px_0_rgba(255,255,255,0.06)]",
    avatarBg: "from-yellow-600/50 to-amber-900/70",
    avatarBorder: "border-yellow-400/30",
    label: "#1",
  },
  {
    accent: "text-zinc-200",
    border: "border-zinc-400/30",
    bg: "bg-gradient-to-b from-zinc-700/20 to-zinc-950/95",
    glow: "shadow-[0_0_18px_rgba(148,163,184,0.08),inset_0_1px_0_rgba(255,255,255,0.04)]",
    avatarBg: "from-zinc-500/50 to-zinc-800/70",
    avatarBorder: "border-zinc-400/25",
    label: "#2",
  },
  {
    accent: "text-amber-400",
    border: "border-amber-600/40",
    bg: "bg-gradient-to-b from-amber-900/18 to-zinc-950/95",
    glow: "shadow-[0_0_18px_rgba(217,119,6,0.12),inset_0_1px_0_rgba(255,255,255,0.04)]",
    avatarBg: "from-amber-600/50 to-amber-900/70",
    avatarBorder: "border-amber-500/30",
    label: "#3",
  },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  if (error) console.error("Failed to load leaderboard stats:", error.message);

  const leaderboard = buildLeaderboard(
    (statsResult.data ?? []) as PlayerStatsRow[]
  );
  const topPlayers = leaderboard.slice(0, 3);

  const clearSearchHref = buildLeaderboardHref({ page, limit });
  const previousPageHref = buildLeaderboardHref({ search, page: page - 1, limit });
  const nextPageHref = buildLeaderboardHref({ search, page: page + 1, limit });
  const showNextPage = leaderboard.length === limit;

  // Podium only on page 1, no active search, no error, at least 1 top player
  const showPodium =
    !error && topPlayers.length > 0 && page === 1 && !hasActiveSearch;
  // When podium is visible the list starts at rank 4
  const listPlayers = showPodium ? leaderboard.slice(topPlayers.length) : leaderboard;
  const listRankOffset = showPodium ? topPlayers.length : from;

  return (
    <>
      <section
        className="relative space-y-3 rounded-2xl border border-zinc-800/50 bg-[linear-gradient(160deg,#060814_0%,#09090b_40%,#050508_100%)] p-3 pb-6 shadow-[0_40px_120px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.03)] sm:space-y-4 sm:rounded-[1.75rem] sm:p-4 sm:pb-8 md:rounded-[2rem] md:p-6 md:pb-10 lg:p-8"
        aria-label="444 ARENA Leaderboard"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.38em] text-cyan-400/60 sm:text-[10px]">
              Leaderboard
            </p>
            <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
              444 ARENA Rankings
            </h1>
            <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">
              Global rankings from verified Penalty444 match results.
            </p>
          </div>
          {placementPlayerCount > 0 ? (
            <div
              className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-900/15 px-2.5 py-1.5 text-right"
              title="Players currently completing placement matches"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-400/70">
                In placement
              </p>
              <p className="text-sm font-black tabular-nums text-white">
                {placementPlayerCount}
              </p>
            </div>
          ) : null}
        </header>

        {/* ── Filter pills ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
          {(
            [
              { icon: "🌐", label: "Global" },
              { icon: "⚽", label: "Penalty444" },
              { icon: "🗓", label: "All Time" },
            ] as const
          ).map((pill) => (
            <div
              key={pill.label}
              className="flex items-center justify-between gap-1.5 rounded-xl border border-zinc-700/55 bg-zinc-900/60 px-2.5 py-2 sm:px-3.5 sm:py-2.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-sm">{pill.icon}</span>
                <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.14em] text-zinc-200 sm:text-[11px]">
                  {pill.label}
                </span>
              </div>
              <svg
                className="h-3 w-3 shrink-0 text-zinc-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          ))}
        </div>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error ? (
          <div className="rounded-2xl border border-red-800/50 bg-red-950/30 px-4 py-3.5 text-sm text-red-300">
            Could not load leaderboard. Please refresh.
          </div>
        ) : null}

        {/* ── Podium ─────────────────────────────────────────────────────── */}
        {showPodium ? (
          <div className="grid grid-cols-3 items-end gap-2 sm:gap-3 md:gap-4">
            {topPlayers.map((player, index) => {
              const p = PODIUM[index];
              const rank = index + 1;
              // visual order: #1 center, #2 left, #3 right
              const orderClass =
                index === 0
                  ? "order-2"
                  : index === 1
                    ? "order-1"
                    : "order-3";
              const liftClass =
                index === 0
                  ? "-mt-5 sm:-mt-8"
                  : "mt-5 sm:mt-8";

              return (
                <div
                  key={player.id}
                  className={`${orderClass} ${liftClass} flex flex-col rounded-2xl border p-2.5 sm:p-4 md:rounded-[1.5rem] ${p.border} ${p.bg} ${p.glow}`}
                >
                  {/* rank badge */}
                  <div className="flex justify-center">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-black sm:text-xs ${p.border} ${p.accent}`}
                    >
                      {p.label}
                    </span>
                  </div>

                  {/* avatar */}
                  <div className="mt-2 flex justify-center sm:mt-3">
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className={`flex h-10 w-10 items-center justify-center rounded-full border bg-gradient-to-b ${p.avatarBg} ${p.avatarBorder} text-xs font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] transition hover:brightness-110 sm:h-14 sm:w-14 sm:text-sm md:h-16 md:w-16`}
                      >
                        {getInitials(player.username)}
                      </Link>
                    ) : (
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full border bg-gradient-to-b ${p.avatarBg} ${p.avatarBorder} text-xs font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] sm:h-14 sm:w-14 sm:text-sm md:h-16 md:w-16`}
                      >
                        {getInitials(player.username)}
                      </div>
                    )}
                  </div>

                  {/* name */}
                  <div className="mt-1.5 text-center sm:mt-2">
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className="block truncate text-[11px] font-black text-white transition hover:text-yellow-100 sm:text-sm md:text-base"
                      >
                        {player.username}
                      </Link>
                    ) : (
                      <p className="truncate text-[11px] font-black text-white sm:text-sm md:text-base">
                        {player.username}
                      </p>
                    )}
                  </div>

                  {/* tier */}
                  <div className="mt-1 flex justify-center">
                    <RankBadge
                      tier={resolveTierForRow(player)}
                      rating={player.rankPoints}
                      matchesPlayed={player.matches}
                      showRating={false}
                      variant="chip"
                    />
                  </div>

                  {/* points block */}
                  <div className="mt-2 rounded-xl border border-white/8 bg-black/30 px-2 py-1.5 text-center sm:mt-2.5">
                    <p
                      className={`text-xl font-black tabular-nums leading-none sm:text-2xl md:text-3xl ${p.accent}`}
                    >
                      {player.rankPoints}
                    </p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-600 sm:text-[9px]">
                      pts
                    </p>
                  </div>

                  {/* win rate */}
                  <p className="mt-1.5 text-center text-[9px] text-zinc-500 sm:text-[10px]">
                    {player.winRate}% WR · {player.wins}W {player.losses}L
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── Search ─────────────────────────────────────────────────────── */}
        <form
          action="/leaderboard"
          method="get"
          className="flex gap-2 rounded-xl border border-zinc-800/60 bg-black/35 p-2.5 sm:gap-3 sm:rounded-2xl sm:p-3"
        >
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="limit" value={limit} />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search player username…"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700/70 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none sm:rounded-xl sm:px-4"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4"
          >
            Search
          </button>
          {hasActiveSearch ? (
            <Link
              href={clearSearchHref}
              className="flex shrink-0 items-center text-sm font-semibold text-yellow-200/80 hover:text-yellow-100"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {/* ── Ranked list ────────────────────────────────────────────────── */}
        {(!showPodium || listPlayers.length > 0) ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-950/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            {/* table header — sm+ only */}
            {listPlayers.length > 0 ? (
              <div className="hidden border-b border-zinc-800/60 bg-zinc-900/40 sm:flex sm:items-center sm:gap-3 sm:px-4 sm:py-2.5">
                <div className="w-9 shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">
                  #
                </div>
                <div className="flex-1 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">
                  Player
                </div>
                <div className="hidden w-24 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600 md:block">
                  Tier
                </div>
                <div className="w-16 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600 sm:w-20">
                  Points
                </div>
                <div className="hidden w-14 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600 sm:block">
                  Win %
                </div>
                <div className="hidden w-8 shrink-0 text-center text-[9px] font-black text-zinc-600 md:block">
                  △
                </div>
              </div>
            ) : null}

            {/* empty state */}
            {listPlayers.length === 0 ? (
              <div className="px-4 py-10 text-center">
                {hasActiveSearch ? (
                  <p className="text-sm text-zinc-400">
                    {`No players found for "${search}".`}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-zinc-400">
                      No ranked players yet. Complete{" "}
                      {UNRANKED_MATCHES_THRESHOLD} placement matches to appear.
                    </p>
                    <Link
                      href="/lobby"
                      className="inline-flex rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-white hover:border-zinc-500"
                    >
                      Start Playing
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              listPlayers.map((player, index) => {
                const rank = listRankOffset + index + 1;
                return (
                  <div
                    key={player.id}
                    className="group flex items-center gap-3 border-b border-zinc-800/40 px-3 py-2.5 last:border-b-0 transition-colors hover:bg-zinc-800/20 sm:px-4"
                  >
                    {/* rank number */}
                    <div
                      className={`w-9 shrink-0 text-sm font-black tabular-nums ${rankColor(rank)}`}
                    >
                      {rank}
                    </div>

                    {/* player: avatar + name + tier (mobile) */}
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      {hasValidUserId(player.id) ? (
                        <Link
                          href={buildPlayerProfileHref(
                            player.id,
                            player.username
                          )}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700/60 bg-gradient-to-b from-zinc-700/40 to-zinc-900 text-[10px] font-black text-white transition hover:border-zinc-500"
                        >
                          {getInitials(player.username)}
                        </Link>
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700/60 bg-gradient-to-b from-zinc-700/40 to-zinc-900 text-[10px] font-black text-white">
                          {getInitials(player.username)}
                        </div>
                      )}

                      <div className="min-w-0">
                        {hasValidUserId(player.id) ? (
                          <Link
                            href={buildPlayerProfileHref(
                              player.id,
                              player.username
                            )}
                            className="block truncate text-sm font-bold text-white transition hover:text-yellow-100"
                          >
                            {player.username}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm font-bold text-white">
                            {player.username}
                          </span>
                        )}
                        {/* tier under name — hidden on md+ (replaced by separate column) */}
                        <div className="mt-0.5 md:hidden">
                          <RankBadge
                            tier={resolveTierForRow(player)}
                            rating={player.rankPoints}
                            matchesPlayed={player.matches}
                            showRating={false}
                            variant="chip"
                          />
                        </div>
                      </div>
                    </div>

                    {/* tier column — md+ only */}
                    <div className="hidden w-24 shrink-0 md:block">
                      <RankBadge
                        tier={resolveTierForRow(player)}
                        rating={player.rankPoints}
                        matchesPlayed={player.matches}
                        showRating={false}
                        variant="chip"
                      />
                    </div>

                    {/* points */}
                    <div className="w-16 shrink-0 text-right sm:w-20">
                      <p className="text-sm font-black tabular-nums text-yellow-200">
                        {player.rankPoints}
                      </p>
                      {/* win rate under points — mobile only */}
                      <p className="text-[10px] tabular-nums text-zinc-600 sm:hidden">
                        {player.winRate}%
                      </p>
                    </div>

                    {/* win rate column — sm+ only */}
                    <div className="hidden w-14 shrink-0 text-right sm:block">
                      <p className="text-sm font-bold text-zinc-300">
                        {player.winRate}%
                      </p>
                    </div>

                    {/* movement — md+ only, no data = em dash */}
                    <div className="hidden w-8 shrink-0 text-center text-zinc-700 md:block">
                      —
                    </div>

                    {/* challenge — active search only */}
                    {hasActiveSearch && hasValidUserId(player.id) ? (
                      <Link
                        href={buildChallengeHref(player.id, player.username)}
                        className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-2 py-1 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/50 sm:px-2.5"
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

        {/* ── Pagination ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/60 bg-black/35 px-4 py-3">
          {page > 1 ? (
            <Link
              href={previousPageHref}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {showNextPage ? (
            <Link
              href={nextPageHref}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500 sm:rounded-xl sm:px-4"
            >
              Next →
            </Link>
          ) : null}
        </div>
      </section>

      {/* ── Your Rank bar — client component, pinned above bottom nav ──── */}
      <YourRankBar />
    </>
  );
}
