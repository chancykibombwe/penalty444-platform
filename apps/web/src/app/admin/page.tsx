"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { UNRANKED_MATCHES_THRESHOLD } from "../../lib/player/ranks";
import type {
  AdminDataResponse,
  AdminMatchRow,
  AdminTournamentRow,
  AdminPlayerRow,
  AdminHealthData,
} from "../api/admin/data/route";

// ─── Page states ──────────────────────────────────────────────────────────────

type PageState =
  | "loading"
  | "unauthenticated"
  | "forbidden"
  | "service_unavailable"
  | "error"
  | "ready";

// ─── Debug notes (static, admin-only guidance) ───────────────────────────────

const DEBUG_NOTES = [
  "If Vercel preview realtime disconnects, verify NEXT_PUBLIC_REALTIME_URL is set on the Vercel preview env.",
  "If Railway logs show CORS rejected, confirm preview-origin rule from PR #92 is deployed.",
  "If a tournament shows 2/4 players, it is waiting — do not treat as broken. Bracket requires minimum 2 registered players to start.",
  "Wallet and paid tournaments are disabled during beta. Economy mode must remain 'off' or unset.",
  "Placement players (< 10 matches) do not appear on the public leaderboard — this is correct behavior.",
  "Admin emails are set via ADMIN_EMAILS server env var (never NEXT_PUBLIC_ADMIN_EMAILS).",
  "This dashboard is read-only. No mutations are available in this view.",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case "in_progress":
      return "#34d399";
    case "registration":
    case "check_in":
      return "#60a5fa";
    case "completed":
      return "#a78bfa";
    case "cancelled":
      return "#f87171";
    default:
      return "#71717a";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    case "registration":
      return "Open";
    case "check_in":
      return "Check-In";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Pill({
  label,
  color,
  bg,
  border,
}: {
  label: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 font-bold"
      style={{
        fontSize: "10px",
        letterSpacing: "0.08em",
        color,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  children,
  accent = "rgba(34,211,238,0.25)",
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(4,6,16,0.98)",
        border: `1px solid ${accent}`,
        boxShadow: `0 0 20px rgba(0,0,0,0.40)`,
      }}
    >
      <p
        className="mb-3 font-black uppercase"
        style={{
          fontSize: "9px",
          letterSpacing: "0.30em",
          color: accent,
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function HealthCards({ health }: { health: AdminHealthData }) {
  const cards = [
    {
      label: "Match Results",
      value: health.matchResultsCount.toLocaleString(),
      sub: "total in DB",
      accent: "#34d399",
    },
    {
      label: "Tournaments",
      value: health.tournamentsCount.toLocaleString(),
      sub: "all statuses",
      accent: "#60a5fa",
    },
    {
      label: "Ranked Players",
      value: health.rankedPlayersCount.toLocaleString(),
      sub: `≥ ${UNRANKED_MATCHES_THRESHOLD} matches`,
      accent: "#a78bfa",
    },
    {
      label: "Placement",
      value: health.placementPlayersCount.toLocaleString(),
      sub: "< 10 matches",
      accent: "#fbbf24",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-3"
          style={{
            background: "rgba(8,10,22,0.95)",
            border: `1px solid ${c.accent}30`,
          }}
        >
          <p
            className="font-bold uppercase"
            style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#52525b" }}
          >
            {c.label}
          </p>
          <p
            className="mt-1 font-black tabular-nums"
            style={{ fontSize: "22px", lineHeight: 1, color: c.accent }}
          >
            {c.value}
          </p>
          <p style={{ fontSize: "10px", color: "#52525b", marginTop: "2px" }}>
            {c.sub}
          </p>
        </div>
      ))}
    </div>
  );
}

function ConfigStatus({ health }: { health: AdminHealthData }) {
  const rows = [
    {
      key: "Realtime URL",
      value: health.realtimeUrlConfigured ? "Configured ✓" : "Missing ✗",
      ok: health.realtimeUrlConfigured,
    },
    {
      key: "Economy Mode",
      value: health.economyMode,
      ok: health.economyMode === "off" || health.economyMode === "not_set",
    },
  ];

  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between">
          <span style={{ fontSize: "11px", color: "#71717a" }}>{r.key}</span>
          <span
            className="font-bold"
            style={{ fontSize: "11px", color: r.ok ? "#34d399" : "#f87171" }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function MatchTable({ matches }: { matches: AdminMatchRow[] }) {
  if (matches.length === 0) {
    return (
      <p style={{ fontSize: "13px", color: "#52525b" }}>
        No recent match results found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ fontSize: "11px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {["Time", "Room", "P1", "P2", "Score", "Winner"].map((h) => (
              <th
                key={h}
                className="pb-1.5 text-left font-black uppercase"
                style={{ letterSpacing: "0.16em", color: "#3f3f46", fontSize: "9px", paddingRight: "8px" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr
              key={`${m.roomCode}-${i}`}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
            >
              <td
                className="py-1.5 font-mono"
                style={{ color: "#52525b", paddingRight: "8px", whiteSpace: "nowrap" }}
              >
                {relativeTime(m.createdAt)}
              </td>
              <td
                className="py-1.5 font-mono"
                style={{ color: "#71717a", paddingRight: "8px" }}
              >
                {m.roomCode}
              </td>
              <td className="py-1.5" style={{ color: "#d4d4d8", paddingRight: "8px", maxWidth: "80px" }}>
                <span className="block truncate">{m.playerOneUsername}</span>
              </td>
              <td className="py-1.5" style={{ color: "#d4d4d8", paddingRight: "8px", maxWidth: "80px" }}>
                <span className="block truncate">{m.playerTwoUsername}</span>
              </td>
              <td
                className="py-1.5 font-mono tabular-nums"
                style={{ color: "#a1a1aa", paddingRight: "8px", whiteSpace: "nowrap" }}
              >
                {m.playerOneScore}–{m.playerTwoScore}
              </td>
              <td className="py-1.5" style={{ paddingRight: "8px", maxWidth: "80px" }}>
                {m.winnerUsername ? (
                  <span
                    className="block truncate font-semibold"
                    style={{ color: m.isDraw ? "#fbbf24" : "#34d399" }}
                  >
                    {m.winnerUsername}
                  </span>
                ) : (
                  <span style={{ color: "#3f3f46" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TournamentList({ tournaments }: { tournaments: AdminTournamentRow[] }) {
  if (tournaments.length === 0) {
    return (
      <p style={{ fontSize: "13px", color: "#52525b" }}>
        No tournaments found.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tournaments.map((t) => (
        <div
          key={t.id}
          className="rounded-xl px-3 py-2.5"
          style={{
            background: "rgba(8,10,22,0.95)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className="truncate font-bold text-white"
                style={{ fontSize: "12px" }}
              >
                {t.name}
              </p>
              <p style={{ fontSize: "10px", color: "#52525b", marginTop: "1px" }}>
                {t.entryCount}/{t.maxPlayers} players · {t.matchCount} matches ·{" "}
                {relativeTime(t.createdAt)}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-bold"
              style={{
                fontSize: "9px",
                letterSpacing: "0.12em",
                color: statusColor(t.status),
                background: `${statusColor(t.status)}18`,
                border: `1px solid ${statusColor(t.status)}40`,
                whiteSpace: "nowrap",
              }}
            >
              {statusLabel(t.status)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerList({ players }: { players: AdminPlayerRow[] }) {
  if (players.length === 0) {
    return (
      <p style={{ fontSize: "13px", color: "#52525b" }}>
        No players found.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {players.map((p, i) => (
        <div key={p.username} className="flex items-center gap-2.5">
          <span
            className="w-5 shrink-0 text-right font-black tabular-nums"
            style={{ fontSize: "11px", color: "#3f3f46" }}
          >
            {i + 1}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-semibold"
            style={{ fontSize: "12px", color: "#d4d4d8" }}
          >
            {p.username}
          </span>
          <span
            className="shrink-0 font-bold tabular-nums"
            style={{ fontSize: "11px", color: "#fbbf24" }}
          >
            {p.rankPoints} pts
          </span>
          <span
            className="shrink-0 font-mono"
            style={{
              fontSize: "10px",
              color: p.isRanked ? "#34d399" : "#71717a",
            }}
          >
            {p.matches}M {p.wins}W
          </span>
          {!p.isRanked && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 font-bold"
              style={{
                fontSize: "8px",
                color: "#60a5fa",
                background: "rgba(96,165,250,0.10)",
                border: "1px solid rgba(96,165,250,0.25)",
              }}
              title={`${UNRANKED_MATCHES_THRESHOLD - p.matches} more matches to rank`}
            >
              Placement {p.matches}/{UNRANKED_MATCHES_THRESHOLD}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function DebugNotes() {
  return (
    <ul className="space-y-2">
      {DEBUG_NOTES.map((note, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            className="mt-0.5 shrink-0 font-black"
            style={{ fontSize: "11px", color: "rgba(34,211,238,0.50)" }}
          >
            →
          </span>
          <p style={{ fontSize: "11px", color: "#71717a", lineHeight: "1.5" }}>
            {note}
          </p>
        </li>
      ))}
    </ul>
  );
}

// ─── Gate screens ─────────────────────────────────────────────────────────────

function GateScreen({
  title,
  body,
  color,
}: {
  title: string;
  body: string;
  color: string;
}) {
  return (
    <div
      className="-mx-4 -mt-4 flex min-h-screen items-center justify-center md:-mx-6 md:-mt-6"
      style={{
        background:
          "linear-gradient(160deg, #010212 0%, #030810 55%, #020508 100%)",
      }}
    >
      <div
        className="mx-4 max-w-sm rounded-2xl p-6 text-center"
        style={{
          background: "rgba(4,6,16,0.98)",
          border: `1px solid ${color}30`,
        }}
      >
        <p
          className="font-black"
          style={{ fontSize: "20px", color }}
        >
          {title}
        </p>
        <p
          className="mt-2 font-medium"
          style={{ fontSize: "13px", color: "#71717a" }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      className="-mx-4 -mt-4 min-h-screen md:-mx-6 md:-mt-6"
      style={{
        background:
          "linear-gradient(160deg, #010212 0%, #030810 55%, #020508 100%)",
      }}
    >
      <div className="mx-auto max-w-[980px] px-4 pt-4 md:px-6 md:pt-6">
        <div className="mb-5">
          <div
            className="h-3 w-24 animate-pulse rounded"
            style={{ background: "rgba(255,255,255,0.05)" }}
          />
          <div
            className="mt-2 h-7 w-48 animate-pulse rounded"
            style={{ background: "rgba(255,255,255,0.05)" }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main admin dashboard ─────────────────────────────────────────────────────

function AdminDashboard({ data }: { data: AdminDataResponse }) {
  return (
    <div
      className="-mx-4 -mt-4 min-h-screen md:-mx-6 md:-mt-6"
      style={{
        background:
          "linear-gradient(160deg, #010212 0%, #030810 55%, #020508 100%)",
      }}
    >
      <div className="relative mx-auto max-w-[980px] px-4 pt-4 md:px-6 md:pt-6">

        {/* ══ PAGE HEADER ══════════════════════════════════════════════════ */}
        <div className="mb-5">
          <p
            className="font-black uppercase"
            style={{
              fontSize: "9px",
              letterSpacing: "0.32em",
              color: "rgba(34,211,238,0.70)",
            }}
          >
            444 ARENA
          </p>
          <h1
            className="mt-1 font-black text-white"
            style={{ fontSize: "22px", letterSpacing: "-0.01em" }}
          >
            Beta Admin
          </h1>
          <p style={{ fontSize: "13px", color: "#71717a", marginTop: "3px" }}>
            Read-only operational view for 444 ARENA beta.
          </p>

          {/* Policy pills */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill
              label="Read-Only"
              color="#34d399"
              bg="rgba(20,50,40,0.85)"
              border="rgba(52,211,153,0.45)"
            />
            <Pill
              label="Admin Only"
              color="#60a5fa"
              bg="rgba(14,30,55,0.85)"
              border="rgba(96,165,250,0.40)"
            />
            <Pill
              label="Free Play Beta"
              color="#a78bfa"
              bg="rgba(30,18,55,0.85)"
              border="rgba(167,139,250,0.40)"
            />
            <Pill
              label="No Wallet Actions"
              color="#71717a"
              bg="rgba(18,18,24,0.85)"
              border="rgba(80,80,100,0.40)"
            />
          </div>
        </div>

        {/* ══ DASHBOARD GRID ═══════════════════════════════════════════════ */}
        <div className="lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-5 space-y-5 lg:space-y-0">

          {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Health Overview */}
            <SectionCard title="Beta Health" accent="rgba(52,211,153,0.35)">
              <HealthCards health={data.health} />
              <ConfigStatus health={data.health} />
            </SectionCard>

            {/* Recent Match Results */}
            <SectionCard title="Recent Match Results (last 20)" accent="rgba(96,165,250,0.30)">
              <MatchTable matches={data.recentMatches} />
            </SectionCard>

            {/* Active Rooms */}
            <SectionCard title="Active Rooms" accent="rgba(251,191,36,0.25)">
              <p style={{ fontSize: "12px", color: "#71717a", lineHeight: "1.5" }}>
                Live in-memory rooms are not persisted to Supabase.
              </p>
              <p
                className="mt-1.5 font-medium"
                style={{ fontSize: "11px", color: "#52525b" }}
              >
                Use Railway logs for real-time room debugging until room
                snapshots are stored in a database table.
              </p>
            </SectionCard>

          </div>

          {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Tournament Debug */}
            <SectionCard title="Tournaments (last 15)" accent="rgba(167,139,250,0.30)">
              <TournamentList tournaments={data.tournaments} />
            </SectionCard>

            {/* Player Snapshot */}
            <SectionCard title="Player Snapshot (top 15)" accent="rgba(251,191,36,0.25)">
              <PlayerList players={data.players} />
            </SectionCard>

            {/* Debug Notes */}
            <SectionCard title="Operational Notes" accent="rgba(34,211,238,0.20)">
              <DebugNotes />
            </SectionCard>

          </div>
        </div>

        <div className="h-6 md:h-8" />
      </div>
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<AdminDataResponse | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setState("unauthenticated");
          return;
        }

        const res = await fetch("/api/admin/data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });

        if (res.status === 401) {
          setState("unauthenticated");
          return;
        }
        if (res.status === 403) {
          setState("forbidden");
          return;
        }
        if (res.status === 503) {
          setState("service_unavailable");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }

        const json = (await res.json()) as AdminDataResponse;
        setData(json);
        setState("ready");
      } catch {
        setState("error");
      }
    }

    void load();
  }, []);

  if (state === "loading") return <LoadingSkeleton />;

  if (state === "unauthenticated") {
    return (
      <GateScreen
        title="Sign In Required"
        body="Please sign in to access the admin dashboard."
        color="#60a5fa"
      />
    );
  }

  if (state === "forbidden") {
    return (
      <GateScreen
        title="Not Authorized"
        body="Your account does not have admin access. Contact the operator to add your email to ADMIN_EMAILS."
        color="#f87171"
      />
    );
  }

  if (state === "service_unavailable") {
    return (
      <GateScreen
        title="Admin Unavailable"
        body="SUPABASE_SERVICE_ROLE_KEY is not configured on this environment. Set it in Vercel server-side env vars."
        color="#fbbf24"
      />
    );
  }

  if (state === "error" || !data) {
    return (
      <GateScreen
        title="Error"
        body="Could not load admin data. Check server logs."
        color="#f87171"
      />
    );
  }

  return <AdminDashboard data={data} />;
}
