import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  resolvePlayerTier,
  UNRANKED_MATCHES_THRESHOLD,
  type RankTier,
} from "../../lib/player/ranks";
import { LEADERBOARD_QUALIFICATION_THRESHOLD } from "./constants";
import YourRankBar from "./YourRankBar";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

// ─── Types ────────────────────────────────────────────────────────────────────

type RankBy = "rating" | "win_rate";

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
  /** true when matches < LEADERBOARD_QUALIFICATION_THRESHOLD (10–19 matches past placement) */
  provisional: boolean;
  /** 1-based position among officially qualified players; null for provisional */
  officialRank: number | null;
};

// ─── Per-medal inline-style config ────────────────────────────────────────────

type PodiumStyle = {
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  hexBg: string;
  hexFilter: string;
  avBg: string;
  avShadow: string;
  accentColor: string;
  accentFilter: string;
  pedestalLine: string;
  pedestalGlow: string;
  ambientBg: string;
};

const PODIUM: PodiumStyle[] = [
  {
    // ── Gold — #1 (center) ──────────────────────────────────────────────────
    cardBg: [
      "radial-gradient(ellipse at 50% 0%, rgba(200,130,10,0.22) 0%, transparent 55%)",
      "linear-gradient(175deg, rgba(130,72,6,0.96) 0%, rgba(45,22,2,1) 36%, rgba(7,5,1,1) 100%)",
    ].join(", "),
    cardBorder: "rgba(234,179,8,0.80)",
    cardShadow:
      "0 0 0 1px rgba(234,179,8,0.32), 0 28px 80px rgba(234,179,8,0.65), inset 0 1px 0 rgba(255,215,0,0.28), inset 0 -1px 0 rgba(234,179,8,0.16)",
    hexBg: "linear-gradient(145deg, #ffe040 0%, #c07200 100%)",
    hexFilter:
      "drop-shadow(0 0 16px rgba(234,179,8,1)) drop-shadow(0 0 32px rgba(234,179,8,0.85))",
    avBg: "linear-gradient(175deg, rgba(175,105,15,0.85) 0%, rgba(35,16,2,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(234,179,8,1), 0 0 0 7px rgba(234,179,8,0.30), 0 0 40px rgba(234,179,8,0.58)",
    accentColor: "#fde68a",
    accentFilter: "drop-shadow(0 0 10px rgba(234,179,8,1))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(234,179,8,1) 50%, transparent 100%)",
    pedestalGlow: "rgba(234,179,8,0.70)",
    ambientBg: "rgba(234,179,8,0.16)",
  },
  {
    // ── Silver — #2 (left) ──────────────────────────────────────────────────
    cardBg: [
      "radial-gradient(ellipse at 50% 0%, rgba(200,218,240,0.28) 0%, transparent 52%)",
      "linear-gradient(175deg, rgba(96,118,145,0.96) 0%, rgba(28,34,46,1) 36%, rgba(6,7,10,1) 100%)",
    ].join(", "),
    cardBorder: "rgba(190,210,235,0.90)",
    cardShadow:
      "0 0 0 1px rgba(190,210,235,0.38), 0 20px 70px rgba(180,200,230,0.70), inset 0 1px 0 rgba(230,240,255,0.30), inset 0 -1px 0 rgba(180,200,230,0.18)",
    hexBg: "linear-gradient(145deg, #f0f8ff 0%, #6a8ab0 100%)",
    hexFilter:
      "drop-shadow(0 0 14px rgba(200,218,240,1)) drop-shadow(0 0 28px rgba(180,200,230,0.90))",
    avBg: "linear-gradient(175deg, rgba(110,138,168,0.88) 0%, rgba(18,22,32,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(200,218,240,1), 0 0 0 7px rgba(180,200,230,0.38), 0 0 38px rgba(180,200,230,0.70)",
    accentColor: "#f0f8ff",
    accentFilter: "drop-shadow(0 0 10px rgba(200,218,240,1))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(200,218,240,1) 50%, transparent 100%)",
    pedestalGlow: "rgba(200,218,240,0.75)",
    ambientBg: "rgba(180,200,230,0.20)",
  },
  {
    // ── Bronze — #3 (right) ─────────────────────────────────────────────────
    cardBg: [
      "radial-gradient(ellipse at 50% 0%, rgba(180,92,20,0.20) 0%, transparent 52%)",
      "linear-gradient(175deg, rgba(110,52,10,0.94) 0%, rgba(30,14,3,1) 36%, rgba(6,3,1,1) 100%)",
    ].join(", "),
    cardBorder: "rgba(180,92,20,0.78)",
    cardShadow:
      "0 0 0 1px rgba(180,92,20,0.30), 0 20px 55px rgba(180,92,20,0.55), inset 0 1px 0 rgba(225,135,55,0.22), inset 0 -1px 0 rgba(180,92,20,0.14)",
    hexBg: "linear-gradient(145deg, #e88230 0%, #7a3800 100%)",
    hexFilter:
      "drop-shadow(0 0 12px rgba(180,92,20,1)) drop-shadow(0 0 24px rgba(180,92,20,0.78))",
    avBg: "linear-gradient(175deg, rgba(155,78,15,0.82) 0%, rgba(24,11,2,1) 100%)",
    avShadow:
      "0 0 0 3px rgba(180,92,20,0.98), 0 0 0 7px rgba(180,92,20,0.28), 0 0 32px rgba(180,92,20,0.55)",
    accentColor: "#fbbf24",
    accentFilter: "drop-shadow(0 0 8px rgba(180,92,20,0.92))",
    pedestalLine:
      "linear-gradient(90deg, transparent 0%, rgba(180,92,20,1) 50%, transparent 100%)",
    pedestalGlow: "rgba(180,92,20,0.65)",
    ambientBg: "rgba(180,92,20,0.12)",
  },
];

