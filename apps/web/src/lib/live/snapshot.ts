/**
 * Hardening Sprint 2 — TASK 4: lightweight platform snapshot.
 *
 * Bundles the data the Home page's live ecosystem needs into a single
 * `Promise.all`. Today the Home page fires five independent component
 * effects (PlatformLiveStatus, LiveMatchPreview, FeaturedLiveMatches,
 * PlayerMomentsStrip, GlobalActivityFeed) each polling Supabase. A
 * single call site that wants all four read-only feeds at once can use
 * this helper to avoid duplicating the underlying queries.
 *
 * NOTE: this is opt-in. Existing components still call the individual
 * `fetch*` helpers for backwards compatibility; the snapshot is a new
 * surface for callers that want everything in one shot.
 *
 * A future evolution (documented in `docs/pre-economy-architecture.md`)
 * is a `platform_stats` materialized view updated by a tick cron, which
 * would collapse all five queries into ONE row read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_COUNTS,
  fetchFeaturedLiveMatches,
  fetchPlatformActivity,
  fetchPlatformLiveCounts,
  fetchRecentPlayerMoments,
  type ActivityEvent,
  type FeaturedLiveMatch,
  type PlatformLiveCounts,
  type RecentPlayerMoment,
} from "./activity";

export type PlatformSnapshot = {
  counts: PlatformLiveCounts;
  featured: FeaturedLiveMatch[];
  moments: RecentPlayerMoment[];
  activity: ActivityEvent[];
  /** Snapshot wall-clock at completion (ms). */
  takenAt: number;
};

export type FetchSnapshotOptions = {
  featuredLimit?: number;
  momentsLimit?: number;
  activityLimit?: number;
};

const EMPTY_SNAPSHOT: PlatformSnapshot = {
  counts: { ...EMPTY_COUNTS },
  featured: [],
  moments: [],
  activity: [],
  takenAt: 0,
};

export function emptyPlatformSnapshot(): PlatformSnapshot {
  return { ...EMPTY_SNAPSHOT, takenAt: 0 };
}

/**
 * Fetch all four home feeds in parallel. Failures in any one feed
 * degrade gracefully (that section becomes empty / unchanged) without
 * dragging down the others.
 */
export async function fetchPlatformSnapshot(
  client: SupabaseClient,
  options: FetchSnapshotOptions = {}
): Promise<PlatformSnapshot> {
  const {
    featuredLimit = 4,
    momentsLimit = 6,
    activityLimit = 8,
  } = options;

  const [counts, featured, moments, activity] = await Promise.all([
    fetchPlatformLiveCounts(client).catch(() => ({ ...EMPTY_COUNTS })),
    fetchFeaturedLiveMatches(client, featuredLimit).catch(() => []),
    fetchRecentPlayerMoments(client, momentsLimit).catch(() => []),
    fetchPlatformActivity(client, activityLimit).catch(() => []),
  ]);

  return {
    counts,
    featured,
    moments,
    activity,
    takenAt: Date.now(),
  };
}
