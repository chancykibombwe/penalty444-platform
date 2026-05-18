/**
 * Pure single-elimination bracket helpers (Tournament v1+).
 *
 * Bracket size is the next power of two >= active players, capped by max_players.
 * Round-1 BYEs use null on the open side of a match (standard tournament seed order).
 * Later rounds use null for unfilled feeders (TBD until a match completes or BYEs propagate).
 */

export type BracketMatchDraft = {
  round_number: number;
  slot_index: number;
  entry_one_id: string | null;
  entry_two_id: string | null;
  status: "pending" | "ready" | "walkover";
  winner_entry_id?: string | null;
};

export type BracketMatchSlotRef = {
  entry_one_id: string | null;
  entry_two_id: string | null;
  status: string;
  winner_entry_id?: string | null;
};

export type GenerateBracketResult = {
  drafts: BracketMatchDraft[];
  bracketSize: number;
  playerCount: number;
};

export function isPowerOfTwo(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0
  );
}

/** Smallest power of two >= n (minimum 2). */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`nextPowerOfTwo requires an integer >= 2. Received ${n}.`);
  }
  if (isPowerOfTwo(n)) return n;
  return 2 ** Math.ceil(Math.log2(n));
}

export function getTotalRounds(bracketSize: number): number {
  if (!isPowerOfTwo(bracketSize)) {
    throw new Error(
      `Bracket size must be a power of two. Received ${bracketSize}.`
    );
  }
  return Math.round(Math.log2(bracketSize));
}

/** Bracket size from round-1 match count (each match is two slots). */
export function getBracketSizeFromRoundOneMatchCount(roundOneMatchCount: number): number {
  if (!Number.isInteger(roundOneMatchCount) || roundOneMatchCount < 1) {
    throw new Error(
      `Round-one match count must be a positive integer. Received ${roundOneMatchCount}.`
    );
  }
  return roundOneMatchCount * 2;
}

/** Standard 1-indexed seed positions for a power-of-two bracket (e.g. 8 → [1,8,4,5,2,7,3,6]). */
export function generateSeedOrder(bracketSize: number): number[] {
  if (!isPowerOfTwo(bracketSize)) {
    throw new Error(
      `generateSeedOrder requires a power-of-two bracket size. Received ${bracketSize}.`
    );
  }
  if (bracketSize === 2) {
    return [1, 2];
  }

  const half = bracketSize / 2;
  const prev = generateSeedOrder(half);
  const order: number[] = [];

  for (const seed of prev) {
    order.push(seed);
    order.push(bracketSize + 1 - seed);
  }

  return order;
}

/** True when this side of a slot is a BYE (null entry, opponent present). */
export function isByeSlot(
  entryOneId: string | null,
  entryTwoId: string | null,
  side: 1 | 2
): boolean {
  const entryId = side === 1 ? entryOneId : entryTwoId;
  const opponentId = side === 1 ? entryTwoId : entryOneId;
  return entryId === null && opponentId !== null;
}

/** True when exactly one side is a BYE (unplayable auto-advance slot). */
export function isByeMatch(entryOneId: string | null, entryTwoId: string | null): boolean {
  const one = entryOneId !== null;
  const two = entryTwoId !== null;
  return one !== two;
}

export function isVoidMatchStatus(status: string): boolean {
  return status === "void";
}

