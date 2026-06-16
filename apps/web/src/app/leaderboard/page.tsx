import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
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

// ─── Pure helpers (data logic unchanged) ─────────────────────────────────────

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
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
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

// ─── Podium configs ────────────────────────────────────────────────────────────

const PODIUM = [
  {
    // Gold — #1 (center, raised)
    accent: "text-yellow-300",
    cardBorder: "border-yellow-500/60",
    cardBg:
      "bg-[linear-gradient(175deg,rgba(110,62,6,0.88)_0%,rgba(22,13,2,0.98)_55%,rgba(5,4,1,1)_100%)]",
    cardGlow:
      "shadow-[0_0_0_1px_rgba(234,179,8,0.22),0_16px_56px_rgba(234,179,8,0.40),inset_0_1px_0_rgba(255,215,0,0.15)]",
    hexFill:
      "linear-gradient(150deg, rgba(255,220,50,0.95) 0%, rgba(180,105,10,1) 100%)",
    hexGlowColor: "rgba(234,179,8,1)",
    avatarRingInner: "rgba(234,179,8,0.90)",
    avatarRingOuter: "rgba(234,179,8,0.28)",
    avatarGrad: "from-yellow-600/65 to-amber-950",
    pedestalColor: "rgba(234,179,8,0.70)",
    pedestalGlow: "rgba(234,179,8,0.40)",
  },
  {
    // Silver — #2 (left, lower)
    accent: "text-slate-200",
    cardBorder: "border-slate-400/45",
    cardBg:
      "bg-[linear-gradient(175deg,rgba(60,72,90,0.85)_0%,rgba(15,18,24,0.98)_55%,rgba(4,5,7,1)_100%)]",
    cardGlow:
      "shadow-[0_0_0_1px_rgba(148,163,184,0.18),0_12px_36px_rgba(148,163,184,0.28),inset_0_1px_0_rgba(200,215,230,0.10)]",
    hexFill:
      "linear-gradient(150deg, rgba(210,225,240,0.80) 0%, rgba(60,78,100,1) 100%)",
    hexGlowColor: "rgba(148,163,184,0.90)",
    avatarRingInner: "rgba(148,163,184,0.80)",
    avatarRingOuter: "rgba(148,163,184,0.25)",
    avatarGrad: "from-slate-400/60 to-zinc-900",
    pedestalColor: "rgba(148,163,184,0.55)",
    pedestalGlow: "rgba(148,163,184,0.30)",
  },
  {
    // Bronze — #3 (right, lower)
    accent: "text-amber-400",
    cardBorder: "border-amber-700/50",
    cardBg:
      "bg-[linear-gradient(175deg,rgba(105,46,10,0.85)_0%,rgba(20,10,3,0.98)_55%,rgba(5,3,1,1)_100%)]",
    cardGlow:
      "shadow-[0_0_0_1px_rgba(180,83,9,0.20),0_12px_32px_rgba(180,83,9,0.32),inset_0_1px_0_rgba(220,120,35,0.10)]",
    hexFill:
      "linear-gradient(150deg, rgba(210,115,20,0.90) 0%, rgba(92,40,6,1) 100%)",
    hexGlowColor: "rgba(180,83,9,1)",
    avatarRingInner: "rgba(180,83,9,0.85)",
    avatarRingOuter: "rgba(180,83,9,0.28)",
    avatarGrad: "from-amber-700/65 to-amber-950",
    pedestalColor: "rgba(180,83,9,0.60)",
    pedestalGlow: "rgba(180,83,9,0.35)",
  },
] as const;

