"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { clearActiveMatch } from "../../lib/match/activeMatch";
import { GradientButton } from "../ui/GradientButton";
import { OutlineButton } from "../ui/OutlineButton";

type CreateRoomPanelProps = {
  challengeUserId?: string;
  challengeUsername?: string;
};

type WaitingRoom = {
  roomCode: string;
  rounds: 3 | 5;
};

export default function CreateRoomPanel({
  challengeUsername,
}: CreateRoomPanelProps) {
  const [rounds, setRounds] = useState<3 | 5>(3);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [waitingRoom, setWaitingRoom] = useState<WaitingRoom | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();

  // Listen for server confirmation that the private room was cancelled.
  // ActiveMatchRecovery already handles room:created → saveActiveMatch, so we
  // only need to clear it here on cancel.
  useEffect(() => {
    const socket = getSocket();

    function onRoomCancelled({ roomCode }: { roomCode?: string }) {
      setWaitingRoom((prev) => {
        if (!prev) return prev;
        if (roomCode?.trim().toUpperCase() !== prev.roomCode) return prev;
        clearActiveMatch();
        return null;
      });
      setCancelling(false);
      setStatus(null);
    }

    socket.on("room:cancelled", onRoomCancelled);
    return () => {
      socket.off("room:cancelled", onRoomCancelled);
    };
  }, []);

  async function createRoom() {
    if (loading) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Please try again in a moment.");
      return;
    }

    setStatus(null);
    setLoading(true);

    const identity = await getCurrentPlayerIdentity();

    if (!identity) {
      setLoading(false);
      router.replace("/auth/login");
      return;
    }

    const selectedRounds = rounds;

    const onCreated = (payload: { roomCode: string }) => {
      cleanup();
      const code = payload.roomCode?.trim().toUpperCase();
      if (!code) {
        setLoading(false);
        setStatus("Room created but code was missing. Please try again.");
        return;
      }
      // Do not navigate immediately — host stays in lobby waiting for
      // opponent. ActiveMatchRecovery saves activeMatch on room:created.
      setLoading(false);
      setWaitingRoom({ roomCode: code, rounds: selectedRounds });
    };

    // Server surfaces room-create failures (auth/rate-limit) via
    // `error:message`. Log the detail for debugging but only show the
    // user a friendly fallback — never the raw server string.
    const onError = (payload?: { message?: string }) => {
      cleanup();
      console.warn("room:create failed:", payload);
      setLoading(false);
      setStatus("Could not create room. Please try again.");
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      setLoading(false);
      setStatus("Server is not responding. Please try again.");
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      socket.off("room:created", onCreated);
      socket.off("error:message", onError);
    }

    socket.on("room:created", onCreated);
    socket.on("error:message", onError);

    socket.emit("room:create", {
      playerId: identity.playerId,
      username: identity.username,
      rounds: selectedRounds,
      stakeLabel: "Free",
    });
  }

  async function cancelRoom() {
    if (!waitingRoom || cancelling) return;

    const socket = getSocket();

    if (!socket.connected) {
      // Cannot cancel safely without a live connection: the server-side
      // room and playerActiveRooms mapping may still be alive. Keep the
      // waiting card visible so the host can retry after reconnecting.
      setStatus("Reconnect required before cancelling this room.");
      return;
    }

    setCancelling(true);
    setStatus(null);

    try {
      const identity = await getCurrentPlayerIdentity();

      if (!identity) {
        setCancelling(false);
        return;
      }

      const targetCode = waitingRoom.roomCode;

      // Scoped listeners — cleaned up on success, error, or timeout.
      const onCancelled = ({ roomCode }: { roomCode?: string }) => {
        if (roomCode?.trim().toUpperCase() !== targetCode) return;
        cleanupCancel();
        // The useEffect room:cancelled listener handles setWaitingRoom(null)
        // and clearActiveMatch() — both paths are idempotent.
      };

      const onCancelError = (payload?: { message?: string }) => {
        cleanupCancel();
        setCancelling(false);
        setStatus(payload?.message || "Could not cancel room. Please try again.");
      };

      const cancelTimeoutId = window.setTimeout(() => {
        cleanupCancel();
        setCancelling(false);
        setStatus("Cancel timed out. Please try again.");
      }, 5000);

      function cleanupCancel() {
        window.clearTimeout(cancelTimeoutId);
        socket.off("room:cancelled", onCancelled);
        socket.off("error:message", onCancelError);
      }

      socket.on("room:cancelled", onCancelled);
      socket.on("error:message", onCancelError);

      socket.emit("room:cancel", {
        playerId: identity.playerId,
        roomCode: targetCode,
      });
    } catch {
      setCancelling(false);
      setStatus("Could not cancel room.");
    }
  }

  function copyRoomCode() {
    if (!waitingRoom) return;
    void navigator.clipboard.writeText(waitingRoom.roomCode);
  }

  // ── Waiting state — room created, host stays in lobby ──────────────────
  if (waitingRoom) {
    return (
      <div className="space-y-4 overflow-hidden rounded-2xl border border-[#8B5CF6]/30 bg-[#0D1420] p-6 shadow-[0_0_28px_rgba(139,92,246,0.16)]">
        <div>
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/30">
            <svg
              className="h-4 w-4 text-[#C4B5FD]"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 110-2h6V5a1 1 0 011-1z" />
            </svg>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            Private Room
          </p>
          <h2 className="mt-1 text-lg font-black text-white">Room Created</h2>
        </div>

        <div className="rounded-xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/10 px-4 py-4">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#C4B5FD]/70">
            Room Code
          </p>
          <div className="mt-1 flex items-center gap-3">
            <p className="select-all font-mono text-2xl font-black tracking-[0.25em] text-white">
              {waitingRoom.roomCode}
            </p>
            <button
              type="button"
              onClick={copyRoomCode}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 transition hover:border-[#8B5CF6]/40 hover:text-zinc-200"
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {waitingRoom.rounds} rounds · Free
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8B5CF6]"
            aria-hidden
          />
          <p className="text-sm text-zinc-400">Waiting for opponent to join…</p>
        </div>

        <p className="text-xs text-zinc-500">
          Share the room code above. You&apos;ll get a notification when your
          opponent joins.
        </p>

        <div className="flex flex-col gap-2">
          <GradientButton
            variant="purple"
            onClick={() => router.push(`/match/${waitingRoom.roomCode}`)}
            className="w-full"
          >
            Enter Room
          </GradientButton>
          <OutlineButton
            tone="muted"
            onClick={cancelRoom}
            disabled={cancelling}
            className="w-full"
          >
            {cancelling ? "Cancelling…" : "Cancel Room"}
          </OutlineButton>
        </div>

        {status ? (
          <p className="text-sm text-amber-200/90" role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
      </div>
    );
  }

  // ── Setup state ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 overflow-hidden rounded-2xl border border-[#8B5CF6]/30 bg-[#0D1420] p-6 shadow-[0_0_28px_rgba(139,92,246,0.16)]">
      <div>
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/30">
          <svg
            className="h-4 w-4 text-[#C4B5FD]"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 011-1z" />
          </svg>
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Private Room
        </p>
        <h2 className="mt-1 text-lg font-black text-white">Create Room</h2>
      </div>

      <p className="text-sm text-zinc-400">
        Start a private match and share the room code with your opponent.
      </p>

      {challengeUsername ? (
        <div className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-950/20 px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />
          <p className="text-xs font-semibold text-cyan-100">
            Challenging {challengeUsername}
          </p>
        </div>
      ) : null}

      {/* Rounds selector */}
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          Rounds
        </p>
        <div className="flex gap-2">
          {([3, 5] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRounds(r)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-black transition-colors ${
                rounds === r
                  ? "border-[#8B5CF6]/60 bg-[#8B5CF6]/15 text-[#C4B5FD]"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              {r} rounds
            </button>
          ))}
        </div>
      </div>

      {/* Stake — locked to Free for this version */}
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          Stake
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <span className="text-sm font-black text-emerald-300">Free</span>
          <span className="text-xs text-zinc-600">
            — Private rooms are Free Play for now.
          </span>
        </div>
      </div>

      <GradientButton variant="purple" onClick={createRoom} disabled={loading} className="w-full">
        {loading ? "Creating..." : "Create Room"}
      </GradientButton>

      {status ? (
        <p className="text-sm text-amber-200/90" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  );
}
