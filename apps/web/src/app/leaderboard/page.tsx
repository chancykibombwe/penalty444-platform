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

// ─── Tier → avatar ring / gradient (for ranked list rows) ────────────────────

function tierAvatarStyle(tier: RankTier): { ring: string; grad: string } {
  const id = tier.id;
  if (id === "champion")
    return { ring: "ring-yellow-300/80", grad: "from-yellow-400/60 to-yellow-900/95" };
  if (id === "elite")
    return { ring: "ring-cyan-200/80", grad: "from-cyan-400/55 to-cyan-900/95" };
  if (id === "diamond")
    return { ring: "ring-cyan-400/75", grad: "from-cyan-500/55 to-blue-950/95" };
  if (id === "platinum")
    return { ring: "ring-purple-400/75", grad: "from-purple-500/55 to-purple-950/95" };
  if (id === "gold")
    return { ring: "ring-amber-400/75", grad: "from-amber-400/60 to-amber-900/95" };
  if (id === "silver")
    return { ring: "ring-zinc-300/65", grad: "from-zinc-400/55 to-zinc-800/95" };
  if (id === "bronze")
    return { ring: "ring-amber-600/70", grad: "from-amber-600/55 to-amber-950/95" };
  return { ring: "ring-zinc-700/40", grad: "from-zinc-700/40 to-zinc-900/95" };
}

// ─── Podium medal configs ─────────────────────────────────────────────────────

