/**
 * B6D3B PR-1 — `GET /api/unity-cohort/status`.
 *
 * Convenience only: returns `{ inCohort: boolean }` so a client can decide whether
 * to offer the protected entry. This is NEVER a security boundary — the player and
 * artifact routes independently enforce their own gates and must not trust this
 * boolean. Production always returns `false`. No identity or configuration detail
 * is ever returned.
 */

import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  createStatusHandler,
  type CohortAdminLike,
} from "../../../../lib/unity-cohort/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createStatusHandler({
  createAdmin: () => createAdminClient() as unknown as CohortAdminLike,
});

export const GET = handlers.GET;
