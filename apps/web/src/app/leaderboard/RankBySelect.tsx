"use client";

import { useRouter } from "next/navigation";
import type { RankBy } from "./constants";

const LABELS: Record<RankBy, string> = {
  rating: "Rating",
  win_rate: "Win Rate",
};

type Props = {
  value: RankBy;
  ratingHref: string;
  winRateHref: string;
};

export default function RankBySelect({ value, ratingHref, winRateHref }: Props) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(e.target.value === "win_rate" ? winRateHref : ratingHref);
  }

  const label = LABELS[value];

  return (
    <div
      className="relative flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2"
      style={{
        background: "rgba(12,16,30,0.98)",
        border: "1px solid rgba(55,85,160,0.68)",
        boxShadow:
          "0 0 0 1px rgba(55,85,160,0.22), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 16px rgba(55,85,160,0.12)",
      }}
    >
      {/* Bar chart icon */}
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 shrink-0"
        style={{ color: "rgba(99,140,255,0.90)" }}
      >
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
      </svg>

      {/* Label row */}
      <div>
        <p
          className="font-black uppercase leading-none"
          style={{ fontSize: "7px", color: "#71717a", letterSpacing: "0.15em" }}
        >
          RANK BY
        </p>
        <div className="flex items-center gap-1" style={{ marginTop: "2px" }}>
          <p
            className="font-bold leading-none"
            style={{ fontSize: "11px", color: "#f1f5f9" }}
          >
            {label}
          </p>
          {/* Chevron */}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3 shrink-0"
            style={{ color: "rgba(99,140,255,0.70)" }}
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>

      {/* Invisible native select — covers the whole chip so tapping anywhere opens the picker */}
      <select
        value={value}
        onChange={handleChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Rank by"
      >
        <option value="rating">Rating</option>
        <option value="win_rate">Win Rate</option>
        <option value="tournament_wins" disabled>
          Tournament Wins (Soon)
        </option>
      </select>
    </div>
  );
}
