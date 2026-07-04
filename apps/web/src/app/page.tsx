"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ContinuePlayingCard from "../components/home/ContinuePlayingCard";
import GameCard, {
  type GameCardData,
} from "../components/home/GameCard";
import HeroBanner from "../components/home/HeroBanner";
import HomeMobileShell from "../components/home/HomeMobileShell";
import HomeShared from "../components/home/HomeShared";
import LoggedOutCta from "../components/auth/LoggedOutCta";
import HomeTournamentPreview from "../components/home/HomeTournamentPreview";
import PlayerStatsStrip from "../components/home/PlayerStatsStrip";
import FeaturedLiveMatches from "../components/live/FeaturedLiveMatches";
import GlobalActivityFeed from "../components/live/GlobalActivityFeed";
import LiveMatchPreview from "../components/live/LiveMatchPreview";
import PlatformLiveStatus from "../components/live/PlatformLiveStatus";
import PlayerMomentsStrip from "../components/live/PlayerMomentsStrip";
import FeaturedPlayers from "../components/social/FeaturedPlayers";
import { getCurrentPlayerIdentity } from "../lib/auth/playerIdentity";
import {
  getActiveMatch,
  type ActiveMatch,
} from "../lib/match/activeMatch";
import {
  deriveRecentForm,
  deriveStreak,
  type CompetitiveStats,
} from "../lib/player/stats";
import { supabase } from "../lib/supabase/client";
import {
  getActiveTournament,
  subscribeActiveTournament,
  type ActiveTournament,
} from "../lib/tournament/activeTournament";

const NEWS_ITEMS = [
  {
    id: "beta-launch",
    tag: "Beta Update",
    title: "Free Play Beta is Live",
    body: "Penalty444 is available in free-play beta. No entry fees, no real money — pure skill-based competition.",
    date: "Jun 2026",
  },
  {
    id: "tournaments-testing",
    tag: "Feature",
    title: "Tournament Testing Underway",
    body: "Free-entry single-elimination brackets are being tested. Join one from the Tournaments page.",
    date: "Jun 2026",
  },
  {
    id: "wallet-coming",
    tag: "Coming Soon",
    title: "Wallet & Prizes — Future Feature",
    body: "Prize pools and wallet functionality are planned for a future release. Not available in beta.",
    date: "Upcoming",
  },
  {
    id: "help-center",
    tag: "Support",
    title: "Help Center Now Available",
    body: "Find answers to common questions, report issues, and learn the fair play rules in our Help Center.",
    date: "Jun 2026",
  },
] as const;

const HOW_IT_WORKS = [
  {
    step: "01",
    label: "Sign in",
    detail: "Create a free account to save your stats.",
  },
  {
    step: "02",
    label: "Enter Lobby",
    detail: "Find an open public match or create a private room.",
  },
  {
    step: "03",
    label: "Pick a lane",
    detail: "Choose left, centre, or right each round.",
  },
  {
    step: "04",
    label: "Score & save",
    detail: "You alternate between kicker and keeper each round.",
  },
  {
    step: "05",
    label: "Climb the ranks",
    detail: "Wins improve your rank. All free — no entry fees.",
  },
  {
    step: "06",
    label: "Join tournaments",
    detail: "Free-entry single-elimination brackets. Beta only.",
  },
] as const;

const COMING_SOON_GAMES: GameCardData[] = [
  {
    id: "chess444",
    title: "Chess444",
    subtitle: "Strategy · Classic",
    status: "coming-soon",
    href: "/",
    icon: "♟",
    comingSoon: true,
  },
  {
    id: "draught444",
    title: "Draught444",
    subtitle: "Strategy · Board",
    status: "coming-soon",
    href: "/",
    icon: "🪙",
    comingSoon: true,
  },
  {
    id: "crush444",
    title: "Crush444",
    subtitle: "Puzzle · Arcade",
    status: "coming-soon",
    href: "/",
    icon: "💥",
    comingSoon: true,
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400 sm:text-[10px] sm:tracking-[0.32em]">
      {/* Brand accent tick — neon cyan/blue primary, consistent across sections. */}
      <span
        aria-hidden
        className="inline-block h-3 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-arena-primary to-arena-primary-deep shadow-[0_0_8px_rgba(59,158,255,0.6)]"
      />
      {children}
    </p>
  );
}

