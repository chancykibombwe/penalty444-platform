/**
 * Diagnostic logging gate.
 *
 * The realtime server emits a large volume of verbose diagnostics
 * ([diag:transport] / [diag:presence] / [diag:roomstate] /
 * [diag:activeroom] / [diag:disconnect-policy] / [diag:disconnect-grace] /
 * [diag:reveal-deadlock], room-state mismatch traces, end-match clear
 * traces, clearRoomTimer traces, public-offer lifecycle traces). These
 * are invaluable while debugging beta but flood Railway production logs.
 *
 * They are now emitted ONLY when `DIAG_LOGS=true`, so production stays
 * quiet by default while we can flip the flag to restore full verbosity
 * for an investigation.
 *
 * IMPORTANT: security, persistence/Supabase, settlement, progression,
 * economy/wallet, boot-config summary, fatal env validation, and real
 * error logs must NOT use these helpers — they always log directly via
 * `console.*` so they remain visible regardless of `DIAG_LOGS`.
 *
 * The flag is read lazily on each call so it works regardless of module
 * import order relative to dotenv / process env hydration.
 */

export function diagLogsEnabled(): boolean {
  return process.env.DIAG_LOGS === "true";
}

export function diagLog(...args: unknown[]): void {
  if (process.env.DIAG_LOGS === "true") {
    console.log(...args);
  }
}

export function diagWarn(...args: unknown[]): void {
  if (process.env.DIAG_LOGS === "true") {
    console.warn(...args);
  }
}
