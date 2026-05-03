"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { clearActiveMatch, saveActiveMatch } from "../../lib/match/activeMatch";

type PublicMatchOffer = {
  offerId: string;
  roomCode: string;
  hostPlayerId: string;
  hostUsername: string;
  stakeLabel: string;
  stakeAmount?: number;
  rounds: number;
  createdAt: number;
};

export default function PublicMatchOffersPanel() {
  const router = useRouter();

  const [offers, setOffers] = useState<PublicMatchOffer[]>([]);
  const [stakeLabel, setStakeLabel] = useState("Free");
  const [rounds, setRounds] = useState(3);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [joiningOfferId, setJoiningOfferId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function requestLatestOffers() {
      socket.emit("publicOffers:request");
    }

    function onConnect() {
      console.log("Lobby socket connected:", socket.id);
      setConnected(true);
      setStatus("");
      requestLatestOffers();
    }

    function onReconnectAttempt(attempt: number) {
      console.log("Lobby socket reconnect attempt:", attempt);
      setStatus(`Reconnecting to server... attempt ${attempt}`);
    }

    function onConnectError(error: Error) {
      console.warn("Lobby socket connect error:", error.message);
      setConnected(false);
      setStatus("Could not connect to realtime server.");
      setCreating(false);
      setJoiningOfferId(null);
    }

    function onDisconnect(reason: string) {
      console.warn("Lobby socket disconnected:", reason);
      setConnected(false);
      setStatus("Disconnected from server. Trying to reconnect...");
      setCreating(false);
      setJoiningOfferId(null);
    }

    function onOffersUpdate(payload: { offers: PublicMatchOffer[] }) {
      if (!payload || !Array.isArray(payload.offers)) {
        console.warn("Invalid publicOffers:update payload:", payload);
        return;
      }

      const incomingOffers = payload.offers;

      console.log("Received publicOffers:update:", incomingOffers.length);

      setOffers((previousOffers) => {
        const sortedIncoming = [...incomingOffers].sort(
          (a, b) => b.createdAt - a.createdAt
        );

        if (sortedIncoming.length === 0 && previousOffers.length > 0) {
          console.warn(
            "Ignoring empty public offers overwrite while previous offers exist."
          );
          return previousOffers;
        }

        return sortedIncoming;
      });
    }

    function onOfferCreated(payload: { offer: PublicMatchOffer }) {
      console.log("Received publicOffer:created:", payload);
      setCreating(false);

      if (!payload.offer?.roomCode) {
        setStatus("Offer created, but room code was missing.");
        return;
      }

      saveActiveMatch(payload.offer.roomCode);
      setStatus("Public match offer created. Waiting for opponent...");
      router.push(`/match/${payload.offer.roomCode}`);
    }

    function onMatched(payload: { roomCode: string }) {
      console.log("Received publicOffer:matched:", payload);
      setCreating(false);
      setJoiningOfferId(null);

      if (!payload.roomCode) {
        setStatus("Match found, but room code was missing.");
        return;
      }

      saveActiveMatch(payload.roomCode);
      setStatus("Opponent found. Entering match...");
      router.push(`/match/${payload.roomCode}`);
    }

    function onError(payload: { message: string }) {
      console.warn("Received publicOffers:error:", payload);
      setCreating(false);
      setJoiningOfferId(null);
      setStatus(payload.message || "Something went wrong.");
      requestLatestOffers();
    }

    function onCancelled() {
      console.log("Received publicOffer:cancelled");
      setCreating(false);
      setJoiningOfferId(null);
      clearActiveMatch();
      setStatus("Public offer cancelled.");
      requestLatestOffers();
    }

    function onActiveRoomCleared(payload: { message?: string }) {
      clearActiveMatch();
      setCreating(false);
      setJoiningOfferId(null);
      setStatus(payload.message || "Saved/active match cleared.");
      requestLatestOffers();
    }

    function onActiveRoomClearError(payload: { message?: string }) {
      setCreating(false);
      setJoiningOfferId(null);
      setStatus(payload.message || "Could not clear active match.");
      requestLatestOffers();
    }

    socket.on("connect", onConnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.on("publicOffers:update", onOffersUpdate);
    socket.on("publicOffer:created", onOfferCreated);
    socket.on("publicOffer:matched", onMatched);
    socket.on("publicOffers:error", onError);
    socket.on("publicOffer:cancelled", onCancelled);
    socket.on("activeRoom:cleared", onActiveRoomCleared);
    socket.on("activeRoom:clear:error", onActiveRoomClearError);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      socket.off("publicOffers:update", onOffersUpdate);
      socket.off("publicOffer:created", onOfferCreated);
      socket.off("publicOffer:matched", onMatched);
      socket.off("publicOffers:error", onError);
      socket.off("publicOffer:cancelled", onCancelled);
      socket.off("activeRoom:cleared", onActiveRoomCleared);
      socket.off("activeRoom:clear:error", onActiveRoomClearError);
    };
  }, [router]);

  async function createOffer() {
    if (creating) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setCreating(true);
    setStatus("Creating public match offer...");

    const timeoutId = window.setTimeout(() => {
      setCreating(false);
      setStatus(
        "No response from server. Check backend terminal for error, then try again."
      );
    }, 8000);

    try {
      const identity = await getCurrentPlayerIdentity();

      socket.once("publicOffer:created", () => {
        window.clearTimeout(timeoutId);
      });

      socket.once("publicOffers:error", () => {
        window.clearTimeout(timeoutId);
      });

      socket.emit("publicOffer:create", {
        playerId: identity.playerId,
        username: identity.username,
        stakeLabel,
        rounds,
      });
    } catch {
      window.clearTimeout(timeoutId);
      setCreating(false);
      setStatus("Failed to load player identity. Please login again.");
    }
  }

  async function joinOffer(offerId: string) {
    if (joiningOfferId) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setJoiningOfferId(offerId);
    setStatus("Joining public match...");

    const timeoutId = window.setTimeout(() => {
      setJoiningOfferId(null);
      setStatus(
        "No response from server. Check backend terminal for error, then try again."
      );
    }, 8000);

    try {
      const identity = await getCurrentPlayerIdentity();

      socket.once("publicOffer:matched", () => {
        window.clearTimeout(timeoutId);
      });

      socket.once("publicOffers:error", () => {
        window.clearTimeout(timeoutId);
      });

      socket.emit("publicOffer:join", {
        offerId,
        playerId: identity.playerId,
        username: identity.username,
      });
    } catch {
      window.clearTimeout(timeoutId);
      setJoiningOfferId(null);
      setStatus("Failed to load player identity. Please login again.");
    }
  }

  async function clearSavedMatch() {
    clearActiveMatch();

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Local saved match cleared. Reconnecting to clear server state...");
      return;
    }

    try {
      const identity = await getCurrentPlayerIdentity();

      socket.emit("activeRoom:clear", {
        playerId: identity.playerId,
      });

      setStatus("Clearing saved/active match...");
    } catch {
      setStatus("Local saved match cleared.");
    }
  }

  function refreshLobby() {
    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Reconnecting to server...");
      return;
    }

    socket.emit("publicOffers:request");
    setStatus("Refreshing public offers...");
  }

  return (
    <section className="space-y-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Public Challenges
        </p>

        <h2 className="mt-2 text-2xl font-bold text-white">
          Public Match Offers
        </h2>

        <p className="mt-2 text-zinc-400">
          Create a visible challenge or join another player’s open match.
        </p>

        <p className="mt-3 text-xs text-zinc-500">
          Realtime:{" "}
          <span className={connected ? "text-emerald-400" : "text-red-400"}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-2 block text-sm text-zinc-300">
            Stake Label
          </label>

          <select
            value={stakeLabel}
            onChange={(event) => setStakeLabel(event.target.value)}
            disabled={creating}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none disabled:opacity-50"
          >
            <option value="Free">Free</option>
            <option value="K10">K10</option>
            <option value="K50">K50</option>
            <option value="K100">K100</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-zinc-300">Rounds</label>

          <select
            value={rounds}
            onChange={(event) => setRounds(Number(event.target.value))}
            disabled={creating}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none disabled:opacity-50"
          >
            <option value={3}>3 rounds</option>
            <option value={5}>5 rounds</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={createOffer}
            disabled={creating || !connected}
            className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Public Offer"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <button
          onClick={clearSavedMatch}
          className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-white hover:border-zinc-500"
        >
          Clear Saved Match
        </button>

        <button
          onClick={refreshLobby}
          className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-white hover:border-zinc-500"
        >
          Refresh Lobby
        </button>
      </div>

      {status ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
          {status}
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">Open Offers</h3>

        {offers.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
            No public offers yet.
          </div>
        ) : (
          offers.map((offer) => (
            <div
              key={offer.offerId}
              className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <p className="text-lg font-semibold text-white">
                  {offer.hostUsername}
                </p>

                <p className="mt-1 text-sm text-zinc-400">
                  Stake: {offer.stakeLabel} • Rounds: {offer.rounds}
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  Room: {offer.roomCode}
                </p>
              </div>

              <button
                onClick={() => joinOffer(offer.offerId)}
                disabled={joiningOfferId === offer.offerId || !connected}
                className="rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {joiningOfferId === offer.offerId ? "Joining..." : "Join Offer"}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}