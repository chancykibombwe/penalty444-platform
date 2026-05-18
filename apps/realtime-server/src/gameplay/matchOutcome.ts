import type { Room, RoomPlayer } from "../types/room";

export type ResolvedMatchOutcome = {
  firstPlayer: RoomPlayer;
  secondPlayer: RoomPlayer;
  firstScore: number;
  secondScore: number;
  isDraw: boolean;
  winner: RoomPlayer | null;
  loser: RoomPlayer | null;
};

/** Same winner/score rules as saveMatchResult (gameplay, forfeit, disconnect forfeit). */
export function resolveMatchOutcome(room: Room): ResolvedMatchOutcome | null {
  if (room.players.length < 2) return null;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return null;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;
  const isDraw = firstScore === secondScore;

  const winner = isDraw
    ? null
    : firstScore > secondScore
      ? firstPlayer
      : secondPlayer;

  const loser = isDraw
    ? null
    : firstScore > secondScore
      ? secondPlayer
      : firstPlayer;

  return {
    firstPlayer,
    secondPlayer,
    firstScore,
    secondScore,
    isDraw,
    winner,
    loser,
  };
}
