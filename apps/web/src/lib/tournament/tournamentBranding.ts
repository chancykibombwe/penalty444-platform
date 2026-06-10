/**
 * Tournament identity & branding helpers (display-only).
 * Pure functions derived from existing fields — no DB changes.
 */

import { normalizeTournamentStatus } from "../../components/tournament/TournamentListPanel";

export type TournamentTierId =
  | "duel"
  | "knockout"
  | "arena"
  | "major"
  | "elite";

export type TournamentTier = {
  id: TournamentTierId;
  /** Short label shown as a pill (e.g. "Arena Cup"). */
  label: string;
  /** Tiny pill on cards (e.g. "Arena"). */
  shortLabel: string;
  /** Player-cap copy ("8 players"). */
  capacityLabel: string;
  /** Tagline for the detail banner. */
  subtitle: string;
  /** Tailwind classes for the tier pill. */
  pillClass: string;
  /** Tailwind ring color used on the detail event banner. */
  ringClass: string;
  /** Tailwind glow shadow when state is live. */
  glowClass: string;
};

/**
 * Derive a tournament tier purely from the player cap. This is a presentation
 * tier — it never blocks any gameplay or registration logic.
 */
export function getTournamentTier(maxPlayers: number | null | undefined): TournamentTier {
  const cap = typeof maxPlayers === "number" && maxPlayers > 0 ? maxPlayers : 0;

  if (cap >= 32) {
    return {
      id: "elite",
      label: "Elite Major",
      shortLabel: "Elite",
      capacityLabel: `${cap} players`,
      subtitle: "Elite-tier knockout event",
      pillClass:
        "border-fuchsia-400/55 bg-fuchsia-500/15 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,0.22)]",
      ringClass: "ring-fuchsia-500/25",
      glowClass: "shadow-[0_0_42px_rgba(217,70,239,0.18)]",
    };
  }

  if (cap >= 16) {
    return {
      id: "major",
      label: "Major Cup",
      shortLabel: "Major",
      capacityLabel: `${cap} players`,
      subtitle: "Major knockout event",
      pillClass:
        "border-orange-400/55 bg-orange-500/15 text-orange-100 shadow-[0_0_16px_rgba(249,115,22,0.18)]",
      ringClass: "ring-orange-500/25",
      glowClass: "shadow-[0_0_36px_rgba(249,115,22,0.18)]",
    };
  }

  if (cap >= 8) {
    return {
      id: "arena",
      label: "Arena Cup",
      shortLabel: "Arena",
      capacityLabel: `${cap} players`,
      subtitle: "Arena-format knockout",
      pillClass:
        "border-amber-400/55 bg-amber-500/15 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.18)]",
      ringClass: "ring-amber-500/25",
      glowClass: "shadow-[0_0_30px_rgba(251,191,36,0.18)]",
    };
  }

  if (cap >= 4) {
    return {
      id: "knockout",
      label: "Knockout Cup",
      shortLabel: "Knockout",
      capacityLabel: `${cap} players`,
      subtitle: "Quick knockout bracket",
      pillClass:
        "border-cyan-400/50 bg-cyan-500/10 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.16)]",
      ringClass: "ring-cyan-500/25",
      glowClass: "shadow-[0_0_26px_rgba(34,211,238,0.16)]",
    };
  }

  return {
    id: "duel",
    label: "Duel Cup",
    shortLabel: "Duel",
    capacityLabel: cap > 0 ? `${cap} players` : "Head-to-head",
    subtitle: "Head-to-head duel",
    pillClass:
      "border-sky-400/45 bg-sky-500/10 text-sky-100 shadow-[0_0_12px_rgba(14,165,233,0.16)]",
    ringClass: "ring-sky-500/25",
    glowClass: "shadow-[0_0_24px_rgba(14,165,233,0.16)]",
  };
}

export type TournamentStateBadge = {
  label: string;
  /** Tailwind classes for the badge. */
  className: string;
  /** Optional pulse dot (live tournaments only). */
  pulse: boolean;
};

export function getTournamentStateBadge(
  status: string,
  options: { hasChampion?: boolean } = {}
): TournamentStateBadge {
  const normalized = normalizeTournamentStatus(status);
  switch (normalized) {
    case "in_progress":
      return {
        label: "Live Event",
        className:
          "border-cyan-400/55 bg-cyan-500/15 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.22)]",
        pulse: true,
      };
    case "completed":
      return {
        label: options.hasChampion ? "Champion Crowned" : "Completed Event",
        className:
          "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 shadow-[0_0_16px_rgba(234,179,8,0.18)]",
        pulse: false,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className: "border-red-500/45 bg-red-950/40 text-red-200",
        pulse: false,
      };
    case "check_in":
      return {
        label: "Starting soon",
        className: "border-amber-500/45 bg-amber-950/35 text-amber-100",
        pulse: true,
      };
    case "registration":
      return {
        label: "Open for Registration",
        className: "border-emerald-500/45 bg-emerald-950/35 text-emerald-100",
        pulse: false,
      };
    default:
      return {
        label: normalized.replace(/_/g, " ") || "Tournament",
        className: "border-zinc-700 bg-zinc-900/70 text-zinc-200",
        pulse: false,
      };
  }
}

/**
 * Returns a short "event subtitle" used on the detail banner and big cards.
 * Combines tier + format + status hint.
 */
export function getEventSubtitle(options: {
  tier: TournamentTier;
  format: string;
  status: string;
  championName: string | null;
}): string {
  const { tier, format, status, championName } = options;
  const formatPretty = format
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  switch (normalizeTournamentStatus(status)) {
    case "completed":
      return championName
        ? `${tier.label} · ${formatPretty} · Champion: ${championName}`
        : `${tier.label} · ${formatPretty} · Completed`;
    case "in_progress":
      return `${tier.label} · ${formatPretty} · Live now`;
    case "cancelled":
      return `${tier.label} · ${formatPretty} · Cancelled`;
    case "check_in":
      return `${tier.label} · ${formatPretty} · Starting soon`;
    case "registration":
      return `${tier.label} · ${formatPretty} · Registration open`;
    default:
      return `${tier.label} · ${formatPretty}`;
  }
}
