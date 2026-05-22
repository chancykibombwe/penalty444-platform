/**
 * Phase 11 — Frontend-visible economy mode.
 *
 * The browser cannot directly know `process.env.ECONOMY_ENABLED` on the
 * server; we expose a single safe flag via `NEXT_PUBLIC_ECONOMY_MODE`
 * which the deploy sets to one of: "off" | "test" | "live".
 *
 * Defaults to "off" so the UI fails closed in any misconfigured env.
 */

export type EconomyMode = "off" | "test" | "live";

export function getPublicEconomyMode(): EconomyMode {
  const raw = process.env.NEXT_PUBLIC_ECONOMY_MODE?.trim().toLowerCase();
  if (raw === "test" || raw === "live") return raw;
  return "off";
}

export function describeEconomyMode(mode: EconomyMode): {
  label: string;
  tone: "neutral" | "test" | "live";
  hint: string;
} {
  switch (mode) {
    case "live":
      return {
        label: "Live · Real Money",
        tone: "live",
        hint: "Production economy is active.",
      };
    case "test":
      return {
        label: "Test Mode",
        tone: "test",
        hint: "Internal test balances only. No real money.",
      };
    default:
      return {
        label: "Free Play",
        tone: "neutral",
        hint: "Real money is disabled. All matches are free.",
      };
  }
}
