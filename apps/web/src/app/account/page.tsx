"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AchievementGrid from "../../components/player/AchievementGrid";
import CompetitiveProfileCard from "../../components/player/CompetitiveProfileCard";
import PromotionToast from "../../components/player/PromotionToast";
import RecentForm from "../../components/player/RecentForm";
import TrophiesPreview from "../../components/player/TrophiesPreview";
import WalletPanel from "../../components/account/WalletPanel";
import RivalCard from "../../components/social/RivalCard";
import { ViewProfileButton } from "../../components/social/SocialActions";
import { pushNotification } from "../../components/live/NotificationBell";
import { resolvePlayerTier, UNRANKED_MATCHES_THRESHOLD } from "../../lib/player/ranks";
import {
  detectPromotion,
  type PromotionEvent,
} from "../../lib/player/promotion";
import {
  computeGlobalRankFromRows,
  deriveRecentForm,
  deriveStreak,
  type CompetitiveStats,
} from "../../lib/player/stats";
import { disconnectSocket } from "../../lib/socket/client";
import { supabase } from "../../lib/supabase/client";

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

type AccountInfo = {
  id: string;
  email: string;
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

function SettingRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-800/80 px-5 py-4 first:border-t-0">
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <span className="shrink-0 text-xs font-bold uppercase tracking-[0.18em] text-zinc-600">
        Coming soon
      </span>
    </div>
  );
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


