/**
 * Phase 10 — Economy foundation: feature flags & constants.
 *
 * The new economy code path is GATED. Setting `ECONOMY_ENABLED=false`
 * (default) keeps every gameplay handler running through the legacy
 * `wallet/stakes.ts` RPCs. Setting it to `true` will be done in a
 * future sprint AFTER:
 *
 *   - migration `20260522104000_economy_foundation_v1.sql` is applied
 *   - reconciliation cron is in place
 *   - integration tests pass end-to-end
 *   - real-money payment gateway is reviewed by compliance
 *
 * No code in Phase 10 reads this flag from the live match flow — the
 * economy services are exposed but called only from explicit admin /
 * future hooks. Centralising the flag here means flipping it is a
 * single grep.
 */

export const ECONOMY_ENABLED = process.env.ECONOMY_ENABLED === "true";

/** Default currency code for Phase 10. Real currency selection happens later. */
export const DEFAULT_CURRENCY = "P4C";

/** Smallest currency unit ratio (e.g. 100 cents per dollar). */
export const MINOR_UNITS_PER_UNIT = 100;

/** Hard cap on a single ledger movement, in minor units. */
export const MAX_LEDGER_AMOUNT_MINOR = 100_000_000;
