"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

export default function AccountPage() {
  const router = useRouter();

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [stats, setStats] = useState<PlayerStatsRow | null>(null);
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading account...");

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

      const [statsResult, rankResult] = await Promise.all([
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
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/70 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(0,0,0,0.45)]">
                  {getInitials(displayName)}
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-3xl font-black tracking-tight text-white">
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
                    Account ID: {account?.id}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:min-w-[280px]">
                <div className="rounded-2xl border border-yellow-300/20 bg-yellow-950/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-300/70">
                    Points
                  </p>
                  <p className="mt-2 text-4xl font-black tracking-tighter text-yellow-100">
                    {rankPoints}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-700/80 bg-black/35 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Global Rank
                  </p>
                  <p className="mt-2 text-4xl font-black tracking-tighter text-white">
                    {globalRank ? `#${globalRank}` : "-"}
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
              <StatCard label="Tier" value={tier} />
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
        </>
      ) : null}
    </section>
  );
}
