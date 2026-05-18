/**
 * Pure single-elimination bracket helpers (Tournament v1).
 * No byes: player count must be a power of two.
 */

export type BracketMatchDraft = {
  round_number: number;
  slot_index: number;
  entry_one_id: string | null;
  entry_two_id: string | null;
  status: "pending" | "ready";
};

export function isPowerOfTwo(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0
  );
}

export function getTotalRounds(playerCount: number): number {
  if (!isPowerOfTwo(playerCount)) {
    throw new Error(`Player count must be a power of two. Received ${playerCount}.`);
  }
  return Math.round(Math.log2(playerCount));
}

/** Parent slot in the next round for a given match position. */
export function getParentSlot(roundNumber: number, slotIndex: number) {
  return {
    round_number: roundNumber + 1,
    slot_index: Math.floor(slotIndex / 2),
  };
}

export function getRoundLabel(roundNumber: number, totalRounds: number): string {
  const roundsFromFinal = totalRounds - roundNumber;
  if (roundsFromFinal === 0) return "Final";
  if (roundsFromFinal === 1) return "Semifinals";
  if (roundsFromFinal === 2) return "Quarterfinals";
  return `Round ${roundNumber}`;
}

/**
 * Deterministic single-elimination bracket.
 * Round 1 pairs entryIds[0] vs [1], [2] vs [3], … in order (check-in sort applied by caller).
 * Later rounds are empty placeholders linked via getParentSlot after insert.
 */
export function generateSingleEliminationBracket(
  entryIds: string[]
): BracketMatchDraft[] {
  const playerCount = entryIds.length;

  if (!isPowerOfTwo(playerCount)) {
    throw new Error(
      `Cannot generate bracket: ${playerCount} checked-in players is not a power of two.`
    );
  }

  const totalRounds = getTotalRounds(playerCount);
  const matches: BracketMatchDraft[] = [];

  const roundOneMatchCount = playerCount / 2;
  for (let slotIndex = 0; slotIndex < roundOneMatchCount; slotIndex += 1) {
    matches.push({
      round_number: 1,
      slot_index: slotIndex,
      entry_one_id: entryIds[slotIndex * 2] ?? null,
      entry_two_id: entryIds[slotIndex * 2 + 1] ?? null,
      status: "ready",
    });
  }

  for (let roundNumber = 2; roundNumber <= totalRounds; roundNumber += 1) {
    const matchCount = playerCount / 2 ** roundNumber;
    for (let slotIndex = 0; slotIndex < matchCount; slotIndex += 1) {
      matches.push({
        round_number: roundNumber,
        slot_index: slotIndex,
        entry_one_id: null,
        entry_two_id: null,
        status: "pending",
      });
    }
  }

  return matches;
}

export function bracketSlotKey(roundNumber: number, slotIndex: number): string {
  return `${roundNumber}:${slotIndex}`;
}
