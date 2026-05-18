import type { TournamentEntryRow } from "../../components/tournament/TournamentListPanel";
import { isByeMatch, isByeSlot, isVoidMatchStatus } from "./bracket";

export function formatMatchStatus(status: string): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "in_progress":
      return "Live";
    case "pending":
      return "Pending";
    case "completed":
      return "Completed";
    case "walkover":
      return "Walkover";
    case "void":
      return "No winner";
    case "cancelled":
      return "Cancelled";
    default:
      return status.replace(/_/g, " ");
  }
}

export function bracketSectionClass(prominent: boolean, hasMatches: boolean) {
  if (prominent && hasMatches) {
    return "space-y-10 rounded-2xl border border-amber-500/25 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-black p-8 shadow-xl ring-1 ring-amber-500/15";
  }
  if (prominent) {
    return "rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6";
  }
  return "space-y-8 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6";
}

export function entryLabel(
  entryId: string | null,
  entryById: Map<string, TournamentEntryRow>
): string {
  if (!entryId) return "TBD";
  const entry = entryById.get(entryId);
  return entry?.username ?? "Unknown";
}

/**
 * Side label for bracket display: player name, BYE (null vs opponent), or TBD.
 */
export function matchEntrySideLabel(
  entryOneId: string | null,
  entryTwoId: string | null,
  entryById: Map<string, TournamentEntryRow>,
  side: 1 | 2
): string {
  const entryId = side === 1 ? entryOneId : entryTwoId;
  if (entryId) {
    return entryLabel(entryId, entryById);
  }
  if (isByeSlot(entryOneId, entryTwoId, side)) {
    return "BYE";
  }
  return "TBD";
}

export function getMatchCardClasses(
  status: string,
  options: { isParticipant: boolean; isFinal: boolean }
): string {
  const classes = [
    "rounded-xl border px-4 py-3 transition-shadow",
  ];

  if (options.isFinal) {
    classes.push(
      "bg-gradient-to-br from-amber-950/35 via-zinc-950/90 to-zinc-950 md:min-w-[300px]"
    );
  }

  switch (status) {
    case "ready":
      classes.push(
        "border-amber-500/55 bg-amber-950/25 shadow-[0_0_20px_rgba(245,158,11,0.22)] ring-1 ring-amber-500/35"
      );
      break;
    case "in_progress":
      classes.push(
        "border-cyan-500/55 bg-cyan-950/25 shadow-[0_0_20px_rgba(34,211,238,0.22)] ring-1 ring-cyan-500/35"
      );
      break;
    case "completed":
    case "walkover":
      classes.push("border-emerald-500/20 bg-emerald-950/10");
      break;
    case "void":
      classes.push("border-zinc-600/50 bg-zinc-900/60");
      break;
    case "cancelled":
      classes.push("border-red-500/35 bg-red-950/20");
      break;
    default:
      classes.push("border-zinc-700/80 bg-zinc-950/50");
      break;
  }

  if (options.isFinal && (status === "completed" || status === "walkover")) {
    classes.push("border-emerald-500/35 shadow-[0_0_24px_rgba(16,185,129,0.12)]");
  } else if (options.isFinal) {
    classes.push("border-amber-400/40 shadow-md");
  }

  if (options.isParticipant) {
    classes.push(
      "ring-2 ring-amber-400/75 shadow-lg shadow-amber-500/20"
    );
  }

  return classes.join(" ");
}

export function isTerminalMatchStatus(status: string) {
  return (
    status === "completed" ||
    status === "walkover" ||
    status === "void" ||
    status === "cancelled"
  );
}

export function isVoidMatch(status: string): boolean {
  return isVoidMatchStatus(status);
}

/** Walkover caused by a round-1 BYE (one null side). */
export function isWalkoverByeMatch(
  entryOneId: string | null,
  entryTwoId: string | null,
  status: string
): boolean {
  return status === "walkover" && isByeMatch(entryOneId, entryTwoId);
}
