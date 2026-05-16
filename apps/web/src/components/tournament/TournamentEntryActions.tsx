"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import type { TournamentEntryRow, TournamentRow } from "./TournamentListPanel";

const OPEN_ENTRY_STATUSES = new Set(["registration", "check_in"]);

type TournamentEntryActionsProps = {
  tournament: TournamentRow;
  currentUserId: string | null;
  myEntry: TournamentEntryRow | null;
  registeredCount: number;
  onUpdated: () => void;
};

export default function TournamentEntryActions({
  tournament,
  currentUserId,
  myEntry,
  registeredCount,
  onUpdated,
}: TournamentEntryActionsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const isHost =
    Boolean(currentUserId) && currentUserId === tournament.created_by;
  const isCancelled = tournament.status === "cancelled";
  const isOpen = OPEN_ENTRY_STATUSES.has(tournament.status);
  const isFull = registeredCount >= tournament.max_players;
  const isWithdrawn = myEntry?.status === "withdrawn";

  const canJoin =
    !isHost &&
    isOpen &&
    !isCancelled &&
    !myEntry &&
    !isFull &&
    tournament.status === "registration";
  const canCheckIn =
    !isHost &&
    isOpen &&
    !isCancelled &&
    tournament.status === "check_in" &&
    myEntry?.status === "registered";
  const canWithdraw =
    !isHost &&
    isOpen &&
    !isCancelled &&
    myEntry &&
    !isWithdrawn &&
    (myEntry.status === "registered" || myEntry.status === "checked_in");

  const canJoinAgain =
    !isHost &&
    isOpen &&
    !isCancelled &&
    !!myEntry &&
    myEntry.status === "withdrawn" &&
    !isFull;

  async function handleJoin() {
    if (!canJoin || busy) return;

    setBusy(true);
    setMessage("Joining tournament...");

    try {
      const identity = await getCurrentPlayerIdentity();
      if (!identity) {
        setMessage("You must be logged in.");
        return;
      }

      const { error } = await supabase.from("tournament_entries").insert({
        tournament_id: tournament.id,
        user_id: identity.playerId,
        username: identity.username,
        status: "registered",
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Registered successfully.");
      onUpdated();
    } catch {
      setMessage("Failed to join tournament.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn() {
    if (!canCheckIn || !myEntry || busy) return;

    setBusy(true);
    setMessage("Checking in...");

    try {
      const identity = await getCurrentPlayerIdentity();
      if (!identity) {
        setMessage("You must be logged in.");
        return;
      }

      const checkedInAt = new Date().toISOString();

      const { error } = await supabase
        .from("tournament_entries")
        .update({
          status: "checked_in",
          checked_in_at: checkedInAt,
        })
        .eq("id", myEntry.id)
        .eq("user_id", identity.playerId);

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Checked in. Ready for bracket start.");
      onUpdated();
    } catch {
      setMessage("Failed to check in.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinAgain() {
    if (!canJoinAgain || !myEntry || busy) return;

    setBusy(true);
    setMessage("Rejoining tournament...");

    try {
      const identity = await getCurrentPlayerIdentity();
      if (!identity) {
        setMessage("You must be logged in.");
        return;
      }

      const { error } = await supabase
        .from("tournament_entries")
        .update({
          status: "registered",
          checked_in_at: null,
        })
        .eq("id", myEntry.id)
        .eq("user_id", identity.playerId)
        .eq("status", "withdrawn");

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("You have rejoined this tournament.");
      onUpdated();
    } catch {
      setMessage("Failed to rejoin tournament.");
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!canWithdraw || !myEntry || busy) return;

    const confirmed = window.confirm("Withdraw from this tournament?");

    if (!confirmed) return;

    setBusy(true);
    setMessage("Withdrawing...");

    try {
      const identity = await getCurrentPlayerIdentity();
      if (!identity) {
        setMessage("You must be logged in.");
        return;
      }

      const { error } = await supabase
        .from("tournament_entries")
        .update({ status: "withdrawn" })
        .eq("id", myEntry.id)
        .eq("user_id", identity.playerId);

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("You have withdrawn from this tournament.");
      onUpdated();
    } catch {
      setMessage("Failed to withdraw.");
    } finally {
      setBusy(false);
    }
  }

  if (isCancelled) {
    return (
      <p className="text-xs text-red-300/90">
        This tournament was cancelled.
      </p>
    );
  }

  if (isHost) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-200/80">
          You are hosting this tournament. Players register below; use Manage
          to start or cancel the event.
        </p>
        <Link
          href={`/tournaments/${tournament.id}`}
          className="inline-flex rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-500"
        >
          Manage Tournament
        </Link>
      </div>
    );
  }

  if (isWithdrawn && myEntry) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Your status:{" "}
          <span className="text-zinc-300">withdrawn</span>
        </p>
        <p className="text-xs text-zinc-500">
          You are no longer registered for this event.
        </p>
        {canJoinAgain ? (
          <button
            type="button"
            onClick={handleJoinAgain}
            disabled={busy}
            className="rounded-xl border border-amber-500/50 bg-amber-950/30 px-4 py-2 text-sm font-bold text-amber-100 hover:border-amber-400/70 disabled:opacity-50"
          >
            {busy ? "Rejoining…" : "Join Again"}
          </button>
        ) : null}
        {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
      </div>
    );
  }

  if (myEntry) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">
          Your status:{" "}
          <span className="text-amber-100">
            {myEntry.status.replace("_", " ")}
          </span>
        </p>

        <div className="flex flex-wrap gap-2">
          {canCheckIn ? (
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={busy}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {busy ? "Checking in…" : "Check In"}
            </button>
          ) : null}

          {canWithdraw ? (
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={busy}
              className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
          ) : null}
        </div>

        {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <p className="text-xs text-zinc-500">
        Registration closed for this event.
      </p>
    );
  }

  if (isFull) {
    return <p className="text-xs text-zinc-500">Tournament is full.</p>;
  }

  if (tournament.status === "check_in") {
    return (
      <p className="text-xs text-zinc-500">
        Check-in is open but you are not registered.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleJoin}
        disabled={!canJoin || busy}
        className="rounded-xl border border-amber-500/50 bg-amber-950/30 px-4 py-2 text-sm font-bold text-amber-100 hover:border-amber-400/70 disabled:opacity-50"
      >
        {busy ? "Joining…" : "Join Tournament"}
      </button>
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
    </div>
  );
}
