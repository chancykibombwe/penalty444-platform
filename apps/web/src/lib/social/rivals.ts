/**
 * Phase 9 — Rival derivation.
 *
 * Pure read-only logic over `match_results`. Identifies the player's
 * biggest rival by aggregate match volume, then surfaces a richer
 * head-to-head summary (wins / losses / draws / last played / momentum).
 *
 * The goal is *attachment*, not data accuracy at all costs — so rivals
 * use simple, transparent thresholds:
 *   - Minimum 3 matches together to qualify
 *   - "Top rival" = most matches together; ties broken by recency
 *   - "Rivalry label" derived from balance + recent momentum
 *
 * Never writes. No new tables. No fake opponents.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type HeadToHead = {
  opponentUserId: string;
  opponentUsername: string;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Most recent match date in this matchup (ISO). */
  lastPlayedAt: string | null;
  /** Last 5 results in the matchup, newest first. */
  recentForm: Array<"W" | "L" | "D">;
};

export type RivalSummary = HeadToHead & {
  /** Short, vibey rivalry label suitable for chips and headlines. */
  label: RivalLabel;
  /** Slightly longer one-liner used as the card subline. */
  flavor: string;
};

export type RivalLabel =
  | "Heating up"
  | "You lead this matchup"
  | "They have your number"
  | "Even rivalry"
  | "Run it back"
  | "New rivalry";

const MIN_MATCHES_FOR_RIVAL = 3;
const RIVAL_FETCH_LIMIT = 60;
const RECENT_FORM_LIMIT = 5;

type MatchResultRow = {
  player_one_id: string | null;
  player_one_username: string | null;
  player_one_score: number | null;
  player_two_id: string | null;
  player_two_username: string | null;
  player_two_score: number | null;
  winner_id: string | null;
  is_draw: boolean | null;
  created_at: string | null;
};

/**
 * Top rival for a given user — null if there isn't enough history.
 */
export async function fetchTopRival(
  client: SupabaseClient,
  userId: string
): Promise<RivalSummary | null> {
  const head = await fetchAllHeadToHeads(client, userId);
  if (head.length === 0) return null;

  // Sort by total matches desc, then by recency desc. Anything below the
  // threshold gets dropped — we never invent a rivalry from 1 or 2 games.
  const qualifying = head.filter(
    (h) => h.totalMatches >= MIN_MATCHES_FOR_RIVAL
  );
  if (qualifying.length === 0) return null;

  qualifying.sort((a, b) => {
    if (b.totalMatches !== a.totalMatches) {
      return b.totalMatches - a.totalMatches;
    }
    const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
    const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
    return bTime - aTime;
  });

  return summarizeRival(qualifying[0]);
}

/**
 * Head-to-head between two specific players. Use this on a profile page
 * where the viewer wants to see the matchup against the profile owner.
 *
 * Returns `null` only on DB error. When zero matches have been played,
 * returns a zeroed summary so the consumer can still render a "new
 * rivalry" prompt.
 */
export async function fetchHeadToHead(
  client: SupabaseClient,
  viewerUserId: string,
  opponentUserId: string,
  opponentUsername: string
): Promise<HeadToHead | null> {
  if (viewerUserId === opponentUserId) return null;
  const head = await fetchAllHeadToHeads(client, viewerUserId);
  return (
    head.find((row) => row.opponentUserId === opponentUserId) ?? {
      opponentUserId,
      opponentUsername,
      totalMatches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      lastPlayedAt: null,
      recentForm: [],
    }
  );
}

/**
 * Aggregate ALL recorded head-to-heads for a single player. Used by the
 * top-rival picker and the profile head-to-head lookup.
 *
 * Reads the most recent `RIVAL_FETCH_LIMIT` matches involving this user
 * — a deliberate ceiling so very heavy histories don't generate massive
 * queries. The threshold-based rivalry surfacing means the most active
 * recent opponent always wins, which is what players actually care about.
 */