export default function AccountPage() {
  const router = useRouter();

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [stats, setStats] = useState<PlayerStatsRow | null>(null);
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading account...");
  const [loggingOut, setLoggingOut] = useState(false);
  const [recentMatches, setRecentMatches] = useState<MatchResultRow[]>([]);
  const [matchHistoryNotice, setMatchHistoryNotice] = useState("");
  const [activeSeason, setActiveSeason] = useState<SeasonRow | null>(null);
  const [seasonCountdown, setSeasonCountdown] = useState<string | null>(null);
  const [tournamentWins, setTournamentWins] = useState<number>(0);
  const [promotionEvent, setPromotionEvent] = useState<PromotionEvent | null>(
    null
  );

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    disconnectSocket();
    router.replace("/");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      setLoading(true);
      setMessage("Loading account...");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/auth/login");
        return;
      }

      const userId = session.user.id;

      const [
        statsResult,
        rankResult,
        matchesResult,
        seasonResult,
        tournamentWinsResult,
      ] = await Promise.all([
          supabase
            .from("player_stats")
            .select(
              "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points"
            )
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
            .from("match_results")
            .select(
              "room_code, match_instance, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, loser_id, is_draw, created_at"
            )
            .or(`player_one_id.eq.${userId},player_two_id.eq.${userId}`)
            .order("created_at", { ascending: false })
            .limit(10),
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
            .from("tournaments")
            .select("id", { count: "exact", head: true })
            .eq("game_id", "penalty444")
            .eq("winner_id", userId),
        ]);

      if (cancelled) return;

      setAccount({
        id: userId,
        email: session.user.email || "Logged-in player",
      });

      if (statsResult.error) {
        setMessage(statsResult.error.message);
        setLoading(false);
        return;
      }

      const currentStats = statsResult.data as PlayerStatsRow | null;
      const rankRows = (rankResult.data ?? []) as RankRow[];

      setStats(currentStats);
      setGlobalRank(
        computeGlobalRankFromRows(
          rankRows,
          userId,
          currentStats?.matches ?? 0
        )
      );
      setRecentMatches((matchesResult.data ?? []) as MatchResultRow[]);
      setTournamentWins(tournamentWinsResult.count ?? 0);
      setMatchHistoryNotice(
        matchesResult.error
          ? "Match history is unavailable right now."
          : ""
      );

      const season = !seasonResult.error
        ? ((seasonResult.data?.[0] as SeasonRow | undefined) ?? null)
        : null;
      setActiveSeason(season);
      setSeasonCountdown(
        season ? formatSeasonCountdown(season.ends_at) : null
      );

      setMessage(
        rankResult.error
          ? `Could not calculate global rank: ${rankResult.error.message}`
          : ""
      );
      setLoading(false);
    }

    loadAccount();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!activeSeason) return;

    const updateCountdown = () => {
      setSeasonCountdown(formatSeasonCountdown(activeSeason.ends_at));
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSeason]);

  const displayName = stats?.username || "Arena Player";
  const displayedMatches = account
    ? recentMatches.map((match) => mapMatchForDisplay(match, account.id))
    : [];

  useEffect(() => {
    if (!account?.id || !stats) return;
    if ((stats.matches ?? 0) < UNRANKED_MATCHES_THRESHOLD) return;
    const tier = resolvePlayerTier({
      rating: stats.rank_points ?? null,
      matchesPlayed: stats.matches ?? null,
    });
    const event = detectPromotion(account.id, tier);
    if (event) {
      setPromotionEvent(event);
      pushNotification({
        kind: "promotion",
        tone: event.to.id === "champion" ? "champion" : "promotion",
        message: `Promoted to ${event.to.label}`,
        context: `From ${event.from.label} · Keep climbing`,
        href: "/account",
      });
    }
  }, [account?.id, stats]);

  const competitiveStats: CompetitiveStats | null = useMemo(() => {
    if (!account) return null;
    const recentForm = deriveRecentForm(recentMatches, account.id, 5);
    return {
      username: stats?.username ?? null,
      rating: stats?.rank_points ?? null,
      matches: stats?.matches ?? 0,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      draws: stats?.draws ?? 0,
      goalsFor: stats?.goals_for ?? 0,
      goalsAgainst: stats?.goals_against ?? 0,
      tournamentWins,
      recentForm,
      streak: deriveStreak(recentForm),
    };
  }, [account, stats, recentMatches, tournamentWins]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24 sm:pb-6">
      <PromotionToast event={promotionEvent} />

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

      {loading ? (
        <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-5 text-zinc-400">
          {message}
        </div>
      ) : null}

      {!loading && message ? (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 p-5 text-red-200">
          {message}
        </div>
      ) : null}

      {!loading ? (
        <>
          <CompetitiveProfileCard
            username={displayName}
            stats={competitiveStats}
            globalRank={globalRank}
          />

          <RecentForm form={competitiveStats?.recentForm ?? []} className="!p-4" />

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
            {matchHistoryNotice ? (
              <p className="border-b border-zinc-800/80 px-4 py-3 text-xs text-zinc-500">
                {matchHistoryNotice}
              </p>
            ) : null}
            {displayedMatches.length > 0 ? (
              <ul>
                {displayedMatches.map((match) => (
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
                      <p className="truncate text-sm font-semibold text-white">
                        vs {match.opponent}
                      </p>
                      <p className="text-[11px] text-zinc-500">{match.dateLabel}</p>
                    </div>
                    <span className="shrink-0 text-sm font-black tabular-nums text-zinc-300">
                      {match.score}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-zinc-500">
                No match history yet.
              </p>
            )}
          </div>

          <AchievementGrid stats={competitiveStats} />

          <TrophiesPreview count={tournamentWins} />

          <div className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-black/45 px-4 py-3">
            <span className="text-sm font-semibold text-zinc-400">Season Rankings</span>
            <span className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Coming soon
            </span>
          </div>

          <WalletPanel userId={account?.id ?? null} />

          {stats?.username ? (
            <section
              className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-cyan-400/30 bg-cyan-500/5 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:px-5"
              aria-label="Public profile share"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200">
                  Public profile
                </p>
                <p className="mt-0.5 truncate text-sm font-bold text-white">
                  /profile/{stats.username}
                </p>
              </div>
              <ViewProfileButton
                username={stats.username}
                size="md"
                variant="primary"
                label="Open public profile"
              />
            </section>
          ) : null}

          <RivalCard viewerUserId={account?.id ?? null} />

          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="border-b border-zinc-800/80 px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-widest text-white">
                Settings
              </h2>
            </div>
            <SettingRow
              title="Account Settings"
              description="Profile details and account preferences."
            />
            <SettingRow
              title="Wallet Settings"
              description="Manage arena wallet options and coin settings."
            />
            <SettingRow
              title="Game Settings"
              description="Penalty444 match and gameplay preferences."
            />
            <SettingRow
              title="Security"
              description="Password, sessions, and account security."
            />
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded-xl border border-zinc-700/80 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