// ─── Page ──────────────────────────────────────────────────────────────────────

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
          Centered game-screen panel — max 560px, cinematic dark frame
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="relative mx-auto max-w-[560px]">
        {/* Ambient background radial glow behind the card */}
        <div
          className="pointer-events-none absolute -inset-10 -z-10 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 50% 30%, rgba(34,211,238,0.07), transparent 65%)",
          }}
        />

        <section
          className="overflow-hidden rounded-[22px] border border-zinc-800/65 bg-[#07080f] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_32px_80px_rgba(0,0,0,0.92)]"
          aria-label="444 ARENA Leaderboard"
        >

          {/* ═══ APP-SCREEN HEADER ════════════════════════════════════════
              444 ARENA left · LEADERBOARD center · Coming Soon pills right
              ════════════════════════════════════════════════════════════ */}
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800/55 bg-[#060710]/85 px-4 py-3 sm:py-3.5">
            {/* Left brand */}
            <div className="flex-none">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-500">
                444 ARENA
              </p>
            </div>

            {/* Center title */}
            <h1 className="flex-1 text-center text-[14px] font-black uppercase tracking-[0.28em] text-white sm:text-[15px]">
              LEADERBOARD
            </h1>

            {/* Right utility pills */}
            <div className="flex flex-none items-center gap-1.5">
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/90 px-2 py-1 text-center">
                <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-300">
                  WALLET
                </p>
                <p className="text-[7px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
                  COMING SOON
                </p>
              </div>
              <div className="hidden rounded-lg border border-zinc-700/60 bg-zinc-900/90 px-2 py-1 sm:block">
                <p className="whitespace-nowrap text-[8px] font-semibold text-zinc-500">
                  Season: Coming Soon
                </p>
              </div>
            </div>
          </div>

          {/* ═══ MAIN CONTENT ════════════════════════════════════════════ */}
          <div className="space-y-3 p-3 sm:space-y-3.5 sm:p-4">

            {/* ─── FILTER PILLS ─────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2">
              {/* GLOBAL */}
              <div className="flex items-center gap-2 rounded-xl border border-zinc-600/55 bg-zinc-900/80 px-2.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-3">
                <svg
                  className="h-4 w-4 shrink-0 text-blue-400/80"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.15em] text-white sm:text-[11px]">
                  GLOBAL
                </span>
                <svg
                  className="h-2.5 w-2.5 shrink-0 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>

              {/* PENALTY444 */}
              <div className="flex items-center gap-2 rounded-xl border border-zinc-600/55 bg-zinc-900/80 px-2.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-3">
                <svg
                  className="h-4 w-4 shrink-0 text-blue-400/80"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                  <path d="M2 12h20" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.12em] text-white sm:text-[11px]">
                  P444
                </span>
                <svg
                  className="h-2.5 w-2.5 shrink-0 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>

              {/* ALL TIME */}
              <div className="flex items-center gap-2 rounded-xl border border-zinc-700/45 bg-zinc-900/70 px-2.5 py-3 opacity-55 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:px-3">
                <svg
                  className="h-4 w-4 shrink-0 text-zinc-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400 sm:text-[11px]">
                  ALL TIME
                </span>
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
            </div>

            {/* ─── ERROR ────────────────────────────────────────────────── */}
            {error ? (
              <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                Could not load leaderboard. Please refresh.
              </div>
            ) : null}

            {/* ─── PODIUM (trophy case) ─────────────────────────────────── */}
            {showPodium ? (
              <div className="grid grid-cols-3 items-end gap-2 pt-2 sm:gap-3 sm:pt-3">
                {topPlayers.map((player, index) => {
                  const p = PODIUM[index as 0 | 1 | 2];
                  if (!p) return null;
                  const rank = index + 1;
                  const isFirst = index === 0;
                  const tier = resolveTierForRow(player);
                  const orderClass =
                    isFirst ? "order-2" : index === 1 ? "order-1" : "order-3";
                  // Badge sizes
                  const badgeW = isFirst ? 52 : 44;
                  const badgeH = isFirst ? 58 : 50;
                  const badgeFs = isFirst ? "20px" : "16px";
                  // Avatar sizes
                  const avSize = isFirst ? 72 : 60;
                  const avFs = isFirst ? "15px" : "12px";
                  // Card overlap: badge overlaps card by ~half badge height
                  const overlap = Math.round(badgeH / 2);

                  return (
                    <div
                      key={player.id}
                      className={`${orderClass} flex flex-col items-center`}
                    >
                      {/* Spacer pushes side cards down — center card is naturally "raised" */}
                      {!isFirst && (
                        <div className="h-8 w-full shrink-0 sm:h-12" />
                      )}

                      {/* ── Hex rank badge (floats above card) ─────────── */}
                      <div
                        className="relative z-10 shrink-0"
                        style={{
                          clipPath:
                            "polygon(50% 0%, 97% 25%, 97% 75%, 50% 100%, 3% 75%, 3% 25%)",
                          background: p.hexFill,
                          filter: `drop-shadow(0 0 12px ${p.hexGlowColor})`,
                          width: `${badgeW}px`,
                          height: `${badgeH}px`,
                        }}
                      >
                        <div className="flex h-full w-full items-center justify-center">
                          <span
                            className="font-black text-white"
                            style={{ fontSize: badgeFs }}
                          >
                            {rank}
                          </span>
                        </div>
                      </div>

                      {/* ── Card body (overlaps badge by half its height) ─ */}
                      <div
                        className={`w-full overflow-hidden rounded-[18px] border ${p.cardBorder} ${p.cardBg} ${p.cardGlow}`}
                        style={{ marginTop: `-${overlap}px` }}
                      >
                        {/* Content — top padding clears the overlapping badge */}
                        <div
                          className="flex flex-col items-center px-2 sm:px-3"
                          style={{ paddingTop: `${overlap + 10}px` }}
                        >
                          {/* Avatar circle with medal ring */}
                          {hasValidUserId(player.id) ? (
                            <Link
                              href={buildPlayerProfileHref(
                                player.id,
                                player.username
                              )}
                              className="block transition hover:brightness-110"
                            >
                              <div
                                className={`flex items-center justify-center rounded-full bg-gradient-to-b font-black text-white ${p.avatarGrad}`}
                                style={{
                                  width: `${avSize}px`,
                                  height: `${avSize}px`,
                                  fontSize: avFs,
                                  boxShadow: `0 0 0 3px ${p.avatarRingInner}, 0 0 0 6px ${p.avatarRingOuter}, 0 0 22px ${p.avatarRingOuter}`,
                                }}
                              >
                                {getInitials(player.username)}
                              </div>
                            </Link>
                          ) : (
                            <div
                              className={`flex items-center justify-center rounded-full bg-gradient-to-b font-black text-white ${p.avatarGrad}`}
                              style={{
                                width: `${avSize}px`,
                                height: `${avSize}px`,
                                fontSize: avFs,
                                boxShadow: `0 0 0 3px ${p.avatarRingInner}, 0 0 0 6px ${p.avatarRingOuter}, 0 0 22px ${p.avatarRingOuter}`,
                              }}
                            >
                              {getInitials(player.username)}
                            </div>
                          )}

                          {/* Player name */}
                          <div className="mt-2 w-full px-1">
                            {hasValidUserId(player.id) ? (
                              <Link
                                href={buildPlayerProfileHref(
                                  player.id,
                                  player.username
                                )}
                                className={`block truncate text-center font-black transition hover:opacity-80 ${p.accent} ${isFirst ? "text-[13px]" : "text-[11px]"}`}
                              >
                                {player.username}
                              </Link>
                            ) : (
                              <p
                                className={`truncate text-center font-black ${p.accent} ${isFirst ? "text-[13px]" : "text-[11px]"}`}
                              >
                                {player.username}
                              </p>
                            )}
                          </div>

                          {/* Tier label */}
                          <div
                            className={`mt-0.5 flex items-center gap-0.5 text-[9px] font-bold ${tier.textClass}`}
                          >
                            <span>{tier.icon}</span>
                            <span>{tier.label}</span>
                          </div>

                          {/* Stats block */}
                          <div className="mt-2 w-full space-y-1 border-t border-white/[0.06] px-0.5 pt-2 pb-2.5">
                            <div className="flex items-baseline justify-between">
                              <span className="text-[8px] uppercase tracking-[0.14em] text-zinc-600">
                                Points
                              </span>
                              <span
                                className={`font-black tabular-nums ${p.accent} ${isFirst ? "text-[22px]" : "text-[18px]"}`}
                                style={{
                                  filter: `drop-shadow(0 0 6px ${p.hexGlowColor})`,
                                  lineHeight: 1,
                                }}
                              >
                                {player.rankPoints}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between">
                              <span className="text-[8px] uppercase tracking-[0.14em] text-zinc-600">
                                Win rate
                              </span>
                              <span className="text-[11px] font-bold text-zinc-300">
                                {player.winRate}%
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Pedestal glow at card bottom */}
                        <div className="relative">
                          {/* Thin glowing line */}
                          <div
                            className="h-px w-full"
                            style={{
                              background: `linear-gradient(90deg, transparent 0%, ${p.pedestalColor} 40%, ${p.pedestalColor} 60%, transparent 100%)`,
                            }}
                          />
                          {/* Diffuse glow below line */}
                          <div className="relative flex justify-center pb-2 pt-1.5">
                            <div
                              className="rounded-full blur-lg"
                              style={{
                                width: "70%",
                                height: "8px",
                                background: p.pedestalGlow,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* ─── SEARCH ───────────────────────────────────────────────── */}
            <form
              action="/leaderboard"
              method="get"
              className="flex gap-2 rounded-xl border border-zinc-800/55 bg-zinc-950/60 p-2"
            >
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="limit" value={limit} />
              <input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Search player…"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700/55 bg-zinc-900/80 px-3 py-1.5 text-[13px] text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
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

            {/* ─── RANKED LIST ──────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">

              {/* Column header */}
              {listPlayers.length > 0 ? (
                <div className="flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-900/25 px-4 py-2">
                  <div className="w-8 shrink-0 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                    RANK
                  </div>
                  <div className="flex-1 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                    PLAYER
                  </div>
                  <div className="hidden w-16 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:block">
                    POINTS
                  </div>
                  <div className="hidden w-14 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:block">
                    WIN%
                  </div>
                  <div className="hidden w-5 shrink-0 text-center text-[9px] font-black text-zinc-600 sm:block">
                    ↑↓
                  </div>
                  <div className="w-12 shrink-0 text-right text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600 sm:hidden">
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
                  ) : showPodium ? (
                    <div className="space-y-1">
                      <p className="text-sm text-zinc-600">
                        More ranked players will appear here.
                      </p>
                      <p className="text-xs text-zinc-700">
                        Complete {UNRANKED_MATCHES_THRESHOLD} matches to claim
                        your rank.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-500">
                        No ranked players yet. Complete{" "}
                        {UNRANKED_MATCHES_THRESHOLD} placement matches to
                        appear.
                      </p>
                      <Link
                        href="/lobby"
                        className="inline-flex rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white transition hover:border-zinc-500"
                      >
                        Start Playing
                      </Link>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Player rows */}
              {listPlayers.map((player, index) => {
                const rank = listRankOffset + index + 1;
                const tier = resolveTierForRow(player);
                const av = tierAvatarStyle(tier);

                return (
                  <div
                    key={player.id}
                    className="group flex items-center gap-2.5 border-b border-zinc-800/30 px-4 py-2.5 last:border-b-0 transition-colors hover:bg-white/[0.025] sm:gap-3"
                  >
                    {/* Rank number */}
                    <div className="w-8 shrink-0 text-[15px] font-black tabular-nums text-zinc-400">
                      {rank}
                    </div>

                    {/* Avatar with tier ring */}
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-[11px] font-black text-white ring-2 ring-offset-1 ring-offset-zinc-950 transition hover:brightness-110 ${av.grad} ${av.ring}`}
                      >
                        {getInitials(player.username)}
                      </Link>
                    ) : (
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-[11px] font-black text-white ring-2 ring-offset-1 ring-offset-zinc-950 ${av.grad} ${av.ring}`}
                      >
                        {getInitials(player.username)}
                      </div>
                    )}

                    {/* Player name + tier label */}
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
                      <div
                        className={`flex items-center gap-1 text-[10px] font-bold ${tier.textClass}`}
                      >
                        <span>{tier.icon}</span>
                        <span>{tier.label}</span>
                      </div>
                    </div>

                    {/* Points — desktop */}
                    <div className="hidden w-16 shrink-0 text-right sm:block">
                      <p className="text-[13px] font-black tabular-nums text-yellow-200">
                        {player.rankPoints}
                      </p>
                    </div>

                    {/* Win rate — desktop */}
                    <div className="hidden w-14 shrink-0 text-right sm:block">
                      <p className="text-[13px] font-bold text-zinc-400">
                        {player.winRate}%
                      </p>
                    </div>

                    {/* Movement — desktop, always — */}
                    <div className="hidden w-5 shrink-0 text-center text-sm text-zinc-700 sm:block">
                      —
                    </div>

                    {/* Mobile: points + win rate stacked */}
                    <div className="w-12 shrink-0 text-right sm:hidden">
                      <p className="text-[13px] font-black tabular-nums text-yellow-200">
                        {player.rankPoints}
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        {player.winRate}%
                      </p>
                    </div>

                    {/* Challenge button — search results only */}
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
              })}
            </div>

            {/* ─── PAGINATION ───────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 px-1">
              {page > 1 ? (
                <Link
                  href={previousPageHref}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-[13px] font-semibold text-white transition hover:border-zinc-500"
                >
                  ← Prev
                </Link>
              ) : (
                <span />
              )}
              {showNextPage ? (
                <Link
                  href={nextPageHref}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-[13px] font-semibold text-white transition hover:border-zinc-500"
                >
                  Next →
                </Link>
              ) : null}
            </div>

            {/* Placement note */}
            {placementPlayerCount > 0 ? (
              <p className="text-center text-[10px] text-zinc-700">
                {placementPlayerCount} player
                {placementPlayerCount === 1 ? "" : "s"} in placement —{" "}
                {UNRANKED_MATCHES_THRESHOLD} matches required to rank
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {/* ═══ YOUR RANK BAR — fixed client component ══════════════════════ */}
      <YourRankBar />
    </>
  );
}
