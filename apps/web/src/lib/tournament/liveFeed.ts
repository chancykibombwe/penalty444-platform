import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type {
  TournamentEntryRow,
  TournamentRow,
} from "../../components/tournament/TournamentListPanel";
import {
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
} from "./bracket";
import {
  isTerminalMatchStatus,
  isWalkoverByeMatch,
} from "./matchDisplay";

export type TournamentFeedTone =
  | "neutral"
  | "info"
  | "live"
  | "good"
  | "warn"
  | "victory";

export type TournamentFeedEvent = {
  id: string;
  /** Unix timestamp used for ordering only — falls back to derived order. */
  timestamp: number;
  /** Short headline ("Mike advanced automatically"). */
  title: string;
  /** Optional context line ("Semi-final 2 · Free Pass"). */
  detail?: string;
  tone: TournamentFeedTone;
};

type DeriveFeedOptions = {
  tournament: Pick<
    TournamentRow,
    "id" | "name" | "status" | "created_at" | "starts_at" | "updated_at"
  > | null;
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
  /** Defaults to 12. */
  limit?: number;
};

function entryName(
  entryId: string | null,
  entryById: Map<string, TournamentEntryRow>
): string {
  if (!entryId) return "TBD";
  return entryById.get(entryId)?.username ?? "Player";
}

function getNextStageLabel(
  currentRound: number,
  totalRounds: number
): string | null {
  if (totalRounds <= 0) return null;
  if (currentRound >= totalRounds) return null;
  return getRoundLabel(currentRound + 1, totalRounds);
}

