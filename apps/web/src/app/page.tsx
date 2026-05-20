"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ActivityFeed from "../components/home/ActivityFeed";
import ContinuePlayingCard from "../components/home/ContinuePlayingCard";
import GameCard, {
  type GameCardData,
} from "../components/home/GameCard";
import HeroBanner from "../components/home/HeroBanner";
import HomeShared from "../components/home/HomeShared";
import HomeTournamentPreview from "../components/home/HomeTournamentPreview";
import PlayerStatsStrip from "../components/home/PlayerStatsStrip";
import QuickActionCard from "../components/home/QuickActionCard";
import { getCurrentPlayerIdentity } from "../lib/auth/playerIdentity";
import {
  getActiveMatch,
  type ActiveMatch,
} from "../lib/match/activeMatch";
import {
  getActiveTournament,
  subscribeActiveTournament,
  type ActiveTournament,
} from "../lib/tournament/activeTournament";

const MOCK_GAMES: GameCardData[] = [
  {
    id: "penalty444",
    title: "Penalty444",
    subtitle: "Football · Skill",
    playersOnline: 482,
    status: "live",
    featured: true,
    href: "/games/penalty444",
    icon: "⚽",
  },
  {
    id: "chess444",
    title: "Chess444",
    subtitle: "Strategy · Classic",
    playersOnline: 261,
    status: "soon",
    href: "/",
    icon: "♟",
    comingSoon: true,
  },
  {
    id: "draught444",
    title: "Draught444",
    subtitle: "Strategy · Board",
    playersOnline: 134,
    status: "preparing",
    href: "/",
    icon: "🪙",
    comingSoon: true,
  },
  {
    id: "crush444",
    title: "Crush444",
    subtitle: "Puzzle · Arcade",
    playersOnline: 318,
    status: "soon",
    href: "/",
    icon: "💥",
    comingSoon: true,
  },
];

export default function HomePage() {
  const [username, setUsername] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [activeTournament, setActiveTournament] =
    useState<ActiveTournament | null>(null);

  function refreshActiveMatch() {
    setActiveMatch(getActiveMatch());
  }

  useEffect(() => {
    let cancelled = false;

    void getCurrentPlayerIdentity().then((identity) => {
      if (cancelled) return;
      setUsername(identity?.username ?? null);
      setActiveTournament(
        getActiveTournament(identity?.playerId ?? undefined)
      );
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
          : "Head back when ready phase opens — keep your seat warm.",
        href: `/tournaments/${activeTournament.tournamentId}`,
        cta: "Resume Tournament",
        icon: "🏆",
      });
    }

    return cards;
  }, [activeMatch, activeTournament]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-1 pb-2 sm:px-2">
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
        className="grid gap-3 sm:grid-cols-2 sm:gap-4"
        aria-label="Quick actions"
      >
        <QuickActionCard
          title="Quick Match"
          subtitle="Find an opponent instantly"
          href="/lobby"
          cta="Find a match"
          icon="⚡"
          tone="cyan"
        />
        <QuickActionCard
          title="Create Room"
          subtitle="Challenge your friends"
          href="/lobby"
          cta="Create room"
          icon="🎯"
          tone="amber"
        />
      </section>

      <HomeTournamentPreview />

      <section aria-label="Games on 444 Arena">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
              Games
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-white sm:text-xl">
              Pick your arena
            </h2>
          </div>
          <Link
            href="/lobby"
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
          >
            Browse all →
          </Link>
        </div>

        <div className="home-game-scroll relative mt-3 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:gap-4">
          {MOCK_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      <PlayerStatsStrip username={username} />

      <ActivityFeed seeMoreHref="/tournaments" />

      <footer className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-4 py-3 text-center text-[11px] text-zinc-500 sm:px-5">
        444 Arena · Competitive multiplayer · Skill over luck
      </footer>
    </div>
  );
}
