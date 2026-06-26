"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { useLobbyConnection } from "../../lib/socket/LobbyConnectionProvider";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { clearActiveMatch, saveActiveMatch } from "../../lib/match/activeMatch";
import { GradientButton } from "../ui/GradientButton";
import EmptyState from "../ui/EmptyState";

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

function sortOffers(offers: PublicMatchOffer[]) {
  return [...offers].sort((a, b) => b.createdAt - a.createdAt);
}

export default function PublicMatchOffersPanel() {
  const router = useRouter();

  const [offers, setOffers] = useState<PublicMatchOffer[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [rounds, setRounds] = useState(3);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [joiningOfferId, setJoiningOfferId] = useState<string | null>(null);
  const [cancellingOfferId, setCancellingOfferId] = useState<string | null>(
    null
  );

  // Hotfix lobby-socket-bootstrap-stability: shared connection state.
  // The lobby provider owns the connect/disconnect listeners so this
  // panel can't desync with RankedMatchmakingPanel anymore.
  const { connected } = useLobbyConnection();

  function applyAuthoritativeOffers(incomingOffers: PublicMatchOffer[]) {
    const sortedIncoming = sortOffers(incomingOffers);
    setOffers(sortedIncoming);

    setJoiningOfferId((currentJoiningId) => {
      if (!currentJoiningId) return null;
      const stillExists = sortedIncoming.some(
        (offer) => offer.offerId === currentJoiningId
      );
      return stillExists ? currentJoiningId : null;
    });

    setCancellingOfferId((currentCancellingId) => {
      if (!currentCancellingId) return null;
      const stillExists = sortedIncoming.some(
        (offer) => offer.offerId === currentCancellingId
      );
      return stillExists ? currentCancellingId : null;
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadIdentity() {
      const identity = await getCurrentPlayerIdentity();
      if (!isMounted) return;
      setMyPlayerId(identity?.playerId ?? null);
    }

    loadIdentity();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    function requestLatestOffers() {
      socket.emit("publicOffers:request");
    }

    function onConnect() {
      // The provider owns `connected`; this handler exists purely to
      // refresh the offers list as soon as we land a connection.
      console.log("Lobby socket connected:", socket.id);
      setStatus("");
      requestLatestOffers();
    }

    function onReconnectAttempt(attempt: number) {
      console.log("Lobby socket reconnect attempt:", attempt);
      setStatus(`Reconnecting to server... attempt ${attempt}`);
    }

    function onConnectError(error: Error) {
      console.warn("Lobby socket connect error:", error.message);
      setStatus("Could not connect to realtime server.");
      setCreating(false);
      setJoiningOfferId(null);
      setCancellingOfferId(null);
    }

    function onDisconnect(reason: string) {
      console.warn("Lobby socket disconnected:", reason);
      setStatus("Disconnected from server. Trying to reconnect...");
      setCreating(false);
      setJoiningOfferId(null);
      setCancellingOfferId(null);
    }

    function onOffersUpdate(payload: { offers: PublicMatchOffer[] }) {
      if (!payload || !Array.isArray(payload.offers)) {
        console.warn("Invalid publicOffers:update payload:", payload);
        return;
      }

      console.log("Received publicOffers:update:", payload.offers.length);
      applyAuthoritativeOffers(payload.offers);
    }

    function onOfferCreated(payload: { offer: PublicMatchOffer }) {
      console.log("Received publicOffer:created:", payload);
      setCreating(false);

      if (!payload.offer?.roomCode) {
        setStatus("Challenge created, but room code was missing.");
        return;
      }

      const createdRoomCode = payload.offer.roomCode;
      void getCurrentPlayerIdentity().then((identity) => {
        if (identity?.playerId) {
          saveActiveMatch(createdRoomCode, identity.playerId);
        }
      });
      setStatus("Challenge open. Waiting for an opponent…");
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

      const matchedRoomCode = payload.roomCode;
      void getCurrentPlayerIdentity().then((identity) => {
        if (identity?.playerId) {
          saveActiveMatch(matchedRoomCode, identity.playerId);
        }
      });
      setStatus("Opponent found. Entering match...");
      router.push(`/match/${payload.roomCode}`);
    }

    function onError(payload: { message: string }) {
      console.warn("Received publicOffers:error:", payload);
      setCreating(false);
      setJoiningOfferId(null);
      setCancellingOfferId(null);
      setStatus(payload.message || "Something went wrong. Please try again.");
      requestLatestOffers();
    }

    function onCancelled(payload: { offerId?: string }) {
      console.log("Received publicOffer:cancelled:", payload);

      const cancelledOfferId = payload?.offerId;

      setOffers((previousOffers) => {
        const nextOffers = cancelledOfferId
          ? previousOffers.filter(
              (offer) => offer.offerId !== cancelledOfferId
            )
          : [];
        return sortOffers(nextOffers);
      });

      setJoiningOfferId(null);
      setCancellingOfferId(null);
      setCreating(false);
      clearActiveMatch();
      setStatus("Challenge cancelled.");
      requestLatestOffers();
    }

    function onActiveRoomCleared(payload: { message?: string }) {
      clearActiveMatch();
      setCreating(false);
      setJoiningOfferId(null);
      setCancellingOfferId(null);
      setStatus(payload.message || "Saved/active match cleared.");
      requestLatestOffers();
    }

    function onActiveRoomClearError(payload: { message?: string }) {
      setCreating(false);
      setJoiningOfferId(null);
      setCancellingOfferId(null);
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

    // If the singleton was already healthy when we mounted (e.g. the
    // user navigated back from /match), grab the latest offers right
    // away. The LobbyConnectionProvider owns the connect lifecycle so
    // we DO NOT call socket.connect() from here anymore — that was the
    // duplicate connect path that contributed to the "Disconnected"
    // first-load bug.
    if (socket.connected) {
      onConnect();
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
    setStatus("Opening challenge…");

    // Resolve identity BEFORE arming the timeout / attaching ack
    // listeners. Doing it the other way around opens a race where the
    // 8s timeout can fire mid-`await`, leaving the ack listeners
    // attached (because they were registered AFTER the timeout fired)
    // with no cleanup hook. That made every "slow start" retry stack
    // a fresh pair of listeners.
    let identity: Awaited<ReturnType<typeof getCurrentPlayerIdentity>>;
    try {
      identity = await getCurrentPlayerIdentity();
    } catch {
      setCreating(false);
      setStatus("Failed to load player identity. Please login again.");
      return;
    }

    if (!identity) {
      setCreating(false);
      router.replace("/auth/login");
      return;
    }

    setMyPlayerId(identity.playerId);

    // Now that identity is known, attach ack listeners FIRST so the
    // timeout closure always sees a valid `detachAcks`.
    const onAck = () => {
      window.clearTimeout(timeoutId);
      detachAcks();
    };
    socket.on("publicOffer:created", onAck);
    socket.on("publicOffers:error", onAck);
    const detachAcks = (() => {
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        socket.off("publicOffer:created", onAck);
        socket.off("publicOffers:error", onAck);
      };
    })();

    const timeoutId = window.setTimeout(() => {
      detachAcks();
      setCreating(false);
      setStatus(
        "Server is not responding. Please try again."
      );
    }, 8000);

    socket.emit("publicOffer:create", {
      playerId: identity.playerId,
      username: identity.username,
      stakeLabel: "Free",
      rounds,
    });
  }

  async function joinOffer(offerId: string) {
    if (joiningOfferId || cancellingOfferId) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setJoiningOfferId(offerId);
    setStatus("Joining match…");

    // See createOffer for the rationale: identity → listeners → timer.
    let identity: Awaited<ReturnType<typeof getCurrentPlayerIdentity>>;
    try {
      identity = await getCurrentPlayerIdentity();
    } catch {
      setJoiningOfferId(null);
      setStatus("Failed to load player identity. Please login again.");
      return;
    }

    if (!identity) {
      setJoiningOfferId(null);
      router.replace("/auth/login");
      return;
    }

    const onAck = () => {
      window.clearTimeout(timeoutId);
      detachAcks();
    };
    socket.on("publicOffer:matched", onAck);
    socket.on("publicOffers:error", onAck);
    const detachAcks = (() => {
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        socket.off("publicOffer:matched", onAck);
        socket.off("publicOffers:error", onAck);
      };
    })();

    const timeoutId = window.setTimeout(() => {
      detachAcks();
      setJoiningOfferId(null);
      setStatus(
        "Server is not responding. Please try again."
      );
    }, 8000);

    socket.emit("publicOffer:join", {
      offerId,
      playerId: identity.playerId,
      username: identity.username,
    });
  }

  async function cancelOffer(offerId: string) {
    if (cancellingOfferId || joiningOfferId) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setCancellingOfferId(offerId);
    setStatus("Cancelling challenge…");

    // See createOffer for the rationale: identity → listeners → timer.
    let identity: Awaited<ReturnType<typeof getCurrentPlayerIdentity>>;
    try {
      identity = await getCurrentPlayerIdentity();
    } catch {
      setCancellingOfferId(null);
      setStatus("Failed to load player identity. Please login again.");
      return;
    }

    if (!identity) {
      setCancellingOfferId(null);
      router.replace("/auth/login");
      return;
    }

    const onAck = () => {
      window.clearTimeout(timeoutId);
      detachAcks();
    };
    socket.on("publicOffer:cancelled", onAck);
    socket.on("publicOffers:error", onAck);
    const detachAcks = (() => {
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        socket.off("publicOffer:cancelled", onAck);
        socket.off("publicOffers:error", onAck);
      };
    })();

    const timeoutId = window.setTimeout(() => {
      detachAcks();
      setCancellingOfferId(null);
      setStatus(
        "Server is not responding. Please try again."
      );
    }, 8000);

    socket.emit("publicOffer:cancel", {
      offerId,
      playerId: identity.playerId,
    });
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

      if (!identity) {
        router.replace("/auth/login");
        return;
      }

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
    setStatus("Refreshing…");
  }

  return (
    <section className="space-y-2 overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] sm:space-y-2.5 sm:p-4">
      <div>
        <p className="hidden text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:block">
          Active Rooms
        </p>

        <h2 className="text-base font-black tracking-tight text-white sm:mt-1 sm:text-xl">
          Open Challenges
        </h2>

        <p className="mt-1 hidden text-sm text-zinc-400 sm:block">
          Create an open challenge or join one to play a free match.
        </p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
          <div className="hidden sm:block">
            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Stake
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5">
              <span className="text-sm font-black text-emerald-300">Free</span>
              <span className="text-xs text-zinc-600">· Paid stakes coming soon</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Rounds
            </label>

            <select
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
              disabled={creating || Boolean(cancellingOfferId)}
              className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-zinc-500 disabled:opacity-50"
            >
              <option value={3}>3 rounds</option>
              <option value={5}>5 rounds</option>
            </select>
          </div>

          <div className="flex items-end">
            <GradientButton
              variant="primary"
              onClick={createOffer}
              disabled={creating || !connected || Boolean(cancellingOfferId)}
              className="w-full !min-h-[36px] !px-3 !py-1.5 !text-xs"
            >
              {creating ? "Opening…" : "Open Challenge"}
            </GradientButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800/80 pt-2">
          <button
            type="button"
            onClick={clearSavedMatch}
            className="text-[10px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            Clear saved match
          </button>

          <button
            type="button"
            onClick={refreshLobby}
            className="text-[10px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            Refresh lobby
          </button>
        </div>

        {status ? (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-400">
            {status}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            Open Challenges
          </p>

          {offers.length === 0 ? (
            <EmptyState
              icon="⚔"
              title="No open challenges"
              subtitle="Create one above to wait for an opponent"
              compact
            />
          ) : (
            offers.map((offer) => {
              const isHostWaitingOffer =
                myPlayerId !== null && offer.hostPlayerId === myPlayerId;

              return (
                <div
                  key={offer.offerId}
                  className={`flex flex-col gap-2 rounded-2xl border border-l-2 py-2 pl-4 pr-3 sm:flex-row sm:items-center sm:justify-between ${
                    isHostWaitingOffer
                      ? "border-cyan-500/30 border-l-cyan-400/60 bg-cyan-950/15 shadow-[0_0_24px_rgba(34,211,238,0.06)]"
                      : "border-zinc-800/60 border-l-violet-500/40 bg-zinc-900/40"
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-black text-white">
                        {offer.hostUsername}
                      </p>
                      {isHostWaitingOffer ? (
                        <span className="rounded-full border border-cyan-400/40 bg-cyan-950/40 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">
                          Your challenge
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-zinc-400">
                      Stake: {offer.stakeLabel} · Rounds: {offer.rounds}
                    </p>

                    <p className="mt-1 text-[11px] font-mono text-zinc-600">
                      {offer.roomCode}
                    </p>

                    {isHostWaitingOffer ? (
                      <p className="mt-2 text-xs text-cyan-200/80">
                        Waiting for an opponent. Cancel anytime before someone
                        joins.
                      </p>
                    ) : null}
                  </div>

                  {isHostWaitingOffer ? (
                    <button
                      type="button"
                      onClick={() => cancelOffer(offer.offerId)}
                      disabled={
                        cancellingOfferId === offer.offerId || !connected
                      }
                      className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-100 hover:border-red-400/60 hover:bg-red-950/50 disabled:opacity-50"
                    >
                      {cancellingOfferId === offer.offerId
                        ? "Cancelling…"
                        : "Cancel"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => joinOffer(offer.offerId)}
                      disabled={
                        joiningOfferId === offer.offerId ||
                        Boolean(cancellingOfferId) ||
                        !connected
                      }
                      className="rounded-xl border border-zinc-700/80 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-zinc-500 disabled:opacity-50"
                    >
                      {joiningOfferId === offer.offerId
                        ? "Joining…"
                        : "Join Challenge"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
