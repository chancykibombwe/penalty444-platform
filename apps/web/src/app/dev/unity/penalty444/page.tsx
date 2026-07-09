/**
 * DEV-ONLY — Unity WebGL viewer (loads the local, git-ignored WebGL build).
 *
 * Production guard: returns 404 unless UNITY_PROTOTYPE_ROUTE_ENABLED=true is
 * set on the server — the same server-side gate used by /dev/unity-prototype.
 * Never use a NEXT_PUBLIC_* variable for this gate, and never rely on
 * client-side hiding alone.
 *
 * This page loads /unity/penalty444/index.html in an iframe for MANUAL local
 * viewing of an already-built WebGL output. It is intentionally passive:
 *   - No live match state, no match mount.
 *   - No postMessage wiring (React never sends to / receives from Unity here).
 *   - No Socket.IO, no Supabase, no auth tokens, no wallet/economy.
 *   - No gameplay authority.
 *
 * The WebGL output at apps/web/public/unity/penalty444/ is git-ignored and is
 * NOT committed, so this page must still compile/build when the output is
 * absent (e.g. on Vercel). Missing-output handling lives in the client half.
 */

import { notFound } from "next/navigation";
import WebGLViewerClient from "./WebGLViewerClient";

export default function UnityWebGLViewerPage() {
  const isProduction = process.env.VERCEL_ENV === "production";
  const explicitlyEnabled = process.env.UNITY_PROTOTYPE_ROUTE_ENABLED === "true";

  if (isProduction && !explicitlyEnabled) {
    notFound();
  }

  return <WebGLViewerClient />;
}
