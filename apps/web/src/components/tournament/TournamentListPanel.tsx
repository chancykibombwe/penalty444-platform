"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import TournamentEntryActions from "./TournamentEntryActions";

export type TournamentRow = {
  id: string;
  game_id: string;
  name: string;
  status: string;
  format: string;
  max_players: number;
  rounds_per_match: number;
  created_by: string;
  starts_at: string | null;
  created_at: string;
};

export type TournamentEntryRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  username: string;
  status: string;
  checked_in_at: string | null;
};

export function formatTournamentStatus(status: string): string {
  switch (status) {
    case "registration":
      return "Registration";
    case "check_in":
      return "Ready Phase";
    case "in_progress":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
}

export function formatEntryStatus(status: string): string {
  switch (status) {
    case "registered":
      return "Registered";
    case "checked_in":
      return "Ready";
    case "withdrawn":
      return "Withdrawn";
    default:
      return status.replace(/_/g, " ");
  }
}

export function statusBadgeClass(status: string) {
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

function formatStartsAt(value: string | null) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type TournamentListPanelProps = {
  listVersion?: number;
};

export default function TournamentListPanel({
  listVersion = 0,
}: TournamentListPanelProps) {
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<
    Map<string, TournamentEntryRow[]>
  >(new Map());
  const [myEntriesByTournament, setMyEntriesByTournament] = useState<
    Map<string, TournamentEntryRow>
  >(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTournaments() {
      setLoading(true);
      setError("");

      const identity = await getCurrentPlayerIdentity();
      const userId = identity?.playerId ?? null;

      if (!cancelled) {
        setCurrentUserId(userId);
      }

      const { data: tournamentRows, error: tournamentError } = await supabase
        .from("tournaments")
        .select(
          "id, game_id, name, status, format, max_players, rounds_per_match, created_by, starts_at, created_at"
        )
        .eq("game_id", "penalty444")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (tournamentError) {
        setError(tournamentError.message);
        setTournaments([]);
        setEntriesByTournament(new Map());
        setMyEntriesByTournament(new Map());
        setLoading(false);
        return;
      }

      const list = ((tournamentRows ?? []) as TournamentRow[]).filter(
        (row) => row.status !== "cancelled"
      );
      setTournaments(list);

      if (list.length === 0) {
        setEntriesByTournament(new Map());
        setMyEntriesByTournament(new Map());
        setLoading(false);
        return;
      }

      const tournamentIds = list.map((row) => row.id);

      const { data: entryRows, error: entriesError } = await supabase
        .from("tournament_entries")
        .select("id, tournament_id, user_id, username, status, checked_in_at")
        .in("tournament_id", tournamentIds);

      if (cancelled) return;

      if (entriesError) {
        setError(entriesError.message);
        setEntriesByTournament(new Map());
        setMyEntriesByTournament(new Map());
        setLoading(false);
        return;
      }

      const grouped = new Map<string, TournamentEntryRow[]>();
      const mine = new Map<string, TournamentEntryRow>();

      for (const row of (entryRows ?? []) as TournamentEntryRow[]) {
        const bucket = grouped.get(row.tournament_id) ?? [];
        bucket.push(row);
        grouped.set(row.tournament_id, bucket);

        if (userId && row.user_id === userId) {
          mine.set(row.tournament_id, row);
        }
      }

      setEntriesByTournament(grouped);
      setMyEntriesByTournament(mine);
      setLoading(false);
    }

    loadTournaments();

    return () => {
      cancelled = true;
    };
  }, [refreshKey, listVersion]);

  return (
    <section className="space-y-6 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-2xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Events
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">Open Tournaments</h2>
          <p className="mt-2 text-zinc-400">
            Join tournaments and get Ready before the bracket starts.
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading tournaments...</p>
      ) : tournaments.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-8 text-center text-sm text-zinc-400">
          No tournaments yet. Create one above to get started.
        </div>
      ) : (
        <ul className="space-y-4">
          {tournaments.map((tournament) => {
            const entries = entriesByTournament.get(tournament.id) ?? [];
            const registeredCount = entries.filter(
              (entry) => entry.status !== "withdrawn"
            ).length;
            const myEntry = myEntriesByTournament.get(tournament.id) ?? null;
            const isHost =
              Boolean(currentUserId) &&
              currentUserId === tournament.created_by;

            return (
              <li
                key={tournament.id}
                className={`rounded-2xl border bg-zinc-950/60 p-5 ${
                  isHost ? "border-amber-500/35" : "border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-white">
                        <Link
                          href={`/tournaments/${tournament.id}`}
                          className="hover:text-amber-200"
                        >
                          {tournament.name}
                        </Link>
                      </h3>
                      {isHost ? (
                        <span className="rounded-md border border-amber-500/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-200">
                          HOST: YOU
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Single elimination · {tournament.rounds_per_match} rounds
                      per match
                    </p>
                  </div>

                  <span
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold tracking-wide ${statusBadgeClass(tournament.status)}`}
                  >
                    {formatTournamentStatus(tournament.status)}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Registered
                    </dt>
                    <dd className="mt-1 font-semibold text-white">
                      {registeredCount} / {tournament.max_players}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Starts
                    </dt>
                    <dd className="mt-1 font-semibold text-white">
                      {formatStartsAt(tournament.starts_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Format
                    </dt>
                    <dd className="mt-1 font-semibold capitalize text-white">
                      {tournament.format.replace("_", " ")}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-zinc-800 pt-4">
                  <TournamentEntryActions
                    tournament={tournament}
                    currentUserId={currentUserId}
                    myEntry={myEntry}
                    registeredCount={registeredCount}
                    onUpdated={refresh}
                    showHostStrip
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
