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

// ─── Podium inline-style config (all visual props explicit — no Tailwind arbitrary) ──

type PodiumStyle = {
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  hexBg: string;
  hexFilter: string;
  avBg: string;
  avShadow: string;
  accentColor: string;
  accentShadow: string;
  pedestalLine: string;
  pedestalGlow: string;
  ambientColor: string;
};

const PODIUM_STYLES: PodiumStyle[] = [
  {
    // Gold — #1 center
    cardBg:
      "linear-gradient(175deg, rgba(130,72,6,0.96) 0%, rgba(45,22,2,1) 38%, rgba(7,5,1,1) 100%)",
    cardBorder: "rgba(234,179,8,0.75)",
    cardShadow:
      "0 0 0 1px rgba(234,179,8,0.30), 0 24px 72px rgba(234,179,8,0.62), inset 0 1px 0 rgba(255,215,0,0.26), inset 0 -1px 0 rgba(234,179,8,0.14)",
    hexBg: "linear-gradient(145deg, #ffe040 0%, #c07200 100%)",
    hexFilter:
      "drop-shadow(0 0 14px rgba(234,179,8,1)) drop-shadow(0 0 28px rgba(234,179,8,0.80))",
    avBg: "linear-gradient(175deg, rgba(175,105,15,0.80) 0%, rgba(35,16,2,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(234,179,8,0.98), 0 0 0 7px rgba(234,179,8,0.28), 0 0 36px rgba(234,179,8,0.55)",
    accentColor: "#fde68a",
    accentShadow: "drop-shadow(0 0 8px rgba(234,179,8,1))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(234,179,8,0.92) 50%, transparent 100%)",
    pedestalGlow: "rgba(234,179,8,0.65)",
    ambientColor: "rgba(234,179,8,0.14)",
  },
  {
    // Silver — #2 left
    cardBg:
      "linear-gradient(175deg, rgba(72,88,108,0.92) 0%, rgba(22,27,38,1) 38%, rgba(5,6,8,1) 100%)",
    cardBorder: "rgba(148,163,184,0.65)",
    cardShadow:
      "0 0 0 1px rgba(148,163,184,0.25), 0 18px 50px rgba(148,163,184,0.42), inset 0 1px 0 rgba(210,225,240,0.20), inset 0 -1px 0 rgba(148,163,184,0.12)",
    hexBg: "linear-gradient(145deg, #dceeff 0%, #4a6488 100%)",
    hexFilter:
      "drop-shadow(0 0 11px rgba(148,163,184,1)) drop-shadow(0 0 22px rgba(148,163,184,0.72))",
    avBg: "linear-gradient(175deg, rgba(85,108,130,0.75) 0%, rgba(16,20,28,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(148,163,184,0.95), 0 0 0 7px rgba(148,163,184,0.25), 0 0 28px rgba(148,163,184,0.48)",
    accentColor: "#e2e8f0",
    accentShadow: "drop-shadow(0 0 6px rgba(148,163,184,0.90))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(148,163,184,0.88) 50%, transparent 100%)",
    pedestalGlow: "rgba(148,163,184,0.55)",
    ambientColor: "rgba(148,163,184,0.10)",
  },
  {
    // Bronze — #3 right
    cardBg:
      "linear-gradient(175deg, rgba(110,52,10,0.94) 0%, rgba(30,14,3,1) 38%, rgba(6,3,1,1) 100%)",
    cardBorder: "rgba(180,92,20,0.68)",
    cardShadow:
      "0 0 0 1px rgba(180,92,20,0.26), 0 18px 50px rgba(180,92,20,0.48), inset 0 1px 0 rgba(225,135,55,0.18), inset 0 -1px 0 rgba(180,92,20,0.12)",
    hexBg: "linear-gradient(145deg, #e88230 0%, #7a3800 100%)",
    hexFilter:
      "drop-shadow(0 0 11px rgba(180,92,20,1)) drop-shadow(0 0 22px rgba(180,92,20,0.75))",
    avBg: "linear-gradient(175deg, rgba(155,78,15,0.78) 0%, rgba(24,11,2,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(180,92,20,0.95), 0 0 0 7px rgba(180,92,20,0.26), 0 0 28px rgba(180,92,20,0.48)",
    accentColor: "#fbbf24",
    accentShadow: "drop-shadow(0 0 6px rgba(180,92,20,0.92))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(180,92,20,0.88) 50%, transparent 100%)",
    pedestalGlow: "rgba(180,92,20,0.58)",
    ambientColor: "rgba(180,92,20,0.11)",
  },
];

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

