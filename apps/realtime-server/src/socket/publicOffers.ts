import type { Server, Socket } from "socket.io";
import { clearRoomTimer } from "../gameplay/timers";
import { cleanUsername, generateOfferId } from "../room/codes";
import { evaluateMatchStart } from "../room/readiness";
import { playerActiveRooms, publicOffers, rooms } from "../state/stores";
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
import { allowSocketAction } from "../security/rateLimit";
import {
  jwtEnforcementEnabled,
  jwtMatchesPlayer,
} from "../security/jwt";
import { diagLog } from "../diagnostics/log";

/**
 * Host-disconnect grace window for public match offers.
 *
 * Previously, the moment a host's socket dropped (refresh, brief
 * network blip, navigation), the offer was deleted immediately. This
 * made offers feel fragile to hosts and forced lobby viewers to
 * watch offers vanish/reappear on every minor disconnect.
 *
 * 15s matches the typical socket.io reconnect window the web client
 * uses; long enough to absorb a refresh / quick network hiccup, short
 * enough that lobby viewers don't see stale offers from genuinely-gone
 * hosts.
 */
export const PUBLIC_OFFER_HOST_GRACE_MS = 15_000;

/**
 * Server-only handle map for host-disconnect grace timers. Not part
 * of the offer object (timers don't serialise to clients and we want
 * the wire shape kept narrow).
 */
const publicOfferHostGraceTimers = new Map<string, NodeJS.Timeout>();

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

  diagLog(
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

  diagLog(
    `[publicOffers:update -> socket] reason=${reason} socket=${socketId} offers=${payload.offers.length}`
  );

  socket.emit("publicOffers:update", payload);
}

/**
 * Hard-removal of a public offer after the host's grace window has
 * elapsed. Mirrors `publicOffer:cancel`: legacy stake unlock, parallel
 * economy refund, active-room clear, single-player room cleanup, and
 * lobby snapshot re-emit. Idempotent — safe to call when the offer is
 * already gone.
 */
async function removeAbandonedPublicOffer(
  offer: PublicMatchOffer,
  reason: string
): Promise<void> {
  const deps = getDeps();

  const liveOffer = publicOffers.get(offer.offerId);
  if (!liveOffer) return;

  publicOffers.delete(offer.offerId);
  publicOfferHostGraceTimers.delete(offer.offerId);

  const waitingRoom = rooms.get(offer.roomCode);
  if (
    waitingRoom &&
    waitingRoom.players.length === 1 &&
    !waitingRoom.matchEnded
  ) {
    clearRoomTimer(waitingRoom);
    rooms.delete(offer.roomCode);
  }

  try {
    await deps.unlockStake(offer.hostPlayerId, offer.stakeAmount);
  } catch (error) {
    console.error(
      `[publicOffer:hostGrace] unlockStake failed offerId=${offer.offerId} ` +
        `playerId=${offer.hostPlayerId} reason=${reason}`,
      error
    );
  }

  if (waitingRoom) {
    try {
      await refundMatchEscrowForPlayer(waitingRoom, offer.hostPlayerId);
    } catch (error) {
      console.error(
        `[publicOffer:hostGrace] refundMatchEscrow failed offerId=${offer.offerId} ` +
          `playerId=${offer.hostPlayerId} reason=${reason}`,
        error
      );
    }
  }

  deps.clearPlayerActiveRoom(offer.hostPlayerId);

  diagLog(
    `[publicOffer:hostGrace] OFFER_REMOVED offerId=${offer.offerId} ` +
      `roomCode=${offer.roomCode} hostPlayerId=${offer.hostPlayerId} ` +
      `reason=${reason}`
  );

  emitPublicOffers(reason);
}

/**
 * Mark the offer as host-disconnected and arm the grace timer. If a
 * grace is already armed for this offer (e.g. a flapping connection
 * dropped a second time before reviving) the existing timer is
 * cancelled and a fresh one is scheduled. Pure-noop if the offer was
 * already cleaned up.
 */
