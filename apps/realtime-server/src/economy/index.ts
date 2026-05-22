/**
 * Phase 10 — Economy module barrel.
 *
 * The economy module is intentionally NOT auto-wired into the live match
 * flow. It is exposed here so future sprints can opt in behind the
 * `ECONOMY_ENABLED` flag.
 */

export { ECONOMY_ENABLED, DEFAULT_CURRENCY } from "./config";
export {
  getWallet,
  getOrCreateWallet,
  getWalletBalance,
  createLedgerEntry,
  type LedgerDirection,
  type LedgerEntryInput,
  type LedgerTransactionType,
  type WalletRow,
} from "./wallet";
export {
  lockMatchEscrow,
  releaseMatchEscrow,
  refundMatchEscrow,
  lockTournamentEntryEscrow,
  fetchMatchEscrowsForRoom,
  refundTournamentEntryEscrowByRow,
  markEscrowManualReview,
  type EscrowRow,
  type EscrowStatus,
  type EscrowScope,
} from "./escrow";
export {
  settleMatchEconomy,
  settleTournamentEconomy,
  type SettleMatchInput,
  type SettleMatchResult,
  type SettleTournamentInput,
  type SettleTournamentResult,
} from "./settlement";
export {
  createMatchEscrowKey,
  createTournamentEntryEscrowKey,
  createTournamentPayoutKey,
  createSettlementKey,
  isUniqueViolation,
  type SettlementType,
} from "./idempotency";
export { emitAuditEvent, type AuditEventInput, type AuditSeverity } from "./audit";
export {
  lockMatchEscrowForPlayer,
  refundMatchEscrowForPlayer,
  refundAllMatchEscrows,
  settleMatchEconomyForRoom,
  lockTournamentEntryForPlayer,
  refundTournamentEntryForPlayer,
  settleTournamentEconomyForTournament,
  refundAllTournamentEntryEscrows,
  seedTestWalletBalance,
  getEconomyMode,
  type EconomyMode,
  type EconomyResult,
  type SeedTestWalletInput,
  type TournamentRefundFanoutSummary,
} from "./integration";
export {
  reconcileEconomy,
  reconcileStuckSettlements,
  reconcileOrphanEscrows,
  reconcileTournamentEscrows,
  reconcileWalletConsistency,
  listStuckEscrows,
  listStuckSettlements,
  type ReconciliationSummary,
  type StuckSettlementReport,
  type OrphanEscrowReport,
  type StuckEscrowSnapshot,
  type StuckSettlementSnapshot,
} from "./reconciliation";
export {
  validateEscrowStateTransition,
  isTerminalEscrowStatus,
  isRecoverableEscrowStatus,
  validateSettlementStateTransition,
  isTerminalSettlementStatus,
  isReconcilableSettlementStatus,
  type SettlementStatus,
} from "./state";
