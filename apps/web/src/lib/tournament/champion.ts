import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type { TournamentEntryRow } from "../../components/tournament/TournamentListPanel";
import type { TournamentDetailRow } from "./useTournamentDetailSync";

export function resolveChampionName(
  tournament: TournamentDetailRow,
  matches: TournamentMatchRow[],
  entries: TournamentEntryRow[]
): string | null {
  if (tournament.status !== "completed") {
    return null;
  }

  if (tournament.winner_id) {
    const winnerEntry = entries.find(
      (entry) => entry.user_id === tournament.winner_id
    );
    if (winnerEntry?.username) {
      return winnerEntry.username;
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const maxRound = Math.max(...matches.map((match) => match.round_number));
  const finalMatches = matches
    .filter((match) => match.round_number === maxRound)
    .sort((a, b) => a.slot_index - b.slot_index);
  const finalMatch = finalMatches[0];

  if (!finalMatch?.winner_entry_id) {
    return null;
  }

  const championEntry = entries.find(
    (entry) => entry.id === finalMatch.winner_entry_id
  );
  return championEntry?.username ?? null;
}
