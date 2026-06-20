"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSocket, waitForSocketAuth } from "../../lib/socket/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import {
  saveActiveMatch,
  clearActiveMatch,
  getActiveMatch,
} from "../../lib/match/activeMatch";

// A snapshot of `roomCode: null` from the server means "no active room".
// Because this component is mounted globally (including on the match page),
// a freshly-saved local entry can race a snapshot request issued during
// match creation/join. We only honour a null-clear when the local entry
// is older than this guard window, so a just-created match is never wiped.
const SNAPSHOT_NULL_CLEAR_GUARD_MS = 15_000;

export default function ActiveMatchRecovery() {
  const router = useRouter();
  const playerIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;

    // Resolve identity once so the localStorage writes below carry a
    // playerId. Without it, `saveActiveMatch` silently no-ops (the bug
    // that hid the Resume Match card). Also drives the snapshot request.
    void getCurrentPlayerIdentity().then((identity) => {
      if (cancelled) return;
      playerIdRef.current = identity?.playerId ?? null;
      requestActiveRoomSnapshot();
    });

    function requestActiveRoomSnapshot() {
      socket.emit("activeRoom:request", {
        playerId: playerIdRef.current ?? undefined,
      });
    }

    function saveRoom(roomCode?: string) {
      if (!roomCode) return;
      const playerId = playerIdRef.current ?? undefined;
      // If identity hasn't resolved yet, resolve on demand so we never
      // fall back into the no-op (missing playerId) save path.
      if (!playerId) {
        void getCurrentPlayerIdentity().then((identity) => {
          if (cancelled) return;
          playerIdRef.current = identity?.playerId ?? null;
          if (identity?.playerId) {
            saveActiveMatch(roomCode, identity.playerId);
          }
        });
        return;
      }
      saveActiveMatch(roomCode, playerId);
    }

    function onConnect() {
      void waitForSocketAuth(5000).then((auth) => {
        if (cancelled) return;
        // Only request the snapshot when the server's verified userId
        // matches our local playerId. A null or mismatched userId means
        // auth failed or timed out; emitting would be rejected anyway and
        // the server's proactive snapshot (sent after successful verify)
        // is the recovery path.
        const pid = playerIdRef.current;
        if (!pid || auth.userId !== pid) return;
        requestActiveRoomSnapshot();
      });
    }

    function onRoomCreated(payload: { roomCode?: string }) {
      saveRoom(payload.roomCode);
    }

    function onRoomJoined(payload: { roomCode?: string }) {
      saveRoom(payload.roomCode);
    }

    function onPublicOfferCreated(payload: { offer?: { roomCode?: string } }) {
      saveRoom(payload.offer?.roomCode);
    }

    function onPublicOfferMatched(payload: { roomCode?: string }) {
      if (!payload.roomCode) return;
      saveRoom(payload.roomCode);
      router.push(`/match/${payload.roomCode}`);
    }

    // Server-authoritative active-room snapshot (Resume Match recovery).
    function onActiveRoomSnapshot(payload: { roomCode?: string | null }) {
      const roomCode =
        typeof payload?.roomCode === "string" ? payload.roomCode.trim() : "";

      if (roomCode) {
        saveRoom(roomCode);
        return;
      }

      // roomCode is null/absent → server has no active room for us. Clear
      // any stale local entry, but never a just-saved one (creation/join
      // race guard).
      const existing = getActiveMatch();
      if (!existing) return;
      if (Date.now() - existing.savedAt < SNAPSHOT_NULL_CLEAR_GUARD_MS) {
        console.info("[ActiveMatch] keeping_in_progress", {
          roomCode: existing.roomCode,
          ageSec: Math.round((Date.now() - existing.savedAt) / 1000),
        });
        return;
      }
      console.info("[ActiveMatch] cleared_no_active_room", {
        roomCode: existing.roomCode,
      });
      clearActiveMatch();
    }

    // Early-cancel abort (first 5 s of a match). Emitted directly to each
    // player socket so this reaches players who navigated away from the
    // match page before the abort fired.
    function onMatchAborted(payload: { roomCode?: string }) {
      const existing = getActiveMatch();
      if (!existing) return;
      const code = payload?.roomCode?.trim().toUpperCase();
      if (code && existing.roomCode !== code) return;
      console.info("[ActiveMatch] cleared_terminal", {
        reason: "match:aborted",
        roomCode: code ?? existing.roomCode,
      });
      clearActiveMatch();
    }

    function onMatchEnd() {
      console.info("[ActiveMatch] cleared_terminal", { reason: "match:end" });
      clearActiveMatch();
    }

    function onMatchUpdate(payload: { matchEnded?: boolean }) {
      if (payload.matchEnded) {
        clearActiveMatch();
      }
    }

    // Server snapshot sent after a page-refresh rejoin. If the match is
    // already over, the Resume Match card must be cleared immediately even
    // though `match:end` was never received in this page load.
    function onMatchRejoinState(payload: { matchEnded?: boolean }) {
      if (payload.matchEnded) {
        const existing = getActiveMatch();
        if (existing) {
          console.info("[ActiveMatch] ignored_stale_resume", {
            roomCode: existing.roomCode,
          });
        }
        clearActiveMatch();
      }
    }

    function onPublicOfferCancelled() {
      clearActiveMatch();
    }

    // Clear active match when a private room is cancelled. Uses roomCode-aware
    // matching so a player in a different room is never affected. Falls back to
    // an unconditional clear when the payload carries no roomCode (defensive).
    function onRoomCancelled(payload: { roomCode?: string }) {
      const existing = getActiveMatch();
      if (!existing) return;
      const code = payload?.roomCode?.trim().toUpperCase();
      if (code && existing.roomCode !== code) return;
      clearActiveMatch();
    }

    // Readiness-authority pre-start cancellation (opponent never showed up).
    // MatchRoomPanel handles this when it's mounted, but if the user navigated
    // away from the match page, only ActiveMatchRecovery is listening.
    function onMatchCancelled(payload: { roomCode?: string }) {
      const existing = getActiveMatch();
      if (!existing) return;
      const code = payload?.roomCode?.trim().toUpperCase();
      if (code && existing.roomCode !== code) return;
      clearActiveMatch();
    }

    socket.on("connect", onConnect);
    socket.on("room:created", onRoomCreated);
    socket.on("room:joined", onRoomJoined);
    socket.on("publicOffer:created", onPublicOfferCreated);
    socket.on("publicOffer:matched", onPublicOfferMatched);
    socket.on("publicOffer:cancelled", onPublicOfferCancelled);
    socket.on("room:cancelled", onRoomCancelled);
    socket.on("activeRoom:snapshot", onActiveRoomSnapshot);
    socket.on("match:end", onMatchEnd);
    socket.on("match:update", onMatchUpdate);
    socket.on("match:rejoinState", onMatchRejoinState);
    socket.on("match:cancelled", onMatchCancelled);
    socket.on("match:aborted", onMatchAborted);

    // If the socket is already connected at mount (common on the lobby),
    // the `connect` event won't fire again — request a snapshot now,
    // but still gate on socket:authenticated and userId match.
    if (socket.connected) {
      void waitForSocketAuth(5000).then((auth) => {
        if (cancelled) return;
        const pid = playerIdRef.current;
        if (!pid || auth.userId !== pid) return;
        requestActiveRoomSnapshot();
      });
    }

    return () => {
      cancelled = true;
      socket.off("connect", onConnect);
      socket.off("room:created", onRoomCreated);
      socket.off("room:joined", onRoomJoined);
      socket.off("publicOffer:created", onPublicOfferCreated);
      socket.off("publicOffer:matched", onPublicOfferMatched);
      socket.off("publicOffer:cancelled", onPublicOfferCancelled);
      socket.off("room:cancelled", onRoomCancelled);
      socket.off("activeRoom:snapshot", onActiveRoomSnapshot);
      socket.off("match:end", onMatchEnd);
      socket.off("match:update", onMatchUpdate);
      socket.off("match:rejoinState", onMatchRejoinState);
      socket.off("match:cancelled", onMatchCancelled);
      socket.off("match:aborted", onMatchAborted);
    };
  }, [router]);

  return null;
}
