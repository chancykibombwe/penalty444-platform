"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../../../components/auth/RequireAuth";
import TournamentAdminActions from "../../../components/tournament/TournamentAdminActions";
import TournamentBracketPanel, {
  computeParticipantTournamentResult,
  computePlayerBracketState,
} from "../../../components/tournament/TournamentBracketPanel";
import TournamentEntryActions from "../../../components/tournament/TournamentEntryActions";
import TournamentLiveFeed from "../../../components/tournament/TournamentLiveFeed";
import TournamentLiveNow from "../../../components/tournament/TournamentLiveNow";
import TournamentPresenceCard from "../../../components/tournament/TournamentPresenceCard";
import TournamentSummaryStats from "../../../components/tournament/TournamentSummaryStats";
import TournamentWaitingRoom from "../../../components/tournament/TournamentWaitingRoom";
import TournamentLiveSpotlight from "../../../components/live/TournamentLiveSpotlight";
import {
  deriveTournamentWaitingRoomState,
  getPlayerRoundLabel,
  getTournamentTotalRounds,
} from "../../../lib/tournament/playerWaitingRoom";
import { resolveChampionName } from "../../../lib/tournament/champion";
import { useTournamentDetailSync } from "../../../lib/tournament/useTournamentDetailSync";
import { useTournamentRealtime } from "../../../lib/tournament/useTournamentRealtime";
import {
  derivePlayerPresence,
  deriveTournamentSummary,
  getPresenceLabel,
  getPresenceToneClass,
} from "../../../lib/tournament/tournamentPresence";
import {
  getEventSubtitle,
  getTournamentStateBadge,
  getTournamentTier,
} from "../../../lib/tournament/tournamentBranding";
import {
  clearActiveTournamentIfMatches,
  clearActiveTournamentIfPlayerMismatch,
  saveActiveTournament,
  type ActiveTournamentState,
} from "../../../lib/tournament/activeTournament";
import {
  clearActiveMatch,
  getActiveMatch,
} from "../../../lib/match/activeMatch";

