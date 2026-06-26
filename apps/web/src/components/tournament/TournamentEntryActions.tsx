"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { getPublicEconomyMode } from "../../lib/economy/mode";
import {
  lockTournamentEntry,
  refundTournamentEntry,
} from "../../lib/economy/tournamentEntryClient";
import {
  formatEntryStatus,
  type TournamentEntryRow,
  type TournamentRow,
} from "./TournamentListPanel";

const OPEN_ENTRY_STATUSES = new Set(["registration", "check_in"]);

type TournamentEntryActionsProps = {
  tournament: TournamentRow;
  currentUserId: string | null;
  myEntry: TournamentEntryRow | null;
  registeredCount: number;
  onUpdated: () => void;
  /** List cards: short host hint + link to detail. Detail page omits this. */
  showHostStrip?: boolean;
  /**
   * List/card context only: after a successful join, send the player to the
   * tournament detail page (the Tournament Lobby) instead of leaving them on
   * the list. The detail page already lives there, so it omits this.
   */
  redirectToLobbyOnJoin?: boolean;
};

export default function TournamentEntryActions({
  tournament,
  currentUserId,
  myEntry,
  registeredCount,
  onUpdated,
  showHostStrip = false,
  redirectToLobbyOnJoin = false,
}: TournamentEntryActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const isHost =
    Boolean(currentUserId) && currentUserId === tournament.created_by;
  const isCancelled = tournament.status === "cancelled";
  const isOpen = OPEN_ENTRY_STATUSES.has(tournament.status);
  const isFull = registeredCount >= tournament.max_players;
  const isWithdrawn = myEntry?.status === "withdrawn";

  const canJoin =
    isOpen &&
    !isCancelled &&
    !myEntry &&
    !isFull &&
    tournament.status === "registration";
  const canCheckIn =
    isOpen &&
    !isCancelled &&
    tournament.status === "check_in" &&
    myEntry?.status === "registered";
  const canWithdraw =
    isOpen &&
    !isCancelled &&
    myEntry &&
    !isWithdrawn &&
    (myEntry.status === "registered" || myEntry.status === "checked_in");

  const canJoinAgain =
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

      // Beta policy: tournaments are Free Entry and the economy is off
      // by default. Skip the internal escrow reservation entirely in
      // that case — calling it would hit the realtime server's internal
      // secret gate and surface a confusing "Could not reserve entry
      // fee" error for a path that was never meant to charge anyone.
      const economyOff = getPublicEconomyMode() === "off";
      let lockSkipped = true;

      if (!economyOff) {
        // Phase 11 TASK 4: try to lock the tournament entry escrow first.
        // For free tournaments, the server returns `skipped: true` and
        // we proceed normally.
        const lock = await lockTournamentEntry(tournament.id);
        if (lock.ok === false) {
          setMessage(`Could not reserve entry fee: ${lock.error}`);
          return;
        }
        lockSkipped = lock.skipped === true;
      }

      const { error } = await supabase.from("tournament_entries").insert({
        tournament_id: tournament.id,
        user_id: identity.playerId,
        username: identity.username,
        status: "registered",
      });

      if (error) {
        // Roll back the escrow if registration failed.
        if (!lockSkipped) {
          await refundTournamentEntry(tournament.id);
        }
        setMessage(error.message);
        return;
      }

      setMessage("Registered successfully.");
      onUpdated();

      if (redirectToLobbyOnJoin) {
        router.push(`/tournaments/${tournament.id}`);
      }
    } catch {
      setMessage("Failed to join tournament.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn() {
    if (!canCheckIn || !myEntry || busy) return;

    setBusy(true);
    setMessage("Getting ready...");

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
        .eq("user_id", identity.playerId)
        .eq("status", "registered");

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Ready for tournament start.");
      onUpdated();
    } catch {
      setMessage("Failed to mark ready.");
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

      // Beta policy: skip the refund call entirely when the economy is
      // off — there is nothing to refund, and calling it would hit the
      // same internal-secret gate as the lock path.
      if (getPublicEconomyMode() !== "off") {
        // Phase 11 TASK 4: refund any locked entry escrow. Safe even
        // when none exists (server returns skipped=true).
        await refundTournamentEntry(tournament.id);
      }

      setMessage("You have withdrawn from this tournament.");
      onUpdated();
    } catch {
      setMessage("Failed to withdraw.");
    } finally {
      setBusy(false);
    }
  }

  const hostManageStrip =
    showHostStrip && isHost && !isCancelled ? (
      <div className="space-y-2 border-b border-zinc-800 pb-3">
        <p className="text-xs text-amber-200/80">
          {isOpen
            ? "Hosting — join as a player below. Open the tournament page to start the bracket."
            : tournament.status === "in_progress"
              ? "Hosting — play your bracket matches on the tournament page."
              : "Hosting — open the tournament page for details."}
        </p>
        <Link
          href={`/tournaments/${tournament.id}`}
          className="inline-flex rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-500"
        >
          Open Tournament
        </Link>
      </div>
    ) : null;

  if (isCancelled) {
    return (
      <div className="space-y-2">
        {hostManageStrip}
        <p className="text-xs text-red-300/90">
          This tournament was cancelled.
        </p>
      </div>
    );
  }

  let participantContent: ReactNode = null;

  if (isWithdrawn && myEntry) {
    participantContent = (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Your status:{" "}
          <span className="text-zinc-300">
            {formatEntryStatus("withdrawn")}
          </span>
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
      </>
    );
  } else if (myEntry) {
    const isActiveEntry =
      myEntry.status === "registered" || myEntry.status === "checked_in";

    participantContent = (
      <>
        {isActiveEntry && isOpen ? (
          <p className="text-sm font-bold text-amber-100">
            You&apos;re in — waiting for the host to start the tournament.
          </p>
        ) : null}
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">
          Your status:{" "}
          <span className="text-amber-100">
            {formatEntryStatus(myEntry.status)}
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
              {busy ? "Getting ready…" : "Ready"}
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
      </>
    );
  } else if (!isOpen) {
    participantContent = (
      <p className="text-xs text-zinc-500">
        Registration closed for this event.
      </p>
    );
  } else if (isFull) {
    participantContent = (
      <p className="text-xs text-zinc-500">Tournament is full.</p>
    );
  } else if (tournament.status === "check_in") {
    participantContent = (
      <p className="text-xs text-zinc-500">
        Registration is closed for this event.
      </p>
    );
  } else {
    participantContent = (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={handleJoin}
          disabled={!canJoin || busy}
          className="inline-flex items-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_0_20px_rgba(16,185,129,0.28)] transition-all hover:from-emerald-400 hover:to-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join Free Tournament"}
        </button>
        <p className="text-[10px] font-semibold text-emerald-400/70">
          Free Entry · No paid stakes in beta
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hostManageStrip}
      {participantContent}
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
    </div>
  );
}
