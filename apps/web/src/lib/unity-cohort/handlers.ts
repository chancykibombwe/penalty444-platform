/**
 * B6D3B PR-1 — protected cohort route handlers (server-only).
 *
 * Composes the cohort gates for all four final routes so each `route.ts` exports
 * only route-segment fields and every dependency (env, Supabase admin client,
 * clock, streaming transport) is injectable for deterministic tests.
 *
 * Gate order is IDENTICAL and PRODUCTION IS ALWAYS FIRST: a production deployment
 * never performs a Supabase lookup, never resolves the artifact origin, never signs
 * a token, and never opens an upstream request.
 *
 * Every failure of every gate collapses into ONE byte-identical opaque 404. This
 * feature never returns 401/403, so its existence is never confirmed.
 *
 * Two-layer enforcement (see the authorization package §11.1):
 *   - mint  — verifies the Supabase bearer AND current allowlist membership;
 *   - entry — verifies the signed cookie AND re-resolves the user AND rechecks the
 *             current allowlist (one lookup per page open);
 *   - artifact — verifies the signed cookie only (no per-file Supabase lookup), so
 *             ordinary allowlist removal is bounded by the 10-minute TTL, while
 *             secret rotation or a token-version bump revokes instantly.
 */

import {
  buildCohortCookie,
  COHORT_COOKIE_NAME,
  MAX_CAPABILITY_TTL_SECONDS,
  readCookieValue,
  signCapability,
  verifyCapability,
  type CapabilityPayload,
} from "./capability";
import {
  extractBearerToken,
  isEmailInCohort,
  isProductionDenied,
  opaqueNotFound,
  parseCohortEmails,
  readCohortEnv,
  resolveSigningSecret,
  resolveTokenVersion,
  sanitizedUpstreamFailure,
  validateArtifactOrigin,
  type CohortEnv,
} from "./cohortAccess";
import {
  ARTIFACT_RECORDS,
  ARTIFACT_RELEASE_ID,
  resolveArtifactRecord,
} from "./artifactManifest";
import {
  streamArtifact as defaultStreamArtifact,
  type ArtifactDiagnostics,
  type ArtifactProxyOutcome,
  type ArtifactProxyRequest,
} from "./rawArtifactProxy";

/** Minimal shape of the Supabase admin client actually used here. */
export interface CohortAdminLike {
  readonly auth: {
    getUser(token: string): Promise<{
      data: { user: { id?: string | null; email?: string | null } | null };
      error: unknown;
    }>;
    readonly admin: {
      getUserById(id: string): Promise<{
        data: { user: { id?: string | null; email?: string | null } | null };
        error: unknown;
      }>;
    };
  };
}

export interface CohortHandlerDeps {
  readonly readEnv?: () => CohortEnv;
  /** Must THROW when the service-role key is unavailable (matches createAdminClient). */
  readonly createAdmin?: () => CohortAdminLike;
  readonly nowSeconds?: () => number;
  readonly streamArtifactImpl?: (
    req: ArtifactProxyRequest,
  ) => Promise<ArtifactProxyOutcome>;
  readonly onDiagnostics?: (d: ArtifactDiagnostics) => void;
}

/** Capability TTL actually issued (never above the hard ceiling). */
export const COHORT_SESSION_TTL_SECONDS = MAX_CAPABILITY_TTL_SECONDS;

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Aggregate-only diagnostics logger. Never records identity, origin or bytes. */
function defaultDiagnostics(d: ArtifactDiagnostics): void {
  console.info(
    JSON.stringify({
      scope: "unity-cohort-artifact",
      transport: d.transport,
      label: d.label,
      upstreamStatus: d.upstreamStatus,
      firstChunkMs: d.firstChunkMs,
      totalDurationMs: d.totalDurationMs,
      chunkCount: d.chunkCount,
      totalBytes: d.totalBytes,
      rangeUsed: d.rangeUsed,
      reason: d.reason,
    }),
  );
}

interface ResolvedDeps {
  readEnv: () => CohortEnv;
  createAdmin: (() => CohortAdminLike) | null;
  nowSeconds: () => number;
  streamArtifactImpl: (req: ArtifactProxyRequest) => Promise<ArtifactProxyOutcome>;
  onDiagnostics: (d: ArtifactDiagnostics) => void;
}

function resolveDeps(deps: CohortHandlerDeps): ResolvedDeps {
  return {
    readEnv: deps.readEnv ?? readCohortEnv,
    createAdmin: deps.createAdmin ?? null,
    nowSeconds: deps.nowSeconds ?? defaultNowSeconds,
    streamArtifactImpl: deps.streamArtifactImpl ?? ((r) => defaultStreamArtifact(r)),
    onDiagnostics: deps.onDiagnostics ?? defaultDiagnostics,
  };
}

/** Build the admin client, or null when unavailable (never throws outward). */
function tryCreateAdmin(factory: (() => CohortAdminLike) | null): CohortAdminLike | null {
  if (factory === null) return null;
  try {
    return factory();
  } catch {
    return null; // e.g. SUPABASE_SERVICE_ROLE_KEY absent ⇒ deny
  }
}

