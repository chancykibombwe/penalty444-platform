/**
 * Phase 10 — Economy audit event helpers.
 *
 * All ledger / escrow / settlement transitions emit one audit row plus
 * one structured log line. Audit rows are APPEND-ONLY (no UPDATE /
 * DELETE policies grant client access).
 *
 * Log prefixes (kept consistent with Sprint 1 + Sprint 2 conventions):
 *   [Economy]    — high-level event (wallet created, settlement started)
 *   [Escrow]     — escrow lifecycle transitions
 *   [Settlement] — settlement pipeline
 *   [Audit]      — when an audit row is persisted
 *
 * If `supabase` is null (dev env without service role), audit rows are
 * still logged but not persisted; this keeps the realtime server boot
 * working without env vars.
 */

import { supabase } from "../config";

export type AuditSeverity = "info" | "warning" | "error" | "critical";

export type AuditEventInput = {
  eventType: string;
  severity?: AuditSeverity;
  actorId?: string | null;
  actorKind?: "user" | "system" | "admin" | "realtime_server";
  referenceType?: string | null;
  referenceId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Persist an audit row + emit a `[Audit]` log line. Failures to persist
 * are logged but never thrown — audit must never break the calling
 * pipeline.
 */
export async function emitAuditEvent(input: AuditEventInput): Promise<void> {
  const severity = input.severity ?? "info";
  const logLine =
    `[Audit] ${input.eventType} severity=${severity} ` +
    `ref=${input.referenceType ?? "—"}:${input.referenceId ?? "—"} ` +
    `actor=${input.actorKind ?? "realtime_server"}:${input.actorId ?? "—"}`;

  if (severity === "error" || severity === "critical") {
    console.error(logLine);
  } else if (severity === "warning") {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }

  if (!supabase) return;

  try {
    const { error } = await supabase.from("audit_events").insert({
      event_type: input.eventType,
      severity,
      actor_id: input.actorId ?? null,
      actor_kind: input.actorKind ?? "realtime_server",
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      payload: input.payload ?? {},
    });
    if (error) {
      console.error(`[Audit] persist failed event=${input.eventType}:`, error);
    }
  } catch (err) {
    console.error(`[Audit] persist crashed event=${input.eventType}:`, err);
  }
}