const PODIUM = [
  {
    // Gold — #1
    accent: "text-yellow-300",
    cardBorder: "border-yellow-500/55",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(234,179,8,0.20),transparent_52%),linear-gradient(175deg,rgba(120,70,10,0.72),rgba(5,5,8,0.99))]",
    cardGlow:
      "shadow-[0_0_60px_rgba(234,179,8,0.30),inset_0_1px_0_rgba(255,215,0,0.12)]",
    hexFill:
      "linear-gradient(155deg, rgba(255,215,0,0.55) 0%, rgba(130,75,10,0.95) 100%)",
    hexGlowColor: "rgba(234,179,8,0.80)",
    avatarRing: "ring-2 ring-yellow-400/65",
    avatarGrad: "from-yellow-500/65 to-amber-950/95",
    pedestalColor: "rgba(234,179,8,0.55)",
    label: "#1",
  },
  {
    // Silver — #2
    accent: "text-slate-200",
    cardBorder: "border-slate-300/45",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(148,163,184,0.14),transparent_52%),linear-gradient(175deg,rgba(71,85,105,0.65),rgba(5,5,8,0.99))]",
    cardGlow:
      "shadow-[0_0_42px_rgba(148,163,184,0.20),inset_0_1px_0_rgba(200,215,230,0.08)]",
    hexFill:
      "linear-gradient(155deg, rgba(200,215,230,0.42) 0%, rgba(55,70,90,0.95) 100%)",
    hexGlowColor: "rgba(148,163,184,0.60)",
    avatarRing: "ring-2 ring-slate-300/55",
    avatarGrad: "from-slate-400/60 to-zinc-900/95",
    pedestalColor: "rgba(148,163,184,0.48)",
    label: "#2",
  },
  {
    // Bronze — #3
    accent: "text-amber-400",
    cardBorder: "border-amber-600/50",
    cardBg:
      "bg-[radial-gradient(ellipse_at_50%_-5%,rgba(180,83,9,0.16),transparent_52%),linear-gradient(175deg,rgba(120,53,15,0.65),rgba(5,5,8,0.99))]",
    cardGlow:
      "shadow-[0_0_42px_rgba(180,83,9,0.22),inset_0_1px_0_rgba(210,120,40,0.08)]",
    hexFill:
      "linear-gradient(155deg, rgba(200,110,20,0.52) 0%, rgba(80,40,8,0.95) 100%)",
    hexGlowColor: "rgba(180,83,9,0.70)",
    avatarRing: "ring-2 ring-amber-500/55",
    avatarGrad: "from-amber-600/60 to-amber-950/95",
    pedestalColor: "rgba(180,83,9,0.52)",
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
  const listPlayers = showPodium
    ? leaderboard.slice(topPlayers.length)
    : leaderboard;
  const listRankOffset = showPodium ? topPlayers.length : from;

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          Outer shell — deep black, single card, matches the mockup screen
          ═══════════════════════════════════════════════════════════════════ */}
      <section
        className="overflow-hidden rounded-2xl border border-zinc-800/50 bg-[#060810] shadow-[0_40px_120px_rgba(0,0,0,0.80),inset_0_1px_0_rgba(255,255,255,0.04)] sm:rounded-[1.75rem] md:rounded-[2rem]"
        aria-label="444 ARENA Leaderboard"
      >
        {/* ═══ APP HEADER ═════════════════════════════════════════════════
            444 ARENA (left) · LEADERBOARD (center) · Coming Soon pills (right)
            ═══════════════════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/50 bg-zinc-950/40 px-3 py-2.5 sm:px-4 sm:py-3">
          {/* Left */}
          <span className="flex-none text-[10px] font-black uppercase tracking-[0.28em] text-cyan-400/70 sm:text-[11px]">
            444 ARENA
          </span>

          {/* Center */}
          <h1 className="flex-1 text-center text-[12px] font-black uppercase tracking-[0.32em] text-white sm:text-sm">
            LEADERBOARD
          </h1>

          {/* Right — Coming Soon pills */}
          <div className="flex flex-none items-center gap-1 sm:gap-1.5">
            <div className="rounded border border-zinc-700/50 bg-zinc-900/60 px-1.5 py-1 text-center leading-none">
              <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-400 sm:text-[8px]">
                WALLET
              </p>
              <p className="text-[7px] font-black uppercase tracking-[0.08em] text-zinc-500 sm:text-[8px]">
                COMING SOON
              </p>
            </div>
            <div className="hidden rounded border border-zinc-700/50 bg-zinc-900/60 px-2 py-1 sm:block">
              <p className="whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.10em] text-zinc-500 sm:text-[9px]">
                Season: Coming Soon
              </p>
            </div>
          </div>
        </div>

        {/* ═══ MAIN CONTENT ════════════════════════════════════════════════ */}
        <div className="space-y-3 p-3 sm:space-y-3.5 sm:p-4 md:p-5 lg:p-6">

          {/* ─── Filter pills ─────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            {/* GLOBAL */}
            <div className="flex items-center gap-2 rounded-xl border border-zinc-700/55 bg-zinc-900/65 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-3 sm:py-2.5">
              <svg className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clipRule="evenodd" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.15em] text-zinc-100 sm:text-[11px]">
                GLOBAL
              </span>
              <svg className="h-2.5 w-2.5 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>

            {/* PENALTY444 */}
            <div className="flex items-center gap-2 rounded-xl border border-zinc-700/55 bg-zinc-900/65 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-3 sm:py-2.5">
              <svg className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                <path d="M2 12h20"/>
              </svg>
              <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.15em] text-zinc-100 sm:text-[11px]">
                PENALTY444
              </span>
              <svg className="h-2.5 w-2.5 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>

            {/* ALL TIME */}
            <div className="flex items-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-900/55 px-2.5 py-2 opacity-65 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-3 sm:py-2.5">
              <svg className="h-3.5 w-3.5 shrink-0 text-zinc-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 sm:text-[11px]">
                ALL TIME
              </span>
              <svg className="h-2.5 w-2.5 shrink-0 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>

          {/* ─── Error ────────────────────────────────────────────────── */}
          {error ? (
            <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              Could not load leaderboard. Please refresh.
            </div>
          ) : null}

          {/* ─── Podium ───────────────────────────────────────────────── */}
          {showPodium ? (
            <div className="grid grid-cols-3 items-end gap-2 pt-2 sm:gap-3 sm:pt-3 md:gap-4">
              {topPlayers.map((player, index) => {
                const p = PODIUM[index];
                const rank = index + 1;
                const tier = resolveTierForRow(player);
                // visual order: #1 center-raised, #2 left, #3 right
                const orderClass =
                  index === 0 ? "order-2" : index === 1 ? "order-1" : "order-3";
                const liftClass =
                  index === 0 ? "-mt-8 sm:-mt-12" : "mt-8 sm:mt-12";

                return (
                  <div
                    key={player.id}
                    className={`${orderClass} ${liftClass} relative flex flex-col items-center overflow-visible rounded-2xl border pb-3 pt-2 sm:pt-3 md:rounded-[1.5rem] ${p.cardBorder} ${p.cardBg} ${p.cardGlow}`}
                  >
                    {/* Hex rank badge */}
                    <div className="flex justify-center">
                      <div
                        className={`flex h-10 w-[38px] items-center justify-center text-[15px] font-black sm:h-12 sm:w-11 sm:text-[18px] ${p.accent}`}
                        style={{
                          clipPath:
                            "polygon(50% 0%, 97% 26%, 97% 74%, 50% 100%, 3% 74%, 3% 26%)",
                          background: p.hexFill,
                          filter: `drop-shadow(0 0 8px ${p.hexGlowColor})`,
                        }}
                      >
                        {rank}
                      </div>
                    </div>

                    {/* Avatar */}
                    <div className="mt-2 sm:mt-3">
                      {hasValidUserId(player.id) ? (
                        <Link
                          href={buildPlayerProfileHref(player.id, player.username)}
                          className={`flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-b text-sm font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22)] transition hover:brightness-110 sm:h-16 sm:w-16 sm:text-base md:h-[72px] md:w-[72px] md:text-lg ${p.avatarGrad} ${p.avatarRing}`}
                          style={{ height: "52px", width: "52px" }}
                        >
                          {getInitials(player.username)}
                        </Link>
                      ) : (
                        <div
                          className={`flex items-center justify-center rounded-full bg-gradient-to-b text-sm font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22)] sm:text-base ${p.avatarGrad} ${p.avatarRing}`}
                          style={{ height: "52px", width: "52px" }}
                        >
                          {getInitials(player.username)}
                        </div>
                      )}
                    </div>

                    {/* Name */}
                    <div className="mt-1.5 w-full px-2 text-center sm:mt-2">
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

                    {/* Tier */}
                    <div className="mt-0.5 flex items-center gap-1 px-2">
                      <span className={`text-[9px] font-bold sm:text-[10px] ${tier.textClass}`}>
                        {tier.icon} {tier.label}
                      </span>
                    </div>

                    {/* Points block */}
                    <div className="mx-2 mt-2 w-[calc(100%-1rem)] rounded-xl border border-white/8 bg-black/50 py-1.5 text-center sm:mt-2.5 sm:py-2">
                      <p
                        className={`text-[20px] font-black tabular-nums leading-none sm:text-2xl md:text-[28px] ${p.accent}`}
                        style={{
                          filter: `drop-shadow(0 0 8px ${p.hexGlowColor})`,
                        }}
                      >
                        {player.rankPoints}
                      </p>
                      <p className="mt-0.5 text-[7px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:text-[8px]">
                        PTS
                      </p>
                    </div>

                    {/* Win rate */}
                    <p className="mt-1.5 text-center text-[9px] text-zinc-500 sm:text-[10px]">
                      {player.winRate}% WR · {player.wins}W {player.losses}L
                    </p>

                    {/* Pedestal base glow */}
                    <div
                      className="absolute -bottom-0.5 left-6 right-6 h-1 rounded-full blur-sm"
                      style={{ background: p.pedestalColor }}
                    />
                    <div
                      className="absolute -bottom-1 left-10 right-10 h-2 rounded-full blur-md opacity-60"
                      style={{ background: p.pedestalColor }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* ─── Search ───────────────────────────────────────────────── */}
          <form
            action="/leaderboard"
            method="get"
            className="flex gap-2 rounded-xl border border-zinc-800/50 bg-black/30 p-2"
          >
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="limit" value={limit} />
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Search player…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700/60 bg-zinc-900/70 px-3 py-1.5 text-[13px] text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:border-zinc-500"
            >
              Search
            </button>
            {hasActiveSearch ? (
              <Link
                href={clearSearchHref}
                className="flex shrink-0 items-center text-[13px] font-semibold text-yellow-300/80 hover:text-yellow-200"
              >
                Clear
              </Link>
            ) : null}
          </form>

          {/* ─── Rankings list ────────────────────────────────────────── */}
          {(!showPodium || listPlayers.length > 0) ? (
            <div className="overflow-hidden rounded-xl border border-zinc-800/50 bg-zinc-950/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">

              {/* Column header row */}
              {listPlayers.length > 0 ? (
                <div className="flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-900/30 px-4 py-2 sm:gap-3">
                  <div className="w-8 shrink-0 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                    RANK
                  </div>
                  <div className="flex-1 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                    PLAYER
                  </div>
                  <div className="hidden w-20 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:block">
                    POINTS
                  </div>
                  <div className="hidden w-16 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:block">
                    WIN RATE
                  </div>
                  <div className="hidden w-6 shrink-0 text-center text-[9px] font-black text-zinc-600 sm:block">
                    ↑↓
                  </div>
                  {/* mobile: points label inline */}
                  <div className="w-14 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:hidden">
                    PTS
                  </div>
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
                        No ranked players yet. Complete{" "}
                        {UNRANKED_MATCHES_THRESHOLD} placement matches to
                        appear.
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
                  const tier = resolveTierForRow(player);
                  const av = tierAvatarStyle(tier);

                  return (
                    <div
                      key={player.id}
                      className="group flex items-center gap-2 border-b border-zinc-800/35 px-4 py-2.5 last:border-b-0 transition-colors hover:bg-zinc-800/18 sm:gap-3"
                    >
                      {/* Rank */}
                      <div className="w-8 shrink-0 text-base font-black tabular-nums text-zinc-300 sm:text-lg">
                        {rank}
                      </div>

                      {/* Avatar */}
                      {hasValidUserId(player.id) ? (
                        <Link
                          href={buildPlayerProfileHref(player.id, player.username)}
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-[11px] font-black text-white ring-offset-1 ring-offset-zinc-950 transition hover:brightness-110 ${av.grad} ${av.ring} ring-2`}
                        >
                          {getInitials(player.username)}
                        </Link>
                      ) : (
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-[11px] font-black text-white ring-offset-1 ring-offset-zinc-950 ${av.grad} ${av.ring} ring-2`}
                        >
                          {getInitials(player.username)}
                        </div>
                      )}

                      {/* Player name + tier */}
                      <div className="min-w-0 flex-1">
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
                        <div className={`flex items-center gap-1 text-[11px] font-bold ${tier.textClass}`}>
                          <span>{tier.icon}</span>
                          <span>{tier.label}</span>
                        </div>
                      </div>

                      {/* Points — desktop */}
                      <div className="hidden w-20 shrink-0 text-right sm:block">
                        <p className="text-[13px] font-black tabular-nums text-yellow-200">
                          {player.rankPoints}
                        </p>
                      </div>

                      {/* Win Rate — desktop */}
                      <div className="hidden w-16 shrink-0 text-right sm:block">
                        <p className="text-[13px] font-bold text-zinc-300">
                          {player.winRate}%
                        </p>
                      </div>

                      {/* Movement — desktop, always — */}
                      <div className="hidden w-6 shrink-0 text-center text-sm text-zinc-600 sm:block">
                        —
                      </div>

                      {/* Mobile: points only */}
                      <div className="w-14 shrink-0 text-right sm:hidden">
                        <p className="text-[13px] font-black tabular-nums text-yellow-200">
                          {player.rankPoints}
                        </p>
                        <p className="text-[10px] text-zinc-600">
                          {player.winRate}%
                        </p>
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
          ) : null}

          {/* ─── Pagination ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/45 bg-black/30 px-4 py-2.5">
            {page > 1 ? (
              <Link
                href={previousPageHref}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:border-zinc-500"
              >
                ← Prev
              </Link>
            ) : (
              <span />
            )}
            {showNextPage ? (
              <Link
                href={nextPageHref}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:border-zinc-500"
              >
                Next →
              </Link>
            ) : null}
          </div>

          {/* Placement count — compact note, if any */}
          {placementPlayerCount > 0 ? (
            <p className="text-center text-[10px] text-zinc-600">
              {placementPlayerCount} players currently in placement (
              {UNRANKED_MATCHES_THRESHOLD} matches required to rank)
            </p>
          ) : null}
        </div>
      </section>

      {/* ═══ YOUR RANK BAR — fixed client component ══════════════════════ */}
      <YourRankBar />
    </>
  );
}
