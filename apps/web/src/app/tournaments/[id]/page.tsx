"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAuth from "../../../components/auth/RequireAuth";
import TournamentAdminActions from "../../../components/tournament/TournamentAdminActions";
import TournamentBracketPanel, {
  type TournamentMatchRow,
} from "../../../components/tournament/TournamentBracketPanel";
import TournamentEntryActions from "../../../components/tournament/TournamentEntryActions";
import type {
  TournamentEntryRow,
  TournamentRow,
} from "../../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../../../lib/auth/playerIdentity";
import { supabase } from "../../../lib/supabase/client";

function statusBadgeClass(status: string) {
  switch (status) {
    case "registration":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "check_in":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "in_progress":
      return "border-cyan-500/40 bg-cyan-950/30 text-cyan-200";
    case "completed":
      return "border-zinc-500/40 bg-zinc-800/50 text-zinc-300";
    case "cancelled":
      return "border-red-500/40 bg-red-950/30 text-red-200";
    default:
      return "border-zinc-600/40 bg-zinc-900 text-zinc-400";
  }
}

export default function TournamentDetailPage() {
  const params = useParams();
  const tournamentId =
    typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [entries, setEntries] = useState<TournamentEntryRow[]>([]);
  const [matches, setMatches] = useState<TournamentMatchRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tournamentId) {
        setError("Missing tournament id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setCreatorUsername(null);

      const identity = await getCurrentPlayerIdentity();
      if (!cancelled) {
        setCurrentUserId(identity?.playerId ?? null);
      }

      const { data: tournamentRow, error: tournamentError } = await supabase
        .from("tournaments")
        .select(
          "id, game_id, name, status, format, max_players, rounds_per_match, created_by, starts_at, created_at"
        )
        .eq("id", tournamentId)
        .maybeSingle();

      if (cancelled) return;

      if (tournamentError) {
        setError(tournamentError.message);
        setLoading(false);
        return;
      }

      if (!tournamentRow) {
        setError("Tournament not found.");
        setLoading(false);
        return;
      }

      const [entriesResult, matchesResult] = await Promise.all([
        supabase
          .from("tournament_entries")
          .select(
            "id, tournament_id, user_id, username, status, checked_in_at"
          )
          .eq("tournament_id", tournamentId)
          .order("checked_in_at", { ascending: true, nullsFirst: false }),
        supabase
          .from("tournament_matches")
          .select(
            "id, tournament_id, round_number, slot_index, entry_one_id, entry_two_id, room_code, status, winner_entry_id, next_match_id"
          )
          .eq("tournament_id", tournamentId)
          .order("round_number", { ascending: true })
          .order("slot_index", { ascending: true }),
      ]);

      if (cancelled) return;

      if (entriesResult.error) {
        setError(entriesResult.error.message);
        setLoading(false);
        return;
      }

      if (matchesResult.error) {
        setError(matchesResult.error.message);
        setLoading(false);
        return;
      }

      const row = tournamentRow as TournamentRow;
      setTournament(row);
      setEntries((entriesResult.data ?? []) as TournamentEntryRow[]);
      setMatches((matchesResult.data ?? []) as TournamentMatchRow[]);

      const isViewerHost =
        identity?.playerId != null && identity.playerId === row.created_by;
      if (isViewerHost) {
        setCreatorUsername(null);
      } else {
        const { data: creatorProfile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", row.created_by)
          .maybeSingle();
        if (!cancelled) {
          setCreatorUsername(creatorProfile?.username ?? null);
        }
      }

      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [tournamentId, refreshKey]);

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
                  className={`rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusBadgeClass(tournament.status)}`}
                >
                  {tournament.status.replace("_", " ")}
                </span>
              </div>

              {tournament.status === "cancelled" ? (
                <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-200">
                  This tournament has been cancelled.
                </p>
              ) : null}

              {myEntry?.status === "withdrawn" ? (
                <p className="mt-4 rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300">
                  You have withdrawn from this tournament.
                </p>
              ) : null}

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase text-zinc-500">Entries</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {registeredCount} active · {checkedInEntries.length} checked
                    in
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-zinc-500">Starts</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {tournament.starts_at
                      ? new Date(tournament.starts_at).toLocaleString()
                      : "TBD"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-zinc-500">Matches</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {matches.length}
                  </dd>
                </div>
              </dl>
            </header>

            {tournament.status !== "cancelled" ? (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                <h2 className="text-lg font-bold text-white">Participation</h2>
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

            <TournamentBracketPanel matches={matches} entries={entries} />
          </>
        ) : null}
      </section>
    </RequireAuth>
  );
}
