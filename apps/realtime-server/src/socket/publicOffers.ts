import type { Server, Socket } from "socket.io";
import { clearRoomTimer } from "../gameplay/timers";
import { cleanUsername, generateOfferId } from "../room/codes";
import { publicOffers, rooms } from "../state/stores";
import type {
  MatchType,
  PublicMatchOffer,
  Room,
  RoomPlayer,
} from "../types/room";
import {
  lockMatchEscrowForPlayer,
  refundMatchEscrowForPlayer,
} from "../economy";

type CreateRoomWithPlayersFn = (
  players: RoomPlayer[],
  maxRounds?: number,
  matchType?: MatchType,
  stakeLabel?: string
) => { code: string; room: Room };

type PublicOfferHandlerDeps = {
  io: Server;
  createRoomWithPlayers: CreateRoomWithPlayersFn;
  getTrackedActiveRoom: (playerId?: string) => string | null;
  playerIsBusyInDifferentRoom: (
    playerId: string,
    targetRoomCode?: string
  ) => string | null;
  getStakeAmount: (stakeLabel?: string) => number;
  lockStake: (
    playerId: string,
    stakeAmount: number
  ) => Promise<{ ok: boolean; message: string }>;
  unlockStake: (playerId: string, stakeAmount: number) => Promise<void>;
  setPlayerActiveRoom: (playerId: string, roomCode: string) => void;
  clearPlayerActiveRoom: (playerId?: string) => void;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  startRoundTimer: (roomCode: string, room: Room) => void;
};

let offerDeps: PublicOfferHandlerDeps | null = null;

export function bindPublicOfferHandlers(deps: PublicOfferHandlerDeps): void {
  offerDeps = deps;
}

function getDeps(): PublicOfferHandlerDeps {
  if (!offerDeps) {
    throw new Error(
      "bindPublicOfferHandlers must be called before public offer handlers."
    );
  }
  return offerDeps;
}

function getPublicOffersPayload() {
  return {
    offers: Array.from(publicOffers.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    ),
  };
}

export function emitPublicOffers(reason = "manual") {
  const { io } = getDeps();
  const payload = getPublicOffersPayload();

  console.log(
    `[publicOffers:update] reason=${reason} offers=${payload.offers.length} connectedSockets=${io.engine.clientsCount}`
  );

  io.emit("publicOffers:update", payload);
}

export function emitPublicOffersToSocket(
  socketId: string,
  reason = "socket snapshot"
) {
  const { io } = getDeps();
  const socket = io.sockets.sockets.get(socketId);

  if (!socket) return;

  const payload = getPublicOffersPayload();

  console.log(
    `[publicOffers:update -> socket] reason=${reason} socket=${socketId} offers=${payload.offers.length}`
  );

  socket.emit("publicOffers:update", payload);
}