export function scheduleHostDisconnectGrace(offerId: string): void {
  const offer = publicOffers.get(offerId);
  if (!offer) return;

  const existingTimer = publicOfferHostGraceTimers.get(offerId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    publicOfferHostGraceTimers.delete(offerId);
  }

  const now = Date.now();
  offer.hostDisconnectedAt = now;
  offer.hostExpiresAt = now + PUBLIC_OFFER_HOST_GRACE_MS;

  diagLog(
    `[publicOffer:hostGrace] GRACE_ARMED offerId=${offerId} ` +
      `roomCode=${offer.roomCode} hostPlayerId=${offer.hostPlayerId} ` +
      `expiresAt=${offer.hostExpiresAt}`
  );

  const timer = setTimeout(() => {
    const stillLive = publicOffers.get(offerId);
    if (!stillLive) {
      publicOfferHostGraceTimers.delete(offerId);
      return;
    }

    // Defensive: another path may have cleared `hostDisconnectedAt`
    // without going through `cancelHostDisconnectGrace` (e.g. an
    // explicit cancel or join). In that case the offer is alive and
    // we must NOT remove it.
    if (stillLive.hostDisconnectedAt === undefined) {
      publicOfferHostGraceTimers.delete(offerId);
      return;
    }

    void removeAbandonedPublicOffer(
      stillLive,
      "publicOffer:hostGrace expired"
    );
  }, PUBLIC_OFFER_HOST_GRACE_MS);

  publicOfferHostGraceTimers.set(offerId, timer);

  emitPublicOffers("publicOffer:hostGrace armed");
}

/**
 * Cancel an armed host-disconnect grace timer and clear the
 * disconnected flags on the offer. Idempotent.
 */
function cancelHostDisconnectGrace(offerId: string): void {
  const timer = publicOfferHostGraceTimers.get(offerId);
  if (timer) {
    clearTimeout(timer);
    publicOfferHostGraceTimers.delete(offerId);
  }

  const offer = publicOffers.get(offerId);
  if (offer) {
    offer.hostDisconnectedAt = undefined;
    offer.hostExpiresAt = undefined;
  }
}

/**
 * Revive every public offer hosted by `playerId` that is currently
 * inside its disconnect-grace window:
 *   - Cancel the grace timer.
 *   - Clear the disconnect flags.
 *   - Re-bind `room.players[0].socketId` to the fresh socket so the
 *     NEXT disconnect can correctly key off this socket.
 *   - Re-assert the host's `playerActiveRooms` mapping in case it was
 *     cleared by a stale path.
 *   - Emit a fresh lobby snapshot.
 *
 * Called from the JWT-verified user hook AND from `player:register`
 * — both fire on lobby reconnect without requiring any frontend
 * changes. Idempotent and cheap when no matching offer exists.
 */