function formatCountdown(targetIso: string | null, nowMs: number): string | null {
  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) return null;
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TournamentDetailPage() {
  const params = useParams();
  const tournamentId =
    typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const {
    tournament,
    entries,
    matches,
    currentUserId,
    creatorUsername,
    loading,
    error,
    refresh,
  } = useTournamentDetailSync(tournamentId);

  // Computed below from bracket state; passed back into the realtime hook so
  // missed `tournament:matchReady` socket events still trigger the auto-enter
  // banner & countdown. See effect comments further down.
  const [autoRouteFallback, setAutoRouteFallback] = useState<{
    tournamentId: string;
    tournamentMatchId: string;
    roomCode: string;
  } | null>(null);

  const { pendingMatchReady, matchReadyCountdown, enterPendingMatchNow } =
    useTournamentRealtime({
      tournamentId: tournament?.id ?? tournamentId,
      playerId: currentUserId,
      fallbackReady: autoRouteFallback,
    });

  useEffect(() => {
    // Shared debounce for both visibility and focus paths so a tab-switch
    // (which may fire both events) only triggers one refresh.
    const REFRESH_DEBOUNCE_MS = 1_500;
    let lastRefreshAt = 0;

    function maybeRefresh() {
      const now = Date.now();
      if (now - lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
      lastRefreshAt = now;
      refresh();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        maybeRefresh();
      }
    };

    // window.focus covers returning from another app or from a match page
    // in a second window — cases where visibilitychange alone doesn't fire.
    const handleFocus = () => {
      maybeRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refresh]);

  const activeEntries = useMemo(
    () => entries.filter((entry) => entry.status !== "withdrawn"),
    [entries]
  );

  const checkedInEntries = useMemo(
    () => entries.filter((entry) => entry.status === "checked_in"),
    [entries]
  );

  const myEntry = useMemo(() => {
    if (!currentUserId) return null;
    return entries.find((entry) => entry.user_id === currentUserId) ?? null;
  }, [entries, currentUserId]);

  const registeredCount = activeEntries.length;

  const isHost =
    Boolean(currentUserId) &&
    tournament != null &&
    currentUserId === tournament.created_by;

  const bracketFirst =
    tournament != null &&
    (tournament.status === "in_progress" || matches.length > 0);

  const readyCount = checkedInEntries.length;

  const championName = useMemo(() => {
    if (!tournament) return null;
    return resolveChampionName(tournament, matches, entries);
  }, [tournament, matches, entries]);

  const myEntryId = myEntry?.id ?? null;
  const myEntryActive = myEntry != null && myEntry.status !== "withdrawn";
  const tournamentInProgress = tournament?.status === "in_progress";

  const presence = useMemo(
    () =>
      tournament
        ? derivePlayerPresence({
            tournamentStatus: tournament.status,
            myEntry,
            matches,
            championUserId: tournament.winner_id,
            currentUserId,
          })
        : "VIEWING",
    [tournament, myEntry, matches, currentUserId]
  );

  const totalBracketRounds = useMemo(
    () => getTournamentTotalRounds(matches),
    [matches]
  );

  const playerRoundLabel = useMemo(
    () => (myEntry ? getPlayerRoundLabel(myEntry.id, matches) : null),
    [myEntry, matches]
  );

  const tournamentSummary = useMemo(
    () =>
      tournament
        ? deriveTournamentSummary({
            tournamentStatus: tournament.status,
            entries,
            matches,
          })
        : null,
    [tournament, entries, matches]
  );

  const presenceRoundLabel =
    playerRoundLabel ?? tournamentSummary?.currentRoundLabel ?? null;

  const tournamentTier = useMemo(
    () => getTournamentTier(tournament?.max_players ?? null),
    [tournament?.max_players]
  );

  const tournamentStateBadge = useMemo(
    () =>
      tournament
        ? getTournamentStateBadge(tournament.status, {
            hasChampion: Boolean(championName),
          })
        : null,
    [tournament, championName]
  );

  const tournamentSubtitle = useMemo(
    () =>
      tournament
        ? getEventSubtitle({
            tier: tournamentTier,
            format: tournament.format,
            status: tournament.status,
            championName,
          })
        : null,
    [tournament, tournamentTier, championName]
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const startsAt = tournament?.starts_at ?? null;
  const startsCountdown = useMemo(
    () =>
      tournament?.status === "registration" || tournament?.status === "check_in"
        ? formatCountdown(startsAt, nowMs)
        : null,
    [tournament?.status, startsAt, nowMs]
  );

  useEffect(() => {
    if (!startsCountdown) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startsCountdown]);

  // Persistent active-tournament snapshot. Mirrors the activeMatch system so a
  // refresh / tab-close / nav-away always restores a clear Resume Tournament
  // CTA on the tournaments list page.
  useEffect(() => {
    if (!tournament) return;
    if (!currentUserId) return;

    // Wipe any leftover snapshot bound to a different account before deciding.
    clearActiveTournamentIfPlayerMismatch(currentUserId);

    const status = tournament.status;
    const userIsActiveParticipant =
      myEntry != null && myEntry.status !== "withdrawn";

    // Terminal states or non-participation = no snapshot for this tournament.
    if (
      status === "completed" ||
      status === "cancelled" ||
      !userIsActiveParticipant
    ) {
      clearActiveTournamentIfMatches(tournament.id);
      return;
    }

    // Only meaningful lifecycle states are persisted.
    let lastKnownState: ActiveTournamentState;
    if (status === "registration") lastKnownState = "registration";
    else if (status === "check_in") lastKnownState = "check_in";
    else if (status === "in_progress") lastKnownState = "in_progress";
    else lastKnownState = "unknown";

    saveActiveTournament({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      playerId: currentUserId,
      lastKnownState,
      tierLabel: tournamentTier.label,
    });
  }, [
    tournament,
    currentUserId,
    myEntry,
    tournamentTier.label,
  ]);

  // If the user becomes a champion or the tournament finishes, drop the
  // snapshot proactively even before the effect above re-evaluates.
  useEffect(() => {
    if (!tournament) return;
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      clearActiveTournamentIfMatches(tournament.id);
    }
  }, [tournament]);

  const playerBracketState = useMemo(
    () =>
      computePlayerBracketState(
        matches,
        myEntryId,
        myEntryActive,
        Boolean(tournamentInProgress)
      ),
    [matches, myEntryId, myEntryActive, tournamentInProgress]
  );

  const participantResult = useMemo(
    () =>
      tournament
        ? computeParticipantTournamentResult(
            tournament.status,
            matches,
            myEntryId,
            myEntryActive,
            championName
          )
        : null,
    [tournament, matches, myEntryId, myEntryActive, championName]
  );

  // Derived auto-route fallback: a non-terminal participant match with a
  // server-assigned room_code that we should be routed into. The realtime
  // hook activates this after a short delay if no live event arrived.
  const derivedFallbackReady = useMemo(() => {
    if (!tournament || tournament.status !== "in_progress") return null;
    if (!myEntryActive || !myEntryId) return null;

    const target =
      playerBracketState.joinMatch ?? playerBracketState.readyMatch ?? null;
    if (!target) return null;
    if (!target.room_code) return null;

    return {
      tournamentId: tournament.id,
      tournamentMatchId: target.id,
      roomCode: target.room_code,
    };
  }, [
    tournament,
    myEntryActive,
    myEntryId,
    playerBracketState.joinMatch,
    playerBracketState.readyMatch,
  ]);

  useEffect(() => {
    setAutoRouteFallback((previous) => {
      if (!derivedFallbackReady) {
        return previous === null ? previous : null;
      }
      if (
        previous &&
        previous.tournamentMatchId === derivedFallbackReady.tournamentMatchId &&
        previous.roomCode === derivedFallbackReady.roomCode &&
        previous.tournamentId === derivedFallbackReady.tournamentId
      ) {
        return previous;
      }
      return derivedFallbackReady;
    });
  }, [derivedFallbackReady]);

  // Completion-state cleanup: when the tournament is done, drop any
  // activeMatch snapshot still pointing at one of this tournament's rooms.
  // (Cross-tournament activeMatch entries are left alone.)
  useEffect(() => {
    if (!tournament) return;
    if (tournament.status !== "completed" && tournament.status !== "cancelled") {
      return;
    }
    if (typeof window === "undefined") return;

    const active = getActiveMatch();
    if (!active?.roomCode) return;

    const matchesThisTournament = matches.some(
      (match) =>
        match.room_code &&
        match.room_code.trim().toUpperCase() === active.roomCode
    );

    if (matchesThisTournament) {
      console.info(
        "[CompletionState] clearing activeMatch for finished tournament",
        tournament.id,
        "room=",
        active.roomCode
      );
      clearActiveMatch();
    }
  }, [tournament, matches]);

  const showWaitingRoom = useMemo(() => {
    if (!tournament || !myEntryActive) {
      return false;
    }

    return (
      deriveTournamentWaitingRoomState({
        tournamentStatus: tournament.status,
        matches,
        myEntry,
        championName,
        participantHeadline: participantResult?.headline ?? null,
        participantDetail: participantResult?.detail,
        hasReadyMatch: Boolean(playerBracketState.readyMatch),
        hasJoinMatch: Boolean(playerBracketState.joinMatch),
        hasActivePlayableMatch: playerBracketState.hasActivePlayableMatch,
        advancedByBye: playerBracketState.advancedByBye,
        pendingRealtimeReady: Boolean(pendingMatchReady),
      }).kind !== "hidden"
    );
  }, [
    tournament,
    matches,
    myEntry,
    myEntryActive,
    championName,
    participantResult,
    playerBracketState,
    pendingMatchReady,
  ]);

  return (
    <RequireAuth>
      <section className="space-y-8">
        <div>
          <Link
            href="/tournaments"
            className="text-sm font-semibold text-amber-300/80 hover:text-amber-200"
          >
            ← All tournaments
          </Link>
        </div>

        {loading ? (
          <p className="text-zinc-400">Loading tournament...</p>
        ) : error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-red-200">
            {error}
          </div>
        ) : tournament ? (
          <>
            <TournamentWaitingRoom
              tournamentId={tournament.id}
              tournamentStatus={tournament.status}
              tournamentName={tournament.name}
              tournamentTierLabel={tournamentTier.label}
              matches={matches}
              myEntry={myEntry}
              championName={championName}
              participantHeadline={participantResult?.headline ?? null}
              participantDetail={participantResult?.detail}
              readyMatch={playerBracketState.readyMatch}
              joinMatch={playerBracketState.joinMatch}
              hasActivePlayableMatch={
                playerBracketState.hasActivePlayableMatch
              }
              advancedByBye={playerBracketState.advancedByBye}
              pendingMatchReady={pendingMatchReady}
              matchReadyCountdown={matchReadyCountdown}
              onEnterPendingMatch={enterPendingMatchNow}
              onUpdated={refresh}
            />

            <header
              className={`relative overflow-hidden rounded-3xl border-2 bg-gradient-to-br from-black via-zinc-950 to-zinc-900 p-4 shadow-2xl sm:p-6 ${
                tournament.status === "cancelled"
                  ? "border-red-500/45"
                  : tournamentInProgress
                    ? `border-cyan-500/45 ring-1 ${tournamentTier.ringClass} ${tournamentTier.glowClass}`
                    : tournament.status === "completed"
                      ? "border-yellow-300/40 ring-1 ring-yellow-500/15 shadow-[0_0_36px_rgba(234,179,8,0.16)]"
                      : `border-zinc-800 ring-1 ${tournamentTier.ringClass}`
              }`}
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full blur-3xl opacity-30 ${
                  tournamentInProgress
                    ? "bg-cyan-500/30"
                    : tournament.status === "completed"
                      ? "bg-yellow-500/25"
                      : tournament.status === "cancelled"
                        ? "bg-red-500/20"
                        : tournamentTier.id === "elite"
                          ? "bg-fuchsia-500/25"
                          : tournamentTier.id === "major"
                            ? "bg-orange-500/25"
                            : tournamentTier.id === "arena"
                              ? "bg-amber-500/20"
                              : tournamentTier.id === "knockout"
                                ? "bg-cyan-500/20"
                                : "bg-sky-500/20"
                }`}
              />

              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${tournamentTier.pillClass}`}
                    >
                      🏟 {tournamentTier.label}
                    </span>
                    {tournamentStateBadge ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${tournamentStateBadge.className}`}
                      >
                        {tournamentStateBadge.pulse ? (
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90" />
                        ) : null}
                        {tournamentStateBadge.label}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200">
                      {tournamentTier.capacityLabel}
                    </span>
                    {myEntry ? (
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${getPresenceToneClass(
                          presence
                        )}`}
                      >
                        {getPresenceLabel(presence)}
                      </span>
                    ) : null}
                    {isHost ? (
                      <span className="inline-flex items-center rounded-full border border-amber-500/45 bg-amber-950/40 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
                        Host: You
                      </span>
                    ) : creatorUsername ? (
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
                        Host · {creatorUsername}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500 sm:text-[11px]">
                    Tournament
                  </p>
                  <h1
                    className={`mt-1 break-words text-3xl font-black tracking-tight sm:text-4xl md:text-5xl ${
                      tournament.status === "completed"
                        ? "bg-gradient-to-r from-yellow-200 via-amber-200 to-yellow-100 bg-clip-text text-transparent"
                        : "text-white"
                    }`}
                  >
                    {tournament.name}
                  </h1>
                  {tournamentSubtitle ? (
                    <p className="mt-1.5 text-xs text-zinc-400 sm:text-sm">
                      {tournamentSubtitle}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-zinc-500 sm:text-xs">
                    {tournament.rounds_per_match} rounds per match
                  </p>
                </div>

                {startsCountdown ? (
                  <div className="shrink-0 rounded-2xl border border-amber-400/45 bg-amber-950/40 px-4 py-3 text-center shadow-lg">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/90">
                      Starts in
                    </p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-amber-100 sm:text-3xl">
                      {startsCountdown}
                    </p>
                  </div>
                ) : null}
              </div>

              {tournament.status === "cancelled" ? (
                <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-200">
                  This tournament has been cancelled.
                </p>
              ) : null}

              {tournament.starts_at &&
              (tournament.status === "registration" ||
                tournament.status === "check_in") ? (
                <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-xs text-amber-100/95 sm:text-sm">
                  Scheduled for{" "}
                  {new Date(tournament.starts_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  . The host will start the bracket when players are ready.
                </p>
              ) : null}

              {myEntry?.status === "withdrawn" ? (
                <p className="mt-4 rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300">
                  You have withdrawn from this tournament.
                </p>
              ) : null}

              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-4 sm:gap-4">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
                    Registered
                  </dt>
                  <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
                    {registeredCount}
                    {tournament.max_players ? (
                      <span className="ml-1 text-sm font-bold text-zinc-500">
                        / {tournament.max_players}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
                    Ready
                  </dt>
                  <dd className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
                    {readyCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
                    {tournamentInProgress
                      ? "Current round"
                      : tournament.status === "completed"
                        ? "Rounds played"
                        : "Bracket"}
                  </dt>
                  <dd className="mt-1 text-lg font-black text-white sm:text-xl">
                    {tournamentInProgress && playerRoundLabel
                      ? playerRoundLabel
                      : matches.length > 0
                        ? totalBracketRounds > 0
                          ? `${totalBracketRounds} rounds`
                          : `${matches.length} matches`
                        : "Not yet drawn"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
                    {tournamentInProgress
                      ? "Live since"
                      : tournament.status === "completed"
                        ? "Finished"
                        : "Starts"}
                  </dt>
                  <dd className="mt-1 text-sm font-bold text-white sm:text-base">
                    {tournamentInProgress
                      ? tournament.starts_at
                        ? new Date(tournament.starts_at).toLocaleTimeString(
                            undefined,
                            { hour: "2-digit", minute: "2-digit" }
                          )
                        : "—"
                      : tournament.status === "completed"
                        ? new Date(tournament.updated_at).toLocaleDateString(
                            undefined,
                            { dateStyle: "medium" }
                          )
                        : tournament.starts_at
                          ? new Date(tournament.starts_at).toLocaleString(
                              undefined,
                              { dateStyle: "medium", timeStyle: "short" }
                            )
                          : "TBD"}
                  </dd>
                </div>
              </dl>
            </header>

            {tournament.status !== "cancelled" ? (
              <TournamentPresenceCard
                presence={presence}
                tournamentStatus={tournament.status}
                hasReadyMatch={Boolean(playerBracketState.readyMatch)}
                currentRoundLabel={presenceRoundLabel}
                hideWhenViewing={!myEntry}
              />
            ) : null}

            {tournament.status !== "cancelled" ? (
              <TournamentSummaryStats
                tournamentStatus={tournament.status}
                entries={entries}
                matches={matches}
                championName={championName}
              />
            ) : null}

            {tournamentInProgress ? (
              <>
                <TournamentLiveSpotlight
                  tournamentId={tournament.id}
                  tournamentName={tournament.name}
                  matches={matches}
                  entries={entries}
                />
                <TournamentLiveNow entries={entries} matches={matches} />
              </>
            ) : null}

            {bracketFirst ? (
              <>
                <TournamentBracketPanel
                  tournamentId={tournament.id}
                  tournamentStatus={tournament.status}
                  matches={matches}
                  entries={entries}
                  currentUserId={currentUserId}
                  onUpdated={refresh}
                  prominent
                  suppressWaitingBanners={showWaitingRoom}
                  maxPlayers={tournament.max_players}
                />
                {tournament.status !== "cancelled" ? (
                  <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <h2 className="text-base font-bold text-white">
                      Participation
                    </h2>
                    <div className="mt-3">
                      <TournamentEntryActions
                        tournament={tournament}
                        currentUserId={currentUserId}
                        myEntry={myEntry}
                        registeredCount={registeredCount}
                        onUpdated={refresh}
                      />
                    </div>
                  </section>
                ) : null}
                <TournamentAdminActions
                  tournament={tournament}
                  currentUserId={currentUserId}
                  checkedInEntries={checkedInEntries}
                  existingMatchCount={matches.length}
                  onUpdated={refresh}
                />
              </>
            ) : (
              <>
                {tournament.status !== "cancelled" ? (
                  <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                    <h2 className="text-lg font-bold text-white">
                      Participation
                    </h2>
                    <div className="mt-3">
                      <TournamentEntryActions
                        tournament={tournament}
                        currentUserId={currentUserId}
                        myEntry={myEntry}
                        registeredCount={registeredCount}
                        onUpdated={refresh}
                      />
                    </div>
                  </section>
                ) : null}
                <TournamentAdminActions
                  tournament={tournament}
                  currentUserId={currentUserId}
                  checkedInEntries={checkedInEntries}
                  existingMatchCount={matches.length}
                  onUpdated={refresh}
                />
                <TournamentBracketPanel
                  tournamentId={tournament.id}
                  tournamentStatus={tournament.status}
                  matches={matches}
                  entries={entries}
                  currentUserId={currentUserId}
                  onUpdated={refresh}
                  suppressWaitingBanners={showWaitingRoom}
                  maxPlayers={tournament.max_players}
                />
              </>
            )}

            <TournamentLiveFeed
              tournament={tournament}
              entries={entries}
              matches={matches}
            />
          </>
        ) : null}
      </section>
    </RequireAuth>
  );
}
