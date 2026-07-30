/**
 * B6D3B PR-1 — `GET /unity-arena/player`.
 *
 * Protected minimal Unity entry. Validates the signed HttpOnly capability, then
 * re-resolves the Supabase user by the token's stable `sub` and rechecks CURRENT
 * allowlist membership, so a de-allowlisted member is denied immediately here.
 * Production is hard-denied first. Every failure is one opaque 404.
 *
 * The returned HTML references ONLY protected same-origin `/unity-arena/artifact/…`
 * URLs, exposes no upstream hostname, carries no capability/identity/room/match
 * data, and boots exactly one Unity canvas. It is NOT player-facing activation:
 * no flag is configured by this PR and React remains the player-facing renderer.
 *
 * Same-origin framing is established in `next.config.ts` (exact `/unity-arena/player`
 * rule), never by a route header alone.
 */

import { createAdminClient } from "../../../lib/supabase/admin";
import {
  createPlayerHandler,
  type CohortAdminLike,
} from "../../../lib/unity-cohort/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPlayerHandler({
  createAdmin: () => createAdminClient() as unknown as CohortAdminLike,
});

export const GET = handlers.GET;