export function revivePublicOffersForPlayer(
  playerId: string,
  newSocketId: string
): void {
  if (typeof playerId !== "string" || playerId.length === 0) return;

  let revivedAny = false;

  for (const offer of publicOffers.values()) {
    if (offer.hostPlayerId !== playerId) continue;
    if (offer.hostDisconnectedAt === undefined) continue;

    cancelHostDisconnectGrace(offer.offerId);

    const room = rooms.get(offer.roomCode);
    if (room) {
      const hostSlot = room.players.find(
        (p) => p.playerId === playerId
      );
      if (hostSlot) {
        hostSlot.socketId = newSocketId;
      }
    }

    playerActiveRooms.set(playerId, offer.roomCode);

    revivedAny = true;
    diagLog(
      `[publicOffer:hostGrace] REVIVED offerId=${offer.offerId} ` +
        `roomCode=${offer.roomCode} hostPlayerId=${playerId} ` +
        `newSocketId=${newSocketId}`
    );
  }

  if (revivedAny) {
    emitPublicOffers("publicOffer:hostGrace revived");
  }
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
        diagLog("publicOffer:create received", {
          playerId,
          username,
          stakeLabel,
          rounds,
          socketId: socket.id,
        });

        if (
          !allowSocketAction(socket.id, "publicOffer:create", { playerId })
        ) {
          socket.emit("publicOffers:error", {
            message: "Too many offer attempts. Please wait a moment.",
          });
          return;
        }

        if (!playerId) {
          socket.emit("publicOffers:error", {
            message: "Missing player ID.",
          });
          return;
        }

        // Sprint 4 TASK 4: soft JWT cross-check (hard reject in
        // enforce mode) on the host playerId.
        if (!jwtMatchesPlayer(socket, playerId)) {
          if (jwtEnforcementEnabled()) {
            console.warn(
              `[Security] publicOffer:create jwt_player_mismatch socketId=${socket.id} ` +
                `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
            );
            socket.emit("publicOffers:error", {
              message: "Authentication mismatch. Please sign in again.",
            });
            return;
          }
          console.warn(
            `[Security] publicOffer:create jwt_player_mismatch (soft) socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
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

        // Phase 8B beta lock — Public Offers are Free Play only. Hard-force
        // the stake label/amount server-side regardless of what the client
        // sends; a crafted `stakeLabel` of "K10"/"K50"/"K100"/etc. must
        // never be allowed to reach `lockStake()` with a non-zero amount.
        // Paid public offers require a future, explicitly-enabled economy
        // phase — this is intentionally not derived from `getStakeAmount`.
        if (stakeLabel && stakeLabel.trim().toUpperCase() !== "FREE") {
          console.warn(
            `[Security] publicOffer:create non-free stakeLabel rejected ` +
              `socketId=${socket.id} playerId=${playerId} stakeLabel=${stakeLabel}`
          );
        }
        const safeStakeLabel = "Free";
        const stakeAmount = 0;

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
              // Phase 6C — host is on /lobby at offer creation time.
              // Presence flips on the subsequent `player:present`.
              present: false,
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

        diagLog("publicOffer:created sent", offer);
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
        diagLog("publicOffer:join received", {
          offerId,
          playerId,
          username,
          socketId: socket.id,
        });

        if (
          !allowSocketAction(socket.id, "publicOffer:join", { playerId })
        ) {
          socket.emit("publicOffers:error", {
            message: "Too many join attempts. Please wait a moment.",
          });
          return;
        }

        // Sprint 4 TASK 4: soft JWT cross-check on the joining player.
        if (!jwtMatchesPlayer(socket, playerId)) {
          if (jwtEnforcementEnabled()) {
            console.warn(
              `[Security] publicOffer:join jwt_player_mismatch socketId=${socket.id} ` +
                `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
            );
            socket.emit("publicOffers:error", {
              message: "Authentication mismatch. Please sign in again.",
            });
            return;
          }
          console.warn(
            `[Security] publicOffer:join jwt_player_mismatch (soft) socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
        }

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

        // Rule 5: do not let a guest land in a broken room while the
        // host is mid-reconnect. The host either returns inside the
        // grace window (offer revives + becomes joinable again) or
        // the grace timer wipes the offer cleanly. Either way, the
        // guest's wallet is never touched.
        if (offer.hostDisconnectedAt !== undefined) {
          socket.emit("publicOffers:error", {
            message:
              "Host is reconnecting. Please try again in a few seconds.",
          });
          emitPublicOffersToSocket(socket.id, "join blocked by host grace");
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

        // Phase 8B beta lock — Public Offers are Free Play only. Defense
        // in depth: even though `publicOffer:create` now always persists
        // `stakeAmount: 0`, never let a join lock a non-zero stake. Paid
        // public offers require a future, explicitly-enabled economy
        // phase.
        const joinStakeAmount = 0;

        const lockResult = await deps.lockStake(playerId, joinStakeAmount);

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
          // Phase 6C — accepting player has just been notified but
          // their `MatchRoomPanel` has not mounted yet. Presence
          // flips true on the subsequent `player:present`.
          present: false,
        });

        room.roles[playerId] = "KEEPER";
        room.scores[playerId] = 0;

        socket.join(offer.roomCode);

        deps.setPlayerActiveRoom(playerId, offer.roomCode);
        deps.setPlayerActiveRoom(offer.hostPlayerId, offer.roomCode);

        // Defensive: clear any stale host-disconnect grace timer for
        // this offer. The grace guard above already blocks joins while
        // the host is mid-reconnect, but if a race lets us through
        // we still want the timer cleaned so its callback can't
        // remove the now-matched offer.
        cancelHostDisconnectGrace(offerId);

        publicOffers.delete(offerId);
        emitPublicOffers("publicOffer:join matched");

        deps.emitRoomUpdate(offer.roomCode, room);
        deps.emitMatchState(offer.roomCode, room);

        deps.io.to(offer.roomCode).emit("publicOffer:matched", {
          roomCode: offer.roomCode,
        });

        // Phase 6C — readiness authority gates `startRoundTimer`.
        // Both players are still on /lobby; the timer will arm only
        // once both `MatchRoomPanel`s emit `player:present`.
        evaluateMatchStart(offer.roomCode, room);

        diagLog("publicOffer:matched sent", offer.roomCode);
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
      if (
        !allowSocketAction(socket.id, "publicOffer:cancel", { playerId })
      ) {
        return;
      }

      const offer = publicOffers.get(offerId);

      if (!offer) return;

      if (offer.hostPlayerId !== playerId) {
        socket.emit("publicOffers:error", {
          message: "Only the host can cancel this offer.",
        });
        return;
      }

      // Sprint 4 TASK 4: soft JWT cross-check on cancel — also blocks
      // a stranger trying to cancel via the host's playerId.
      if (!jwtMatchesPlayer(socket, playerId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] publicOffer:cancel jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          socket.emit("publicOffers:error", {
            message: "Authentication mismatch.",
          });
          return;
        }
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

      // If the host had an active disconnect-grace timer (rare race:
      // host reconnects, immediately cancels), clear it so the timer
      // callback doesn't fire a redundant `OFFER_REMOVED` later.
      cancelHostDisconnectGrace(offerId);

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
