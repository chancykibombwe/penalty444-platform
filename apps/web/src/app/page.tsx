"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ContinuePlayingCard from "../components/home/ContinuePlayingCard";
import GameCard, {
  type GameCardData,
} from "../components/home/GameCard";
import HeroBanner from "../components/home/HeroBanner";
import HomeShared from "../components/home/HomeShared";
import HomeTournamentPreview from "../components/home/HomeTournamentPreview";
import PlayerStatsStrip from "../components/home/PlayerStatsStrip";
import QuickActionCard from "../components/home/QuickActionCard";
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

const ARENA_GAMES: GameCardData[] = [
  {
    id: "penalty444",
    title: "Penalty444",
    subtitle: "Football · Skill",
    status: "live",
    featured: true,
    href: "/games/penalty444",
    icon: "⚽",
  },
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

      // Best-effort home stats lookup. Failure is silent so the home page
      // never blocks on a missing row — the strip renders Unranked safely.
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
    <div className="mx-auto max-w-6xl space-y-3 pb-2">
      <HomeShared />

      <HeroBanner primaryHref="/lobby" secondaryHref="/tournaments" />

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

      <section
        className="grid grid-cols-2 gap-2 sm:gap-4"
        aria-label="Quick actions"
      >
        <QuickActionCard
          title="Enter Lobby"
          subtitle="Find an open game or create a private room"
          href="/lobby"
          cta="Play Free"
          icon="⚡"
          tone="cyan"
        />
        <QuickActionCard
          title="How to Play"
          subtitle="Rules, tips, and beta overview"
          href="/how-to-play"
          cta="Learn"
          icon="📖"
          tone="amber"
        />
      </section>

      <section aria-label="How the beta works">
        <button
          type="button"
          onClick={() => setHowItWorksOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={howItWorksOpen}
        >
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
            How It Works
          </p>
          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300/80">
            Free Play Beta
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="ml-auto h-3 w-3 shrink-0 text-zinc-500 transition-transform"
            style={{ transform: howItWorksOpen ? "rotate(180deg)" : "rotate(0deg)" }}
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

      <section aria-label="Need Help?">
        <div
          className="rounded-2xl px-4 py-4"
          style={{
            background: "rgba(10,14,26,0.95)",
            border: "1px solid rgba(55,85,160,0.35)",
          }}
        >
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
            Support
          </p>
          <p className="mt-1 text-sm font-black text-white">Need Help?</p>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
            Browse the Help Center, report a bug, or reach out directly.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/support"
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
              style={{
                background: "rgba(55,85,160,0.28)",
                border: "1px solid rgba(55,85,160,0.50)",
              }}
            >
              View Help Center
            </Link>
            <Link
              href="/support#report"
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-zinc-300"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              Report a Problem
            </Link>
            <Link
              href="/support#contact"
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-zinc-300"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              Contact Support
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Games on 444 Arena">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
            Games
          </p>
          <Link
            href="/lobby"
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
          >
            Browse all →
          </Link>
        </div>

        <p className="mt-1 hidden text-xs text-zinc-400 sm:block">
          Free Play — no real money, no entry fees.
        </p>

        <div className="home-game-scroll relative mt-2 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1.5 sm:gap-4">
          {ARENA_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      <PlayerStatsStrip stats={playerStats} />

      <HomeTournamentPreview />

      <PlatformLiveStatus />

      <FeaturedLiveMatches />

      <LiveMatchPreview />

      <FeaturedPlayers />

      <PlayerMomentsStrip />

      <GlobalActivityFeed seeMoreHref="/tournaments" />

      <section aria-label="News and Announcements">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
            News &amp; Announcements
          </p>
          <Link
            href="/news"
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
          >
            See all →
          </Link>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {NEWS_ITEMS.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="rounded-xl px-3 py-2.5"
              style={{
                background: "rgba(10,14,26,0.90)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]"
                  style={{
                    background: "rgba(55,85,160,0.20)",
                    border: "1px solid rgba(55,85,160,0.35)",
                    color: "rgba(148,163,255,0.90)",
                  }}
                >
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

      <footer className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/60 px-4 py-3 text-center text-[11px] text-zinc-500 sm:px-5">
        444 Arena · Competitive multiplayer · Skill over luck
      </footer>
    </div>
  );
}
