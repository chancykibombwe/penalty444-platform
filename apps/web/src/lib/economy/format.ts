/**
 * Phase 10 — Economy formatting helpers (display-only).
 *
 * Never used for authority. The frontend formats numbers the
 * service-role layer authoritatively writes; it never computes a
 * balance from primitives the user can influence.
 */

export const MINOR_UNITS_PER_UNIT = 100;

export function formatMinorAmount(
  minor: number | null | undefined,
  currency = "P4C"
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return `0 ${currency}`;
  }
  const major = minor / MINOR_UNITS_PER_UNIT;
  const formatted = major.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

export function formatBalanceSplit(
  minor: number | null | undefined
): { major: string; cents: string } {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return { major: "0", cents: "00" };
  }
  const abs = Math.abs(minor);
  const sign = minor < 0 ? "-" : "";
  const majorPart = Math.floor(abs / MINOR_UNITS_PER_UNIT);
  const centsPart = abs % MINOR_UNITS_PER_UNIT;
  return {
    major: `${sign}${majorPart.toLocaleString()}`,
    cents: centsPart.toString().padStart(2, "0"),
  };
}
