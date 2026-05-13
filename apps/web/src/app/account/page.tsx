"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  tier: string;
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
  rankPointChange: string;
  dateLabel: string;
};

function getTierBadgeClass(tier: string) {
  switch (tier.toLowerCase()) {
    case "bronze":
      return "border-amber-500/80 bg-amber-950/90 text-amber-100 shadow-[0_0_22px_rgba(180,83,9,0.22)] ring-1 ring-amber-300/10";
    case "silver":
      return "border-slate-300/70 bg-slate-950/90 text-slate-100 shadow-[0_0_22px_rgba(148,163,184,0.18)] ring-1 ring-white/10";
    case "gold":
      return "border-yellow-300/80 bg-yellow-950/90 text-yellow-100 shadow-[0_0_24px_rgba(234,179,8,0.24)] ring-1 ring-yellow-200/15";
    case "diamond":
      return "border-cyan-300/80 bg-cyan-950/90 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.22)] ring-1 ring-cyan-100/15";
    case "legend":
      return "border-fuchsia-300/80 bg-fuchsia-950/90 text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,0.26)] ring-1 ring-fuchsia-100/15";
    default:
      return "border-zinc-600 bg-zinc-900 text-zinc-300 shadow-[0_0_18px_rgba(24,24,27,0.45)] ring-1 ring-white/5";
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
    rankPointChange:
      result === "W" ? "+3 RP" : result === "D" ? "+1 RP" : "-1 RP",
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

      const [statsResult, rankResult, matchesResult] = await Promise.all([
        supabase
          .from("player_stats")
          .select(
            "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier"
          )
          .eq("game_id", "penalty444")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("player_stats")
          .select("user_id, rank_points, wins, matches, goals_for")
          .eq("game_id", "penalty444")
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
      const rankIndex = rankRows.findIndex((row) => row.user_id === userId);

      setStats(currentStats);
      setGlobalRank(rankIndex >= 0 ? rankIndex + 1 : null);
      setRecentMatches((matchesResult.data ?? []) as MatchResultRow[]);
      setMatchHistoryNotice(
        matchesResult.error
          ? "Match history is unavailable right now."
          : ""
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

  const displayName = stats?.username || account?.email || "Player";
  const tier = stats?.tier || "Unranked";
  const rankPoints = stats?.rank_points ?? 0;
  const winRate = stats?.matches
    ? Math.round((stats.wins / stats.matches) * 100)
    : 0;
  const displayedMatches = account
    ? recentMatches.map((match) => mapMatchForDisplay(match, account.id))
    : [];

  return (
    <section className="space-y-8 rounded-[2rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.10),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:p-7 lg:p-9">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.34em] text-yellow-300/70">
          Player Profile
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">
          444 ARENA Account
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-500 sm:text-base">
          Your Penalty444 ranked profile and lifetime arena stats.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-6 text-zinc-300">
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
                      className={`inline-flex rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide ${getTierBadgeClass(
                        tier
                      )}`}
                    >
                      {tier}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    Penalty444 ranked account
                    {account?.email ? ` · ${account.email}` : ""}
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

          {stats ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Matches" value={stats.matches} />
              <StatCard label="Wins" value={stats.wins} />
              <StatCard label="Losses" value={stats.losses} />
              <StatCard label="Draws" value={stats.draws} />
              <StatCard label="Win Rate" value={`${winRate}%`} />
              <StatCard label="Goals For" value={stats.goals_for} />
              <StatCard label="Goals Against" value={stats.goals_against} />
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800/80 bg-black/45 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
              <h2 className="text-2xl font-black text-white">
                No ranked matches yet
              </h2>
              <p className="mt-2 max-w-2xl text-zinc-500">
                Play a completed Penalty444 ranked match to create your arena
                stats row and appear on the leaderboard.
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-black/45 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
            <div className="border-b border-zinc-800/80 px-5 py-4">
              <h2 className="text-lg font-black text-white">Recent Matches</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Your latest Penalty444 arena results.
              </p>
            </div>
            {matchHistoryNotice ? (
              <p className="border-b border-zinc-800/80 px-5 py-3 text-sm text-zinc-500">
                {matchHistoryNotice}
              </p>
            ) : null}
            {displayedMatches.length > 0 ? (
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
                      <span className="font-semibold text-white">
                        {match.score}
                      </span>
                      <span className="font-bold text-yellow-200">
                        {match.rankPointChange}
                      </span>
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

          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-black/45 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
            <div className="border-b border-zinc-800/80 px-5 py-4">
              <h2 className="text-lg font-black text-white">Settings</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Account controls and preferences will appear here.
              </p>
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

          <div className="pt-2">
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="w-full rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white hover:border-zinc-500 disabled:opacity-50 sm:w-auto"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
