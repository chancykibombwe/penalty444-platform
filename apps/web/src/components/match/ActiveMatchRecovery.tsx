"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { saveActiveMatch, clearActiveMatch } from "../../lib/match/activeMatch";

export default function ActiveMatchRecovery() {
  const router = useRouter();

  useEffect(() => {
    const socket = getSocket();

    function saveRoom(roomCode?: string) {
      if (!roomCode) return;
      saveActiveMatch(roomCode);
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

      saveActiveMatch(payload.roomCode);
      router.push(`/match/${payload.roomCode}`);
    }

    function onMatchEnd() {
      clearActiveMatch();
    }

    function onMatchUpdate(payload: { matchEnded?: boolean }) {
      if (payload.matchEnded) {
        clearActiveMatch();
      }
    }

    function onPublicOfferCancelled() {
      clearActiveMatch();
    }

    socket.on("room:created", onRoomCreated);
    socket.on("room:joined", onRoomJoined);
    socket.on("publicOffer:created", onPublicOfferCreated);
    socket.on("publicOffer:matched", onPublicOfferMatched);
    socket.on("publicOffer:cancelled", onPublicOfferCancelled);
    socket.on("match:end", onMatchEnd);
    socket.on("match:update", onMatchUpdate);

    return () => {
      socket.off("room:created", onRoomCreated);
      socket.off("room:joined", onRoomJoined);
      socket.off("publicOffer:created", onPublicOfferCreated);
      socket.off("publicOffer:matched", onPublicOfferMatched);
      socket.off("publicOffer:cancelled", onPublicOfferCancelled);
      socket.off("match:end", onMatchEnd);
      socket.off("match:update", onMatchUpdate);
    };
  }, [router]);

  return null;
}