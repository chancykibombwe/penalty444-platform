"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import SpectatorMatchView from "../../../components/watch/SpectatorMatchView";

/**
 * /watch/[roomCode] — read-only spectator route.
 *
 * Foundation page only: resolves the room code from the URL and hands off
 * to `SpectatorMatchView`. There is intentionally no auth gate — spectating
 * a live tournament match is a public surface for the broader arena
 * experience.
 */
export default function WatchRoomPage() {
  const params = useParams();
  const raw =
    typeof params.roomCode === "string"
      ? params.roomCode
      : Array.isArray(params.roomCode)
        ? params.roomCode[0]
        : "";

  const roomCode = useMemo(() => raw.trim().toUpperCase(), [raw]);

  if (!roomCode) {
    return (
      <section className="mx-auto max-w-3xl space-y-4 px-1 pb-2 sm:px-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-zinc-300">
            Missing room code.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-1 pb-6 sm:px-2">
      <SpectatorMatchView roomCode={roomCode} />
    </section>
  );
}
