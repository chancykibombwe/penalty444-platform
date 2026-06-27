import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { recordAdminAuditLog } from "../../../../../lib/admin/auditLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Admin email gate (server-only) ──────────────────────────────────────────
// Mirrors /api/admin/data and /api/admin/beta-dashboard. ADMIN_EMAILS is a
// server-only env var — never NEXT_PUBLIC_*.

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Allowed feedback statuses — must match the beta_feedback_status_valid CHECK
// in 20260612120000_beta_feedback_v1.sql.
const ALLOWED_STATUSES = ["open", "triaged", "resolved", "wont_fix"] as const;
type FeedbackStatus = (typeof ALLOWED_STATUSES)[number];

function isAllowedStatus(value: unknown): value is FeedbackStatus {
  return (
    typeof value === "string" &&
    (ALLOWED_STATUSES as readonly string[]).includes(value)
  );
}

export type UpdateFeedbackStatusResponse = {
  ok: true;
  id: string;
  status: FeedbackStatus;
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

  const feedbackId =
    body && typeof body === "object" && "feedbackId" in body
      ? (body as { feedbackId?: unknown }).feedbackId
      : undefined;
  const status =
    body && typeof body === "object" && "status" in body
      ? (body as { status?: unknown }).status
      : undefined;

  if (typeof feedbackId !== "string" || feedbackId.trim().length === 0) {
    return NextResponse.json({ error: "invalid_feedback_id" }, { status: 400 });
  }
  if (!isAllowedStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  // 6. Fetch the current row (status + safe context) to record the old status
  //    and short-circuit no-op updates.
  const { data: current, error: fetchError } = await admin
    .from("beta_feedback")
    .select("id, status, category, route, room_code")
    .eq("id", feedbackId)
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
    const noop: UpdateFeedbackStatusResponse = {
      ok: true,
      id: feedbackId,
      status,
      auditLogged: false,
    };
    return NextResponse.json(noop);
  }

  // 7. Update ONLY beta_feedback.status (service role bypasses RLS safely on
  //    the server). No other column is touched.
  const { data, error } = await admin
    .from("beta_feedback")
    .update({ status })
    .eq("id", feedbackId)
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
  //    only — no message body, email, or secrets. A failed audit write does
  //    not fail the status update; it is surfaced via auditLogged.
  const auditLogged = await recordAdminAuditLog(admin, {
    adminUserId: user.id,
    action: "feedback_status_update",
    targetTable: "beta_feedback",
    targetId: feedbackId,
    oldStatus,
    newStatus: status,
    metadata: {
      category: current.category ?? null,
      route: current.route ?? null,
      roomCode: current.room_code ?? null,
    },
  });

  const response: UpdateFeedbackStatusResponse = {
    ok: true,
    id: feedbackId,
    status,
    auditLogged,
  };

  return NextResponse.json(response);
}
