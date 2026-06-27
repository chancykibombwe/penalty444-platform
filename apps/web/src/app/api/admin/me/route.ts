import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Admin email gate (server-only) ──────────────────────────────────────────
// Mirrors the other /api/admin/* routes. ADMIN_EMAILS is a server-only env var
// and is NEVER returned to the client — only a boolean isAdmin.

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export type AdminMeResponse = {
  ok: true;
  isAdmin: boolean;
};

// Lightweight admin-identity check used purely to decide whether to render the
// convenience Admin nav link. The actual admin pages remain protected by their
// own server routes — this endpoint is not a security boundary on its own.
export async function GET(req: NextRequest) {
  // 1. Extract Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 2. Build admin client (service role — server-only, never sent to client)
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error: "admin_client_unavailable",
        detail: "SUPABASE_SERVICE_ROLE_KEY not configured",
      },
      { status: 503 }
    );
  }

  // 3. Verify token — getUser validates the JWT cryptographically
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !user || !user.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 4. Check admin allowlist (server-side only). We return only a boolean —
  //    the email list itself never crosses the network.
  const adminEmails = getAdminEmails();
  const isAdmin =
    adminEmails.length > 0 && adminEmails.includes(user.email.toLowerCase());

  const response: AdminMeResponse = { ok: true, isAdmin };
  return NextResponse.json(response);
}
