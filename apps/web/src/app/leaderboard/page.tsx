import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type MatchResult = {
  player_one_id: string;
  player_one_username: string;
  player_one_score: number;
  player_two_id: string;
  player_two_username: string;
  player_two_score: number;
  winner_id: string | null;
  loser_id: string | null;
  is_draw: boolean;
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
    .from("match_results")
    .select(
      "player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, loser_id, is_draw"
    );

  const players = new Map<string, LeaderboardPlayer>();

  function ensurePlayer(id: string, username: string) {
    if (!players.has(id)) {
      players.set(id, {
        id,
        username,
        wins: 0,
        losses: 0,
        draws: 0,
        matches: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        winRate: 0,
      });
    }

    return players.get(id)!;
  }

  if (data) {
    for (const match of data as MatchResult[]) {
      const playerOne = ensurePlayer(
        match.player_one_id,
        match.player_one_username
      );

      const playerTwo = ensurePlayer(
        match.player_two_id,
        match.player_two_username
      );

      playerOne.matches += 1;
      playerTwo.matches += 1;

      playerOne.goalsFor += match.player_one_score;
      playerOne.goalsAgainst += match.player_two_score;

      playerTwo.goalsFor += match.player_two_score;
      playerTwo.goalsAgainst += match.player_one_score;

      if (match.is_draw) {
        playerOne.draws += 1;
        playerTwo.draws += 1;
      } else {
        if (match.winner_id === playerOne.id) playerOne.wins += 1;
        if (match.winner_id === playerTwo.id) playerTwo.wins += 1;

        if (match.loser_id === playerOne.id) playerOne.losses += 1;
        if (match.loser_id === playerTwo.id) playerTwo.losses += 1;
      }
    }
  }

  const leaderboard = Array.from(players.values())
    .map((player) => ({
      ...player,
      winRate:
        player.matches > 0
          ? Math.round((player.wins / player.matches) * 100)
          : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
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