"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase/client";
import {
  resolvePlayerTier,
  UNRANKED_MATCHES_THRESHOLD,
} from "../../lib/player/ranks";

type BarState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "placement"; username: string; matchesPlayed: number }
  | {
      status: "ranked";
      rank: number;
      username: string;
      rankPoints: number;
      winRate: number;
      matches: number;
    };

function initials(username: string) {
  return (
    username
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export default function YourRankBar() {
  const [bar, setBar] = useState<BarState>({ status: "loading" });

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setBar({ status: "hidden" });
          return;
        }

        const { data: stats } = await supabase
          .from("player_stats")
          .select("matches, wins, losses, rank_points, username")
          .eq("user_id", session.user.id)
          .eq("game_id", "penalty444")
          .maybeSingle();

        if (!stats) {
          setBar({ status: "hidden" });
          return;
        }

        if (stats.matches < UNRANKED_MATCHES_THRESHOLD) {
          setBar({
            status: "placement",
            username: stats.username ?? "Player",
            matchesPlayed: stats.matches,
          });
          return;
        }

        // Count players ranked strictly above the current user by rank_points
        const { count } = await supabase
          .from("player_stats")
          .select("user_id", { count: "exact", head: true })
          .eq("game_id", "penalty444")
          .gte("matches", UNRANKED_MATCHES_THRESHOLD)
          .gt("rank_points", stats.rank_points);

        setBar({
          status: "ranked",
          rank: (count ?? 0) + 1,
          username: stats.username ?? "Player",
          rankPoints: stats.rank_points,
          winRate:
            stats.matches > 0
              ? Math.round((stats.wins / stats.matches) * 100)
              : 0,
          matches: stats.matches,
        });
      } catch {
        setBar({ status: "hidden" });
      }
    }
    load();
  }, []);

  if (bar.status === "hidden") return null;

  const wrap = "fixed bottom-[68px] left-0 right-0 z-30 px-3 sm:bottom-4 sm:px-4 md:bottom-5 md:px-6";

  // ── Loading skeleton ────────────────────────────────────────────────
  if (bar.status === "loading") {
    return (
      <div className={wrap}>
        <div className="mx-auto max-w-[520px]">
          <div
            className="h-[62px] animate-pulse rounded-2xl"
            style={{
              background: "rgba(8,10,20,0.95)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          />
        </div>
      </div>
    );
  }

  // ── Placement state ─────────────────────────────────────────────────
  if (bar.status === "placement") {
    return (
      <div className={wrap}>
        <div className="mx-auto max-w-[520px]">
          <div
            className="flex h-[62px] items-center justify-between gap-3 rounded-2xl px-4"
            style={{
              background: "rgba(6,8,18,0.98)",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow:
                "0 -4px 32px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
                style={{
                  background: "rgba(30,35,50,0.90)",
                  border: "1px solid rgba(80,90,120,0.45)",
                  color: "#a1a1aa",
                }}
              >
                {initials(bar.username)}
              </div>
              <div>
                <p
                  className="font-black uppercase"
                  style={{
                    fontSize: "8px",
                    letterSpacing: "0.28em",
                    color: "#52525b",
                  }}
                >
                  YOUR RANK
                </p>
                <p
                  className="font-bold"
                  style={{ fontSize: "14px", color: "#d4d4d8" }}
                >
                  {bar.username}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p
                className="font-black uppercase"
                style={{
                  fontSize: "8px",
                  letterSpacing: "0.22em",
                  color: "#52525b",
                }}
              >
                Placement
              </p>
              <p
                className="font-bold tabular-nums"
                style={{ fontSize: "12px", color: "#71717a" }}
              >
                {bar.matchesPlayed}/{UNRANKED_MATCHES_THRESHOLD} played
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Ranked state ────────────────────────────────────────────────────
  const tier = resolvePlayerTier({
    rating: bar.rankPoints,
    matchesPlayed: bar.matches,
  });

  // Map tier to a color string for the tier label
  const tierColor =
    tier.id === "champion"
      ? "#fef08a"
      : tier.id === "elite"
      ? "#c4b5fd"
      : tier.id === "diamond"
      ? "#a5f3fc"
      : tier.id === "platinum"
      ? "#99f6e4"
      : tier.id === "gold"
      ? "#fcd34d"
      : tier.id === "silver"
      ? "#e2e8f0"
      : tier.id === "bronze"
      ? "#fbbf24"
      : "#a1a1aa";

  return (
    <div className={wrap}>
      <div className="mx-auto max-w-[520px]">
        <div
          className="flex h-[62px] items-center gap-3 rounded-2xl px-4"
          style={{
            background: "rgba(4,6,16,0.99)",
            border: "1px solid rgba(34,211,238,0.60)",
            // NOTE: all values use spaces — no underscores in CSS property values
            boxShadow:
              "0 0 0 1px rgba(34,211,238,0.14), 0 -4px 32px rgba(0,0,0,0.80), 0 0 40px rgba(34,211,238,0.28), inset 0 1px 0 rgba(34,211,238,0.10)",
          }}
        >
          {/* YOUR RANK label + number */}
          <div className="shrink-0">
            <p
              className="font-black uppercase"
              style={{
                fontSize: "8px",
                letterSpacing: "0.30em",
                color: "rgba(34,211,238,0.85)",
              }}
            >
              YOUR RANK
            </p>
            <p
              className="font-black tabular-nums leading-none text-white"
              style={{ fontSize: "24px" }}
            >
              #{bar.rank}
            </p>
          </div>

          {/* Vertical divider */}
          <div
            className="h-9 w-px shrink-0"
            style={{ background: "rgba(255,255,255,0.07)" }}
          />

          {/* Avatar with cyan ring */}
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-black text-white"
            style={{
              fontSize: "11px",
              background:
                "linear-gradient(to bottom, rgba(20,80,100,0.70), rgba(8,12,22,1))",
              boxShadow:
                "0 0 0 2px rgba(34,211,238,0.70), 0 0 0 5px rgba(34,211,238,0.18), 0 0 22px rgba(34,211,238,0.35)",
            }}
          >
            {initials(bar.username)}
          </div>

          {/* Name + tier */}
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-black text-white"
              style={{ fontSize: "14px" }}
            >
              {bar.username}
            </p>
            <div
              className="flex items-center gap-1 font-bold"
              style={{ fontSize: "10px", color: tierColor, marginTop: "1px" }}
            >
              <span>{tier.icon}</span>
              <span>{tier.label}</span>
            </div>
          </div>

          {/* Points + win rate */}
          <div className="shrink-0 text-right">
            <p
              className="font-black tabular-nums"
              style={{ fontSize: "15px", color: "#fde68a" }}
            >
              {bar.rankPoints}
            </p>
            <p
              className="font-bold"
              style={{ fontSize: "10px", color: "#52525b" }}
            >
              {bar.winRate}%
            </p>
          </div>

          {/* Chevron */}
          <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ color: "#52525b" }}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
