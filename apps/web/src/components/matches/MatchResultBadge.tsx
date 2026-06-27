import type { MatchResult } from "../../lib/matches/matchHistory";

/**
 * Win / Draw / Loss badge. Mirrors the account page's result colors so the
 * Match History reads consistently with the rest of the app.
 */

const RESULT_CLASS: Record<MatchResult, string> = {
  W: "border-emerald-500/70 bg-emerald-950/70 text-emerald-200",
  D: "border-yellow-500/70 bg-yellow-950/70 text-yellow-200",
  L: "border-red-500/70 bg-red-950/70 text-red-200",
};

const RESULT_LABEL: Record<MatchResult, string> = {
  W: "Win",
  D: "Draw",
  L: "Loss",
};

export default function MatchResultBadge({
  result,
  size = "md",
}: {
  result: MatchResult;
  size?: "sm" | "md";
}) {
  const dims = size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border font-black ${dims} ${RESULT_CLASS[result]}`}
      aria-label={RESULT_LABEL[result]}
      title={RESULT_LABEL[result]}
    >
      {result}
    </span>
  );
}
