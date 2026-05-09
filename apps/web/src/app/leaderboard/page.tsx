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
  winRate: number;
};

export default async function LeaderboardPage() {
  const { data, error } = await supabase
    .from("player_stats")
    .select(
      "user_id, username, matches, wins, losses, draws, goals_for, goals_against"
    )
    .eq("game_id", "penalty444")
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
      winRate: row.matches > 0 ? Math.round((row.wins / row.matches) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.matches !== a.matches) return b.matches - a.matches;
      return b.goalsFor - a.goalsFor;
    });

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Leaderboard</h1>
        <p className="mt-2 text-zinc-400">
          Live rankings based on saved match results.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 p-5 text-red-200">
          Failed to load leaderboard: {error.message}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <table className="w-full text-left">
          <thead className="bg-zinc-950">
            <tr className="text-sm text-zinc-400">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
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
                  colSpan={9}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  No completed matches yet.
                </td>
              </tr>
            ) : (
              leaderboard.map((player, index) => (
                <tr key={player.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3 text-white">{index + 1}</td>

                  <td className="px-4 py-3 font-semibold text-white">
                    {player.username}
                  </td>

                  <td className="px-4 py-3 text-white">{player.wins}</td>
                  <td className="px-4 py-3 text-white">{player.losses}</td>
                  <td className="px-4 py-3 text-white">{player.draws}</td>
                  <td className="px-4 py-3 text-white">{player.matches}</td>
                  <td className="px-4 py-3 text-white">{player.goalsFor}</td>
                  <td className="px-4 py-3 text-white">
                    {player.goalsAgainst}
                  </td>
                  <td className="px-4 py-3 text-white">{player.winRate}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}