/**
 * Verify a Supabase bearer and return the lower-cased email when the user is a
 * CURRENT allowlist member. Returns null on any failure. Never reveals which step
 * failed and never returns identity beyond what the caller needs.
 */
async function authorizeBearer(
  req: Request,
  env: CohortEnv,
  admin: CohortAdminLike | null,
): Promise<{ userId: string; email: string } | null> {
  if (admin === null) return null;
  const token = extractBearerToken(req.headers.get("authorization"));
  if (token === null) return null;
  let userId: string | null = null;
  let email: string | null = null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) return null;
    userId = typeof data.user.id === "string" && data.user.id.length > 0 ? data.user.id : null;
    email = typeof data.user.email === "string" && data.user.email.length > 0 ? data.user.email : null;
  } catch {
    return null;
  }
  if (userId === null || email === null) return null;
  if (!isEmailInCohort(email, parseCohortEmails(env.UNITY_COHORT_EMAILS))) return null;
  return { userId, email: email.toLowerCase() };
}

/** Validate the request's capability cookie. Returns the payload or null. */
function authorizeCookie(req: Request, env: CohortEnv, nowSeconds: number): CapabilityPayload | null {
  const secret = resolveSigningSecret(env);
  if (secret === null) return null; // fail closed
  const ver = resolveTokenVersion(env);
  if (ver === null) return null; // fail closed
  const raw = readCookieValue(req.headers.get("cookie"), COHORT_COOKIE_NAME);
  if (raw === null) return null;
  return verifyCapability(raw, { secret, ver, nowSeconds });
}

// ── Status route (convenience only — NEVER a security boundary) ───────────────

/**
 * `GET /api/unity-cohort/status` → `{ inCohort: boolean }`. Production always
 * returns false. Any missing bearer / invalid bearer / unavailable admin client /
 * missing configuration / non-membership also returns false. Never returns an
 * email, user id, allowlist, reason or configuration detail.
 *
 * The player and artifact routes MUST NOT trust this boolean.
 */
