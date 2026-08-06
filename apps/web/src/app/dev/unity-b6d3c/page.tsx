/**
 * DEV-ONLY — B6D3C protected-preview MOCK proof route.
 *
 * Renders the isolated runtime-proof harness that exercises the ALREADY-MERGED
 * player-facing path (UnityPresentationHost → MatchRenderer3D, the viewer
 * presentation adapter, the PR-1 cohort gate and the compiled Unity Protocol v1
 * consumer) using DETERMINISTIC SYNTHETIC MOCK DATA ONLY.
 *
 * This route is NOT a match surface. It never loads MatchRoomPanel, never opens a
 * Socket.IO connection, never reads a room, opponent, wallet or match result, and
 * carries no gameplay authority whatsoever.
 *
 * Server gates, evaluated in this exact order (never a NEXT_PUBLIC_* gate, never
 * client-only, never query-string driven):
 *
 *   1. `VERCEL_ENV === "production"`            → notFound()   [checked FIRST]
 *   2. `B6D3C_PROOF_ROUTE_ENABLED === "true"`   → otherwise notFound()
 *
 * Production is denied before the enable flag is even read, so setting the flag on
 * Production can never expose the route. This commit configures NO environment
 * variable anywhere: with the flag unset (its state on every environment today)
 * the route is a 404 on every deployment, including every Preview.
 *
 * The page takes NO query parameters and derives NOTHING from the request. Every
 * value the client uses is a compile-time constant.
 *
 * See docs/unity-b6d3c-protected-preview-proof.md.
 */

import { notFound } from "next/navigation";

import UnityB6D3CProofClient from "./UnityB6D3CProofClient";

// Never cache or statically prerender a gated dev-only proof surface.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function UnityB6D3CProofPage() {
  // 1. Production is denied FIRST and unconditionally.
  //    (VERCEL_ENV, not NODE_ENV: Previews also run with NODE_ENV=production.)
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  // 2. Explicit server-side opt-in. Unset today on every environment.
  if (process.env.B6D3C_PROOF_ROUTE_ENABLED !== "true") {
    notFound();
  }

  return <UnityB6D3CProofClient />;
}
