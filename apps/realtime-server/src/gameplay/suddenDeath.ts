import { MAX_SUDDEN_DEATH_CYCLES } from "../config";
import type { Room } from "../types/room";

export function shouldEnterSuddenDeath(room: Room) {
  if (room.phase !== "NORMAL") return false;

  const totalNormalTurns = room.maxRounds * 2;

  if (room.round < totalNormalTurns) return false;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return false;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;

  return firstScore === secondScore;
}

export function shouldEndSuddenDeath(room: Room) {
  if (room.phase !== "SUDDEN_DEATH") return false;

  const totalNormalTurns = room.maxRounds * 2;
  const suddenTurnsPlayed = room.round - totalNormalTurns;

  if (suddenTurnsPlayed <= 0) return false;
  if (suddenTurnsPlayed % 2 !== 0) return false;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return false;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;

  if (firstScore !== secondScore) return true;

  if (room.suddenDeathRound >= MAX_SUDDEN_DEATH_CYCLES) return true;

  return false;
}
