"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AchievementGrid from "../../../components/player/AchievementGrid";
import CompetitiveProfileCard from "../../../components/player/CompetitiveProfileCard";
import RecentForm from "../../../components/player/RecentForm";
import TrophiesPreview from "../../../components/player/TrophiesPreview";
import HeadToHeadSummary from "../../../components/social/HeadToHeadSummary";
import PresenceBadge from "../../../components/social/PresenceBadge";
import RivalCard from "../../../components/social/RivalCard";
import {
  AddRivalButton,
  ChallengePlayerButton,
  ViewProfileButton,
} from "../../../components/social/SocialActions";
import { getCurrentPlayerIdentity } from "../../../lib/auth/playerIdentity";
import {
  fetchHeadToHead,
  type HeadToHead,
} from "../../../lib/social/rivals";
import {
  fetchPublicProfile,
  type ProfileRecentMatch,
  type PublicProfile,
} from "../../../lib/social/profile";
import { derivePresence } from "../../../lib/social/presence";
import { supabase } from "../../../lib/supabase/client";

/**
 * /profile/[username] — public read-only player profile.
 *
 * Reuses the existing competitive identity components so the profile feels
 * native to the rest of the platform. When the viewer is looking at SOMEONE
 * ELSE's profile, we additionally render a head-to-head summary (read-only,
 * derived from match history) and social CTAs (View / Challenge / Add
 * Rival).
 */