/** "advances to the semifinals" / "advances to the final" / "advances to round 2" */
function advancesToPhrase(
  currentRound: number,
  totalRounds: number
): string {
  const nextLabel = getNextStageLabel(currentRound, totalRounds);
  if (!nextLabel) return "advances";
  if (nextLabel === "Final") return "advances to the final";
  if (nextLabel === "Semifinals") return "advances to the semifinals";
  if (nextLabel === "Quarterfinals") return "advances to the quarterfinals";
  return `advances to ${nextLabel.toLowerCase()}`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function tsFromIso(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Derives a chronological feed of recent tournament events from the current
 * DB rows. UI-only foundation — no realtime channel, no server writes.
 */
export function deriveTournamentFeed(
  options: DeriveFeedOptions
): TournamentFeedEvent[] {
  const { tournament, entries, matches, limit = 12 } = options;
  if (!tournament) return [];

  const entryById = new Map<string, TournamentEntryRow>();
  for (const entry of entries) {
    entryById.set(entry.id, entry);
  }

  const events: TournamentFeedEvent[] = [];

  const createdTs = tsFromIso(tournament.created_at);
  if (createdTs > 0) {
    events.push({
      id: `tournament-created-${tournament.id}`,
      timestamp: createdTs,
      title: "Tournament created",
      detail: tournament.name,
      tone: "neutral",
    });
  }

  for (const entry of entries) {
    if (entry.status === "withdrawn") continue;
    const checkedInTs = tsFromIso(entry.checked_in_at);
    if (entry.status === "checked_in" && checkedInTs > 0) {
      events.push({
        id: `entry-ready-${entry.id}`,
        timestamp: checkedInTs,
        title: `${entry.username} is ready`,
        tone: "good",
      });
    } else {
      events.push({
        id: `entry-joined-${entry.id}`,
        timestamp: checkedInTs || createdTs,
        title: `${entry.username} joined the tournament`,
        tone: "info",
      });
    }
  }

  const roundOneMatchCount = matches.filter(
    (match) => match.round_number === 1
  ).length;
  const totalRounds =
    roundOneMatchCount > 0
      ? (() => {
          try {
            return getTotalRounds(
              getBracketSizeFromRoundOneMatchCount(roundOneMatchCount)
            );
          } catch {
            return 0;
          }
        })()
      : 0;

  if (tournament.status === "in_progress" || matches.length > 0) {
    events.push({
      id: `tournament-started-${tournament.id}`,
      timestamp:
        tsFromIso(tournament.starts_at) ||
        tsFromIso(tournament.updated_at) ||
        createdTs + 1,
      title: "Tournament bracket is live",
      detail: "Matches are being played",
      tone: "live",
    });
  }

  // Stage-change announcements: emit one banner per round (>= round 2) once
  // any match in that round has progressed beyond pending. Derived purely
  // from match.status — no fake data.
  if (totalRounds >= 2) {
    const baseStageTs =
      tsFromIso(tournament.updated_at) ||
      tsFromIso(tournament.starts_at) ||
      createdTs + 1;

    for (let r = 2; r <= totalRounds; r += 1) {
      const stageMatches = matches.filter((m) => m.round_number === r);
      if (stageMatches.length === 0) continue;
      const anyActive = stageMatches.some(
        (m) => m.status !== "pending" && m.status !== "ready"
      );
      const anyLive = stageMatches.some((m) => m.status === "in_progress");
      const anyTerminal = stageMatches.some((m) =>
        isTerminalMatchStatus(m.status)
      );
      if (!anyActive && !anyLive) continue;

      const isFinalStage = r === totalRounds;
      const stageLabel = getRoundLabel(r, totalRounds);
      events.push({
        id: `stage-${r}-${tournament.id}`,
        timestamp: baseStageTs + r,
        title: isFinalStage
          ? "🏆 Championship match begins"
          : `${stageLabel} ${anyLive ? "are live" : "underway"}`,
        detail:
          isFinalStage && anyTerminal
            ? "Final decided"
            : isFinalStage
              ? "Last match of the tournament"
              : `${stageMatches.length} match${stageMatches.length === 1 ? "" : "es"} this round`,
        tone: isFinalStage ? "victory" : anyLive ? "live" : "good",
      });
    }
  }

  for (const match of matches) {
    const roundLabel =
      totalRounds > 0
        ? getRoundLabel(match.round_number, totalRounds)
        : `Round ${match.round_number}`;
    const matchSlotLabel = `${roundLabel} · Match ${match.slot_index + 1}`;
    const isFinal = totalRounds > 0 && match.round_number === totalRounds;

    if (match.status === "in_progress") {
      const p1 = entryName(match.entry_one_id, entryById);
      const p2 = entryName(match.entry_two_id, entryById);
      events.push({
        id: `match-live-${match.id}`,
        timestamp: tsFromIso(tournament.updated_at) || createdTs + 2,
        title: isFinal
          ? `🏆 Championship match is live`
          : `${roundLabel} match is live`,
        detail: `${p1} vs ${p2}`,
        tone: "live",
      });
      continue;
    }

    if (!isTerminalMatchStatus(match.status)) continue;

    if (
      isWalkoverByeMatch(match.entry_one_id, match.entry_two_id, match.status)
    ) {
      if (match.winner_entry_id) {
        const winnerName = entryName(match.winner_entry_id, entryById);
        events.push({
          id: `match-walkover-${match.id}`,
          timestamp: tsFromIso(tournament.updated_at) || createdTs + 3,
          title: `${winnerName} ${advancesToPhrase(
            match.round_number,
            totalRounds
          )} on a free pass`,
          detail: `${matchSlotLabel} · No opponent`,
          tone: "good",
        });
      }
      continue;
    }

    if (match.status === "completed" && match.winner_entry_id) {
      const winnerName = entryName(match.winner_entry_id, entryById);
      const loserEntryId =
        match.entry_one_id === match.winner_entry_id
          ? match.entry_two_id
          : match.entry_one_id;
      const loserName = loserEntryId
        ? entryName(loserEntryId, entryById)
        : null;

      if (isFinal) {
        events.push({
          id: `match-completed-${match.id}`,
          timestamp: tsFromIso(tournament.updated_at) || createdTs + 4,
          title: loserName
            ? `${winnerName} beats ${loserName} to win the tournament`
            : `${winnerName} wins the tournament`,
          detail: "🏆 Champion crowned",
          tone: "victory",
        });
      } else {
        const phrase = advancesToPhrase(match.round_number, totalRounds);
        events.push({
          id: `match-completed-${match.id}`,
          timestamp: tsFromIso(tournament.updated_at) || createdTs + 4,
          title: loserName
            ? `${winnerName} eliminates ${loserName}`
            : `${winnerName} ${phrase}`,
          detail: loserName ? `${roundLabel} · ${capitalize(phrase)}` : roundLabel,
          tone: "good",
        });
      }
      continue;
    }

    if (match.status === "void") {
      events.push({
        id: `match-void-${match.id}`,
        timestamp: tsFromIso(tournament.updated_at) || createdTs + 5,
        title: `${matchSlotLabel} ended with no winner`,
        detail: "Both players absent",
        tone: "warn",
      });
      continue;
    }

    if (match.status === "walkover" && match.winner_entry_id) {
      events.push({
        id: `match-walkover-late-${match.id}`,
        timestamp: tsFromIso(tournament.updated_at) || createdTs + 6,
        title: `${entryName(
          match.winner_entry_id,
          entryById
        )} ${advancesToPhrase(match.round_number, totalRounds)} by walkover`,
        detail: matchSlotLabel,
        tone: "good",
      });
    }
  }

  if (tournament.status === "completed") {
    events.push({
      id: `tournament-completed-${tournament.id}`,
      timestamp: tsFromIso(tournament.updated_at) || createdTs + 7,
      title: "Tournament complete",
      tone: "victory",
    });
  }

  if (tournament.status === "cancelled") {
    events.push({
      id: `tournament-cancelled-${tournament.id}`,
      timestamp: tsFromIso(tournament.updated_at) || createdTs + 8,
      title: "Tournament cancelled",
      tone: "warn",
    });
  }

  return events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export type LiveMatchSummary = {
  matchId: string;
  roundLabel: string;
  matchLabel: string;
  isFinal: boolean;
  entryOneName: string;
  entryTwoName: string;
};

/**
 * Returns the in-progress matches with display-ready labels. Used to power
 * a "LIVE NOW" section without any backend wiring.
 */
export function deriveLiveMatches(options: {
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
  limit?: number;
}): LiveMatchSummary[] {
  const { entries, matches, limit = 6 } = options;

  const entryById = new Map<string, TournamentEntryRow>();
  for (const entry of entries) {
    entryById.set(entry.id, entry);
  }

  const roundOneMatchCount = matches.filter(
    (match) => match.round_number === 1
  ).length;
  const totalRounds =
    roundOneMatchCount > 0
      ? (() => {
          try {
            return getTotalRounds(
              getBracketSizeFromRoundOneMatchCount(roundOneMatchCount)
            );
          } catch {
            return 0;
          }
        })()
      : 0;

  const live: LiveMatchSummary[] = [];

  for (const match of matches) {
    if (match.status !== "in_progress") continue;

    const roundLabel =
      totalRounds > 0
        ? getRoundLabel(match.round_number, totalRounds)
        : `Round ${match.round_number}`;
    const matchLabel = `Match ${match.slot_index + 1}`;
    const isFinal = totalRounds > 0 && match.round_number === totalRounds;

    live.push({
      matchId: match.id,
      roundLabel,
      matchLabel,
      isFinal,
      entryOneName: entryName(match.entry_one_id, entryById),
      entryTwoName: entryName(match.entry_two_id, entryById),
    });
  }

  return live
    .sort((a, b) => {
      // Finals first, then earlier rounds last (highlights last man standing).
      if (a.isFinal !== b.isFinal) return a.isFinal ? -1 : 1;
      return 0;
    })
    .slice(0, limit);
}
