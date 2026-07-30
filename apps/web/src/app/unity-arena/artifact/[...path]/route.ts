/**
 * B6D3B PR-1 — `GET`/`HEAD /unity-arena/artifact/[...path]`.
 *
 * Protected artifact delivery. Validates the signed HttpOnly capability, resolves
 * the request against the pinned four-file manifest by EXACT match, and streams the
 * pre-compressed bytes verbatim from the fixed validated origin using raw
 * `node:https`/`node:http` only.
 *
 * Built-in `fetch` is PROHIBITED here: the completed B6D3B protected-preview
 * measurement classified it `FAIL — RANGE` (empty entity body despite a correct
 * `206`), while the raw Node transport passed byte-exactly.
 *
 * Production is hard-denied first. Every gate failure is one opaque 404; an
 * authorized-but-failing upstream returns a sanitized status with no body. The
 * upstream origin, full URL, cookie and token never appear in any response.
 */

import { createArtifactHandler } from "../../../../lib/unity-cohort/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No Supabase client here by design: the artifact route performs no per-file
// identity lookup (17 files per load). Ordinary allowlist removal is bounded by the
// 10-minute capability TTL; secret rotation or a token-version bump revokes at once.
const handlers = createArtifactHandler();

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