export function createStatusHandler(deps: CohortHandlerDeps = {}) {
  const d = resolveDeps(deps);
  return {
    GET: async (req: Request): Promise<Response> => {
      const respond = (inCohort: boolean) =>
        new Response(JSON.stringify({ inCohort }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      try {
        const env = d.readEnv();
        if (isProductionDenied(env)) return respond(false);
        const authorized = await authorizeBearer(req, env, tryCreateAdmin(d.createAdmin));
        return respond(authorized !== null);
      } catch {
        return respond(false);
      }
    },
  };
}

// ── Session mint route ────────────────────────────────────────────────────────

/**
 * `POST /api/unity-cohort/session` — mints the short-lived HttpOnly capability.
 *
 * Order: production → bearer → admin client → `getUser` → id+email → CURRENT
 * allowlist → config (secret + token version) → sign → cookie. A removed user
 * cannot mint. The response carries NO token and NO identity.
 */
export function createSessionHandler(deps: CohortHandlerDeps = {}) {
  const d = resolveDeps(deps);
  return {
    POST: async (req: Request): Promise<Response> => {
      try {
        const env = d.readEnv();
        // 1. Production is denied FIRST — before any dependency is touched.
        if (isProductionDenied(env)) return opaqueNotFound();

        // 2–6. Bearer + admin verification + current allowlist membership.
        const authorized = await authorizeBearer(req, env, tryCreateAdmin(d.createAdmin));
        if (authorized === null) return opaqueNotFound();

        // 7. Configuration must be complete and strong, else fail closed.
        const secret = resolveSigningSecret(env);
        if (secret === null) return opaqueNotFound();
        const ver = resolveTokenVersion(env);
        if (ver === null) return opaqueNotFound();

        const nowSeconds = d.nowSeconds();
        const signed = signCapability({
          sub: authorized.userId,
          nowSeconds,
          ttlSeconds: COHORT_SESSION_TTL_SECONDS,
          ver,
          secret,
        });
        if (signed === null) return opaqueNotFound();

        // 8. Set the HttpOnly cookie. 9. Minimal body — no token, no identity.
        const cookie = buildCohortCookie(signed.token, signed.payload, nowSeconds);
        if (cookie === null) return opaqueNotFound();

        return new Response(null, {
          status: 204,
          headers: {
            "Set-Cookie": cookie,
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return opaqueNotFound();
      }
    },
  };
}

// ── Player entry route ────────────────────────────────────────────────────────

/** The four protected, same-origin artifact URLs referenced by the entry HTML. */
export const PROTECTED_ARTIFACT_URLS: ReadonlyArray<string> = Object.freeze(
  ARTIFACT_RECORDS.map((r) => `/unity-arena/artifact/${r.path}`),
);

function artifactUrlFor(label: string): string {
  const record = ARTIFACT_RECORDS.find((r) => r.label === label);
  if (record === undefined) throw new Error("unreachable: pinned label missing");
  return `/unity-arena/artifact/${record.path}`;
}

/**
 * Minimal trusted entry HTML. It references ONLY protected same-origin artifact
 * URLs, boots exactly one Unity canvas, and deliberately does not proxy or depend
 * on the upstream `index.html` or any `TemplateData/**` asset.
 *
 * It contains no capability, token, user id, email, room code, match id, upstream
 * hostname, or query-string authorization, and creates no gameplay state.
 */
export function buildPlayerEntryHtml(): string {
  const loader = artifactUrlFor("loader");
  const data = artifactUrlFor("data");
  const framework = artifactUrlFor("framework");
  const wasm = artifactUrlFor("wasm");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Penalty444 Arena</title>
<style>
html,body{margin:0;padding:0;background:#000;overflow:hidden;height:100%}
#unity-canvas{display:block;width:100%;height:100%;background:#000;outline:none}
</style>
</head>
<body>
<canvas id="unity-canvas" tabindex="-1"></canvas>
<script src="${loader}"></script>
<script>
(function(){
  var canvas = document.getElementById("unity-canvas");
  if (!canvas || typeof createUnityInstance !== "function") return;
  createUnityInstance(canvas, {
    dataUrl: "${data}",
    frameworkUrl: "${framework}",
    codeUrl: "${wasm}",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "Penalty444",
    productName: "Penalty444 Arena",
    productVersion: "${ARTIFACT_RELEASE_ID}"
  }).catch(function(){ /* presentation-only: never surface upstream detail */ });
})();
</script>
</body>
</html>
`;
}

/**
 * `GET /unity-arena/player` — protected minimal entry.
 *
 * Order: production → cookie signature/expiry/version → re-resolve the Supabase
 * user by `sub` → recheck the CURRENT allowlist → HTML. A revoked (de-allowlisted)
 * member receives 404 immediately at this route.
 *
 * Framing (`X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`) is established
 * in `next.config.ts`, NOT here, because a route header cannot reliably override the
 * global `DENY`.
 */
export function createPlayerHandler(deps: CohortHandlerDeps = {}) {
  const d = resolveDeps(deps);
  return {
    GET: async (req: Request): Promise<Response> => {
      try {
        const env = d.readEnv();
        if (isProductionDenied(env)) return opaqueNotFound();

        const payload = authorizeCookie(req, env, d.nowSeconds());
        if (payload === null) return opaqueNotFound();

        // Allowlist recheck: re-resolve the user by the token's stable `sub`.
        const admin = tryCreateAdmin(d.createAdmin);
        if (admin === null) return opaqueNotFound();
        let email: string | null = null;
        try {
          const { data, error } = await admin.auth.admin.getUserById(payload.sub);
          if (error || !data || !data.user) return opaqueNotFound();
          email = typeof data.user.email === "string" ? data.user.email : null;
        } catch {
          return opaqueNotFound();
        }
        if (!isEmailInCohort(email, parseCohortEmails(env.UNITY_COHORT_EMAILS))) {
          return opaqueNotFound();
        }

        return new Response(buildPlayerEntryHtml(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            Vary: "Cookie",
          },
        });
      } catch {
        return opaqueNotFound();
      }
    },
  };
}

// ── Artifact route ────────────────────────────────────────────────────────────

export interface ArtifactRouteContext {
  readonly params: Promise<{ path?: string[] }>;
}

/**
 * `GET`/`HEAD /unity-arena/artifact/[...path]` — protected raw streaming.
 *
 * Order: production → cookie signature/expiry/version → exact manifest path
 * resolution → validated fixed origin → raw stream. No Supabase lookup per
 * artifact (17 files per load); ordinary revocation is bounded by the TTL, while
 * secret rotation / token-version bump denies immediately.
 */
export function createArtifactHandler(deps: CohortHandlerDeps = {}) {
  const d = resolveDeps(deps);

  async function handle(
    req: Request,
    ctx: ArtifactRouteContext,
    method: "GET" | "HEAD",
  ): Promise<Response> {
    try {
      const env = d.readEnv();
      if (isProductionDenied(env)) return opaqueNotFound();

      const payload = authorizeCookie(req, env, d.nowSeconds());
      if (payload === null) return opaqueNotFound();

      const { path } = await ctx.params;
      const record = resolveArtifactRecord(path ?? []);
      if (record === null) return opaqueNotFound();

      const origin = validateArtifactOrigin(env.UNITY_COHORT_ARTIFACT_ORIGIN);
      if (origin === null) return opaqueNotFound();

      const outcome = await d.streamArtifactImpl({
        origin,
        record,
        method,
        range: req.headers.get("range"),
        signal: req.signal,
        onDiagnostics: d.onDiagnostics,
      });

      if (outcome.kind === "error") {
        // Authorized request, upstream problem → sanitized status, never a body.
        return sanitizedUpstreamFailure(outcome.status);
      }
      return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
    } catch {
      return opaqueNotFound();
    }
  }

  return {
    GET: (req: Request, ctx: ArtifactRouteContext) => handle(req, ctx, "GET"),
    HEAD: (req: Request, ctx: ArtifactRouteContext) => handle(req, ctx, "HEAD"),
  };
}
