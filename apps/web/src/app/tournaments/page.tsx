"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RequireAuth from "../../components/auth/RequireAuth";
import CreateTournamentPanel from "../../components/tournament/CreateTournamentPanel";
import TournamentHubHero, {
  type TournamentHubStats,
} from "../../components/tournament/TournamentHubHero";
import TournamentListPanel from "../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import {
  clearActiveTournamentIfPlayerMismatch,
  getActiveTournament,
  subscribeActiveTournament,
  type ActiveTournament,
} from "../../lib/tournament/activeTournament";
import { useTournamentRealtime } from "../../lib/tournament/useTournamentRealtime";

const DEV_SCHEDULE_SYNC_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEV_SCHEDULE_SYNC === "true";

const DEV_SCHEDULE_SYNC_INTERVAL_MS = 30_000;

async function runDevTournamentScheduleSync(): Promise<void> {
  if (!DEV_SCHEDULE_SYNC_ENABLED) {
    return;
  }

  try {
    await fetch("/api/internal/tournaments/tick", {
      method: "POST",
      headers: { "x-dev-schedule-sync": "1" },
      cache: "no-store",
    });
  } catch {
    // Best-effort local scheduler; production uses cron + CRON_SECRET.
  }
}

// ─── Coming Soon feature list (no real data, clearly disabled) ───────────────

const COMING_SOON_FEATURES = [
  {
    icon: "🏆",
    label: "Advanced Rewards",
    detail: "Future event formats — disabled during Free Play Beta",
  },
  {
    icon: "⭐",
    label: "Sponsored Events",
    detail: "Brand-backed arenas — future feature",
  },
  {
    icon: "📅",
    label: "Scheduled Seasons",
    detail: "Recurring leagues with standings",
  },
  {
    icon: "🔒",
    label: "Wallet Features",
    detail: "Requires future wallet launch — not available in beta",
  },
];

