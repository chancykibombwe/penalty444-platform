import { createClient } from "@supabase/supabase-js";

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
  goals_against: number;
  rank_points: number;
  tier: string;
};

type LeaderboardPlayer = {
  id: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  rankPoints: number;
  tier: string;
  winRate: number;
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

function getPodiumClass(index: number) {
  switch (index) {
    case 0:
      return "md:order-2 md:-mt-8 md:scale-[1.08] border-yellow-300/70 bg-[linear-gradient(180deg,_rgba(113,63,18,0.55),_rgba(9,9,11,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_36px_90px_rgba(234,179,8,0.22)] ring-1 ring-yellow-200/15";
    case 1:
      return "md:order-1 md:mt-12 border-slate-300/60 bg-[linear-gradient(180deg,_rgba(51,65,85,0.48),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(148,163,184,0.12)] ring-1 ring-white/10";
    case 2:
      return "md:order-3 md:mt-12 border-amber-600/70 bg-[linear-gradient(180deg,_rgba(120,53,15,0.44),_rgba(9,9,11,0.95))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_28px_70px_rgba(180,83,9,0.16)] ring-1 ring-amber-200/10";
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

export default async function LeaderboardPage() {
  const { data, error } = await supabase
    .from("player_stats")
    .select(
      "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier"
    )
    .eq("game_id", "penalty444")
    .order("rank_points", { ascending: false })
    .order("wins", { ascending: false })
    .order("matches", { ascending: false })
    .order("goals_for", { ascending: false });

  const leaderboard = ((data ?? []) as PlayerStatsRow[])
    .map((row): LeaderboardPlayer => ({
      id: row.user_id,
      username: row.username,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      matches: row.matches,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      rankPoints: row.rank_points,
      tier: row.tier,
      winRate: row.matches > 0 ? Math.round((row.wins / row.matches) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.matches !== a.matches) return b.matches - a.matches;
      return b.goalsFor - a.goalsFor;
    });

  const topPlayers = leaderboard.slice(0, 3);

  return (
    <section className="space-y-10 rounded-[2rem] border border-zinc-800/80 bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.10),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_#050505,_#09090b_42%,_#020202)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)] sm:p-7 lg:p-9">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.34em] text-yellow-300/70">
            Competitive Arena
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">
            444 ARENA Rankings
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-500 sm:text-base">
            Live rankings based on saved match results.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="rounded-xl border border-zinc-700/80 bg-black/45 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/30">
            Penalty444
          </div>
          <div className="rounded-xl border border-zinc-700/80 bg-black/45 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/30">
            All Time
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 p-5 text-red-200">
          Failed to load leaderboard: {error.message}
        </div>
      ) : null}

      {topPlayers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3 md:items-start">
          {topPlayers.map((player, index) => (
            <div
              key={player.id}
              className={`min-h-[310px] rounded-[1.75rem] border p-7 md:min-h-[340px] md:p-8 ${getPodiumClass(
                index
              )}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-4xl font-black tracking-tight text-white">
                  #{index + 1}
                </div>
                <span
                  className={`inline-flex rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide ${getTierBadgeClass(
                    player.tier
                  )}`}
                >
                  {player.tier}
                </span>
              </div>

              <div className="mt-7 flex flex-col items-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/70 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(0,0,0,0.45)] md:h-24 md:w-24 md:text-3xl">
                  {getInitials(player.username)}
                </div>
                <div className="mt-5 max-w-full truncate text-2xl font-black tracking-tight text-white">
                  {player.username}
                </div>
                <div className="mt-4 text-6xl font-black tracking-tighter text-white">
                  {player.rankPoints}
                </div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  ranked points
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-xs font-semibold text-zinc-400 shadow-inner">
                <span>
                  {player.wins}W / {player.losses}L / {player.draws}D
                </span>
                <span className="font-semibold text-white">
                  {player.winRate}%
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-zinc-800/80 bg-black/45 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <table className="w-full min-w-[1050px] text-left">
          <thead className="bg-black/55">
            <tr className="text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Points</th>
              <th className="px-4 py-3">Wins</th>
              <th className="px-4 py-3">Losses</th>
              <th className="px-4 py-3">Draws</th>
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Goals For</th>
              <th className="px-4 py-3">Goals Against</th>
              <th className="px-4 py-3">Win Rate</th>
            </tr>
          </thead>

          <tbody>
            {leaderboard.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  No completed matches yet.
                </td>
              </tr>
            ) : (
              leaderboard.map((player, index) => (
                <tr
                  key={player.id}
                  className="border-t border-zinc-800 hover:bg-zinc-800/40"
                >
                  <td className="px-4 py-4 text-lg font-black text-zinc-50">
                    #{index + 1}
                  </td>

                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-black/60 text-xs font-black text-white shadow-inner">
                        {getInitials(player.username)}
                      </div>
                      <span className="font-bold text-white">
                        {player.username}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide ${getTierBadgeClass(
                        player.tier
                      )}`}
                    >
                      {player.tier}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-lg font-black text-yellow-100">
                    {player.rankPoints}
                  </td>
                  <td className="px-4 py-4 text-white">{player.wins}</td>
                  <td className="px-4 py-4 text-white">{player.losses}</td>
                  <td className="px-4 py-4 text-white">{player.draws}</td>
                  <td className="px-4 py-4 text-white">{player.matches}</td>
                  <td className="px-4 py-4 text-white">{player.goalsFor}</td>
                  <td className="px-4 py-4 text-white">
                    {player.goalsAgainst}
                  </td>
                  <td className="px-4 py-4 text-white">{player.winRate}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}