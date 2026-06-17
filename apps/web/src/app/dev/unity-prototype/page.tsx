/**
 * DEV-ONLY — Unity / 3D prototype sandbox.
 *
 * Production guard: returns 404 unless UNITY_PROTOTYPE_ROUTE_ENABLED=true
 * is set on the server. Never use a NEXT_PUBLIC_* variable for this gate.
 *
 * Constraints (see docs/unity-3d-prototype-plan.md §11):
 *   - No Supabase reads or writes.
 *   - No Socket.IO connections.
 *   - No auth tokens read or displayed.
 *   - No match result logic.
 */

import { notFound } from "next/navigation";
import UnityPrototypeClient from "./UnityPrototypeClient";

export default function UnityPrototypePage() {
  const isProduction = process.env.VERCEL_ENV === "production";
  const explicitlyEnabled = process.env.UNITY_PROTOTYPE_ROUTE_ENABLED === "true";

  if (isProduction && !explicitlyEnabled) {
    notFound();
  }

  return <UnityPrototypeClient />;
}
