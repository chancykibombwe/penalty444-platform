import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Admin email gate (server-only) ──────────────────────────────────────────
// Mirrors /api/admin/data, /api/admin/beta-dashboard, and
// /api/admin/beta-feedback/status. ADMIN_EMAILS is server-only (never
// NEXT_PUBLIC_*).

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Allowed lobby chat statuses — must match the
// lobby_chat_messages_status_valid CHECK in 20260613120000_lobby_chat_v1.sql.
const ALLOWED_STATUSES = ["visible", "flagged", "hidden"] as const;
type ChatStatus = (typeof ALLOWED_STATUSES)[number];

function isAllowedStatus(value: unknown): value is ChatStatus {
  return (
    typeof value === "string" &&
    (ALLOWED_STATUSES as readonly string[]).includes(value)
  );
}

export type UpdateChatStatusResponse = {
  ok: true;
  id: string;
  status: ChatStatus;
};

export async function PATCH(req: NextRequest) {
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

  // 4. Check admin allowlist (server-side only) BEFORE any mutation.
  const adminEmails = getAdminEmails();
  if (
    adminEmails.length === 0 ||
    !adminEmails.includes(user.email.toLowerCase())
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 5. Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const messageId =
    body && typeof body === "object" && "messageId" in body
      ? (body as { messageId?: unknown }).messageId
      : undefined;
  const status =
    body && typeof body === "object" && "status" in body
      ? (body as { status?: unknown }).status
      : undefined;

  if (typeof messageId !== "string" || messageId.trim().length === 0) {
    return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
  }
  if (!isAllowedStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  // 6. Update ONLY lobby_chat_messages.status (service role bypasses RLS safely
  //    on the server). No other column is touched.
  const { data, error } = await admin
    .from("lobby_chat_messages")
    .update({ status })
    .eq("id", messageId)
    .select("id")
    .maybeSingle();

  if (error) {
    // Do not leak the raw service-role error to the client.
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const response: UpdateChatStatusResponse = {
    ok: true,
    id: messageId,
    status,
  };

  return NextResponse.json(response);
}
