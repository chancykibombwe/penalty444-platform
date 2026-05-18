"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import type { TournamentMatchRow } from "./TournamentBracketPanel";

export type TournamentMatchRoomActionProps = {
  tournamentId: string;
  match: TournamentMatchRow;
  isParticipant: boolean;
  canEnterMatch: boolean;
  canJoinMatch: boolean;
  onUpdated?: () => void;
};

export default function TournamentMatchRoomAction({
  tournamentId,
  match,
  isParticipant,
  canEnterMatch,
  canJoinMatch,
  onUpdated,
}: TournamentMatchRoomActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isParticipant) {
    return null;
  }

  if (match.room_code && canJoinMatch) {
    return (
      <Link
        href={`/match/${match.room_code}`}
        className="mt-3 inline-flex rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-500"
      >
        Join Match
      </Link>
    );
  }

  if (!canEnterMatch) {
    return null;
  }

  async function handleEnterMatch() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Session expired. Please log in again.");
        return;
      }

      const response = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/room`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const payload = (await response.json().catch(() => ({}))) as {
        roomCode?: string;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Failed to open match room.");
        return;
      }

      if (!payload.roomCode) {
        setError("No room code returned.");
        return;
      }

      onUpdated?.();
      router.push(`/match/${payload.roomCode}`);
    } catch {
      setError("Failed to open match room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-1">
      <button
        type="button"
        onClick={handleEnterMatch}
        disabled={busy}
        className="rounded-xl border border-amber-500/50 bg-amber-950/30 px-4 py-2 text-sm font-bold text-amber-100 hover:border-amber-400/70 disabled:opacity-50"
      >
        {busy ? "Opening…" : "Enter Match"}
      </button>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
