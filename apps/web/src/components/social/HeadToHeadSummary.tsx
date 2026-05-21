"use client";

import {
  formatLastPlayed,
  type HeadToHead,
} from "../../lib/social/rivals";

/**
 * Compact head-to-head summary between the viewer and another player.
 *
 * Used on the profile page when viewing someone OTHER than yourself, and
 * embedded inside `RivalCard` for the account-page top-rival treatment.
 * Pure display — never queries data itself.
 */
type Props = {
  head: HeadToHead;
  /** Slim layout used inside RivalCard. Defaults to false (full grid). */
  compact?: boolean;
};

export default function HeadToHeadSummary({ head, compact = false }: Props) {
  const goalDiff = head.goalsFor - head.goalsAgainst;
  const diffLabel =
    goalDiff > 0 ? `+${goalDiff}` : goalDiff < 0 ? `${goalDiff}` : "0";

  return (
    <div
      className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4 sm:gap-3"}`}
    >
      <Tile label="Wins" value={head.wins} tone="emerald" />
      <Tile label="Losses" value={head.losses} tone="rose" />
      <Tile label="Draws" value={head.draws} tone="neutral" />
      <Tile
        label="Goal diff"
        valueText={diffLabel}
        tone={goalDiff > 0 ? "emerald" : goalDiff < 0 ? "rose" : "neutral"}
      />
      {!compact ? (
        <>
          <Tile
            label="Matches"
            value={head.totalMatches}
            tone="cyan"
            wide
          />
          <Tile
            label="Last played"
            valueText={formatLastPlayed(head.lastPlayedAt)}
            tone="neutral"
            wide
          />
        </>
      ) : null}
      {head.recentForm.length > 0 ? (
        <div
          className={`flex items-center gap-1.5 ${compact ? "col-span-4" : "col-span-2 sm:col-span-4"}`}
          aria-label="Recent results in this matchup"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
            Recent
          </span>
          <div className="flex items-center gap-1">
            {head.recentForm.map((r, idx) => (
              <span
                key={idx}
                className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-black ${
                  r === "W"
                    ? "border border-emerald-400/55 bg-emerald-500/15 text-emerald-100"
                    : r === "L"
                      ? "border border-rose-400/55 bg-rose-500/15 text-rose-100"
                      : "border border-zinc-700 bg-zinc-900/70 text-zinc-200"
                }`}
                aria-label={r === "W" ? "Win" : r === "L" ? "Loss" : "Draw"}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  valueText,
  tone,
  wide,
}: {
  label: string;
  value?: number;
  valueText?: string;
  tone: "emerald" | "rose" | "neutral" | "cyan";
  wide?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/40 text-emerald-100"
      : tone === "rose"
        ? "border-rose-400/40 text-rose-100"
        : tone === "cyan"
          ? "border-cyan-400/40 text-cyan-100"
          : "border-zinc-700/80 text-zinc-100";

  return (
    <div
      className={`rounded-2xl border bg-black/35 px-3 py-2 ${toneClass} ${wide ? "col-span-2" : ""}`}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-70">
        {label}
      </p>
      <p className="mt-1 text-lg font-black tabular-nums">
        {valueText ?? value ?? 0}
      </p>
    </div>
  );
}
