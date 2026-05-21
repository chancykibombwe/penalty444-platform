"use client";

import Link from "next/link";

/**
 * Compact, link-only player chip — reusable across leaderboard rows,
 * activity feeds, watch view player names, and similar places where a
 * username needs to become a clickable identity.
 *
 * Stays presentation-light: no fetch, no rank lookup. Pass `rank` and
 * `presence` if the surrounding context already has them.
 */
type Props = {
  username: string;
  rank?: string;
  /** Optional small status pill rendered to the right of the name. */
  presenceLabel?: string;
  presenceTone?: "cyan" | "amber" | "emerald" | "neutral";
  className?: string;
};

const TONE_PILL = {
  cyan: "border-cyan-400/45 bg-cyan-500/10 text-cyan-100",
  amber: "border-amber-400/45 bg-amber-500/10 text-amber-100",
  emerald: "border-emerald-400/45 bg-emerald-500/10 text-emerald-100",
  neutral: "border-zinc-700 bg-zinc-900/70 text-zinc-200",
} as const;

export default function PlayerCardChip({
  username,
  rank,
  presenceLabel,
  presenceTone = "neutral",
  className,
}: Props) {
  return (
    <Link
      href={`/profile/${encodeURIComponent(username)}`}
      className={`inline-flex max-w-full items-center gap-2 rounded-xl border border-transparent px-2 py-1 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/5 ${className ?? ""}`}
    >
      <span className="truncate font-bold text-white">{username}</span>
      {rank ? (
        <span className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900/70 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-300">
          {rank}
        </span>
      ) : null}
      {presenceLabel ? (
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] ${TONE_PILL[presenceTone]}`}
        >
          {presenceLabel}
        </span>
      ) : null}
    </Link>
  );
}
