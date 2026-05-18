import type { PublicMatchOffer, RankedQueueEntry, Room } from "../types/room";

export const rooms = new Map<string, Room>();

/** Bracket slot id → active realtime room code (in-process idempotency). */
export const tournamentMatchRooms = new Map<string, string>();

export const publicOffers = new Map<string, PublicMatchOffer>();

export const playerActiveRooms = new Map<string, string>();

/** FIFO ranked matchmaking (v1: no MMR / stakes). Keyed by `playerId`. */
export const rankedQueue = new Map<string, RankedQueueEntry>();