const BETA_RULES = [
  { icon: "✓", label: "Free Entry Only", color: "#34d399" },
  { icon: "✓", label: "Manual Host Start", color: "#34d399" },
  { icon: "✓", label: "Single-Elimination Brackets", color: "#34d399" },
  { icon: "✓", label: "No Cash Stakes in Beta", color: "#34d399" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TournamentsPage() {
  const [listVersion, setListVersion] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTournament, setActiveTournament] =
    useState<ActiveTournament | null>(null);

  useTournamentRealtime({ playerId: currentUserId });

  useEffect(() => {
    let cancelled = false;

    void getCurrentPlayerIdentity().then((identity) => {
      if (!cancelled) {
        const playerId = identity?.playerId ?? null;
        setCurrentUserId(playerId);
        if (playerId) {
          clearActiveTournamentIfPlayerMismatch(playerId);
          setActiveTournament(getActiveTournament(playerId));
        } else {
          setActiveTournament(getActiveTournament() ?? null);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live changes (same-tab + cross-tab) so the resume hero is
  // always in sync with the snapshot.
  useEffect(() => {
    const unsubscribe = subscribeActiveTournament(() => {
      setActiveTournament(getActiveTournament(currentUserId ?? undefined));
    });
    return unsubscribe;
  }, [currentUserId]);

  useEffect(() => {
    if (!DEV_SCHEDULE_SYNC_ENABLED) {
      return;
    }

    const syncAndRefresh = async () => {
      await runDevTournamentScheduleSync();
      setListVersion((version) => version + 1);
    };

    void syncAndRefresh();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void syncAndRefresh();
    }, DEV_SCHEDULE_SYNC_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncAndRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      setListVersion((version) => version + 1);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // Visibility refresh — tab switch without a window-focus event (e.g. clicking
  // between browser tabs). Not gated on active-tournament state so a player who
  // left the list empty still sees newly created tournaments on return.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setListVersion((version) => version + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Low-frequency baseline poll (30 s) — keeps the list alive even when no
  // active tournaments are present and neither focus nor visibility has fired.
  // Allows a freshly created tournament in another browser to appear without a
  // manual reload.
  useEffect(() => {
    const BASELINE_POLL_MS = 30_000;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setListVersion((version) => version + 1);
    }, BASELINE_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!activeTournament) return;
    if (activeTournament.lastKnownState !== "in_progress") return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setListVersion((version) => version + 1);
    }, 8_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTournament]);

  const activeStateCopy = activeTournament
    ? activeStateLine(activeTournament.lastKnownState)
    : null;

  const [stats, setStats] = useState<TournamentHubStats>({
    live: 0,
    upcoming: 0,
    mine: 0,
    completed: 0,
  });
  const [listLoading, setListLoading] = useState(true);

  const handleStatsChanged = useCallback((next: TournamentHubStats) => {
    setStats(next);
  }, []);
  const handleLoadingChanged = useCallback((loading: boolean) => {
    setListLoading(loading);
  }, []);

  return (
    <RequireAuth>
      {/* Full-bleed dark canvas */}
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
                color: "rgba(34,211,238,0.80)",
              }}
            >
              444 ARENA
            </p>
            <h1
              className="mt-1 font-black text-white"
              style={{ fontSize: "24px", letterSpacing: "-0.01em" }}
            >
              Tournaments
            </h1>
            <p style={{ fontSize: "13px", color: "#71717a", marginTop: "3px" }}>
              Free-entry beta tournaments. More formats coming later.
            </p>

            {/* ── Beta policy pills ── */}
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { label: "Free Entry", icon: "✓", active: true },
                  { label: "Manual Start", icon: "⚡", active: true },
                  { label: "No Cash Prizes in Beta", icon: "🔒", active: true },
                  { label: "Wallet Coming Soon", icon: "◷", active: false },
                ] as const
              ).map(({ label, icon, active }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold"
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.06em",
                    background: active
                      ? "rgba(20,50,40,0.85)"
                      : "rgba(18,20,28,0.85)",
                    border: active
                      ? "1px solid rgba(52,211,153,0.50)"
                      : "1px solid rgba(80,85,110,0.45)",
                    color: active ? "#6ee7b7" : "#71717a",
                  }}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ══ TWO-COLUMN LAYOUT ════════════════════════════════════════════ */}
          {/* Mobile: single column. lg+: main | sidebar */}
          <div className="lg:grid lg:grid-cols-[1fr_280px] lg:items-start lg:gap-5">

            {/* ── MAIN COLUMN ──────────────────────────────────────────────── */}
            <div className="space-y-5">
              <TournamentHubHero stats={stats} isLoading={listLoading} />

              {/* Resume active tournament banner */}
              {activeTournament ? (
                <section
                  className={`relative overflow-hidden rounded-2xl border-2 px-4 py-4 sm:px-5 sm:py-5 ${
                    activeTournament.lastKnownState === "in_progress"
                      ? "border-cyan-400/55 bg-gradient-to-br from-cyan-950/35 via-zinc-950 to-black shadow-[0_0_36px_rgba(34,211,238,0.2)]"
                      : "border-amber-400/55 bg-gradient-to-br from-amber-950/30 via-zinc-950 to-black shadow-[0_0_28px_rgba(251,191,36,0.18)]"
                  }`}
                  aria-label="Resume active tournament"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
                            activeTournament.lastKnownState === "in_progress"
                              ? "border-cyan-400/55 bg-cyan-500/15 text-cyan-100"
                              : "border-amber-400/55 bg-amber-500/15 text-amber-100"
                          }`}
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90"
                            aria-hidden
                          />
                          {activeTournament.lastKnownState === "in_progress"
                            ? "Your tournament is live"
                            : "You are still in this tournament"}
                        </span>
                        {activeTournament.tierLabel ? (
                          <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
                            {activeTournament.tierLabel}
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-2 break-words text-lg font-black tracking-tight text-white sm:text-xl">
                        {activeTournament.tournamentName}
                      </h2>
                      <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">
                        {activeStateCopy}
                      </p>
                    </div>
                    <Link
                      href={`/tournaments/${activeTournament.tournamentId}`}
                      className={`inline-flex w-full shrink-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-black shadow-lg sm:w-auto ${
                        activeTournament.lastKnownState === "in_progress"
                          ? "bg-gradient-to-r from-cyan-400 to-amber-500 text-zinc-950 hover:from-cyan-300 hover:to-amber-400"
                          : "bg-gradient-to-r from-amber-400 to-orange-500 text-zinc-950 hover:from-amber-300 hover:to-orange-400"
                      }`}
                    >
                      Resume Tournament →
                    </Link>
                  </div>
                </section>
              ) : null}

              <TournamentListPanel
                listVersion={listVersion}
                activeTournamentId={activeTournament?.tournamentId ?? null}
                defaultFilter="live"
                onStatsChanged={handleStatsChanged}
                onLoadingChanged={handleLoadingChanged}
              />

              <CreateTournamentPanel
                onCreated={() => setListVersion((version) => version + 1)}
              />

              {/* Mobile-only: beta rules + coming soon below main */}
              <div className="space-y-4 lg:hidden">
                <BetaRulesCard />
                <ComingSoonCard />
              </div>
            </div>

            {/* ── SIDEBAR (desktop only) ────────────────────────────────────── */}
            <aside className="hidden space-y-4 lg:block">
              <BetaRulesCard />
              <ComingSoonCard />
            </aside>
          </div>

          <div className="h-4 md:h-6" />
        </div>
      </div>
    </RequireAuth>
  );
}

// ─── Sidebar sub-components ───────────────────────────────────────────────────

function BetaRulesCard() {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(4,8,18,0.98)",
        border: "1px solid rgba(52,211,153,0.22)",
        boxShadow: "0 0 24px rgba(52,211,153,0.08)",
      }}
    >
      <p
        className="font-black uppercase"
        style={{
          fontSize: "9px",
          letterSpacing: "0.30em",
          color: "rgba(52,211,153,0.80)",
          marginBottom: "10px",
        }}
      >
        Beta Rules
      </p>
      <ul className="space-y-2.5">
        {BETA_RULES.map(({ icon, label, color }) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black"
              style={{
                background: "rgba(52,211,153,0.12)",
                color,
              }}
            >
              {icon}
            </span>
            <span
              className="font-semibold"
              style={{ fontSize: "12px", color: "#d4d4d8" }}
            >
              {label}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="mt-3 font-medium"
        style={{
          fontSize: "11px",
          color: "#52525b",
          lineHeight: "1.4",
        }}
      >
        Create or join free tournaments during beta. Advanced formats and wallet
        features are not available yet.
      </p>
    </div>
  );
}

function ComingSoonCard() {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(4,6,14,0.98)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <p
        className="font-black uppercase"
        style={{
          fontSize: "9px",
          letterSpacing: "0.30em",
          color: "#52525b",
          marginBottom: "10px",
        }}
      >
        Coming Soon
      </p>
      <ul className="space-y-3">
        {COMING_SOON_FEATURES.map(({ icon, label, detail }) => (
          <li key={label} className="flex items-start gap-2.5" aria-disabled="true">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-sm"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                opacity: 0.55,
              }}
            >
              {icon}
            </span>
            <div style={{ opacity: 0.45 }}>
              <p
                className="font-bold text-white"
                style={{ fontSize: "12px" }}
              >
                {label}
              </p>
              <p
                className="font-medium"
                style={{ fontSize: "10px", color: "#71717a", marginTop: "1px" }}
              >
                {detail}
              </p>
            </div>
            <span
              className="ml-auto shrink-0 rounded-full px-2 py-0.5 font-black uppercase"
              style={{
                fontSize: "8px",
                letterSpacing: "0.18em",
                background: "rgba(18,20,28,0.90)",
                border: "1px solid rgba(60,65,90,0.55)",
                color: "#52525b",
              }}
            >
              Soon
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activeStateLine(state: ActiveTournament["lastKnownState"]): string {
  switch (state) {
    case "in_progress":
      return "Resume to play your next bracket match.";
    case "check_in":
      return "Head back to continue your tournament match.";
    case "registration":
      return "Registration is still open — head back when you're ready.";
    default:
      return "Pick up where you left off.";
  }
}
