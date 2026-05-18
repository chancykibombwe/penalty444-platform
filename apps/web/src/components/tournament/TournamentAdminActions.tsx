"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import type { TournamentEntryRow, TournamentRow } from "./TournamentListPanel";

const CANCELLABLE_STATUSES = new Set(["draft", "registration", "check_in"]);
const STARTABLE_STATUSES = new Set(["registration", "check_in"]);

function formatScheduledStart(startsAt: string): string {
  return new Date(startsAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type TournamentAdminActionsProps = {
  tournament: TournamentRow;
  currentUserId: string | null;
  checkedInEntries: TournamentEntryRow[];
  existingMatchCount: number;
  onUpdated: () => void;
};

export default function TournamentAdminActions({
  tournament,
  currentUserId,
  checkedInEntries,
  existingMatchCount,
  onUpdated,
}: TournamentAdminActionsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [registeredEntryCount, setRegisteredEntryCount] = useState<number | null>(
    null
  );

  const readyCount = checkedInEntries.length;

  useEffect(() => {
    let cancelled = false;

    async function loadActiveEntryCount() {
      const { count, error } = await supabase
        .from("tournament_entries")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournament.id)
        .in("status", ["registered", "checked_in"]);

      if (cancelled) return;

      if (error) {
        setRegisteredEntryCount(null);
        return;
      }

      setRegisteredEntryCount(count ?? 0);
    }

    void loadActiveEntryCount();

    return () => {
      cancelled = true;
    };
  }, [tournament.id, tournament.status]);

  if (!currentUserId || currentUserId !== tournament.created_by) {
    return null;
  }

  const isCancelled = tournament.status === "cancelled";
  const canCancel = CANCELLABLE_STATUSES.has(tournament.status);
  const isPreStart = STARTABLE_STATUSES.has(tournament.status);
  const hasScheduledStart = Boolean(tournament.starts_at);
  const activeCount = registeredEntryCount ?? 0;
  const withinCapacity = activeCount <= tournament.max_players;
  const canStart =
    !isCancelled &&
    isPreStart &&
    existingMatchCount === 0 &&
    registeredEntryCount !== null &&
    activeCount >= 2 &&
    withinCapacity;

  if (isCancelled) {
    return null;
  }

  if (tournament.status === "completed" || tournament.status === "in_progress") {
    return message ? (
      <p className="text-xs text-zinc-400">{message}</p>
    ) : null;
  }

  async function handleStartTournament() {
    if (busy || !canStart) return;

    setMessage("");

    const identity = await getCurrentPlayerIdentity();
    if (!identity) {
      setMessage("You must be logged in.");
      return;
    }

    if (identity.playerId !== tournament.created_by) {
      setMessage("Only the tournament creator can start the bracket.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Session expired. Please log in again.");
      return;
    }

    setBusy(true);
    setMessage("Starting tournament on server...");

    try {
      const response = await fetch(
        `/api/tournaments/${tournament.id}/start`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        matchCount?: number;
        playerCount?: number;
      } | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Failed to start tournament.");
        return;
      }

      setMessage(
        payload?.matchCount
          ? `Bracket is Live. ${payload.matchCount} slots created${
              payload.playerCount
                ? ` for ${payload.playerCount} registered players.`
                : "."
            }`
          : "Bracket is Live."
      );
      onUpdated();
    } catch {
      setMessage("Failed to start tournament.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelTournament() {
    if (busy || !canCancel) return;

    const confirmed = window.confirm(
      "Cancel this tournament? Players will no longer be able to join or mark Ready."
    );

    if (!confirmed) return;

    setMessage("");

    const identity = await getCurrentPlayerIdentity();
    if (!identity) {
      setMessage("You must be logged in.");
      return;
    }

    if (identity.playerId !== tournament.created_by) {
      setMessage("Only the tournament creator can cancel this tournament.");
      return;
    }

    setBusy(true);
    setMessage("Cancelling tournament...");

    try {
      const { error } = await supabase
        .from("tournaments")
        .update({ status: "cancelled" })
        .eq("id", tournament.id)
        .eq("created_by", identity.playerId)
        .in("status", ["draft", "registration", "check_in"]);

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Tournament cancelled.");
      onUpdated();
    } catch {
      setMessage("Failed to cancel tournament.");
    } finally {
      setBusy(false);
    }
  }

  if (!isPreStart) {
    return message ? (
      <p className="text-xs text-zinc-400">{message}</p>
    ) : null;
  }

  return (
    <section className="rounded-xl border border-amber-500/20 bg-amber-950/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-100">Creator</h2>
        <p className="text-xs text-zinc-400">
          <span className="text-zinc-500">Registered</span>{" "}
          <span className="font-semibold text-white">
            {registeredEntryCount === null ? "…" : activeCount}
          </span>
          <span className="mx-1.5 text-zinc-600">·</span>
          <span className="text-zinc-500">Ready</span>{" "}
          <span className="font-semibold text-white">{readyCount}</span>
          <span className="text-zinc-500"> (optional)</span>
        </p>
      </div>

      {hasScheduledStart ? (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-100">
            This tournament starts automatically at{" "}
            {formatScheduledStart(tournament.starts_at!)}.
          </p>
          <p className="text-xs text-zinc-400">
            Players can register until it begins.
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100">
          No start time set. This tournament cannot auto-start.
        </p>
      )}

      {!hasScheduledStart ? (
        <p className="mt-2 text-xs text-zinc-500">
          Use Start Tournament below when you are ready to open the bracket
          manually.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!hasScheduledStart ? (
          <button
            type="button"
            onClick={handleStartTournament}
            disabled={busy || !canStart}
            className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
          >
            {busy ? "Working…" : "Start Tournament"}
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            onClick={handleCancelTournament}
            disabled={busy}
            className="rounded-lg border border-red-500/50 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 hover:border-red-400/70 disabled:opacity-50"
          >
            {busy ? "Working…" : "Cancel"}
          </button>
        ) : null}
      </div>

      {hasScheduledStart ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-400">
            Manual start (override)
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleStartTournament}
              disabled={busy || !canStart}
              className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
            >
              {busy ? "Working…" : "Start now"}
            </button>
            {registeredEntryCount !== null && activeCount < 2 ? (
              <span className="text-xs text-red-300">Need at least 2 registered</span>
            ) : null}
            {registeredEntryCount !== null && activeCount > 0 && !withinCapacity ? (
              <span className="text-xs text-red-300">
                Over max {tournament.max_players} players
              </span>
            ) : null}
          </div>
        </details>
      ) : null}

      {message ? <p className="mt-2 text-xs text-zinc-400">{message}</p> : null}
    </section>
  );
}