export default function HomePage() {
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [activeTournament, setActiveTournament] =
    useState<ActiveTournament | null>(null);
  const [playerStats, setPlayerStats] = useState<CompetitiveStats | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  function refreshActiveMatch() {
    setActiveMatch(getActiveMatch());
  }

  useEffect(() => {
    let cancelled = false;

    void getCurrentPlayerIdentity().then(async (identity) => {
      if (cancelled) return;
      setActiveTournament(
        getActiveTournament(identity?.playerId ?? undefined)
      );

      if (!identity?.playerId) {
        setPlayerStats(null);
        return;
      }

      try {
        const [statsResult, matchesResult, tournamentWinsResult] =
          await Promise.all([
            supabase
              .from("player_stats")
              .select(
                "username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier"
              )
              .eq("game_id", "penalty444")
              .eq("user_id", identity.playerId)
              .maybeSingle(),
            supabase
              .from("match_results")
              .select("winner_id, is_draw, created_at")
              .or(
                `player_one_id.eq.${identity.playerId},player_two_id.eq.${identity.playerId}`
              )
              .order("created_at", { ascending: false })
              .limit(5),
            supabase
              .from("tournaments")
              .select("id", { count: "exact", head: true })
              .eq("game_id", "penalty444")
              .eq("winner_id", identity.playerId),
          ]);
        if (cancelled) return;

        const row = statsResult.data;
        const recent = (matchesResult.data ?? []) as Array<{
          winner_id: string | null;
          is_draw: boolean | null;
          created_at: string | null;
        }>;
        const recentForm = deriveRecentForm(recent, identity.playerId, 5);
        const streak = deriveStreak(recentForm);
        const tournamentWins = tournamentWinsResult.count ?? 0;

        if (!row) {
          setPlayerStats({
            username: identity.username ?? null,
            rating: null,
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            tournamentWins,
            recentForm,
            streak,
          });
          return;
        }

        setPlayerStats({
          username: row.username ?? identity.username ?? null,
          rating: row.rank_points ?? null,
          matches: row.matches ?? 0,
          wins: row.wins ?? 0,
          losses: row.losses ?? 0,
          draws: row.draws ?? 0,
          goalsFor: row.goals_for ?? 0,
          goalsAgainst: row.goals_against ?? 0,
          tournamentWins,
          legacyTierName: row.tier ?? null,
          recentForm,
          streak,
        });
      } catch {
        if (!cancelled) setPlayerStats(null);
      }
    });

    refreshActiveMatch();

    const onMatchChange = () => refreshActiveMatch();
    window.addEventListener("storage", onMatchChange);
    window.addEventListener(
      "penalty444:active-match-changed",
      onMatchChange
    );

    const unsubscribeTournament = subscribeActiveTournament(() => {
      setActiveTournament(getActiveTournament());
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onMatchChange);
      window.removeEventListener(
        "penalty444:active-match-changed",
        onMatchChange
      );
      unsubscribeTournament();
    };
  }, []);

  const continueCards = useMemo(() => {
    const cards: Array<{
      key: string;
      tone: "match" | "tournament";
      eyebrow: string;
      title: string;
      subtitle: string;
      href: string;
      cta: string;
      icon: string;
    }> = [];

    if (activeMatch?.roomCode) {
      cards.push({
        key: "active-match",
        tone: "match",
        eyebrow: "Match in progress",
        title: `Room ${activeMatch.roomCode}`,
        subtitle: "Your opponent is waiting. Don't leave them hanging.",
        href: `/match/${activeMatch.roomCode}`,
        cta: "Resume Match",
        icon: "⚽",
      });
    }

    if (activeTournament?.tournamentId) {
      const isLive = activeTournament.lastKnownState === "in_progress";
      cards.push({
        key: "active-tournament",
        tone: "tournament",
        eyebrow: isLive ? "Tournament live" : "You are entered",
        title: activeTournament.tournamentName,
        subtitle: isLive
          ? "Resume to play your next bracket match."
          : "Tournament hasn't started yet. The host will begin when ready.",
        href: `/tournaments/${activeTournament.tournamentId}`,
        cta: "Resume Tournament",
        icon: "🏆",
      });
    }

    return cards;
  }, [activeMatch, activeTournament]);

  return (
    <HomeMobileShell>
    <div className="mx-auto max-w-6xl space-y-6 pb-2 sm:space-y-8">
      <HomeShared />

      {/* ── 1. HERO ── */}
      <div data-home-slot="hero">
        <HeroBanner primaryHref="/lobby" secondaryHref="/tournaments" />
      </div>

      {/* Auth entry points for logged-out visitors (renders nothing once
          signed in, so the logged-in home stays uncluttered). */}
      <LoggedOutCta variant="hero" className="-mt-2" />

      {/* data-home-slot="quick-actions" — reserved: the Quick Actions row
          (QUICK MATCH / CREATE ROOM / JOIN ROOM / PRACTICE) lands here in a
          later Home PR. No placeholder rendered to avoid empty UI. */}

      {/* ── 2. CONTINUE PLAYING (conditional) ── */}
      {continueCards.length > 0 ? (
        <section
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Continue playing"
        >
          {continueCards.map((card) => (
            <ContinuePlayingCard
              key={card.key}
              tone={card.tone}
              eyebrow={card.eyebrow}
              title={card.title}
              subtitle={card.subtitle}
              href={card.href}
              cta={card.cta}
              icon={card.icon}
            />
          ))}
        </section>
      ) : null}

      {/* ── 3. LIVE GAME: PENALTY444 ── */}
      <section aria-label="Penalty444 — Live game" data-home-slot="games-live">
        <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-3">
          <SectionLabel>Live Game</SectionLabel>
          <Link
            href="/how-to-play"
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60"
          >
            How to Play →
          </Link>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-[#3B9EFF]/40 bg-gradient-to-br from-[#0A0E14] via-[#0C1220] to-black p-4 shadow-2xl shadow-[#3B9EFF]/10 sm:p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-[#3B9EFF]/10 blur-3xl"
          />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3B9EFF]/55 bg-[#3B9EFF]/15 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-[#9AD2FF]">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#3B9EFF] shadow-[0_0_8px_rgba(59,158,255,0.8)]" aria-hidden />
                  Free Play · Live
                </span>
                <span className="rounded-full border border-zinc-700/60 bg-zinc-900/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                  1v1
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
                Penalty444
              </h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                Skill-based 1v1 penalty shootout
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                Football · Left · Centre · Right · Sudden Death rules
              </p>
            </div>
            <span className="hidden text-6xl sm:block" aria-hidden>⚽</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/lobby"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-5 py-1.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_0_24px_rgba(59,158,255,0.35)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              ▶ Enter Lobby
            </Link>
            <Link
              href="/how-to-play"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-zinc-700 bg-transparent px-4 py-1.5 text-sm font-black uppercase tracking-wide text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              How to Play
            </Link>
          </div>
        </div>
      </section>

      {/* ── 4. FUTURE GAMES — COMING SOON ── */}
      <section aria-label="More games — Coming Soon" data-home-slot="games-coming-soon">
        <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-3">
          <SectionLabel>More Games</SectionLabel>
          <span className="rounded-full border border-zinc-700/50 bg-zinc-900/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Coming Soon
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {COMING_SOON_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      {/* ── 5. PLAYER STATS ── */}
      <div data-home-slot="stats">
        <PlayerStatsStrip stats={playerStats} />
      </div>

      {/* ── 6. HOW IT WORKS (collapsible) ── */}
      <section aria-label="How the beta works">
        <button
          type="button"
          onClick={() => setHowItWorksOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/60"
          aria-expanded={howItWorksOpen}
        >
          <SectionLabel>How It Works</SectionLabel>
          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300/80">
            Free Play Beta
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="ml-auto h-3 w-3 shrink-0 text-zinc-500 transition-transform"
            style={{ transform: howItWorksOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {howItWorksOpen && (
          <ol className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <li
                key={item.step}
                className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5"
              >
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                  {item.step}
                </span>
                <p className="mt-1 text-sm font-black text-white">{item.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                  {item.detail}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── 7. TOURNAMENTS ── */}
      <HomeTournamentPreview />

      {/* ── 8. ARENA ACTIVITY ── */}
      <PlatformLiveStatus />
      <FeaturedLiveMatches />
      <LiveMatchPreview />

      {/* ── 9. TOP COMPETITORS ── */}
      <FeaturedPlayers />
      <PlayerMomentsStrip />

      {/* ── 10. PLATFORM ACTIVITY ── */}
      <GlobalActivityFeed seeMoreHref="/tournaments" />

      {/* ── 11. NEWS & ANNOUNCEMENTS ── */}
      <section aria-label="News and Announcements">
        <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-3">
          <SectionLabel>News &amp; Announcements</SectionLabel>
          <Link
            href="/news"
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60"
          >
            See all →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {NEWS_ITEMS.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-zinc-800/60 bg-zinc-950/80 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-[#37558A]/55 bg-[#37558A]/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#94A3FF]/90">
                  {item.tag}
                </span>
                <span className="text-[9px] text-zinc-600">{item.date}</span>
              </div>
              <p className="mt-1.5 text-[12px] font-black leading-snug text-white">
                {item.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 12. NEED HELP / SUPPORT ── */}
      <section aria-label="Need Help?">
        <div className="rounded-2xl border border-[#37558A]/30 bg-[#0A0E1A]/95 px-4 py-4">
          <SectionLabel>Support</SectionLabel>
          <p className="mt-1 text-sm font-black text-white">Need Help?</p>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
            Browse the Help Center, report a bug, or reach out directly.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/support"
              className="rounded-lg border border-[#37558A]/50 bg-[#37558A]/25 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#37558A]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              View Help Center
            </Link>
            <Link
              href="/support#report"
              className="rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5 text-[11px] font-bold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              Report a Problem
            </Link>
            <Link
              href="/support#contact"
              className="rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5 text-[11px] font-bold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/60 px-4 py-3 text-center text-[11px] text-zinc-500 sm:px-5">
        444 Arena · Free Play Beta · No real money · No cash prizes
      </footer>
    </div>
    </HomeMobileShell>
  );
}
