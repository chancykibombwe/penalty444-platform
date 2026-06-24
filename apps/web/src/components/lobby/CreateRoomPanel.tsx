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
  const [hostUsername, setHostUsername] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

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

    setHostUsername(identity.username ?? null);
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
    void navigator.clipboard.writeText(waitingRoom.roomCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareRoomCode() {
    if (!waitingRoom || typeof navigator === "undefined" || !("share" in navigator)) return;
    void navigator.share({
      title: "Join my Penalty444 room",
      text: `Room code: ${waitingRoom.roomCode} — join me on 444 Arena!`,
    });
  }

  // ── Waiting state — room created, host stays in lobby ──────────────────
  if (waitingRoom) {
    return (
      <div className="col-span-2 space-y-2 overflow-hidden rounded-2xl border border-[#8B5CF6]/30 bg-[#0D1420] p-2 shadow-[0_0_28px_rgba(139,92,246,0.16)] sm:space-y-3 sm:p-3.5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 sm:block">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/30 sm:mb-1.5">
              <svg
                className="h-3.5 w-3.5 text-[#C4B5FD]"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 110-2h6V5a1 1 0 011-1z" />
              </svg>
            </div>
            <h2 className="text-base font-black text-white sm:mt-0.5">Room Created</h2>
          </div>
          <p className="hidden text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:block">
            Private Room · Waiting for opponent
          </p>
        </div>

        {/* Room code */}
        <div className="rounded-xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/10 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#C4B5FD]/70">
            Room Code
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-3">
            <p className="select-all font-mono text-lg font-black tracking-[0.2em] text-white sm:text-2xl sm:tracking-[0.25em]">
              {waitingRoom.roomCode}
            </p>
            <button
              type="button"
              onClick={copyRoomCode}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] transition hover:border-[#8B5CF6]/40"
              style={{ color: copied ? "#86efac" : undefined }}
            >
              {copied ? "Copied!" : "Copy Code"}
            </button>
            {canShare ? (
              <button
                type="button"
                onClick={shareRoomCode}
                className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 transition hover:border-[#8B5CF6]/40 hover:text-zinc-200"
              >
                Share
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {waitingRoom.rounds} rounds · Free Play Beta
          </p>
        </div>

        {/* Player slots */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            Players
          </p>
          {/* Host slot */}
          <div
            className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
            style={{
              background: "rgba(139,92,246,0.08)",
              border: "1px solid rgba(139,92,246,0.20)",
            }}
          >
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#C4B5FD]/55">
                Player 1 · Host
              </p>
              <p className="mt-0.5 truncate text-[12px] font-bold text-white">
                {hostUsername ?? "You"}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              Joined
            </span>
          </div>
          {/* Guest slot */}
          <div
            className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                Player 2 · Guest
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Waiting for opponent…
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" aria-hidden />
              Waiting
            </span>
          </div>
        </div>

        {/* Waiting indicator */}
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8B5CF6]"
            aria-hidden
          />
          <p className="text-[12px] text-zinc-400">
            Waiting for opponent to join… Share your room code above.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <GradientButton
            variant="purple"
            onClick={() => router.push(`/match/${waitingRoom.roomCode}`)}
            className="w-full !min-h-[40px] !py-2"
          >
            Enter Room
          </GradientButton>
          <OutlineButton
            tone="muted"
            onClick={cancelRoom}
            disabled={cancelling}
            className="w-full !min-h-[40px] !py-2"
          >
            {cancelling ? "Cancelling…" : "Cancel Room"}
          </OutlineButton>
        </div>

        {status ? (
          <p className="text-[12px] text-amber-200/90" role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
      </div>
    );
  }

  // ── Setup state ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-2 overflow-hidden rounded-2xl border border-[#8B5CF6]/30 bg-[#0D1420] p-2 shadow-[0_0_28px_rgba(139,92,246,0.16)] sm:space-y-3 sm:p-3.5">
      <div>
        <div className="flex items-center justify-between gap-2 sm:block">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/30 sm:mb-1.5">
              <svg
                className="h-3.5 w-3.5 text-[#C4B5FD]"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 011-1z" />
              </svg>
            </div>
            <h2 className="text-base font-black text-white sm:mt-0.5">Create Room</h2>
          </div>

          {/* Mobile-only compact rounds toggle, merged into the header row */}
          <div className="flex shrink-0 gap-1 sm:hidden">
            {([3, 5] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRounds(r)}
                aria-label={`${r} rounds`}
                className={`rounded-lg border px-2 py-1 text-xs font-black transition-colors ${
                  rounds === r
                    ? "border-[#8B5CF6]/60 bg-[#8B5CF6]/15 text-[#C4B5FD]"
                    : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <p className="hidden text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:block">
          Private Room
        </p>
      </div>

      <p className="hidden text-sm text-zinc-400 sm:block">
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

      {/* Rounds selector — desktop only; mobile uses the header toggle above */}
      <div className="hidden sm:block">
        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          Rounds
        </p>
        <div className="flex gap-2">
          {([3, 5] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRounds(r)}
              className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-black transition-colors ${
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
      <div className="hidden sm:block">
        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          Stake
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5">
          <span className="text-sm font-black text-emerald-300">Free</span>
          <span className="text-xs text-zinc-600">
            — Private rooms are Free Play for now.
          </span>
        </div>
      </div>

      <GradientButton variant="purple" onClick={createRoom} disabled={loading} className="w-full !min-h-[40px] !py-2">
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
