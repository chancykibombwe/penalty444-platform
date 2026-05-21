/**
 * Phase 6 — Promotion detection.
 *
 * Lightweight client-side tracker: remembers the last competitive tier we
 * showed the player. When their current tier moves up the ladder, the UI
 * can show a "PROMOTED TO X" toast. Demotions are tracked silently so we
 * don't fire a promotion when the player drops back to their old tier.
 *
 * Storage: `localStorage` per-player, scoped by playerId so multi-account
 * setups stay isolated. No server writes.
 */

import {
  getTierById,
  RANKED_TIER_ORDER,
  type RankTier,
  type RankTierId,
} from "./ranks";

const STORAGE_KEY_PREFIX = "p444.lastSeenTier:";

function storageKey(playerId: string): string {
  return `${STORAGE_KEY_PREFIX}${playerId.trim()}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Returns the last competitive tier id we displayed for this player, or
 * `null` if we've never recorded one (first visit / placement player).
 */
export function getLastSeenTier(playerId: string | null | undefined): RankTierId | null {
  if (!isBrowser() || !playerId) return null;
  try {
    const value = window.localStorage.getItem(storageKey(playerId));
    if (!value) return null;
    if (!isKnownTier(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Persist the player's currently-displayed tier so the next visit can detect
 * promotions. Safe to call repeatedly; idempotent.
 */
export function setLastSeenTier(
  playerId: string | null | undefined,
  tierId: RankTierId
): void {
  if (!isBrowser() || !playerId) return;
  try {
    window.localStorage.setItem(storageKey(playerId), tierId);
  } catch {
    // Quota / disabled storage — toast feature degrades gracefully.
  }
}

export function clearLastSeenTier(playerId: string | null | undefined): void {
  if (!isBrowser() || !playerId) return;
  try {
    window.localStorage.removeItem(storageKey(playerId));
  } catch {
    /* ignore */
  }
}

export type PromotionEvent = {
  from: RankTier;
  to: RankTier;
};

/**
 * Compare the player's currently-resolved tier against the last-seen tier
 * and return a promotion event when they've moved UP the ladder.
 *
 * Returns `null` when:
 *   - no previous tier was recorded (first visit — silently record it)
 *   - the tier is the same as last seen
 *   - the tier moved DOWN (demotion — silently update the record)
 *   - the player is in placement (no tier to compare against)
 *
 * Demotions intentionally do not emit toasts; we still update the storage
 * so a subsequent promotion back to the higher tier doesn't double-fire.
 */
export function detectPromotion(
  playerId: string | null | undefined,
  currentTier: RankTier | null
): PromotionEvent | null {
  if (!playerId || !currentTier) return null;
  if (currentTier.id === "unranked") return null;

  const last = getLastSeenTier(playerId);

  if (!last) {
    setLastSeenTier(playerId, currentTier.id);
    return null;
  }

  if (last === currentTier.id) return null;

  const lastIdx = RANKED_TIER_ORDER.indexOf(last);
  const nextIdx = RANKED_TIER_ORDER.indexOf(currentTier.id);

  // Update storage first so we never fire the same promotion twice.
  setLastSeenTier(playerId, currentTier.id);

  if (lastIdx < 0 || nextIdx < 0 || nextIdx <= lastIdx) {
    return null;
  }

  return {
    from: getTierById(last),
    to: currentTier,
  };
}

function isKnownTier(value: string): value is RankTierId {
  return (
    value === "bronze" ||
    value === "silver" ||
    value === "gold" ||
    value === "platinum" ||
    value === "diamond" ||
    value === "elite" ||
    value === "champion" ||
    value === "unranked"
  );
}
