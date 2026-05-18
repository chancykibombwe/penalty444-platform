import type { Server } from "socket.io";

const playerSockets = new Map<string, Set<string>>();
const socketPlayers = new Map<string, string>();
const tournamentSubscribers = new Map<string, Set<string>>();
const socketTournamentSubscriptions = new Map<string, Set<string>>();

function removeSocketFromPlayer(playerId: string, socketId: string): void {
  const sockets = playerSockets.get(playerId);
  if (!sockets) {
    return;
  }

  sockets.delete(socketId);
  if (sockets.size === 0) {
    playerSockets.delete(playerId);
  }
}

function removeSocketFromTournament(tournamentId: string, socketId: string): void {
  const subscribers = tournamentSubscribers.get(tournamentId);
  if (!subscribers) {
    return;
  }

  subscribers.delete(socketId);
  if (subscribers.size === 0) {
    tournamentSubscribers.delete(tournamentId);
  }
}

export function registerPlayerSocket(playerId: string, socketId: string): void {
  const trimmedPlayerId = playerId.trim();
  const trimmedSocketId = socketId.trim();

  if (!trimmedPlayerId || !trimmedSocketId) {
    return;
  }

  const existingPlayerId = socketPlayers.get(trimmedSocketId);
  if (existingPlayerId && existingPlayerId !== trimmedPlayerId) {
    removeSocketFromPlayer(existingPlayerId, trimmedSocketId);
  }

  let sockets = playerSockets.get(trimmedPlayerId);
  if (!sockets) {
    sockets = new Set();
    playerSockets.set(trimmedPlayerId, sockets);
  }

  sockets.add(trimmedSocketId);
  socketPlayers.set(trimmedSocketId, trimmedPlayerId);
}

export function unregisterSocket(socketId: string): void {
  const trimmedSocketId = socketId.trim();
  if (!trimmedSocketId) {
    return;
  }

  const playerId = socketPlayers.get(trimmedSocketId);
  if (playerId) {
    removeSocketFromPlayer(playerId, trimmedSocketId);
    socketPlayers.delete(trimmedSocketId);
  }

  const tournamentIds = socketTournamentSubscriptions.get(trimmedSocketId);
  if (tournamentIds) {
    for (const tournamentId of tournamentIds) {
      removeSocketFromTournament(tournamentId, trimmedSocketId);
    }
    socketTournamentSubscriptions.delete(trimmedSocketId);
  }
}

export function subscribeSocketToTournament(
  tournamentId: string,
  socketId: string
): void {
  const trimmedTournamentId = tournamentId.trim();
  const trimmedSocketId = socketId.trim();

  if (!trimmedTournamentId || !trimmedSocketId) {
    return;
  }

  let subscribers = tournamentSubscribers.get(trimmedTournamentId);
  if (!subscribers) {
    subscribers = new Set();
    tournamentSubscribers.set(trimmedTournamentId, subscribers);
  }

  subscribers.add(trimmedSocketId);

  let subscriptions = socketTournamentSubscriptions.get(trimmedSocketId);
  if (!subscriptions) {
    subscriptions = new Set();
    socketTournamentSubscriptions.set(trimmedSocketId, subscriptions);
  }

  subscriptions.add(trimmedTournamentId);
}

export function unsubscribeSocketFromTournament(
  tournamentId: string,
  socketId: string
): void {
  const trimmedTournamentId = tournamentId.trim();
  const trimmedSocketId = socketId.trim();

  if (!trimmedTournamentId || !trimmedSocketId) {
    return;
  }

  removeSocketFromTournament(trimmedTournamentId, trimmedSocketId);

  const subscriptions = socketTournamentSubscriptions.get(trimmedSocketId);
  if (!subscriptions) {
    return;
  }

  subscriptions.delete(trimmedTournamentId);
  if (subscriptions.size === 0) {
    socketTournamentSubscriptions.delete(trimmedSocketId);
  }
}

export function emitToPlayer(
  io: Server,
  playerId: string,
  event: string,
  payload: unknown
): void {
  const trimmedPlayerId = playerId.trim();
  if (!trimmedPlayerId) {
    return;
  }

  const sockets = playerSockets.get(trimmedPlayerId);
  if (!sockets) {
    return;
  }

  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload);
  }
}

export function emitToTournament(
  io: Server,
  tournamentId: string,
  event: string,
  payload: unknown
): void {
  const trimmedTournamentId = tournamentId.trim();
  if (!trimmedTournamentId) {
    return;
  }

  const subscribers = tournamentSubscribers.get(trimmedTournamentId);
  if (!subscribers) {
    return;
  }

  for (const socketId of subscribers) {
    io.to(socketId).emit(event, payload);
  }
}

export type EmitTournamentMatchReadyParams = {
  tournamentId: string;
  tournamentMatchId: string;
  roomCode: string;
  playerIds: string[];
  autoRouteInMs?: number;
};

export function emitTournamentMatchReady(
  io: Server,
  {
    tournamentId,
    tournamentMatchId,
    roomCode,
    playerIds,
    autoRouteInMs = 3000,
  }: EmitTournamentMatchReadyParams
): void {
  const trimmedTournamentId = tournamentId.trim();
  const trimmedMatchId = tournamentMatchId.trim();
  const trimmedRoomCode = roomCode.trim();

  if (!trimmedTournamentId || !trimmedMatchId || !trimmedRoomCode) {
    return;
  }

  const payload = {
    tournamentId: trimmedTournamentId,
    tournamentMatchId: trimmedMatchId,
    roomCode: trimmedRoomCode,
    autoRouteInMs,
  };

  const notified = new Set<string>();

  for (const playerId of playerIds) {
    const trimmedPlayerId = playerId.trim();
    if (!trimmedPlayerId || notified.has(trimmedPlayerId)) {
      continue;
    }

    notified.add(trimmedPlayerId);
    emitToPlayer(io, trimmedPlayerId, "tournament:matchReady", payload);
  }
}

export function getRealtimeRegistryStats() {
  let registeredPlayerSockets = 0;
  for (const sockets of playerSockets.values()) {
    registeredPlayerSockets += sockets.size;
  }

  let tournamentSubscriberSockets = 0;
  for (const subscribers of tournamentSubscribers.values()) {
    tournamentSubscriberSockets += subscribers.size;
  }

  return {
    registeredPlayers: playerSockets.size,
    registeredPlayerSockets,
    subscribedTournaments: tournamentSubscribers.size,
    tournamentSubscriberSockets,
  };
}
