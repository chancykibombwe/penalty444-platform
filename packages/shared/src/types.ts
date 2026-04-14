export type Lane = "LEFT" | "CENTER" | "RIGHT";

export interface PlayerChoice {
  playerId: string;
  lane: Lane;
}

export interface RoundResult {
  kicker: string;
  keeper: string;
  kickerChoice: Lane;
  keeperChoice: Lane;
  result: "GOAL" | "SAVE";
}

export interface MatchResult {
  winnerId: string;
  loserId: string;
  score: string;
  rounds: RoundResult[];
}