// Tier → avatar ring / gradient for ranked list rows
function tierAvatarStyle(tier: RankTier): {
  ringColor: string;
  ringGlow: string;
  bgGrad: string;
} {
  const id = tier.id;
  if (id === "champion")
    return {
      ringColor: "rgba(253,224,71,0.95)",
      ringGlow: "rgba(253,224,71,0.30)",
      bgGrad: "linear-gradient(175deg, rgba(200,150,20,0.65), rgba(25,15,2,1))",
    };
  if (id === "elite")
    return {
      ringColor: "rgba(167,139,250,0.95)",
      ringGlow: "rgba(167,139,250,0.30)",
      bgGrad:
        "linear-gradient(175deg, rgba(100,70,180,0.65), rgba(10,5,25,1))",
    };
  if (id === "diamond")
    return {
      ringColor: "rgba(34,211,238,0.90)",
      ringGlow: "rgba(34,211,238,0.28)",
      bgGrad:
        "linear-gradient(175deg, rgba(20,120,150,0.65), rgba(5,10,25,1))",
    };
  if (id === "platinum")
    return {
      ringColor: "rgba(94,234,212,0.88)",
      ringGlow: "rgba(94,234,212,0.26)",
      bgGrad:
        "linear-gradient(175deg, rgba(20,110,100,0.65), rgba(5,12,15,1))",
    };
  if (id === "gold")
    return {
      ringColor: "rgba(234,179,8,0.90)",
      ringGlow: "rgba(234,179,8,0.28)",
      bgGrad:
        "linear-gradient(175deg, rgba(130,80,10,0.65), rgba(15,8,1,1))",
    };
  if (id === "silver")
    return {
      ringColor: "rgba(148,163,184,0.88)",
      ringGlow: "rgba(148,163,184,0.24)",
      bgGrad:
        "linear-gradient(175deg, rgba(70,85,100,0.65), rgba(8,10,14,1))",
    };
  if (id === "bronze")
    return {
      ringColor: "rgba(180,92,20,0.88)",
      ringGlow: "rgba(180,92,20,0.26)",
      bgGrad:
        "linear-gradient(175deg, rgba(110,55,10,0.65), rgba(10,5,1,1))",
    };
  return {
    ringColor: "rgba(82,82,91,0.60)",
    ringGlow: "rgba(82,82,91,0.16)",
    bgGrad: "linear-gradient(175deg, rgba(50,50,60,0.55), rgba(8,8,12,1))",
  };
}

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
  const previousPageHref = buildLeaderboardHref({
    search,
    page: page - 1,
    limit,
  });
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
      {/* ════════════════════════════════════════════════════════════════
          Page wrapper — centered game-screen, max 520px
          ════════════════════════════════════════════════════════════════ */}
      <div className="relative mx-auto max-w-[520px]">

        {/* Ambient page glow behind panel */}
        <div
          className="pointer-events-none absolute -inset-12 -z-10 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, rgba(34,211,238,0.10), transparent 68%)",
          }}
        />

        {/* ════ MAIN PANEL ═══════════════════════════════════════════════ */}
        <section
          aria-label="444 ARENA Leaderboard"
          className="relative overflow-hidden rounded-[20px]"
          style={{
            background: "#04060e",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.03), 0 40px 80px rgba(0,0,0,0.96)",
          }}
        >
          {/* ═══ APP-SCREEN HEADER ══════════════════════════════════════
              ← 444 ARENA  |  LEADERBOARD  |  pills
              ════════════════════════════════════════════════════════════ */}
          <div
            className="flex items-center justify-between gap-2 px-4 py-3"
            style={{
              background: "rgba(2,3,10,0.95)",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {/* Left: back arrow + brand */}
            <div className="flex flex-none items-center gap-2">
              <Link
                href="/"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:text-white"
                style={{ background: "rgba(255,255,255,0.06)" }}
                aria-label="Back"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="h-4 w-4"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </Link>
              <div>
                <p
                  className="text-[9px] font-black uppercase leading-none"
                  style={{ color: "rgba(34,211,238,0.80)", letterSpacing: "0.30em" }}
                >
                  444 ARENA
                </p>
              </div>
            </div>

            {/* Center title */}
            <h1
              className="flex-1 text-center font-black uppercase text-white"
              style={{ fontSize: "15px", letterSpacing: "0.26em" }}
            >
              LEADERBOARD
            </h1>

            {/* Right: Coming Soon pills */}
            <div className="flex flex-none items-center gap-1.5">
              <div
                className="rounded-lg px-2 py-1 text-center"
                style={{
                  background: "rgba(20,22,32,0.90)",
                  border: "1px solid rgba(80,82,100,0.50)",
                }}
              >
                <p
                  className="font-black uppercase leading-none"
                  style={{ fontSize: "7px", color: "#a1a1aa", letterSpacing: "0.12em" }}
                >
                  WALLET
                </p>
                <p
                  className="font-semibold uppercase leading-none"
                  style={{ fontSize: "7px", color: "#52525b", letterSpacing: "0.08em", marginTop: "2px" }}
                >
                  COMING SOON
                </p>
              </div>
              <div
                className="hidden rounded-lg px-2 py-1 sm:block"
                style={{
                  background: "rgba(20,22,32,0.90)",
                  border: "1px solid rgba(80,82,100,0.50)",
                }}
              >
                <p
                  className="whitespace-nowrap font-semibold"
                  style={{ fontSize: "8px", color: "#52525b" }}
                >
                  Season: Coming Soon
                </p>
              </div>
            </div>
          </div>

          {/* ═══ CONTENT AREA ═══════════════════════════════════════════ */}
          <div className="space-y-3 p-3 sm:p-4">

            {/* ─── FILTER PILLS ─────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  {
                    icon: (
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-[18px] w-[18px] shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ),
                    label: "GLOBAL",
                    active: true,
                  },
                  {
                    icon: (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-[18px] w-[18px] shrink-0"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                        <path d="M2 12h20" />
                      </svg>
                    ),
                    label: "P444",
                    active: true,
                  },
                  {
                    icon: (
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-[18px] w-[18px] shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ),
                    label: "ALL TIME",
                    active: false,
                  },
                ] as const
              ).map(({ icon, label, active }) => (
                <div
                  key={label}
                  className="flex cursor-default items-center gap-2 rounded-xl px-2.5 py-3"
                  style={{
                    background: active
                      ? "rgba(14,18,32,0.95)"
                      : "rgba(10,12,22,0.80)",
                    border: active
                      ? "1px solid rgba(60,90,160,0.60)"
                      : "1px solid rgba(50,55,80,0.40)",
                    boxShadow: active
                      ? "0 0 0 1px rgba(60,90,160,0.18), inset 0 1px 0 rgba(255,255,255,0.07)"
                      : "inset 0 1px 0 rgba(255,255,255,0.03)",
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  <span
                    style={{ color: active ? "rgba(99,140,255,0.90)" : "#52525b" }}
                  >
                    {icon}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-black uppercase"
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.12em",
                      color: active ? "#f1f5f9" : "#71717a",
                    }}
                  >
                    {label}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="h-2.5 w-2.5 shrink-0"
                    style={{ color: active ? "#6b7280" : "#3f3f46" }}
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              ))}
            </div>

            {/* ─── ERROR ────────────────────────────────────────────────── */}
            {error ? (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: "rgba(60,10,10,0.60)",
                  border: "1px solid rgba(180,40,40,0.50)",
                  color: "#fca5a5",
                }}
              >
                Could not load leaderboard. Please refresh.
              </div>
            ) : null}

            {/* ─── PODIUM (trophy display cases) ───────────────────────── */}
            {showPodium ? (
              <div className="relative pt-2">

                {/* Ambient medal glows behind podium cards */}
                {topPlayers[0] && (
                  <div
                    className="pointer-events-none absolute left-1/2 top-1/3 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM_STYLES[0]!.ambientColor }}
                  />
                )}
                {topPlayers[1] && (
                  <div
                    className="pointer-events-none absolute left-[22%] top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM_STYLES[1]!.ambientColor }}
                  />
                )}
                {topPlayers[2] && (
                  <div
                    className="pointer-events-none absolute left-[78%] top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM_STYLES[2]!.ambientColor }}
                  />
                )}

                {/* 3-column podium grid */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {topPlayers.map((player, index) => {
                    const ps = PODIUM_STYLES[index];
                    if (!ps) return null;
                    const rank = index + 1;
                    const isFirst = index === 0;
                    const tier = resolveTierForRow(player);

                    // Visual order: #1 center, #2 left, #3 right
                    const orderClass =
                      isFirst
                        ? "order-2"
                        : index === 1
                        ? "order-1"
                        : "order-3";

                    // Side cards pushed down 52px so center appears raised
                    const topPad = isFirst ? 0 : 52;

                    // Badge dimensions
                    const badgeW = isFirst ? 58 : 48;
                    const badgeH = isFirst ? 64 : 54;
                    const badgeFs = isFirst ? 22 : 17;

                    // Avatar size
                    const avSize = isFirst ? 76 : 62;
                    const avFs = isFirst ? 16 : 13;

                    // Card top-overlap with badge (half badge height)
                    const overlap = Math.round(badgeH * 0.42);

                    return (
                      <div
                        key={player.id}
                        className={`${orderClass} flex flex-col items-center`}
                        style={{ paddingTop: `${topPad}px` }}
                      >
                        {/* ── Hex rank badge ──────────────────────────── */}
                        <div
                          className="relative z-10 flex items-center justify-center shrink-0"
                          style={{
                            clipPath:
                              "polygon(50% 0%, 97% 25%, 97% 75%, 50% 100%, 3% 75%, 3% 25%)",
                            background: ps.hexBg,
                            filter: ps.hexFilter,
                            width: `${badgeW}px`,
                            height: `${badgeH}px`,
                          }}
                        >
                          <span
                            style={{
                              fontSize: `${badgeFs}px`,
                              fontWeight: 900,
                              color: "white",
                              lineHeight: 1,
                            }}
                          >
                            {rank}
                          </span>
                        </div>

                        {/* ── Card body ───────────────────────────────── */}
                        <div
                          className="relative w-full overflow-hidden rounded-[18px]"
                          style={{
                            marginTop: `-${overlap}px`,
                            background: ps.cardBg,
                            border: `1px solid ${ps.cardBorder}`,
                            boxShadow: ps.cardShadow,
                          }}
                        >
                          {/* Card content */}
                          <div
                            className="flex flex-col items-center px-2"
                            style={{
                              paddingTop: `${overlap + 12}px`,
                              paddingBottom: "12px",
                            }}
                          >
                            {/* Avatar */}
                            {hasValidUserId(player.id) ? (
                              <Link
                                href={buildPlayerProfileHref(
                                  player.id,
                                  player.username
                                )}
                                className="block transition-all hover:brightness-110"
                              >
                                <div
                                  className="flex items-center justify-center rounded-full font-black"
                                  style={{
                                    width: `${avSize}px`,
                                    height: `${avSize}px`,
                                    fontSize: `${avFs}px`,
                                    color: ps.accentColor,
                                    background: ps.avBg,
                                    boxShadow: ps.avShadow,
                                  }}
                                >
                                  {getInitials(player.username)}
                                </div>
                              </Link>
                            ) : (
                              <div
                                className="flex items-center justify-center rounded-full font-black"
                                style={{
                                  width: `${avSize}px`,
                                  height: `${avSize}px`,
                                  fontSize: `${avFs}px`,
                                  color: ps.accentColor,
                                  background: ps.avBg,
                                  boxShadow: ps.avShadow,
                                }}
                              >
                                {getInitials(player.username)}
                              </div>
                            )}

                            {/* Name */}
                            <div
                              className="mt-2 w-full px-1 text-center"
                            >
                              {hasValidUserId(player.id) ? (
                                <Link
                                  href={buildPlayerProfileHref(
                                    player.id,
                                    player.username
                                  )}
                                  className="block truncate font-black transition hover:opacity-80"
                                  style={{
                                    color: ps.accentColor,
                                    fontSize: isFirst ? "13px" : "11px",
                                  }}
                                >
                                  {player.username}
                                </Link>
                              ) : (
                                <p
                                  className="truncate font-black"
                                  style={{
                                    color: ps.accentColor,
                                    fontSize: isFirst ? "13px" : "11px",
                                  }}
                                >
                                  {player.username}
                                </p>
                              )}
                            </div>

                            {/* Tier */}
                            <div
                              className="mt-0.5 flex items-center gap-0.5"
                              style={{
                                color: tier.textClass.includes("yellow")
                                  ? "#fef08a"
                                  : tier.textClass.includes("cyan")
                                  ? "#a5f3fc"
                                  : tier.textClass.includes("purple")
                                  ? "#c4b5fd"
                                  : tier.textClass.includes("teal")
                                  ? "#99f6e4"
                                  : tier.textClass.includes("slate")
                                  ? "#e2e8f0"
                                  : tier.textClass.includes("amber")
                                  ? "#fcd34d"
                                  : "#a1a1aa",
                                fontSize: "9px",
                                fontWeight: 700,
                              }}
                            >
                              <span>{tier.icon}</span>
                              <span>{tier.label}</span>
                            </div>

                            {/* Stats */}
                            <div
                              className="mt-2.5 w-full space-y-1.5"
                              style={{
                                borderTop: "1px solid rgba(255,255,255,0.06)",
                                paddingTop: "8px",
                              }}
                            >
                              <div className="flex items-baseline justify-between">
                                <span
                                  className="font-black uppercase"
                                  style={{
                                    fontSize: "8px",
                                    letterSpacing: "0.14em",
                                    color: "rgba(113,113,122,0.80)",
                                  }}
                                >
                                  Points
                                </span>
                                <span
                                  className="font-black tabular-nums"
                                  style={{
                                    color: ps.accentColor,
                                    fontSize: isFirst ? "24px" : "19px",
                                    lineHeight: 1,
                                    filter: ps.accentShadow,
                                  }}
                                >
                                  {player.rankPoints}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span
                                  className="font-black uppercase"
                                  style={{
                                    fontSize: "8px",
                                    letterSpacing: "0.14em",
                                    color: "rgba(113,113,122,0.80)",
                                  }}
                                >
                                  Win rate
                                </span>
                                <span
                                  className="font-bold tabular-nums"
                                  style={{
                                    color: "#d4d4d8",
                                    fontSize: "12px",
                                  }}
                                >
                                  {player.winRate}%
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Pedestal glow at bottom of card */}
                          <div className="relative pb-2.5">
                            {/* Glowing horizontal line */}
                            <div
                              className="h-px w-full"
                              style={{ background: ps.pedestalLine }}
                            />
                            {/* Diffuse blur beneath line */}
                            <div
                              className="mx-auto mt-1.5 rounded-full"
                              style={{
                                width: "65%",
                                height: "7px",
                                background: ps.pedestalGlow,
                                filter: "blur(8px)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* ─── SEARCH ───────────────────────────────────────────────── */}
            <form
              action="/leaderboard"
              method="get"
              className="flex gap-2 rounded-xl p-2"
              style={{
                background: "rgba(8,10,18,0.80)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="limit" value={limit} />
              <input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Search player…"
                className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-[13px] text-white placeholder:text-zinc-600 focus:outline-none"
                style={{
                  background: "rgba(12,15,25,0.90)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition"
                style={{
                  background: "rgba(20,25,40,0.90)",
                  border: "1px solid rgba(80,90,130,0.50)",
                }}
              >
                Search
              </button>
              {hasActiveSearch ? (
                <Link
                  href={clearSearchHref}
                  className="flex shrink-0 items-center text-[13px] font-semibold transition hover:opacity-80"
                  style={{ color: "#fde68a" }}
                >
                  Clear
                </Link>
              ) : null}
            </form>

            {/* ─── RANKED LIST ──────────────────────────────────────────── */}
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                background: "rgba(7,9,16,0.95)",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.025), 0 4px 24px rgba(0,0,0,0.60)",
              }}
            >
              {/* Column header */}
              {listPlayers.length > 0 ? (
                <div
                  className="flex items-center gap-2.5 px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <div
                    className="w-8 shrink-0 font-black uppercase"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.22em",
                      color: "#52525b",
                    }}
                  >
                    RANK
                  </div>
                  <div
                    className="flex-1 font-black uppercase"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.22em",
                      color: "#52525b",
                    }}
                  >
                    PLAYER
                  </div>
                  <div
                    className="hidden w-16 shrink-0 text-right font-black uppercase sm:block"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.22em",
                      color: "#52525b",
                    }}
                  >
                    POINTS
                  </div>
                  <div
                    className="hidden w-14 shrink-0 text-right font-black uppercase sm:block"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.22em",
                      color: "#52525b",
                    }}
                  >
                    WIN%
                  </div>
                  <div
                    className="hidden w-5 shrink-0 text-center font-black sm:block"
                    style={{ fontSize: "9px", color: "#52525b" }}
                  >
                    ↑↓
                  </div>
                  <div
                    className="w-12 shrink-0 text-right font-black uppercase sm:hidden"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.20em",
                      color: "#52525b",
                    }}
                  >
                    PTS
                  </div>
                </div>
              ) : null}

              {/* Empty state */}
              {listPlayers.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  {hasActiveSearch ? (
                    <p style={{ fontSize: "14px", color: "#71717a" }}>
                      {`No players found for "${search}".`}
                    </p>
                  ) : showPodium ? (
                    <div>
                      <p style={{ fontSize: "13px", color: "#52525b" }}>
                        More ranked players will appear here.
                      </p>
                      <p
                        style={{
                          fontSize: "11px",
                          color: "#3f3f46",
                          marginTop: "4px",
                        }}
                      >
                        Complete {UNRANKED_MATCHES_THRESHOLD} matches to claim
                        your rank.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p style={{ fontSize: "14px", color: "#71717a" }}>
                        No ranked players yet. Complete{" "}
                        {UNRANKED_MATCHES_THRESHOLD} placement matches to
                        appear.
                      </p>
                      <Link
                        href="/lobby"
                        className="inline-flex rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-80"
                        style={{
                          background: "rgba(20,25,40,0.90)",
                          border: "1px solid rgba(80,90,130,0.50)",
                        }}
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
                    className="group flex items-center gap-2.5 px-4 py-2.5 transition-all last:border-b-0"
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "rgba(255,255,255,0.025)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "transparent";
                    }}
                  >
                    {/* Rank number */}
                    <div
                      className="w-8 shrink-0 font-black tabular-nums"
                      style={{ fontSize: "16px", color: "#a1a1aa" }}
                    >
                      {rank}
                    </div>

                    {/* Avatar shell */}
                    {hasValidUserId(player.id) ? (
                      <Link
                        href={buildPlayerProfileHref(player.id, player.username)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-black text-white transition hover:brightness-110"
                        style={{
                          fontSize: "11px",
                          background: av.bgGrad,
                          boxShadow: `0 0 0 2px ${av.ringColor}, 0 0 0 5px ${av.ringGlow}, 0 0 14px ${av.ringGlow}`,
                        }}
                      >
                        {getInitials(player.username)}
                      </Link>
                    ) : (
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-black text-white"
                        style={{
                          fontSize: "11px",
                          background: av.bgGrad,
                          boxShadow: `0 0 0 2px ${av.ringColor}, 0 0 0 5px ${av.ringGlow}, 0 0 14px ${av.ringGlow}`,
                        }}
                      >
                        {getInitials(player.username)}
                      </div>
                    )}

                    {/* Name + tier */}
                    <div className="min-w-0 flex-1">
                      {hasValidUserId(player.id) ? (
                        <Link
                          href={buildPlayerProfileHref(player.id, player.username)}
                          className="block truncate font-bold text-white transition hover:opacity-80"
                          style={{ fontSize: "13px" }}
                        >
                          {player.username}
                        </Link>
                      ) : (
                        <span
                          className="block truncate font-bold text-white"
                          style={{ fontSize: "13px" }}
                        >
                          {player.username}
                        </span>
                      )}
                      <div
                        className="flex items-center gap-1 font-bold"
                        style={{
                          fontSize: "10px",
                          color: av.ringColor,
                          marginTop: "1px",
                        }}
                      >
                        <span>{tier.icon}</span>
                        <span>{tier.label}</span>
                      </div>
                    </div>

                    {/* Points — desktop */}
                    <div className="hidden w-16 shrink-0 text-right sm:block">
                      <p
                        className="font-black tabular-nums"
                        style={{ fontSize: "13px", color: "#fde68a" }}
                      >
                        {player.rankPoints}
                      </p>
                    </div>

                    {/* Win rate — desktop */}
                    <div className="hidden w-14 shrink-0 text-right sm:block">
                      <p
                        className="font-bold tabular-nums"
                        style={{ fontSize: "13px", color: "#a1a1aa" }}
                      >
                        {player.winRate}%
                      </p>
                    </div>

                    {/* Movement — always — */}
                    <div
                      className="hidden w-5 shrink-0 text-center sm:block"
                      style={{ fontSize: "13px", color: "#3f3f46" }}
                    >
                      —
                    </div>

                    {/* Mobile: points + win rate stacked */}
                    <div className="w-12 shrink-0 text-right sm:hidden">
                      <p
                        className="font-black tabular-nums"
                        style={{ fontSize: "13px", color: "#fde68a" }}
                      >
                        {player.rankPoints}
                      </p>
                      <p style={{ fontSize: "10px", color: "#52525b" }}>
                        {player.winRate}%
                      </p>
                    </div>

                    {/* Challenge — search only */}
                    {hasActiveSearch && hasValidUserId(player.id) ? (
                      <Link
                        href={buildChallengeHref(player.id, player.username)}
                        className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold transition hover:opacity-80"
                        style={{
                          background: "rgba(8,40,50,0.80)",
                          border: "1px solid rgba(34,211,238,0.35)",
                          color: "#67e8f9",
                        }}
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
                  className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-80"
                  style={{
                    background: "rgba(20,25,40,0.90)",
                    border: "1px solid rgba(80,90,130,0.50)",
                  }}
                >
                  ← Prev
                </Link>
              ) : (
                <span />
              )}
              {showNextPage ? (
                <Link
                  href={nextPageHref}
                  className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-80"
                  style={{
                    background: "rgba(20,25,40,0.90)",
                    border: "1px solid rgba(80,90,130,0.50)",
                  }}
                >
                  Next →
                </Link>
              ) : null}
            </div>

            {/* Placement count note */}
            {placementPlayerCount > 0 ? (
              <p
                className="text-center"
                style={{ fontSize: "10px", color: "#3f3f46" }}
              >
                {placementPlayerCount} player
                {placementPlayerCount === 1 ? "" : "s"} in placement —{" "}
                {UNRANKED_MATCHES_THRESHOLD} matches required to rank
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {/* ═══ YOUR RANK BAR ═══════════════════════════════════════════════ */}
      <YourRankBar />
    </>
  );
}