export default function PlayerProfilePage() {
  const params = useParams();
  const usernameParam = useMemo(() => {
    const raw =
      typeof params.username === "string"
        ? params.username
        : Array.isArray(params.username)
          ? params.username[0]
          : "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [params.username]);

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(
    undefined
  );
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [head, setHead] = useState<HeadToHead | null>(null);

  // Load viewer identity (best-effort) so we know if this is a self-view.
  useEffect(() => {
    let cancelled = false;
    void getCurrentPlayerIdentity().then((identity) => {
      if (cancelled) return;
      setViewerUserId(identity?.playerId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the public profile by username.
  useEffect(() => {
    if (!usernameParam) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfile(undefined);
    void (async () => {
      const next = await fetchPublicProfile(supabase, usernameParam);
      if (cancelled) return;
      setProfile(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [usernameParam]);

  // Load head-to-head when viewing someone else's profile.
  useEffect(() => {
    if (!profile || !viewerUserId) {
      setHead(null);
      return;
    }
    if (profile.userId === viewerUserId) {
      setHead(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await fetchHeadToHead(
        supabase,
        viewerUserId,
        profile.userId,
        profile.username
      );
      if (cancelled) return;
      setHead(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, viewerUserId]);

  if (profile === undefined) {
    return <ProfileSkeleton />;
  }

  if (profile === null) {
    return <ProfileNotFound usernameParam={usernameParam} />;
  }

  const isSelf = viewerUserId !== null && viewerUserId === profile.userId;
  const presenceState = derivePresence({
    matchesPlayed: profile.stats.matches,
    lastMatchAt: profile.recentMatches[0]?.finishedAt ?? null,
  });

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-1 pb-6 sm:px-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/leaderboard"
          className="text-sm font-semibold text-cyan-300/85 hover:text-cyan-200"
        >
          ← Leaderboard
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <PresenceBadge state={presenceState} size="md" />
          {!isSelf ? (
            <>
              <ChallengePlayerButton username={profile.username} size="md" />
              <AddRivalButton size="md" />
            </>
          ) : (
            <ViewProfileButton
              username={profile.username}
              size="md"
              label="Share Profile"
            />
          )}
        </div>
      </div>

      <CompetitiveProfileCard
        username={profile.username}
        stats={profile.stats}
        subline={isSelf ? "Your competitive identity" : "Competitor"}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <RecentForm form={profile.recentForm} />
        <TrophiesPreview count={profile.stats.tournamentWins ?? 0} />
      </div>

      {head && !isSelf ? (
        <section
          className="rounded-3xl border border-rose-400/40 bg-rose-500/5 p-4 shadow-xl sm:p-5"
          aria-label="Head-to-head with this player"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/55 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-rose-100">
              <span aria-hidden>⚔</span>
              Head-to-head
            </span>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              From match history
            </p>
          </div>
          {head.totalMatches === 0 ? (
            <p className="mt-3 text-sm font-semibold text-zinc-300">
              You haven&apos;t faced {profile.username} yet. Time to make a
              rivalry.
            </p>
          ) : (
            <div className="mt-3">
              <HeadToHeadSummary head={head} />
            </div>
          )}
        </section>
      ) : null}

      {isSelf ? <RivalCard viewerUserId={viewerUserId} /> : null}

      <RecentMatchesPanel
        matches={profile.recentMatches}
        ownerUsername={profile.username}
      />

      <AchievementGrid stats={profile.stats} limit={6} />

      <ChampionsPanel championships={profile.championships} />
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Sub-components
 * ----------------------------------------------------------------------- */

function RecentMatchesPanel({
  matches,
  ownerUsername,
}: {
  matches: ProfileRecentMatch[];
  ownerUsername: string;
}) {
  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-xl sm:p-5"
      aria-label="Recent matches"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-black tracking-tight text-white sm:text-lg">
          Recent matches
        </h2>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Last {matches.length || 0} played
        </p>
      </div>
      {matches.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          {ownerUsername} hasn&apos;t played any matches yet.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {matches.map((match) => (
            <RecentMatchRow key={match.key} match={match} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentMatchRow({ match }: { match: ProfileRecentMatch }) {
  const resultPillClass =
    match.result === "W"
      ? "border-emerald-400/55 bg-emerald-500/15 text-emerald-100"
      : match.result === "L"
        ? "border-rose-400/55 bg-rose-500/15 text-rose-100"
        : "border-zinc-700 bg-zinc-900/70 text-zinc-200";

  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-black ${resultPillClass}`}
        >
          {match.result}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            vs{" "}
            <Link
              href={`/profile/${encodeURIComponent(match.opponentUsername)}`}
              className="hover:text-cyan-200"
            >
              {match.opponentUsername}
            </Link>
          </p>
          <p className="text-[11px] text-zinc-500">
            {match.isTournament ? "Tournament" : "Casual"} ·{" "}
            {match.scoreFor} – {match.scoreAgainst}
          </p>
        </div>
      </div>
      {match.roomCode ? (
        <Link
          href={`/watch/${match.roomCode.toUpperCase()}`}
          className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-cyan-400/45 hover:text-cyan-100"
        >
          Recap
        </Link>
      ) : null}
    </li>
  );
}

function ChampionsPanel({
  championships,
}: {
  championships: PublicProfile["championships"];
}) {
  if (championships.length === 0) return null;
  return (
    <section
      className="rounded-3xl border border-yellow-300/40 bg-yellow-500/5 p-4 shadow-xl sm:p-5"
      aria-label="Tournament championships"
    >
      <h2 className="text-base font-black tracking-tight text-yellow-100 sm:text-lg">
        🏆 Tournament championships
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {championships.map((trophy) => (
          <li
            key={trophy.id}
            className="rounded-2xl border border-yellow-300/35 bg-black/35 px-3 py-2"
          >
            <Link
              href={`/tournaments/${trophy.id}`}
              className="block transition-colors hover:text-yellow-100"
            >
              <p className="truncate text-sm font-bold text-white">
                {trophy.name}
              </p>
              {trophy.finishedAt ? (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-yellow-200/80">
                  {new Date(trophy.finishedAt).toLocaleDateString()}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileSkeleton() {
  return (
    <section
      className="mx-auto max-w-5xl space-y-6 px-1 pb-6 sm:px-2"
      aria-hidden
    >
      <div className="h-6 w-32 animate-pulse rounded bg-zinc-800/60" />
      <div className="h-44 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/70" />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="h-24 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/70" />
        <div className="h-24 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/70" />
      </div>
      <div className="h-40 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/70" />
    </section>
  );
}

function ProfileNotFound({ usernameParam }: { usernameParam: string }) {
  return (
    <section className="mx-auto max-w-2xl space-y-4 px-1 pb-6 sm:px-2">
      <div className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black px-5 py-10 text-center shadow-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
          Profile
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
          Competitor not found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          That arena profile is not available yet.
        </p>
        {usernameParam ? (
          <p className="mt-3 text-[11px] font-mono text-zinc-500">
            @{usernameParam}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/leaderboard"
            className="rounded-xl border border-cyan-500/45 bg-cyan-500/10 px-3 py-2 text-xs font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20"
          >
            Browse leaderboard
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-200 hover:border-cyan-400/45 hover:text-cyan-100"
          >
            Back home
          </Link>
        </div>
      </div>
    </section>
  );
}
