"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { isPowerOfTwo } from "../../lib/tournament/bracket";
import type { TournamentEntryRow, TournamentRow } from "./TournamentListPanel";

const CANCELLABLE_STATUSES = new Set(["draft", "registration", "check_in"]);

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

  if (!currentUserId || currentUserId !== tournament.created_by) {
    return null;
  }

  const isCancelled = tournament.status === "cancelled";
  const canCancel = CANCELLABLE_STATUSES.has(tournament.status);
  const isCheckInPhase = tournament.status === "check_in";
  const checkedInCount = checkedInEntries.length;
  const countIsValid = isPowerOfTwo(checkedInCount);
  const canStart =
    !isCancelled &&
    isCheckInPhase &&
    existingMatchCount === 0 &&
    checkedInCount >= 2 &&
    countIsValid;

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
      } | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Failed to start tournament.");
        return;
      }

      setMessage(
        payload?.matchCount
          ? `Tournament started. ${payload.matchCount} bracket slots created.`
          : "Tournament started. Bracket is live."
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
      "Cancel this tournament? Registered players will no longer be able to join or check in."
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

  return (
    <section
      className={`rounded-2xl border p-5 ${
        isCancelled
          ? "border-red-500/40 bg-red-950/20"
          : "border-amber-500/30 bg-amber-950/15"
      }`}
    >
      <h2 className="text-lg font-bold text-amber-100">Creator controls</h2>

      {isCancelled ? (
        <p className="mt-2 text-sm font-semibold text-red-200">
          This tournament has been cancelled. Bracket start and registration are
          closed.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-400">
            Start the bracket when check-in is complete, or cancel before the
            event goes live.
          </p>

          <ul className="mt-3 space-y-1 text-sm text-zinc-300">
            <li>
              Checked in:{" "}
              <span className="font-semibold text-white">{checkedInCount}</span>
              {!countIsValid && checkedInCount > 0 ? (
                <span className="text-red-300"> — not a power of two</span>
              ) : null}
            </li>
            <li>
              Bracket rows:{" "}
              <span className="font-semibold text-white">
                {existingMatchCount}
              </span>
            </li>
          </ul>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStartTournament}
              disabled={busy || !canStart}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-3 font-bold text-zinc-950 disabled:opacity-50"
            >
              {busy ? "Working…" : "Start Tournament"}
            </button>

            {canCancel ? (
              <button
                type="button"
                onClick={handleCancelTournament}
                disabled={busy}
                className="rounded-xl border border-red-500/50 bg-red-950/40 px-5 py-3 font-bold text-red-100 hover:border-red-400/70 disabled:opacity-50"
              >
                {busy ? "Working…" : "Cancel Tournament"}
              </button>
            ) : null}
          </div>

          {!isCheckInPhase && tournament.status !== "in_progress" ? (
            <p className="mt-2 text-xs text-zinc-500">
              Set tournament status to{" "}
              <code className="text-zinc-400">check_in</code> before starting
              the bracket.
            </p>
          ) : null}
        </>
      )}

      {message ? <p className="mt-3 text-sm text-zinc-300">{message}</p> : null}
    </section>
  );
}
