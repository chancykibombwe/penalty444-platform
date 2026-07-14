/**
 * DEV-ONLY — B6C staging verification route.
 *
 * Loads a hosted, immutable B6B WebGL release through the SAME-ORIGIN staging
 * rewrite (/unity/penalty444/staging/... → the configured Vercel artifact
 * origin) and drives it with deterministic MOCK presentation events. This is
 * presentation testing only — it never loads live match state.
 *
 * Server gates (all required; never a NEXT_PUBLIC_* gate, never client-only):
 *   - UNITY_STAGING_ROUTE_ENABLED=true       (explicit opt-in)
 *   - UNITY_STAGING_ARTIFACT_ORIGIN configured (so the rewrite exists)
 *   - a `version` query param that matches the B6B version contract
 * Any failure returns notFound().
 *
 * The page constructs ONLY same-origin relative URLs from the validated version.
 * It never accepts an origin or a complete URL from the query string, so the
 * client can only ever fetch/iframe the same-origin rewritten path.
 *
 * See docs/unity-b6c-versioned-staging-delivery.md.
 */

import { notFound } from "next/navigation";
import UnityStagingClient from "./UnityStagingClient";

// Same contract as B6B: character-set plus an explicit ".." rejection.
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isValidVersion(value: string): boolean {
  return VERSION_RE.test(value) && !value.includes("..");
}

export default async function UnityStagingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // B6C is staging only — never reachable on a Vercel production deployment.
  // (VERCEL_ENV, not NODE_ENV: Vercel previews also run with NODE_ENV=production.)
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  const routeEnabled = process.env.UNITY_STAGING_ROUTE_ENABLED === "true";
  const originConfigured =
    (process.env.UNITY_STAGING_ARTIFACT_ORIGIN ?? "").trim() !== "";

  if (!routeEnabled || !originConfigured) {
    notFound();
  }

  const params = await searchParams;
  const versionParam = params.version;

  // Reject arrays (?version=a&version=b) and anything invalid/absent.
  if (typeof versionParam !== "string" || !isValidVersion(versionParam)) {
    notFound();
  }
  const version = versionParam;

  // Only same-origin relative paths cross into the client. No origin/URL from
  // the query is ever used to build these.
  const base = `/unity/penalty444/staging/releases/${version}`;

  return (
    <UnityStagingClient
      version={version}
      indexUrl={`${base}/index.html`}
      manifestUrl={`${base}/manifest.json`}
    />
  );
}