async function fetchAllHeadToHeads(
  client: SupabaseClient,
  userId: string
): Promise<HeadToHead[]> {
  try {
    const result = await client
      .from("match_results")
      .select(
        "player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, is_draw, created_at"
      )
      .or(`player_one_id.eq.${userId},player_two_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(RIVAL_FETCH_LIMIT);

    const rows = (result.data ?? []) as MatchResultRow[];
    const byOpponent = new Map<string, HeadToHead>();

    for (const row of rows) {
      if (!row.created_at) continue;
      const isP1 = row.player_one_id === userId;
      const opponentId = isP1 ? row.player_two_id : row.player_one_id;
      const opponentName =
        (isP1 ? row.player_two_username : row.player_one_username) ?? "Opponent";
      if (!opponentId) continue;

      const scoreFor = (isP1 ? row.player_one_score : row.player_two_score) ?? 0;
      const scoreAgainst =
        (isP1 ? row.player_two_score : row.player_one_score) ?? 0;

      const draw = row.is_draw === true;
      const won = !draw && row.winner_id === userId;
      const lost = !draw && row.winner_id !== userId && row.winner_id !== null;

      let entry = byOpponent.get(opponentId);
      if (!entry) {
        entry = {
          opponentUserId: opponentId,
          opponentUsername: opponentName.trim() || "Opponent",
          totalMatches: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          lastPlayedAt: null,
          recentForm: [],
        };
        byOpponent.set(opponentId, entry);
      }

      entry.totalMatches += 1;
      entry.goalsFor += scoreFor;
      entry.goalsAgainst += scoreAgainst;
      if (won) entry.wins += 1;
      else if (lost) entry.losses += 1;
      else if (draw) entry.draws += 1;

      // First row is newest because we ordered DESC.
      if (!entry.lastPlayedAt) {
        entry.lastPlayedAt = row.created_at;
      }
      if (entry.recentForm.length < RECENT_FORM_LIMIT) {
        entry.recentForm.push(won ? "W" : lost ? "L" : "D");
      }
    }

    return Array.from(byOpponent.values());
  } catch {
    return [];
  }
}

/**
 * Build the human-readable rivalry label + flavor copy.
 *
 * Heuristic order (first match wins):
 *   1. New rivalry          → < 3 total matches (caller usually filters first)
 *   2. Heating up           → last 3 results contain at least 2 swings (W↔L)
 *   3. They have your number → loss diff ≥ 3
 *   4. You lead this matchup → win diff ≥ 3
 *   5. Even rivalry         → balanced within 1
 *   6. Run it back          → last played > 7 days ago
 */
function summarizeRival(h: HeadToHead): RivalSummary {
  if (h.totalMatches < MIN_MATCHES_FOR_RIVAL) {
    return {
      ...h,
      label: "New rivalry",
      flavor: `Only ${h.totalMatches} match${h.totalMatches === 1 ? "" : "es"} played — keep going.`,
    };
  }

  const swings = countSwings(h.recentForm.slice(0, 3));
  if (swings >= 2) {
    return {
      ...h,
      label: "Heating up",
      flavor: `Things are tight between you and ${h.opponentUsername}. ${h.wins}W–${h.losses}L–${h.draws}D.`,
    };
  }

  const diff = h.wins - h.losses;
  if (diff <= -3) {
    return {
      ...h,
      label: "They have your number",
      flavor: `${h.opponentUsername} leads ${h.losses}–${h.wins}. Time to flip it.`,
    };
  }
  if (diff >= 3) {
    return {
      ...h,
      label: "You lead this matchup",
      flavor: `You lead ${h.wins}–${h.losses}. Defend the lead.`,
    };
  }
  if (Math.abs(diff) <= 1) {
    return {
      ...h,
      label: "Even rivalry",
      flavor: `Dead even at ${h.wins}–${h.losses}. Next one decides bragging rights.`,
    };
  }

  const daysSince = daysSinceIso(h.lastPlayedAt);
  if (daysSince !== null && daysSince > 7) {
    return {
      ...h,
      label: "Run it back",
      flavor: `Haven't faced ${h.opponentUsername} in ${daysSince} days. Time for a rematch.`,
    };
  }

  return {
    ...h,
    label: "Heating up",
    flavor: `${h.wins}W–${h.losses}L vs ${h.opponentUsername}.`,
  };
}

function countSwings(form: Array<"W" | "L" | "D">): number {
  let swings = 0;
  for (let i = 1; i < form.length; i += 1) {
    if (form[i] !== form[i - 1] && form[i] !== "D" && form[i - 1] !== "D") {
      swings += 1;
    }
  }
  return swings;
}

function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** Pretty "last played" relative label used by the rival card. */
export function formatLastPlayed(iso: string | null): string {
  if (!iso) return "Never";
  const days = daysSinceIso(iso);
  if (days === null) return "Recently";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
