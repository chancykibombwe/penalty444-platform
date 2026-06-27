import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only admin audit-log helper.
 *
 * Inserts one row into public.admin_audit_log using the SERVICE-ROLE client
 * (which bypasses RLS). The table has no client policies, so this must only
 * ever be called from server routes.
 *
 * IMPORTANT: Do NOT import this into a "use client" component — it is meant to
 * run exclusively in Route Handlers / server modules alongside the service-role
 * client.
 */

export type AuditAction = "feedback_status_update" | "chat_status_update";
export type AuditTargetTable = "beta_feedback" | "lobby_chat_messages";

export type RecordAdminAuditLogInput = {
  adminUserId: string;
  action: AuditAction;
  targetTable: AuditTargetTable;
  targetId: string;
  oldStatus: string | null;
  newStatus: string | null;
  /** Small safe context only — never message body, email, or secrets. */
  metadata?: Record<string, unknown>;
};

/**
 * Record an admin action. Returns true on success, false on failure.
 *
 * Never throws — the caller decides how to surface a failed audit write (e.g.
 * `auditLogged: false`). The raw DB error is intentionally not propagated.
 *
 * @param admin a service-role Supabase client (server-only)
 */
export async function recordAdminAuditLog(
  admin: SupabaseClient,
  input: RecordAdminAuditLogInput
): Promise<boolean> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      admin_user_id: input.adminUserId,
      action: input.action,
      target_table: input.targetTable,
      target_id: input.targetId,
      old_status: input.oldStatus,
      new_status: input.newStatus,
      metadata: input.metadata ?? {},
    });

    if (error) {
      // Server-side breadcrumb only — never returned to the client.
      console.error("[admin_audit_log] insert failed:", error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[admin_audit_log] insert threw:", err);
    return false;
  }
}