/** True when two real players can open a match room (not BYE, void, walkover, or terminal). */
export function canMatchBePlayed(match: BracketMatchSlotRef): boolean {
  if (isVoidMatchStatus(match.status)) return false;
  if (match.status === "cancelled") return false;
  if (match.status === "completed" || match.status === "walkover") return false;
  if (match.entry_one_id === null || match.entry_two_id === null) return false;
  return true;
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

function resolveRoundOneStatus(
  entryOneId: string | null,
  entryTwoId: string | null
): Pick<BracketMatchDraft, "status" | "winner_entry_id"> {
  const hasOne = entryOneId !== null;
  const hasTwo = entryTwoId !== null;

  if (hasOne && hasTwo) {
    return { status: "ready", winner_entry_id: null };
  }

  if (hasOne && !hasTwo) {
    return { status: "walkover", winner_entry_id: entryOneId };
  }

  if (!hasOne && hasTwo) {
    return { status: "walkover", winner_entry_id: entryTwoId };
  }

  throw new Error("Round-1 match cannot have two BYE sides.");
}

function refreshMatchStatus(match: BracketMatchDraft): void {
  if (match.status === "walkover") {
    return;
  }

  const hasOne = match.entry_one_id !== null;
  const hasTwo = match.entry_two_id !== null;

  if (hasOne && hasTwo) {
    match.status = "ready";
    return;
  }

  match.status = "pending";
  match.winner_entry_id = null;
}

function placeWinnerInParent(
  matchesByKey: Map<string, BracketMatchDraft>,
  child: BracketMatchDraft,
  winnerEntryId: string
): void {
  const parentPos = getParentSlot(child.round_number, child.slot_index);
  const parentKey = bracketSlotKey(parentPos.round_number, parentPos.slot_index);
  const parent = matchesByKey.get(parentKey);

  if (!parent) {
    return;
  }

  const feederSide = child.slot_index % 2 === 0 ? "entry_one_id" : "entry_two_id";
  parent[feederSide] = winnerEntryId;
  refreshMatchStatus(parent);
}

function propagateWalkoverWinners(matchesByKey: Map<string, BracketMatchDraft>): void {
  const drafts = Array.from(matchesByKey.values()).sort((a, b) => {
    if (a.round_number !== b.round_number) {
      return a.round_number - b.round_number;
    }
    return a.slot_index - b.slot_index;
  });

  for (const match of drafts) {
    if (match.status !== "walkover" || !match.winner_entry_id) {
      continue;
    }

    placeWinnerInParent(matchesByKey, match, match.winner_entry_id);
  }
}

/**
 * Builds a padded single-elimination bracket with round-1 BYEs and immediate
 * walkover advancement into parent slots.
 */
export function generateBracketWithByes(
  entryIds: string[],
  maxPlayers: number
): GenerateBracketResult {
  const playerCount = entryIds.length;

  if (playerCount < 2) {
    throw new Error("Need at least 2 players to generate a bracket.");
  }

  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || !isPowerOfTwo(maxPlayers)) {
    throw new Error(
      `maxPlayers must be a power of two >= 2. Received ${maxPlayers}.`
    );
  }

  if (playerCount > maxPlayers) {
    throw new Error(
      `Too many registered players (${playerCount}) for tournament max (${maxPlayers}).`
    );
  }

  const bracketSize = Math.min(nextPowerOfTwo(playerCount), maxPlayers);

  if (bracketSize < playerCount) {
    throw new Error(
      `Bracket size ${bracketSize} cannot fit ${playerCount} registered players.`
    );
  }

  const seedOrder = generateSeedOrder(bracketSize);
  const seededSlots: (string | null)[] = seedOrder.map((seed) =>
    seed <= playerCount ? entryIds[seed - 1] ?? null : null
  );

  const totalRounds = getTotalRounds(bracketSize);
  const matchesByKey = new Map<string, BracketMatchDraft>();

  const roundOneMatchCount = bracketSize / 2;
  for (let slotIndex = 0; slotIndex < roundOneMatchCount; slotIndex += 1) {
    const entryOneId = seededSlots[slotIndex * 2] ?? null;
    const entryTwoId = seededSlots[slotIndex * 2 + 1] ?? null;
    const roundOne = resolveRoundOneStatus(entryOneId, entryTwoId);

    const draft: BracketMatchDraft = {
      round_number: 1,
      slot_index: slotIndex,
      entry_one_id: entryOneId,
      entry_two_id: entryTwoId,
      status: roundOne.status,
      winner_entry_id: roundOne.winner_entry_id ?? null,
    };

    matchesByKey.set(bracketSlotKey(1, slotIndex), draft);
  }

  for (let roundNumber = 2; roundNumber <= totalRounds; roundNumber += 1) {
    const matchCount = bracketSize / 2 ** roundNumber;
    for (let slotIndex = 0; slotIndex < matchCount; slotIndex += 1) {
      const draft: BracketMatchDraft = {
        round_number: roundNumber,
        slot_index: slotIndex,
        entry_one_id: null,
        entry_two_id: null,
        status: "pending",
        winner_entry_id: null,
      };
      matchesByKey.set(bracketSlotKey(roundNumber, slotIndex), draft);
    }
  }

  propagateWalkoverWinners(matchesByKey);

  const drafts = Array.from(matchesByKey.values()).sort((a, b) => {
    if (a.round_number !== b.round_number) {
      return a.round_number - b.round_number;
    }
    return a.slot_index - b.slot_index;
  });

  return { drafts, bracketSize, playerCount };
}

/**
 * Legacy helper: power-of-two field with no padding (all slots filled).
 */
export function generateSingleEliminationBracket(
  entryIds: string[]
): BracketMatchDraft[] {
  if (!isPowerOfTwo(entryIds.length)) {
    throw new Error(
      `Cannot generate bracket: ${entryIds.length} players is not a power of two.`
    );
  }

  return generateBracketWithByes(entryIds, entryIds.length).drafts;
}

export function bracketSlotKey(roundNumber: number, slotIndex: number): string {
  return `${roundNumber}:${slotIndex}`;
}
