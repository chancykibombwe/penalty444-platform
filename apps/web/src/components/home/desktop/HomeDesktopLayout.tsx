"use client";

import type { CompetitiveStats } from "../../../lib/player/stats";
import LoggedOutCta from "../../auth/LoggedOutCta";
import ContinuePlayingCard from "../ContinuePlayingCard";
import HeroBanner from "../HeroBanner";
import PlayerStatsStrip from "../PlayerStatsStrip";
import DesktopFeaturedGames from "./DesktopFeaturedGames";
import DesktopHeader from "./DesktopHeader";
import DesktopQuickActions from "./DesktopQuickActions";
import DesktopRightRail from "./DesktopRightRail";
import DesktopSidebar from "./DesktopSidebar";
import LeaderboardPanel from "./LeaderboardPanel";
import RecentMatchesPanel from "./RecentMatchesPanel";

/**
 * HomeDesktopLayout — locked Home Desktop V1 layout.
 *
 * Desktop-only: the whole tree is `hidden lg:block`, so the completed mobile
 * Home flow (PRs #169–#171, rendered by page.tsx below `lg`) is untouched at
 * 360 / 390 and on tablet. Three columns:
 *   • Left  — DesktopSidebar (contextual nav) + beta / free-play panel.
 *   • Main  — DesktopHeader, large hero, quick actions, featured games,
 *             player stats, then Recent Matches + Leaderboard panels.
 *   • Right — DesktopRightRail (Live Arena / Beta Challenges / Online Players
 *             / Invite Friends).
 *
 * Composition/layout only. It reuses existing Home sections and reads data
 * read-only through existing helpers; it never touches gameplay, sockets,
 * Supabase schema/RLS, auth, wallet/economy, or tournaments logic.
 */

export type DesktopContinueCard = {
  key: string;
  tone: "match" | "tournament";
  eyebrow: string;
  title: string;
  subtitle: string;
  href: string;
  cta: string;
  icon: string;
};

type Props = {
  playerStats: CompetitiveStats | null;
  continueCards: DesktopContinueCard[];
};

export default function HomeDesktopLayout({
  playerStats,
  continueCards,
}: Props) {
  return (
    <div className="hidden lg:block">
      <div className="mx-auto grid max-w-[1440px] grid-cols-[15rem_minmax(0,1fr)_19rem] items-start gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        {/* ── LEFT: sidebar + beta panel (sticky) ── */}
        <div className="sticky top-6 space-y-4">
          <DesktopSidebar />
        </div>

        {/* ── MAIN column ── */}
        <div className="min-w-0 space-y-6">
          <DesktopHeader />

          <HeroBanner primaryHref="/lobby" secondaryHref="/tournaments" />

          {/* Logged-out entry points (renders nothing once signed in). */}
          <LoggedOutCta variant="hero" className="-mt-2" />

          <DesktopQuickActions />

          {continueCards.length > 0 ? (
            <section
              className="grid gap-3 xl:grid-cols-2"
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

          <DesktopFeaturedGames />

          <PlayerStatsStrip stats={playerStats} />

          {/* Recent matches + leaderboard side by side. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <RecentMatchesPanel />
            <LeaderboardPanel />
          </div>
        </div>

        {/* ── RIGHT rail ── */}
        <DesktopRightRail />
      </div>
    </div>
  );
}
