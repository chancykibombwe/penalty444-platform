"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import RequireAuth from "../../../components/auth/RequireAuth";
import TournamentAdminActions from "../../../components/tournament/TournamentAdminActions";
import TournamentBracketPanel from "../../../components/tournament/TournamentBracketPanel";
import TournamentEntryActions from "../../../components/tournament/TournamentEntryActions";
import {
  formatTournamentStatus,
  statusBadgeClass,
} from "../../../components/tournament/TournamentListPanel";
import { resolveChampionName } from "../../../lib/tournament/champion";
import { useTournamentDetailSync } from "../../../lib/tournament/useTournamentDetailSync";
import { useTournamentRealtime } from "../../../lib/tournament/useTournamentRealtime";

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

  const { pendingMatchReady, matchReadyCountdown, enterPendingMatchNow } =
    useTournamentRealtime({
      tournamentId: tournament?.id ?? tournamentId,
      playerId: currentUserId,
    });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
            {pendingMatchReady ? (
              <div className="rounded-xl border-2 border-amber-400/60 bg-gradient-to-r from-amber-950/80 via-amber-900/40 to-zinc-950 px-4 py-4 shadow-lg shadow-amber-950/30">
                <p className="text-lg font-bold text-amber-50">
                  Your match is ready. Entering in{" "}
                  {matchReadyCountdown ??
                    Math.max(
                      1,
                      Math.ceil(pendingMatchReady.autoRouteInMs / 1000)
                    )}
                  …
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={enterPendingMatchNow}
                    className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-3 font-black text-zinc-950 hover:from-amber-400 hover:to-orange-500"
                  >
                    Enter Now
                  </button>
                </div>
              </div>
            ) : null}

            {tournament.status === "completed" && championName ? (
              <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/60 via-zinc-950 to-zinc-950 px-6 py-5 shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/20">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">
                  Champion
                </p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {championName}
                </p>
              </div>
            ) : null}

            <header
              className={`rounded-2xl border bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 ${
                tournament.status === "cancelled"
                  ? "border-red-500/40"
                  : "border-zinc-800"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-bold text-white">
                    {tournament.name}
                  </h1>
                  <p className="mt-2 text-sm text-zinc-400">
                    {tournament.format.replace("_", " ")} · up to{" "}
                    {tournament.max_players} players ·{" "}
                    {tournament.rounds_per_match} rounds per match
                  </p>
                  <p className="mt-2 text-xs font-bold text-amber-200/90">
                    {isHost ? (
                      <span className="uppercase tracking-widest">
                        HOSTED BY YOU
                      </span>
                    ) : (
                      <>
                        <span className="uppercase tracking-widest">
                          HOST:{" "}
                        </span>
                        <span className="text-amber-100">
                          {creatorUsername ?? "Host"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-bold tracking-wide shadow-md ${statusBadgeClass(tournament.status)}`}
                >
                  {formatTournamentStatus(tournament.status)}
                </span>
              </div>

              {tournament.status === "cancelled" ? (
                <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-200">
                  This tournament has been cancelled.
                </p>
              ) : null}

              {tournament.starts_at &&
              (tournament.status === "registration" ||
                tournament.status === "check_in") ? (
                <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/95">
                  Starts automatically at{" "}
                  {new Date(tournament.starts_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  . Register before the bracket opens.
                </p>
              ) : null}

              {myEntry?.status === "withdrawn" ? (
                <p className="mt-4 rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300">
                  You have withdrawn from this tournament.
                </p>
              ) : null}

              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-zinc-800/80 pt-4 text-sm">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Registered
                  </dt>
                  <dd className="mt-0.5 font-semibold text-white">
                    {registeredCount}
                    {tournament.max_players
                      ? ` / ${tournament.max_players}`
                      : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Ready
                  </dt>
                  <dd className="mt-0.5 font-semibold text-white">
                    {readyCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Starts
                  </dt>
                  <dd className="mt-0.5 font-semibold text-white">
                    {tournament.starts_at
                      ? new Date(tournament.starts_at).toLocaleString()
                      : "TBD"}
                  </dd>
                </div>
                {matches.length > 0 ? (
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      Bracket
                    </dt>
                    <dd className="mt-0.5 font-semibold text-white">
                      {matches.length} matches
                    </dd>
                  </div>
                ) : null}
              </dl>
            </header>

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
                />
              </>
            )}
          </>
        ) : null}
      </section>
    </RequireAuth>
  );
}
