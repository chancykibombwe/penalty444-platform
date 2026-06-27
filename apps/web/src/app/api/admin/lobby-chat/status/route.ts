import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { recordAdminAuditLog } from "../../../../../lib/admin/auditLog";

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
  auditLogged: boolean;
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

  // 6. Fetch the current row (status + safe context) to record the old status
  //    and short-circuit no-op updates. Message body is intentionally NOT read
  //    or stored in the audit log.
  const { data: current, error: fetchError } = await admin
    .from("lobby_chat_messages")
    .select("id, status, room")
    .eq("id", messageId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const oldStatus = current.status as string;

  // No-op: requested status equals current — succeed without a duplicate
  // audit-log entry or write.
  if (oldStatus === status) {
    const noop: UpdateChatStatusResponse = {
      ok: true,
      id: messageId,
      status,
      auditLogged: false,
    };
    return NextResponse.json(noop);
  }

  // 7. Update ONLY lobby_chat_messages.status (service role bypasses RLS safely
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

  // 8. Record the audit-log entry (server-side, service role). Safe metadata
  //    only — room name, never the message body / username / secrets. A failed
  //    audit write does not fail the status update.
  const auditLogged = await recordAdminAuditLog(admin, {
    adminUserId: user.id,
    action: "chat_status_update",
    targetTable: "lobby_chat_messages",
    targetId: messageId,
    oldStatus,
    newStatus: status,
    metadata: {
      room: current.room ?? null,
    },
  });

  const response: UpdateChatStatusResponse = {
    ok: true,
    id: messageId,
    status,
    auditLogged,
  };

  return NextResponse.json(response);
}