// ─── Pure helpers (data logic unchanged) ──────────────────────────────────────

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

function buildLeaderboard(rows: PlayerStatsRow[], rankBy: RankBy = "rating"): LeaderboardPlayer[] {
  const toPlayer = (row: PlayerStatsRow, provisional: boolean): LeaderboardPlayer => ({
    id: row.user_id,
    username: row.username,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    matches: row.matches,
    goalsFor: row.goals_for,
    rankPoints: row.rank_points,
    winRate: row.matches > 0 ? Math.round((row.wins / row.matches) * 100) : 0,
    provisional,
    officialRank: null,
  });

  const sortFn = (a: LeaderboardPlayer, b: LeaderboardPlayer): number => {
    if (rankBy === "win_rate") {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
      if (b.matches !== a.matches) return b.matches - a.matches;
      return b.wins - a.wins;
    }
    // "rating" (default)
    if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return b.goalsFor - a.goalsFor;
  };

  // Qualified players (20+ matches) appear first with official rank numbers.
  // Provisional players (10–19 matches) appear below, clearly separated.
  const qualified = rows
    .filter(r => r.matches >= LEADERBOARD_QUALIFICATION_THRESHOLD)
    .map(r => toPlayer(r, false))
    .sort(sortFn);

  const prov = rows
    .filter(r => r.matches < LEADERBOARD_QUALIFICATION_THRESHOLD)
    .map(r => toPlayer(r, true))
    .sort(sortFn);

  qualified.forEach((p, i) => { p.officialRank = i + 1; });

  return [...qualified, ...prov];
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
  options: { search?: string; page?: number; limit?: number; rankBy?: RankBy } = {}
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (options.search) params.set("search", options.search);
  // Only include rankBy when non-default to keep URLs clean
  if (options.rankBy && options.rankBy !== "rating") params.set("rankBy", options.rankBy);
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

// Tier → avatar ring colors for the ranked list
function tierRingStyle(tier: RankTier): {
  ringColor: string;
  glowColor: string;
  bgGrad: string;
  labelColor: string;
} {
  const id = tier.id;
  if (id === "champion")
    return {
      ringColor: "rgba(253,224,71,0.98)",
      glowColor: "rgba(253,224,71,0.32)",
      bgGrad: "linear-gradient(175deg, rgba(200,150,20,0.70) 0%, rgba(25,15,2,1) 100%)",
      labelColor: "#fef08a",
    };
  if (id === "elite")
    return {
      ringColor: "rgba(167,139,250,0.98)",
      glowColor: "rgba(167,139,250,0.32)",
      bgGrad: "linear-gradient(175deg, rgba(100,70,180,0.70) 0%, rgba(10,5,25,1) 100%)",
      labelColor: "#c4b5fd",
    };
  if (id === "diamond")
    return {
      ringColor: "rgba(34,211,238,0.95)",
      glowColor: "rgba(34,211,238,0.30)",
      bgGrad: "linear-gradient(175deg, rgba(20,120,150,0.70) 0%, rgba(5,10,25,1) 100%)",
      labelColor: "#a5f3fc",
    };
  if (id === "platinum")
    return {
      ringColor: "rgba(94,234,212,0.92)",
      glowColor: "rgba(94,234,212,0.28)",
      bgGrad: "linear-gradient(175deg, rgba(20,110,100,0.70) 0%, rgba(5,12,15,1) 100%)",
      labelColor: "#99f6e4",
    };
  if (id === "gold")
    return {
      ringColor: "rgba(234,179,8,0.95)",
      glowColor: "rgba(234,179,8,0.30)",
      bgGrad: "linear-gradient(175deg, rgba(130,80,10,0.70) 0%, rgba(15,8,1,1) 100%)",
      labelColor: "#fcd34d",
    };
  if (id === "silver")
    return {
      ringColor: "rgba(148,163,184,0.92)",
      glowColor: "rgba(148,163,184,0.26)",
      bgGrad: "linear-gradient(175deg, rgba(70,85,100,0.70) 0%, rgba(8,10,14,1) 100%)",
      labelColor: "#e2e8f0",
    };
  if (id === "bronze")
    return {
      ringColor: "rgba(180,92,20,0.92)",
      glowColor: "rgba(180,92,20,0.28)",
      bgGrad: "linear-gradient(175deg, rgba(110,55,10,0.70) 0%, rgba(10,5,1,1) 100%)",
      labelColor: "#fbbf24",
    };
  return {
    ringColor: "rgba(82,82,91,0.65)",
    glowColor: "rgba(82,82,91,0.18)",
    bgGrad: "linear-gradient(175deg, rgba(50,50,60,0.60) 0%, rgba(8,8,12,1) 100%)",
    labelColor: "#a1a1aa",
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
    rankBy?: string;
  }>;
}) {
  const { search: rawSearch, page: rawPage, limit: rawLimit, rankBy: rawRankBy } =
    await searchParams;
  const search = rawSearch?.trim() ?? "";
  const hasActiveSearch = search.length > 0;
  const page = parsePage(rawPage);
  const limit = parseLimit(rawLimit);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const rankBy: RankBy = rawRankBy === "win_rate" ? "win_rate" : "rating";

  const statsSelect =
    "user_id, username, matches, wins, losses, draws, goals_for, rank_points";
  // Fetch all players who have completed at least one placement match.
  // Provisional players (10–19 matches) and qualified players (20+ matches)
  // are both included; classification happens in buildLeaderboard().
  const RANKED_MATCH_FLOOR = UNRANKED_MATCHES_THRESHOLD;

  let statsQuery = supabase
    .from("player_stats")
    .select(statsSelect)
    .eq("game_id", "penalty444")
    .gte("matches", RANKED_MATCH_FLOOR)
    .order("rank_points", { ascending: false })
    .order("wins", { ascending: false })
    .order("matches", { ascending: false })
    .order("goals_for", { ascending: false })
    .limit(500); // fetch enough for in-memory sort across all rank-by modes

  if (hasActiveSearch) {
    statsQuery = statsQuery.ilike("username", `%${search}%`);
  }

  const [statsResult, placementCountResult] = await Promise.all([
    statsQuery,
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

  const allPlayers = buildLeaderboard(
    (statsResult.data ?? []) as PlayerStatsRow[],
    rankBy
  );
  const provisionalPlayerCount = allPlayers.filter(p => p.provisional).length;
  // In-memory pagination applied after full sort
  const leaderboard = allPlayers.slice(from, to + 1);
  // Podium uses only officially qualified players (20+ matches)
  const topPlayers = allPlayers.filter(p => !p.provisional).slice(0, 3);

  const clearSearchHref = buildLeaderboardHref({ page, limit, rankBy });
  const previousPageHref = buildLeaderboardHref({ search, page: page - 1, limit, rankBy });
  const nextPageHref = buildLeaderboardHref({ search, page: page + 1, limit, rankBy });
  const showNextPage = allPlayers.length > to + 1;

  // Rank-by chip hrefs (always reset to page 1 on sort change)
  const ratingHref = buildLeaderboardHref({ search, page: 1, limit, rankBy: "rating" });
  const winRateHref = buildLeaderboardHref({ search, page: 1, limit, rankBy: "win_rate" });

  const showPodium =
    !error && topPlayers.length > 0 && page === 1 && !hasActiveSearch;
  // Exclude podium players from the ranked list to avoid duplication
  const podiumIds = new Set(topPlayers.map(p => p.id));
  const listPlayers = showPodium
    ? leaderboard.filter(p => !podiumIds.has(p.id))
    : leaderboard;

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════
          Full-bleed cinematic background — negative margins cancel the
          <main>'s p-4/md:p-6 padding so we get edge-to-edge dark canvas
          ══════════════════════════════════════════════════════════════════ */}
      <div
        className="-mx-4 -mt-4 min-h-screen md:-mx-6 md:-mt-6"
        style={{
          background:
            "linear-gradient(160deg, #010212 0%, #030810 55%, #020508 100%)",
        }}
      >
        {/* Re-add correct padding and center the panel */}
        <div className="relative mx-auto max-w-[520px] px-4 pt-4 md:max-w-[700px] md:px-6 md:pt-6">

          {/* Ambient page glow behind the panel */}
          <div
            className="pointer-events-none absolute -inset-8 -z-10 rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at 50% 35%, rgba(34,80,200,0.14), transparent 68%)",
            }}
          />

          {/* ══════════════════════════════════════════════════════════
              MAIN PANEL
              ══════════════════════════════════════════════════════════ */}
          <section
            className="relative overflow-hidden rounded-[20px]"
            aria-label="444 ARENA Leaderboard"
            style={{
              background: "#04060e",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.03), 0 48px 96px rgba(0,0,0,0.98), 0 0 80px rgba(0,0,0,0.70)",
            }}
          >
            {/* ══ APP-SCREEN HEADER ════════════════════════════════════
                ← 444 ARENA  ·  LEADERBOARD  ·  pills
                ════════════════════════════════════════════════════════ */}
            <div
              className="flex items-center justify-between gap-2 px-4 py-3"
              style={{
                background: "rgba(2,3,10,0.96)",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {/* Left: back arrow + brand */}
              <div className="flex flex-none items-center gap-2">
                <Link
                  href="/"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition hover:opacity-80"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    color: "#d4d4d8",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
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
                <span
                  className="font-black uppercase"
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.32em",
                    color: "rgba(34,211,238,0.85)",
                  }}
                >
                  444 ARENA
                </span>
              </div>

              {/* Center: title */}
              <h1
                className="flex-1 text-center font-black uppercase text-white"
                style={{ fontSize: "15px", letterSpacing: "0.25em" }}
              >
                LEADERBOARD
              </h1>

              {/* Right: Coming Soon pills */}
              <div className="flex flex-none items-center gap-1.5">
                <div
                  className="rounded-lg px-2 py-1 text-center"
                  style={{
                    background: "rgba(18,20,30,0.95)",
                    border: "1px solid rgba(70,75,100,0.55)",
                  }}
                >
                  <p
                    className="font-black uppercase leading-none"
                    style={{
                      fontSize: "7px",
                      color: "#a1a1aa",
                      letterSpacing: "0.12em",
                    }}
                  >
                    WALLET
                  </p>
                  <p
                    className="font-semibold uppercase leading-none"
                    style={{
                      fontSize: "7px",
                      color: "#52525b",
                      letterSpacing: "0.07em",
                      marginTop: "2px",
                    }}
                  >
                    COMING SOON
                  </p>
                </div>
              </div>
            </div>

            {/* ══ CONTENT ══════════════════════════════════════════════ */}
            <div className="space-y-3 p-3 sm:p-4">

              {/* ── FILTER CHIPS ─────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Region chip */}
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: "rgba(12,16,30,0.98)",
                    border: "1px solid rgba(55,85,160,0.55)",
                    boxShadow: "0 0 0 1px rgba(55,85,160,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "rgba(99,140,255,0.90)" }}>
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: "#71717a", letterSpacing: "0.15em" }}>REGION</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: "#f1f5f9", marginTop: "2px" }}>Global</p>
                  </div>
                </div>

                {/* Game chip */}
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: "rgba(12,16,30,0.98)",
                    border: "1px solid rgba(55,85,160,0.55)",
                    boxShadow: "0 0 0 1px rgba(55,85,160,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0" style={{ color: "rgba(99,140,255,0.90)" }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                    <path d="M2 12h20" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: "#71717a", letterSpacing: "0.15em" }}>GAME</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: "#f1f5f9", marginTop: "2px" }}>Penalty444</p>
                  </div>
                </div>

                {/* Divider */}
                <div className="mx-0.5 h-8 w-px shrink-0" style={{ background: "rgba(55,65,100,0.45)" }} />

                {/* Period: All Time (active) */}
                <div
                  className="flex cursor-default select-none items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: "rgba(12,16,30,0.98)",
                    border: "1px solid rgba(55,85,160,0.68)",
                    boxShadow: "0 0 0 1px rgba(55,85,160,0.22), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 16px rgba(55,85,160,0.12)",
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "rgba(99,140,255,0.90)" }}>
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: "#71717a", letterSpacing: "0.15em" }}>PERIOD</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: "#f1f5f9", marginTop: "2px" }}>All Time</p>
                  </div>
                  <div className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "rgba(99,140,255,0.90)" }} />
                </div>

                {/* Period: Season (disabled — not yet available) */}
                <div
                  className="flex cursor-not-allowed select-none items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: "rgba(8,10,18,0.70)",
                    border: "1px solid rgba(45,50,75,0.35)",
                    opacity: 0.6,
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "#52525b" }}>
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: "#52525b", letterSpacing: "0.15em" }}>PERIOD</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: "#71717a", marginTop: "2px" }}>Season</p>
                  </div>
                  <span
                    className="ml-0.5 rounded px-1 font-black uppercase"
                    style={{ fontSize: "6px", letterSpacing: "0.12em", background: "rgba(40,45,70,0.80)", color: "#52525b" }}
                  >
                    SOON
                  </span>
                </div>

                {/* Divider */}
                <div className="mx-0.5 h-8 w-px shrink-0" style={{ background: "rgba(55,65,100,0.45)" }} />

                {/* RANK BY: Rating (active by default) */}
                <Link
                  href={ratingHref}
                  className="flex select-none items-center gap-2 rounded-xl px-3 py-2 transition hover:opacity-80"
                  style={{
                    background: rankBy === "rating" ? "rgba(12,16,30,0.98)" : "rgba(8,10,18,0.80)",
                    border: rankBy === "rating" ? "1px solid rgba(55,85,160,0.68)" : "1px solid rgba(45,50,75,0.40)",
                    boxShadow: rankBy === "rating" ? "0 0 0 1px rgba(55,85,160,0.22), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 16px rgba(55,85,160,0.12)" : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: rankBy === "rating" ? "rgba(99,140,255,0.90)" : "#52525b" }}>
                    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: rankBy === "rating" ? "#71717a" : "#52525b", letterSpacing: "0.15em" }}>RANK BY</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: rankBy === "rating" ? "#f1f5f9" : "#71717a", marginTop: "2px" }}>Rating</p>
                  </div>
                  {rankBy === "rating" && (
                    <div className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "rgba(99,140,255,0.90)" }} />
                  )}
                </Link>

                {/* RANK BY: Win Rate */}
                <Link
                  href={winRateHref}
                  className="flex select-none items-center gap-2 rounded-xl px-3 py-2 transition hover:opacity-80"
                  style={{
                    background: rankBy === "win_rate" ? "rgba(12,16,30,0.98)" : "rgba(8,10,18,0.80)",
                    border: rankBy === "win_rate" ? "1px solid rgba(55,85,160,0.68)" : "1px solid rgba(45,50,75,0.40)",
                    boxShadow: rankBy === "win_rate" ? "0 0 0 1px rgba(55,85,160,0.22), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 16px rgba(55,85,160,0.12)" : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: rankBy === "win_rate" ? "rgba(99,140,255,0.90)" : "#52525b" }}>
                    <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: rankBy === "win_rate" ? "#71717a" : "#52525b", letterSpacing: "0.15em" }}>RANK BY</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: rankBy === "win_rate" ? "#f1f5f9" : "#71717a", marginTop: "2px" }}>Win Rate</p>
                  </div>
                  {rankBy === "win_rate" && (
                    <div className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "rgba(99,140,255,0.90)" }} />
                  )}
                </Link>

                {/* RANK BY: Tournament Wins (disabled — not yet available) */}
                <div
                  className="flex cursor-not-allowed select-none items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: "rgba(8,10,18,0.70)",
                    border: "1px solid rgba(45,50,75,0.35)",
                    opacity: 0.6,
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "#52525b" }}>
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <div>
                    <p className="font-black uppercase leading-none" style={{ fontSize: "7px", color: "#52525b", letterSpacing: "0.15em" }}>RANK BY</p>
                    <p className="font-bold leading-tight" style={{ fontSize: "11px", color: "#71717a", marginTop: "2px" }}>Tournament Wins</p>
                  </div>
                  <span
                    className="ml-0.5 rounded px-1 font-black uppercase"
                    style={{ fontSize: "6px", letterSpacing: "0.12em", background: "rgba(40,45,70,0.80)", color: "#52525b" }}
                  >
                    SOON
                  </span>
                </div>
              </div>

              {/* ── ERROR ────────────────────────────────────────────── */}
              {error ? (
                <div
                  className="rounded-xl px-4 py-3 text-sm"
                  style={{
                    background: "rgba(60,10,10,0.65)",
                    border: "1px solid rgba(180,40,40,0.50)",
                    color: "#fca5a5",
                  }}
                >
                  Could not load leaderboard. Please refresh.
                </div>
              ) : null}

              {/* ── PODIUM — trophy display cases ───────────────────── */}
              {showPodium ? (
                <div className="relative overflow-visible pt-2">

                  {/* Per-medal ambient glows behind podium */}
                  <div
                    className="pointer-events-none absolute left-1/2 top-0 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM[0]!.ambientBg }}
                  />
                  <div
                    className="pointer-events-none absolute left-[18%] top-8 h-32 w-32 -translate-x-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM[1]!.ambientBg }}
                  />
                  <div
                    className="pointer-events-none absolute left-[82%] top-8 h-32 w-32 -translate-x-1/2 rounded-full blur-3xl"
                    style={{ background: PODIUM[2]!.ambientBg }}
                  />

                  {/* Podium grid — side cards pushed down 52px so center looks raised */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {topPlayers.map((player, index) => {
                      const ps = PODIUM[index];
                      if (!ps) return null;
                      const rank = index + 1;
                      const isFirst = index === 0;
                      const tier = resolveTierForRow(player);
                      const orderClass =
                        isFirst ? "order-2" : index === 1 ? "order-1" : "order-3";

                      // Sizes scale with position
                      const badgeW = isFirst ? 50 : 42;
                      const badgeH = isFirst ? 58 : 48;
                      const badgeFs = isFirst ? 20 : 16;
                      const avSize = isFirst ? 62 : 50;
                      const avFs = isFirst ? 13 : 11;
                      const overlap = Math.round(badgeH * 0.44);

                      return (
                        <div
                          key={player.id}
                          className={`${orderClass} flex flex-col items-center`}
                          style={{ paddingTop: isFirst ? 0 : "34px" }}
                        >
                          {/* Hex rank badge — floats above card */}
                          <div
                            className="relative z-10 flex shrink-0 items-center justify-center"
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

                          {/* Trophy display case card */}
                          <div
                            className="relative w-full rounded-[18px]"
                            style={{
                              marginTop: `-${overlap}px`,
                              background: ps.cardBg,
                              border: `1px solid ${ps.cardBorder}`,
                              boxShadow: ps.cardShadow,
                              overflow: "hidden",
                            }}
                          >
                            {/* Card content */}
                            <div
                              className="flex flex-col items-center px-2 sm:px-3"
                              style={{
                                paddingTop: `${overlap + 10}px`,
                                paddingBottom: "10px",
                              }}
                            >
                              {/* Avatar shell with medal ring */}
                              {hasValidUserId(player.id) ? (
                                <Link
                                  href={buildPlayerProfileHref(player.id, player.username)}
                                  className="block rounded-full transition hover:brightness-110"
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

                              {/* Player name */}
                              <div className="mt-2 w-full px-1">
                                {hasValidUserId(player.id) ? (
                                  <Link
                                    href={buildPlayerProfileHref(player.id, player.username)}
                                    className="block truncate text-center font-black transition hover:opacity-80"
                                    style={{
                                      color: ps.accentColor,
                                      fontSize: isFirst ? "13px" : "11px",
                                    }}
                                  >
                                    {player.username}
                                  </Link>
                                ) : (
                                  <p
                                    className="truncate text-center font-black"
                                    style={{
                                      color: ps.accentColor,
                                      fontSize: isFirst ? "13px" : "11px",
                                    }}
                                  >
                                    {player.username}
                                  </p>
                                )}
                              </div>

                              {/* Tier chip */}
                              <div
                                className="mt-0.5 flex items-center gap-0.5 font-bold"
                                style={{
                                  fontSize: "9px",
                                  color: tierRingStyle(tier).labelColor,
                                }}
                              >
                                <span>{tier.icon}</span>
                                <span>{tier.label}</span>
                              </div>

                              {/* Stats rows */}
                              <div
                                className="mt-2.5 w-full space-y-1.5"
                                style={{
                                  borderTop: "1px solid rgba(255,255,255,0.07)",
                                  paddingTop: "8px",
                                }}
                              >
                                <div className="flex items-baseline justify-between">
                                  <span
                                    className="font-black uppercase"
                                    style={{
                                      fontSize: "8px",
                                      letterSpacing: "0.14em",
                                      color: "rgba(113,113,122,0.75)",
                                    }}
                                  >
                                    Points
                                  </span>
                                  <span
                                    className="font-black tabular-nums"
                                    style={{
                                      color: ps.accentColor,
                                      fontSize: isFirst ? "20px" : "17px",
                                      lineHeight: 1,
                                      filter: ps.accentFilter,
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
                                      color: "rgba(113,113,122,0.75)",
                                    }}
                                  >
                                    Win rate
                                  </span>
                                  <span
                                    className="font-bold tabular-nums"
                                    style={{ color: "#d4d4d8", fontSize: "12px" }}
                                  >
                                    {player.winRate}%
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Pedestal — glowing base of card */}
                            <div className="relative pb-2.5">
                              <div
                                className="h-px w-full"
                                style={{ background: ps.pedestalLine }}
                              />
                              <div
                                className="mx-auto mt-2 rounded-full"
                                style={{
                                  width: "60%",
                                  height: "8px",
                                  background: ps.pedestalGlow,
                                  filter: "blur(10px)",
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

              {/* ── SEARCH ───────────────────────────────────────────── */}
              <form
                action="/leaderboard"
                method="get"
                className="flex gap-2 rounded-xl p-2"
                style={{
                  background: "rgba(6,8,16,0.90)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <input type="hidden" name="page" value="1" />
                <input type="hidden" name="limit" value={limit} />
                {rankBy !== "rating" && <input type="hidden" name="rankBy" value={rankBy} />}
                <input
                  type="search"
                  name="search"
                  defaultValue={search}
                  placeholder="Search player…"
                  className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-[13px] text-white placeholder:text-zinc-700 focus:outline-none"
                  style={{
                    background: "rgba(10,12,22,0.95)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-80"
                  style={{
                    background: "rgba(18,24,42,0.95)",
                    border: "1px solid rgba(60,80,140,0.55)",
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

              {/* ── RANKED LIST ──────────────────────────────────────── */}
              <div
                className="overflow-hidden rounded-2xl"
                style={{
                  background: "rgba(5,7,14,0.98)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.03), 0 4px 28px rgba(0,0,0,0.65)",
                }}
              >
                {/* Column headers */}
                {listPlayers.length > 0 ? (
                  <div
                    className="flex items-center gap-2.5 px-4 py-2.5"
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      background: "rgba(8,10,20,0.60)",
                    }}
                  >
                    <div
                      className="w-8 shrink-0 font-black uppercase"
                      style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#3f3f46" }}
                    >
                      RANK
                    </div>
                    <div
                      className="flex-1 font-black uppercase"
                      style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#3f3f46" }}
                    >
                      PLAYER
                    </div>
                    <div
                      className="hidden w-16 shrink-0 text-right font-black uppercase sm:block"
                      style={{ fontSize: "9px", letterSpacing: "0.22em", color: rankBy === "rating" ? "rgba(99,140,255,0.60)" : "#3f3f46" }}
                    >
                      POINTS
                    </div>
                    <div
                      className="hidden w-14 shrink-0 text-right font-black uppercase sm:block"
                      style={{ fontSize: "9px", letterSpacing: "0.22em", color: rankBy === "win_rate" ? "rgba(99,140,255,0.60)" : "#3f3f46" }}
                    >
                      WIN%
                    </div>
                    <div
                      className="hidden w-5 shrink-0 text-center font-black sm:block"
                      style={{ fontSize: "9px", color: "#3f3f46" }}
                    >
                      ↑↓
                    </div>
                    <div
                      className="w-12 shrink-0 text-right font-black uppercase sm:hidden"
                      style={{ fontSize: "9px", letterSpacing: "0.20em", color: "#3f3f46" }}
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
                        <p style={{ fontSize: "11px", color: "#3f3f46", marginTop: "4px" }}>
                          Complete {UNRANKED_MATCHES_THRESHOLD} matches to
                          claim your rank.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p style={{ fontSize: "14px", color: "#71717a" }}>
                          No officially ranked players yet. Complete{" "}
                          {LEADERBOARD_QUALIFICATION_THRESHOLD} matches to
                          appear.
                        </p>
                        <Link
                          href="/lobby"
                          className="inline-flex rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-80"
                          style={{
                            background: "rgba(18,24,42,0.95)",
                            border: "1px solid rgba(60,80,140,0.55)",
                          }}
                        >
                          Start Playing
                        </Link>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Player rows — hover via Tailwind (no JS handlers in server component) */}
                {listPlayers.flatMap((player, index) => {
                  const prevPlayer = listPlayers[index - 1];
                  const isFirstProv = player.provisional && !prevPlayer?.provisional;
                  const tier = resolveTierForRow(player);
                  const av = tierRingStyle(tier);

                  const rows = [];

                  if (isFirstProv) {
                    rows.push(
                      <div
                        key="provisional-separator"
                        className="flex items-center gap-3 px-4 py-2"
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          background: "rgba(255,255,255,0.015)",
                        }}
                      >
                        <div className="h-px flex-1" style={{ background: "rgba(255,200,50,0.18)" }} />
                        <p
                          className="shrink-0 font-black uppercase"
                          style={{ fontSize: "8px", letterSpacing: "0.22em", color: "#52525b" }}
                        >
                          Provisional — {LEADERBOARD_QUALIFICATION_THRESHOLD} matches required for official ranking
                        </p>
                        <div className="h-px flex-1" style={{ background: "rgba(255,200,50,0.18)" }} />
                      </div>
                    );
                  }

                  rows.push(
                    <div
                      key={player.id}
                      className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/[0.025]"
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        opacity: player.provisional ? 0.72 : 1,
                      }}
                    >
                      {/* Rank */}
                      <div className="w-8 shrink-0">
                        {player.officialRank !== null ? (
                          <span
                            className="font-black tabular-nums"
                            style={{ fontSize: "17px", color: "#71717a" }}
                          >
                            {player.officialRank}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded px-1 font-black uppercase"
                            style={{
                              fontSize: "6px",
                              letterSpacing: "0.10em",
                              background: "rgba(255,200,50,0.10)",
                              border: "1px solid rgba(255,200,50,0.22)",
                              color: "#a16207",
                            }}
                          >
                            PROV
                          </span>
                        )}
                      </div>

                      {/* Avatar with tier ring */}
                      {hasValidUserId(player.id) ? (
                        <Link
                          href={buildPlayerProfileHref(player.id, player.username)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-black text-white transition hover:brightness-110"
                          style={{
                            fontSize: "11px",
                            background: av.bgGrad,
                            boxShadow: `0 0 0 2px ${av.ringColor}, 0 0 0 5px ${av.glowColor}, 0 0 16px ${av.glowColor}`,
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
                            boxShadow: `0 0 0 2px ${av.ringColor}, 0 0 0 5px ${av.glowColor}, 0 0 16px ${av.glowColor}`,
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
                            color: av.labelColor,
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
                          style={{ fontSize: "13px", color: rankBy === "rating" ? "#fde68a" : "#52525b" }}
                        >
                          {player.rankPoints}
                        </p>
                      </div>

                      {/* Win rate — desktop */}
                      <div className="hidden w-14 shrink-0 text-right sm:block">
                        <p
                          className="font-bold tabular-nums"
                          style={{ fontSize: "13px", color: rankBy === "win_rate" ? "#fde68a" : "#a1a1aa" }}
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
                          style={{ fontSize: "13px", color: rankBy === "rating" ? "#fde68a" : "#52525b" }}
                        >
                          {rankBy === "win_rate" ? `${player.winRate}%` : String(player.rankPoints)}
                        </p>
                        <p style={{ fontSize: "10px", color: "#52525b" }}>
                          {rankBy === "win_rate" ? `${player.rankPoints} pts` : `${player.winRate}%`}
                        </p>
                      </div>

                      {/* Challenge — search only */}
                      {hasActiveSearch && hasValidUserId(player.id) ? (
                        <Link
                          href={buildChallengeHref(player.id, player.username)}
                          className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold transition hover:opacity-80"
                          style={{
                            background: "rgba(8,40,50,0.90)",
                            border: "1px solid rgba(34,211,238,0.38)",
                            color: "#67e8f9",
                          }}
                        >
                          Challenge
                        </Link>
                      ) : null}
                    </div>
                  );

                  return rows;
                })}
              </div>

              {/* ── PAGINATION ───────────────────────────────────────── */}
              <div className="flex items-center justify-between gap-3 px-1">
                {page > 1 ? (
                  <Link
                    href={previousPageHref}
                    className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-80"
                    style={{
                      background: "rgba(18,24,42,0.95)",
                      border: "1px solid rgba(60,80,140,0.50)",
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
                      background: "rgba(18,24,42,0.95)",
                      border: "1px solid rgba(60,80,140,0.50)",
                    }}
                  >
                    Next →
                  </Link>
                ) : null}
              </div>

              {/* Placement / provisional count note */}
              {(placementPlayerCount > 0 || provisionalPlayerCount > 0) ? (
                <p
                  className="text-center"
                  style={{ fontSize: "10px", color: "#3f3f46" }}
                >
                  {placementPlayerCount > 0 && (
                    <>{placementPlayerCount} player{placementPlayerCount === 1 ? "" : "s"} in placement ({UNRANKED_MATCHES_THRESHOLD} matches required)</>
                  )}
                  {placementPlayerCount > 0 && provisionalPlayerCount > 0 && " · "}
                  {provisionalPlayerCount > 0 && (
                    <>{provisionalPlayerCount} provisional ({LEADERBOARD_QUALIFICATION_THRESHOLD} matches for official ranking)</>
                  )}
                </p>
              ) : null}
            </div>
          </section>

          {/* Bottom spacer — tall enough to clear the fixed YourRankBar on mobile */}
          <div className="h-32 sm:h-24" />
        </div>
      </div>

      {/* ── YOUR RANK BAR ──────────────────────────────────────────────── */}
      <YourRankBar />
    </>
  );
}