export function registerPublicOfferHandlers(socket: Socket) {
  const deps = getDeps();

  socket.on("publicOffers:request", () => {
    emitPublicOffersToSocket(socket.id, "client requested snapshot");
  });

  socket.on(
    "publicOffer:create",
    async ({
      playerId,
      username,
      stakeLabel,
      rounds,
    }: {
      playerId: string;
      username?: string;
      stakeLabel: string;
      rounds: number;
    }) => {
      try {
        console.log("publicOffer:create received", {
          playerId,
          username,
          stakeLabel,
          rounds,
          socketId: socket.id,
        });

        if (!playerId) {
          socket.emit("publicOffers:error", {
            message: "Missing player ID.",
          });
          return;
        }

        for (const offer of publicOffers.values()) {
          if (offer.hostPlayerId === playerId) {
            socket.emit("publicOffers:error", {
              message: "You already have an open public match offer.",
            });
            return;
          }
        }

        const busyRoomCode = deps.getTrackedActiveRoom(playerId);

        if (busyRoomCode) {
          socket.emit("publicOffers:error", {
            message: `You are already in an active room (${busyRoomCode}). Finish or leave that match first.`,
          });
          return;
        }

        const playerName = cleanUsername(username);
        const safeRounds = Number.isFinite(rounds) && rounds > 0 ? rounds : 3;
        const safeStakeLabel = stakeLabel?.trim() || "Free";
        const stakeAmount = deps.getStakeAmount(safeStakeLabel);

        const lockResult = await deps.lockStake(playerId, stakeAmount);

        if (!lockResult.ok) {
          socket.emit("publicOffers:error", {
            message: lockResult.message,
          });
          return;
        }

        if (stakeAmount > 0) {
          socket.emit("wallet:update", {
            reason: "stake_locked",
            playerId,
          });
        }

        const { code, room } = deps.createRoomWithPlayers(
          [
            {
              playerId,
              socketId: socket.id,
              username: playerName,
            },
          ],
          safeRounds,
          "public",
          safeStakeLabel
        );

        // Phase 11 TASK 1: parallel economy escrow lock for the host.
        // No-op when ECONOMY_ENABLED=false or stake=0. Failures roll
        // back the legacy lock and tear down the room so the user is
        // never charged on either side.
        const economyHostLock = await lockMatchEscrowForPlayer(
          room,
          playerId
        );
        if (economyHostLock.ok === false) {
          await deps.unlockStake(playerId, stakeAmount);
          clearRoomTimer(room);
          rooms.delete(code);
          deps.clearPlayerActiveRoom(playerId);
          socket.emit("publicOffers:error", {
            message: "Failed to lock arena escrow. Please try again.",
          });
          console.warn(
            `[Economy] host escrow lock failed → rolled back roomCode=${code} ` +
              `playerId=${playerId} reason=${economyHostLock.reason}`
          );
          return;
        }

        const offer: PublicMatchOffer = {
          offerId: generateOfferId(),
          roomCode: code,
          hostPlayerId: playerId,
          hostUsername: playerName,
          stakeLabel: safeStakeLabel,
          stakeAmount,
          rounds: safeRounds,
          createdAt: Date.now(),
        };

        publicOffers.set(offer.offerId, offer);
        deps.setPlayerActiveRoom(playerId, code);

        socket.emit("publicOffer:created", {
          offer,
        });

        emitPublicOffers("publicOffer:create");

        console.log("publicOffer:created sent", offer);
      } catch (error) {
        console.error("publicOffer:create crashed:", error);

        socket.emit("publicOffers:error", {
          message: "Failed to create public offer.",
        });
      }
    }
  );

  socket.on(
    "publicOffer:join",
    async ({
      offerId,
      playerId,
      username,
    }: {
      offerId: string;
      playerId: string;
      username?: string;
    }) => {
      try {
        console.log("publicOffer:join received", {
          offerId,
          playerId,
          username,
          socketId: socket.id,
        });

        const offer = publicOffers.get(offerId);

        if (!offer) {
          socket.emit("publicOffers:error", {
            message: "Offer no longer available.",
          });
          emitPublicOffersToSocket(socket.id, "join failed snapshot");
          return;
        }

        if (offer.hostPlayerId === playerId) {
          socket.emit("publicOffers:error", {
            message: "You cannot join your own offer.",
          });
          return;
        }

        const busyDifferentRoomCode = deps.playerIsBusyInDifferentRoom(
          playerId,
          offer.roomCode
        );

        if (busyDifferentRoomCode) {
          socket.emit("publicOffers:error", {
            message: `You are already in another active room (${busyDifferentRoomCode}). Finish or leave that match first.`,
          });
          return;
        }

        const room = rooms.get(offer.roomCode);

        if (!room) {
          await deps.unlockStake(offer.hostPlayerId, offer.stakeAmount);
          deps.clearPlayerActiveRoom(offer.hostPlayerId);
          publicOffers.delete(offerId);
          emitPublicOffers("publicOffer:join room missing");

          socket.emit("publicOffers:error", {
            message: "Room no longer exists.",
          });
          return;
        }

        if (room.matchEnded) {
          publicOffers.delete(offerId);
          deps.clearPlayerActiveRoom(offer.hostPlayerId);
          emitPublicOffers("publicOffer:join ended room");

          socket.emit("publicOffers:error", {
            message: "This match has already ended.",
          });
          return;
        }

        if (room.players.length >= 2) {
          publicOffers.delete(offerId);
          emitPublicOffers("publicOffer:join room filled");

          socket.emit("publicOffers:error", {
            message: "Room already filled.",
          });
          return;
        }

        const lockResult = await deps.lockStake(playerId, offer.stakeAmount);

        if (!lockResult.ok) {
          socket.emit("publicOffers:error", {
            message: lockResult.message,
          });
          return;
        }

        // Phase 11 TASK 1: parallel economy escrow lock for the guest.
        // If the lock fails we unwind the legacy lock so the player is
        // not charged. The host's escrow stays locked until they either
        // get matched with another guest or cancel.
        const economyGuestLock = await lockMatchEscrowForPlayer(
          room,
          playerId
        );
        if (economyGuestLock.ok === false) {
          await deps.unlockStake(playerId, offer.stakeAmount);
          socket.emit("publicOffers:error", {
            message: "Failed to lock arena escrow. Please try again.",
          });
          console.warn(
            `[Economy] guest escrow lock failed → reverted legacy lock ` +
              `roomCode=${offer.roomCode} playerId=${playerId} reason=${economyGuestLock.reason}`
          );
          return;
        }

        if (offer.stakeAmount > 0) {
          socket.emit("wallet:update", {
            reason: "stake_locked",
            playerId,
          });
        }

        const playerName = cleanUsername(username);

        room.players.push({
          playerId,
          socketId: socket.id,
          username: playerName,
        });

        room.roles[playerId] = "KEEPER";
        room.scores[playerId] = 0;

        socket.join(offer.roomCode);

        deps.setPlayerActiveRoom(playerId, offer.roomCode);
        deps.setPlayerActiveRoom(offer.hostPlayerId, offer.roomCode);

        publicOffers.delete(offerId);
        emitPublicOffers("publicOffer:join matched");

        deps.emitRoomUpdate(offer.roomCode, room);
        deps.emitMatchState(offer.roomCode, room);

        deps.io.to(offer.roomCode).emit("publicOffer:matched", {
          roomCode: offer.roomCode,
        });

        deps.startRoundTimer(offer.roomCode, room);

        console.log("publicOffer:matched sent", offer.roomCode);
      } catch (error) {
        console.error("publicOffer:join crashed:", error);

        socket.emit("publicOffers:error", {
          message: "Failed to join public offer.",
        });
      }
    }
  );

  socket.on(
    "publicOffer:cancel",
    async ({
      offerId,
      playerId,
    }: {
      offerId: string;
      playerId: string;
    }) => {
      const offer = publicOffers.get(offerId);

      if (!offer) return;

      if (offer.hostPlayerId !== playerId) {
        socket.emit("publicOffers:error", {
          message: "Only the host can cancel this offer.",
        });
        return;
      }

      const waitingRoom = rooms.get(offer.roomCode);
      if (
        waitingRoom &&
        waitingRoom.players.length === 1 &&
        !waitingRoom.matchEnded
      ) {
        clearRoomTimer(waitingRoom);
        rooms.delete(offer.roomCode);
      }

      publicOffers.delete(offerId);

      await deps.unlockStake(playerId, offer.stakeAmount);

      // Phase 11 TASK 3: parallel economy refund for the host. Safe
      // even when no economy escrow exists (no_escrow → benign skip).
      if (waitingRoom) {
        await refundMatchEscrowForPlayer(waitingRoom, playerId);
      }

      if (offer.stakeAmount > 0) {
        socket.emit("wallet:update", {
          reason: "stake_unlocked",
          playerId,
        });
      }

      deps.clearPlayerActiveRoom(playerId);
      emitPublicOffers("publicOffer:cancel");

      socket.emit("publicOffer:cancelled", {
        offerId,
      });
    }
  );
}
