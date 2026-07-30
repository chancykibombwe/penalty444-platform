/**
 * B6D3B PR-1 — `POST /api/unity-cohort/session`.
 *
 * Mints the short-lived, signed, HttpOnly cohort capability cookie after verifying
 * a Supabase bearer token server-side and confirming CURRENT server-only allowlist
 * membership. Production never mints. Every failure returns one opaque 404 — never
 * 401/403. The response carries no token and no identity.
 *
 * The mint is authorized by the bearer token (not an ambient cookie), so it is not
 * CSRF-forgeable; the resulting cookie is used only for same-origin GET reads of
 * the protected `/unity-arena` surface.
 */

import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  createSessionHandler,
  type CohortAdminLike,
} from "../../../../lib/unity-cohort/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createSessionHandler({
  createAdmin: () => createAdminClient() as unknown as CohortAdminLike,
});

export const POST = handlers.POST;
