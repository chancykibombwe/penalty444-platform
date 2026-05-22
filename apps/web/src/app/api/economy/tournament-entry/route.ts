/**
 * Phase 11 — Tournament entry escrow proxy.
 *
 * POST /api/economy/tournament-entry
 *   headers: Authorization: Bearer <supabase access token>
 *   body: { action: "lock" | "refund", tournamentId: string }
 *
 * Resolves the calling user from the Bearer token, then dispatches to
 * the realtime server's internal endpoint using the server-side
 * REALTIME_INTERNAL_SECRET. The browser bundle never sees the secret.
 *
 * For free tournaments / economy off, the realtime server short-circuits
 * with `{ ok: true, skipped: true }` and this route just forwards that.
 * The client treats `skipped: true` as "proceed with normal flow".
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  lockTournamentEntryViaRealtime,
  refundTournamentEntryViaRealtime,
} from "../../../../lib/economy/tournamentBridge";

export const dynamic = "force-dynamic";

type RequestBody = {
  action?: "lock" | "refund";
  tournamentId?: string;
};

function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function authenticateUser(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) {
    return { user: null, error: "Server auth is not configured." };
  }
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    return { user: null, error: "Invalid or expired session." };
  }
  return { user: data.user, error: null };
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const action = body.action;
  const tournamentId = body.tournamentId?.trim();
  if (action !== "lock" && action !== "refund") {
    return NextResponse.json(
      { ok: false, error: "invalid_action" },
      { status: 400 }
    );
  }
  if (!tournamentId) {
    return NextResponse.json(
      { ok: false, error: "missing_tournament_id" },
      { status: 400 }
    );
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_bearer_token" },
      { status: 401 }
    );
  }
  const auth = await authenticateUser(token);
  if (!auth.user) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result =
      action === "lock"
        ? await lockTournamentEntryViaRealtime({
            userId: auth.user.id,
            tournamentId,
          })
        : await refundTournamentEntryViaRealtime({
            userId: auth.user.id,
            tournamentId,
          });

    if (result.ok === false) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 }
      );
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "internal_error",
      },
      { status: 500 }
    );
  }
}
