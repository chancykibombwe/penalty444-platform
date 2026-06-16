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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

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

function rankNumColor(rank: number) {
  if (rank === 1) return "text-yellow-300";
  if (rank === 2) return "text-zinc-300";
  if (rank === 3) return "text-amber-400";
  return "text-zinc-500";
}

// ─── Podium medal config (index 0 = gold #1, 1 = silver #2, 2 = bronze #3) ───

const PODIUM = [
  {
    // ── Gold ──
    accent: "text-yellow-300",
    border: "border-yellow-400/60",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(234,179,8,0.22),transparent_55%),linear-gradient(180deg,rgba(113,63,18,0.72),rgba(7,7,9,0.99))]",
    glow: "shadow-[0_0_65px_rgba(234,179,8,0.30),inset_0_1px_0_rgba(255,255,255,0.10)]",
    rankRing: "bg-yellow-400/20 border-2 border-yellow-300/80 text-yellow-300",
    avatarGrad: "from-yellow-500/70 to-amber-950/90",
    avatarRing: "ring-2 ring-yellow-400/55",
    ptsShadow: "drop-shadow-[0_0_12px_rgba(234,179,8,0.65)]",
    label: "#1",
  },
  {
    // ── Silver ──
    accent: "text-slate-200",
    border: "border-slate-300/50",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(148,163,184,0.14),transparent_55%),linear-gradient(180deg,rgba(71,85,105,0.62),rgba(7,7,9,0.99))]",
    glow: "shadow-[0_0_45px_rgba(148,163,184,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]",
    rankRing: "bg-slate-400/15 border-2 border-slate-300/70 text-slate-200",
    avatarGrad: "from-slate-400/60 to-zinc-900/90",
    avatarRing: "ring-2 ring-slate-300/40",
    ptsShadow: "drop-shadow-[0_0_8px_rgba(148,163,184,0.45)]",
    label: "#2",
  },
  {
    // ── Bronze ──
    accent: "text-amber-400",
    border: "border-amber-500/55",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(180,83,9,0.17),transparent_55%),linear-gradient(180deg,rgba(120,53,15,0.62),rgba(7,7,9,0.99))]",
    glow: "shadow-[0_0_45px_rgba(180,83,9,0.20),inset_0_1px_0_rgba(255,255,255,0.07)]",
    rankRing: "bg-amber-500/18 border-2 border-amber-400/70 text-amber-400",
    avatarGrad: "from-amber-500/65 to-amber-950/90",
    avatarRing: "ring-2 ring-amber-400/45",
    ptsShadow: "drop-shadow-[0_0_8px_rgba(217,119,6,0.55)]",
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

  const showPodium =
    !error && topPlayers.length > 0 && page === 1 && !hasActiveSearch;
  const listPlayers = showPodium ? leaderboard.slice(topPlayers.length) : leaderboard;
  const listRankOffset = showPodium ? topPlayers.length : from;

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          Page shell — very dark navy-black with subtle cyan arena glow at top
          ════════════════════════════════════════════════════════════════════ */}
      <section
        className="relative space-y-3 rounded-2xl border border-zinc-800/50 bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.045),transparent_42%),linear-gradient(180deg,#06080f_0%,#09090b_38%,#050507_100%)] p-3 pb-6 shadow-[0_40px_120px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)] sm:space-y-4 sm:rounded-[1.75rem] sm:p-4 sm:pb-8 md:rounded-[2rem] md:p-6 md:pb-10 lg:p-8"
        aria-label="444 ARENA Leaderboard"
      >
        {/* ═══ HEADER ══════════════════════════════════════════════════════ */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.40em] text-cyan-400/55 sm:text-[10px]">
              Competitive Arena
            </p>
            <h1 className="mt-0.5 text-[22px] font-black leading-tight tracking-tight text-white sm:text-3xl md:text-4xl">
              444 ARENA Rankings
            </h1>
            <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">
              Global rankings from verified Penalty444 match results.
            </p>
          </div>
          {placementPlayerCount > 0 ? (
            <div
              className="shrink-0 rounded-lg border border-cyan-500/25 bg-cyan-950/25 px-2.5 py-1.5 text-right"
              title="Players still in placement matches"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-500/70">
                Placement
              </p>
              <p className="text-base font-black tabular-nums leading-none text-white">
                {placementPlayerCount}
              </p>
            </div>
          ) : null}
        </header>

        {/* ═══ FILTER PILLS ════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {(
            [
              {
                svg: (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-cyan-400/70">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clipRule="evenodd" />
                  </svg>
                ),
                label: "Global",
              },
              {
                svg: (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-cyan-400/70">
                    <path d="M10 3.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM2 10a8 8 0 1116 0 8 8 0 01-16 0z" />
                    <path d="M10 7a1 1 0 011 1v2.586l1.707 1.707a1 1 0 01-1.414 1.414l-2-2A1 1 0 019 11V8a1 1 0 011-1z" />
                  </svg>
                ),
                label: "Penalty444",
              },
              {
                svg: (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-zinc-500">
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                ),
                label: "All Time",
              },
            ] as const
          ).map((pill, i) => (
            <div
              key={pill.label}
              className={`flex items-center justify-between gap-1 rounded-xl border px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-3 sm:py-2.5 ${
                i < 2
                  ? "border-zinc-700/60 bg-zinc-900/70"
                  : "border-zinc-800/50 bg-zinc-900/40 opacity-60"
              }`}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                {pill.svg}
                <span
                  className={`min-w-0 truncate text-[10px] font-black uppercase tracking-[0.14em] sm:text-[11px] ${
                    i < 2 ? "text-zinc-100" : "text-zinc-500"
                  }`}
                >
                  {pill.label}
                </span>
              </div>
              <svg
                className="h-2.5 w-2.5 shrink-0 text-zinc-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          ))}
        </div>

        {/* ═══ ERROR ═══════════════════════════════════════════════════════ */}
        {error ? (
          <div className="rounded-2xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            Could not load leaderboard. Please refresh.
          </div>
        ) : null}

        {/* ═══ PODIUM ══════════════════════════════════════════════════════ */}
        {showPodium ? (
          <div className="grid grid-cols-3 items-end gap-2 sm:gap-3 md:gap-4">
            {topPlayers.map((player, index) => {
              const p = PODIUM[index];
              const rank = index + 1;
              // #1 center-raised, #2 left-lower, #3 right-lower
              const orderClass =
                index === 0 ? "order-2" : index === 1 ? "order-1" : "order-3";
              const liftClass =
                index === 0 ? "-mt-7 sm:-mt-11" : "mt-7 sm:mt-11";

              return (
                <div
                  key={player.id}
                  className={`${orderClass} ${liftClass} flex flex-col items-center rounded-2xl border p-3 sm:p-4 md:rounded-[1.5rem] md:p-5 ${p.border} ${p.cardBg} ${p.glow}`}
                >
                  {/* ── Rank circle ── */}
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black sm:h-8 sm:w-8 sm:text-sm ${p.rankRing}`}
                  >
                    {rank}
                  </div>

                  {/* ── Avatar ── */}
                  <div className="mt-2 sm:mt-3">
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b text-sm font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.18)] transition hover:brightness-110 sm:h-16 sm:w-16 sm:text-base md:h-[4.5rem] md:w-[4.5rem] md:text-lg ${p.avatarGrad} ${p.avatarRing}`}
                      >
                        {getInitials(player.username)}
                      </Link>
                    ) : (
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b text-sm font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.18)] sm:h-16 sm:w-16 sm:text-base md:h-[4.5rem] md:w-[4.5rem] md:text-lg ${p.avatarGrad} ${p.avatarRing}`}
                      >
                        {getInitials(player.username)}
                      </div>
                    )}
                  </div>

                  {/* ── Name ── */}
                  <div className="mt-1.5 w-full text-center sm:mt-2">
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className={`block truncate text-[11px] font-black transition hover:text-yellow-100 sm:text-[13px] md:text-sm ${p.accent}`}
                      >
                        {player.username}
                      </Link>
                    ) : (
                      <p
                        className={`truncate text-[11px] font-black sm:text-[13px] md:text-sm ${p.accent}`}
                      >
                        {player.username}
                      </p>
                    )}
                  </div>

                  {/* ── Tier ── */}
                  <div className="mt-1 flex justify-center">
                    <RankBadge
                      tier={resolveTierForRow(player)}
                      rating={player.rankPoints}
                      matchesPlayed={player.matches}
                      showRating={false}
                      variant="chip"
                    />
                  </div>

                  {/* ── Points ── */}
                  <div className="mt-2 w-full rounded-xl border border-white/8 bg-black/45 py-2 text-center sm:mt-2.5 sm:py-2.5">
                    <p
                      className={`text-2xl font-black tabular-nums leading-none sm:text-3xl md:text-[2.25rem] ${p.accent} ${p.ptsShadow}`}
                    >
                      {player.rankPoints}
                    </p>
                    <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.22em] text-zinc-600">
                      PTS
                    </p>
                  </div>

                  {/* ── Win rate ── */}
                  <p className="mt-1.5 text-center text-[9px] font-semibold text-zinc-500 sm:text-[10px]">
                    {player.winRate}% WR · {player.wins}W {player.losses}L
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ═══ SEARCH ══════════════════════════════════════════════════════ */}
        <form
          action="/leaderboard"
          method="get"
          className="flex gap-2 rounded-xl border border-zinc-800/55 bg-black/35 p-2 sm:gap-2.5 sm:p-2.5"
        >
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="limit" value={limit} />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search player…"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700/60 bg-zinc-900/70 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-white transition hover:border-zinc-500"
          >
            Search
          </button>
          {hasActiveSearch ? (
            <Link
              href={clearSearchHref}
              className="flex shrink-0 items-center text-sm font-semibold text-yellow-300/80 hover:text-yellow-200"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {/* ═══ RANKINGS LIST ═══════════════════════════════════════════════ */}
        {(!showPodium || listPlayers.length > 0) ? (
          <>
            {/* Section label */}
            {(showPodium && listPlayers.length > 0) ? (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-800/80" />
                <span className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-600">
                  Rankings
                </span>
                <div className="h-px flex-1 bg-zinc-800/80" />
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-zinc-800/55 bg-zinc-950/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              {/* Column headers */}
              {listPlayers.length > 0 ? (
                <div className="hidden border-b border-zinc-800/55 bg-zinc-900/35 sm:flex sm:items-center sm:gap-2 sm:px-4 sm:py-2">
                  <div className="w-8 shrink-0 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">#</div>
                  <div className="flex-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Player</div>
                  <div className="hidden w-24 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 md:block">Tier</div>
                  <div className="w-14 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 sm:w-16">PTS</div>
                  <div className="hidden w-12 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 sm:block">WR</div>
                  <div className="hidden w-6 shrink-0 text-center text-[9px] font-black text-zinc-700 md:block">△</div>
                </div>
              ) : null}

              {/* Empty state */}
              {listPlayers.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  {hasActiveSearch ? (
                    <p className="text-sm text-zinc-500">
                      {`No players found for "${search}".`}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-500">
                        No ranked players yet. Complete {UNRANKED_MATCHES_THRESHOLD} placement matches to appear.
                      </p>
                      <Link
                        href="/lobby"
                        className="inline-flex rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white hover:border-zinc-500"
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
                      className="group flex items-center gap-2 border-b border-zinc-800/35 px-3 py-2 last:border-b-0 transition-colors hover:bg-zinc-800/20 sm:gap-2.5 sm:px-4"
                    >
                      {/* Rank # */}
                      <div
                        className={`w-8 shrink-0 text-[13px] font-black tabular-nums ${rankNumColor(rank)}`}
                      >
                        {rank}
                      </div>

                      {/* Avatar + name + (mobile tier) */}
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {hasValidUserId(player.id) ? (
                          <Link
                            href={buildPlayerProfileHref(player.id, player.username)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700/55 bg-gradient-to-b from-zinc-700/45 to-zinc-900/90 text-[9px] font-black text-white transition hover:border-zinc-500 sm:h-8 sm:w-8 sm:text-[10px]"
                          >
                            {getInitials(player.username)}
                          </Link>
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700/55 bg-gradient-to-b from-zinc-700/45 to-zinc-900/90 text-[9px] font-black text-white sm:h-8 sm:w-8 sm:text-[10px]">
                            {getInitials(player.username)}
                          </div>
                        )}

                        <div className="min-w-0">
                          {hasValidUserId(player.id) ? (
                            <Link
                              href={buildPlayerProfileHref(player.id, player.username)}
                              className="block truncate text-[13px] font-bold text-white transition hover:text-yellow-100"
                            >
                              {player.username}
                            </Link>
                          ) : (
                            <span className="block truncate text-[13px] font-bold text-white">
                              {player.username}
                            </span>
                          )}
                          {/* Tier under name — hidden on md+ */}
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

                      {/* Tier column — md+ */}
                      <div className="hidden w-24 shrink-0 md:block">
                        <RankBadge
                          tier={resolveTierForRow(player)}
                          rating={player.rankPoints}
                          matchesPlayed={player.matches}
                          showRating={false}
                          variant="chip"
                        />
                      </div>

                      {/* Points */}
                      <div className="w-14 shrink-0 text-right sm:w-16">
                        <p className="text-[13px] font-black tabular-nums text-yellow-200">
                          {player.rankPoints}
                        </p>
                        {/* Win rate under pts — mobile only */}
                        <p className="text-[10px] tabular-nums text-zinc-600 sm:hidden">
                          {player.winRate}%
                        </p>
                      </div>

                      {/* Win rate — sm+ */}
                      <div className="hidden w-12 shrink-0 text-right sm:block">
                        <p className="text-[13px] font-bold text-zinc-400">
                          {player.winRate}%
                        </p>
                      </div>

                      {/* Movement — md+ */}
                      <div className="hidden w-6 shrink-0 text-center text-[12px] text-zinc-700 md:block">
                        —
                      </div>

                      {/* Challenge — search only */}
                      {hasActiveSearch && hasValidUserId(player.id) ? (
                        <Link
                          href={buildChallengeHref(player.id, player.username)}
                          className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-2 py-0.5 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400/50"
                        >
                          Challenge
                        </Link>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {/* ═══ PAGINATION ══════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/50 bg-black/30 px-4 py-2.5">
          {page > 1 ? (
            <Link
              href={previousPageHref}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:border-zinc-500"
            >
              ← Prev
            </Link>
          ) : (
            <span />
          )}
          {showNextPage ? (
            <Link
              href={nextPageHref}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:border-zinc-500"
            >
              Next →
            </Link>
          ) : null}
        </div>
      </section>

      {/* ═══ YOUR RANK BAR — fixed client component ══════════════════════ */}
      <YourRankBar />
    </>
  );
}
