import express from "express";
import http from "http";
import { Server, type Socket } from "socket.io";
import cors from "cors";
import {
  EARLY_CANCEL_MS,
  MAX_SUDDEN_DEATH_CYCLES,
  PICK_TIMEOUT_MS,
  realtimeInternalSecret,
  RESULT_REVEAL_PAUSE_MS,
  supabase,
} from "./config";

const TOURNAMENT_ROUND_CONTINUATION_MS = 1200;
import {
  playerActiveRooms,
  publicOffers,
  rankedQueue,
  rooms,
  tournamentMatchRooms,
} from "./state/stores";
import {
  ensureAuthoritativeRoomRoles,
  getPlayerByRole,
  getPointWinnerRole,
  resolveShot,
  swapRoles,
} from "./gameplay/resolveShot";
import { resolveMatchOutcome } from "./gameplay/matchOutcome";
import { applyPlayerProgressionFromMatch } from "./player/progression";
import {
  maybeCompleteTournament,
  reconcileTournamentCompletion,
} from "./tournament/completion";
import {
  shouldEndSuddenDeath,
  shouldEnterSuddenDeath,
} from "./gameplay/suddenDeath";
import {
  armDisconnectForfeitGrace,
} from "./gameplay/disconnectGrace";
import {
  bindRoundTimers,
  clearPickTimer,
  clearRoomTimer,
  startRoundTimer,
} from "./gameplay/timers";
import {
  bindRoomLifecycle,
  clearPlayerActiveRoom,
  clearPlayersActiveRoomsForRoom,
  createRoomWithPlayers,
  createTournamentRoom,
  getTrackedActiveRoom,
  playerIsBusyInDifferentRoom,
  setPlayerActiveRoom,
} from "./room/lifecycle";
import {
  bindReadinessAuthority,
  evaluateMatchStart,
} from "./room/readiness";
import {
  bindResolveSeqMap,
  scheduleRoomCleanup,
  startStaleRoomSweeper,
  touchRoomActivity,
} from "./room/cleanup";
import {
  bindSpectatorServer,
  mirrorToSpectators,
  pruneSpectatorOnDisconnect,
  registerSpectatorHandlers,
} from "./socket/spectator";
import { bindSocketJwtVerification, jwtEnforcementEnabled } from "./security/jwt";
import {
  logPresenceTransition,
  logRoomStateEmit,
  logSocketConnect,
  logSocketDisconnect,
} from "./diagnostics/transport";
import { diagLog, diagWarn } from "./diagnostics/log";
import { isAuthorizedInternalRequest } from "./security/internalSecret";
import { pruneRateLimitForSocket } from "./security/rateLimit";
import { pruneSocketEventHistory } from "./security/replayGuard";
import {
  corsOriginValidator,
  describeOriginPolicy,
  isProduction,
} from "./config/origins";
import { validateRealtimeServerEnv } from "./config/env";
import { maskSecret } from "./security/maskSecret";
import {
  getEconomyMode,
  listStuckEscrows,
  listStuckSettlements,
  lockTournamentEntryForPlayer,
  reconcileEconomy,
  refundAllMatchEscrows,
  refundAllTournamentEntryEscrows,
  refundTournamentEntryForPlayer,
  seedTestWalletBalance,
  settleMatchEconomyForRoom,
  settleTournamentEconomyForTournament,
} from "./economy";
import {
  bindPublicOfferHandlers,
  emitPublicOffersToSocket,
  registerPublicOfferHandlers,
  revivePublicOffersForPlayer,
  scheduleHostDisconnectGrace,
} from "./socket/publicOffers";
import {
  bindRankedHandlers,
  registerRankedHandlers,
  removeRankedQueueEntryBySocketId,
} from "./socket/ranked";
import {
  bindMatchActionHandlers,
  registerMatchActionHandlers,
} from "./socket/matchActions";
import {
  bindRematchHandlers,
  registerRematchHandlers,
  resetRoomForRematch,
} from "./socket/rematch";
import {
  bindRoomSocketHandlers,
  registerRoomSocketHandlers,
} from "./socket/rooms";
import { normalizeRoomCode } from "./room/codes";
import {
  bindStakesSocketServer,
  getStakeAmount,
  lockStake,
  refundBothStakes,
  settleStakes,
  unlockStake,
} from "./wallet/stakes";
import {
  emitTournamentMatchReady,
  getRealtimeRegistryStats,
  registerPlayerSocket,
  subscribeSocketToTournament,
  unsubscribeSocketFromTournament,
  unregisterSocket,
} from "./tournament/realtimeRegistry";

export { createTournamentRoom } from "./room/lifecycle";
import type {
  MatchPhase,
  MatchType,
  Role,
  Room,
  RoomPlayer,
} from "./types/room";

const app = express();

// Sprint 5 TASK 3: replace permissive `cors()` defaults with the
// allow-list driven validator. `corsOriginValidator` rejects unknown
// origins in production and limits dev to localhost:3000/4000 (plus
// any explicit `ALLOWED_ORIGINS` entries).
app.use(
  cors({
    origin: corsOriginValidator,
    methods: ["GET", "POST"],
    credentials: false,
  })
);
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  // Sprint 5 TASK 3: same allow-list as the express middleware. Socket.IO
  // accepts a function form for `origin` and treats a thrown / falsy
  // result as a CORS rejection.
  cors: {
    origin: (origin, callback) => corsOriginValidator(origin, callback),
    methods: ["GET", "POST"],
    credentials: false,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

bindStakesSocketServer(io);
bindSpectatorServer(io);

// Sprint 4 TASK 10: the local `isAuthorizedInternalRequest` was lifted into
// `security/internalSecret.ts`. We import the same function above so every
// existing call site keeps working unchanged.

/**
 * Phase 11 TASK 6: dev-only test wallet seeder.
 *
 * POST /internal/economy/test-seed
 *   headers: x-realtime-internal-secret
 *   body: { userId: string, amountMinor: number, note?: string }
 *
 * Guarded by THREE conditions, ALL of which must hold:
 *   1. ECONOMY_ENABLED=true
 *   2. ECONOMY_TEST_MODE=true
 *   3. ECONOMY_REAL_MONEY_ENABLED=false (enforced inside seeder)
 *
 * In production the env vars block this. The internal-secret header
 * prevents misuse from non-trusted callers. Idempotency key derives
 * from (userId, amountMinor, note), so retries collapse.
 */
app.post("/internal/economy/test-seed", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  if (getEconomyMode() !== "test") {
    res
      .status(409)
      .json({ error: "Economy is not in test mode.", mode: getEconomyMode() });
    return;
  }

  const body = req.body as {
    userId?: string;
    amountMinor?: number;
    note?: string;
  };
  const userId = body.userId?.trim();
  const amountMinor = Number(body.amountMinor ?? 0);
  const note = body.note?.toString();

  if (!userId) {
    res.status(400).json({ error: "userId required." });
    return;
  }
  if (
    !Number.isFinite(amountMinor) ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    res.status(400).json({ error: "amountMinor must be a positive integer." });
    return;
  }

  try {
    const result = await seedTestWalletBalance({ userId, amountMinor, note });
    if (result.ok === false) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({ ok: true, mode: "test" });
  } catch (error) {
    console.error("[Economy] test-seed crashed:", error);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 11 TASK 4: lock a tournament entry escrow.
 *
 * POST /internal/economy/tournament-entry/lock
 *   body: { userId, tournamentId }
 *
 * Reads `entry_fee_minor` from the tournament row (server-authoritative
 * — never trusts client amounts). Returns `{ ok: true, skipped: true }`
 * for free tournaments or when economy is off.
 */
app.post("/internal/economy/tournament-entry/lock", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const body = req.body as { userId?: string; tournamentId?: string };
  const userId = body.userId?.trim();
  const tournamentId = body.tournamentId?.trim();
  if (!userId || !tournamentId) {
    res.status(400).json({ error: "userId and tournamentId required." });
    return;
  }
  if (!supabase) {
    res.status(503).json({ error: "Supabase not configured." });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id, entry_fee_minor, status")
      .eq("id", tournamentId)
      .maybeSingle();
    if (error || !data) {
      res.status(404).json({ error: "Tournament not found." });
      return;
    }
    const entryFeeMinor = Number(data.entry_fee_minor ?? 0);

    const result = await lockTournamentEntryForPlayer({
      userId,
      tournamentId,
      entryFeeMinor,
    });
    if (result.ok === false) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({
      ok: true,
      skipped: result.skipped ?? false,
      entryFeeMinor,
    });
  } catch (err) {
    console.error("[Economy] tournament-entry/lock crashed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 12 TASK 7 — Economy operations endpoints.
 *
 * All require `x-realtime-internal-secret`. JSON-only summaries. Never
 * expose user-identifying data unless strictly required.
 */
app.get("/internal/economy/health", (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const mode = getEconomyMode();
  const realMoney = process.env.ECONOMY_REAL_MONEY_ENABLED === "true";
  const jwtEnforce = process.env.SOCKET_JWT_ENFORCE === "true";
  res.json({
    mode,
    realMoneyEnabled: realMoney,
    jwtEnforce,
    blockers: economyLaunchBlockers(),
    timestamp: new Date().toISOString(),
  });
});

app.post("/internal/economy/reconcile", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    const summary = await reconcileEconomy();
    res.json(summary);
  } catch (err) {
    console.error("[EconomyRecovery] reconcile endpoint crashed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/internal/economy/escrows/stuck", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
  try {
    const rows = await listStuckEscrows(limit);
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error("[EconomyRecovery] stuck-escrows endpoint crashed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/internal/economy/settlements/stuck", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
  try {
    const rows = await listStuckSettlements(limit);
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error(
      "[EconomyRecovery] stuck-settlements endpoint crashed:",
      err
    );
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/internal/economy/tournament/refund-fanout", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const body = req.body as { tournamentId?: string };
  const tournamentId = body.tournamentId?.trim();
  if (!tournamentId) {
    res.status(400).json({ error: "tournamentId required." });
    return;
  }
  try {
    const result = await refundAllTournamentEntryEscrows(tournamentId);
    if (result.ok === false) {
      res
        .status(400)
        .json({ error: result.reason, summary: result.summary ?? null });
      return;
    }
    res.json(result.summary);
  } catch (err) {
    console.error("[EconomyRecovery] refund-fanout crashed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 11 TASK 4: refund a locked tournament entry escrow.
 */
app.post("/internal/economy/tournament-entry/refund", async (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const body = req.body as { userId?: string; tournamentId?: string };
  const userId = body.userId?.trim();
  const tournamentId = body.tournamentId?.trim();
  if (!userId || !tournamentId) {
    res.status(400).json({ error: "userId and tournamentId required." });
    return;
  }

  try {
    const result = await refundTournamentEntryForPlayer({
      userId,
      tournamentId,
    });
    if (result.ok === false) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({
      ok: true,
      skipped: result.skipped ?? false,
    });
  } catch (err) {
    console.error("[Economy] tournament-entry/refund crashed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/internal/tournament-rooms", (req, res) => {
    if (!isAuthorizedInternalRequest(req)) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const body = req.body as {
      tournamentId?: string;
      tournamentMatchId?: string;
      allowedPlayerIds?: string[];
      notifyPlayerIds?: string[];
      maxRounds?: number;
      /**
       * Sprint 1 TASK 5: when `notify === false`, the realtime server
       * only creates/returns the room code WITHOUT emitting
       * `tournament:matchReady`. The web caller then persists `room_code`
       * to Supabase and follows up with /notify after persistence
       * succeeds. Defaults to `true` for backwards compatibility.
       */
      notify?: boolean;
    };

    const tournamentId =
      typeof body.tournamentId === "string" ? body.tournamentId.trim() : "";
    const tournamentMatchId =
      typeof body.tournamentMatchId === "string"
        ? body.tournamentMatchId.trim()
        : "";
    const allowedPlayerIds = Array.isArray(body.allowedPlayerIds)
      ? body.allowedPlayerIds
      : [];
    const notifyPlayerIds = Array.isArray(body.notifyPlayerIds)
      ? body.notifyPlayerIds
          .filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0
          )
          .map((id) => id.trim())
      : [];
    const maxRounds =
      typeof body.maxRounds === "number" && body.maxRounds > 0
        ? body.maxRounds
        : 3;
    const shouldNotify = body.notify !== false;

    if (!tournamentId || !tournamentMatchId) {
      res.status(400).json({
        error: "tournamentId and tournamentMatchId are required.",
      });
      return;
    }

    const notifyPlayers = (roomCode: string, existing: boolean) => {
      if (notifyPlayerIds.length === 0) {
        return;
      }

      emitTournamentMatchReady(io, {
        tournamentId,
        tournamentMatchId,
        roomCode,
        playerIds: notifyPlayerIds,
      });

      console.log(
        `[TournamentRoom] notified tournamentId=${tournamentId} matchId=${tournamentMatchId} roomCode=${roomCode} existing=${existing} players=${notifyPlayerIds.length}`
      );
    };

    const existingCode = tournamentMatchRooms.get(tournamentMatchId);
    if (existingCode && rooms.has(existingCode)) {
      if (shouldNotify) notifyPlayers(existingCode, true);
      res.json({ roomCode: existingCode, existing: true });
      return;
    }

    if (existingCode && !rooms.has(existingCode)) {
      tournamentMatchRooms.delete(tournamentMatchId);
    }

    try {
      const { code } = createTournamentRoom({
        players: [],
        maxRounds,
        tournamentMatchId,
        tournamentId,
        allowedPlayerIds,
      });

      tournamentMatchRooms.set(tournamentMatchId, code);

      console.log(
        `[TournamentRoom] created tournamentId=${tournamentId} matchId=${tournamentMatchId} roomCode=${code}`
      );

      if (shouldNotify) {
        notifyPlayers(code, false);
      }
      res.json({ roomCode: code, existing: false });
    } catch (error) {
      console.error("POST /internal/tournament-rooms failed:", error);
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create tournament room.",
      });
    }
  }
);

/**
 * Sprint 1 TASK 5: dedicated notify endpoint. Used by the web caller AFTER
 * `room_code` has been persisted to Supabase, so clients never receive a
 * `tournament:matchReady` event for a room whose code isn't yet stored.
 */
app.post("/internal/tournament-rooms/notify", (req, res) => {
  if (!isAuthorizedInternalRequest(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const body = req.body as {
    tournamentId?: string;
    tournamentMatchId?: string;
    roomCode?: string;
    notifyPlayerIds?: string[];
  };

  const tournamentId =
    typeof body.tournamentId === "string" ? body.tournamentId.trim() : "";
  const tournamentMatchId =
    typeof body.tournamentMatchId === "string"
      ? body.tournamentMatchId.trim()
      : "";
  const roomCode =
    typeof body.roomCode === "string" ? body.roomCode.trim() : "";
  const notifyPlayerIds = Array.isArray(body.notifyPlayerIds)
    ? body.notifyPlayerIds
        .filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
        .map((id) => id.trim())
    : [];

  if (!tournamentId || !tournamentMatchId || !roomCode) {
    res.status(400).json({
      error:
        "tournamentId, tournamentMatchId, and roomCode are required.",
    });
    return;
  }

  if (!rooms.has(roomCode)) {
    console.warn(
      `[TournamentRoom] notify skipped: room missing roomCode=${roomCode} matchId=${tournamentMatchId}`
    );
    res.status(404).json({ error: "Realtime room missing." });
    return;
  }

  if (notifyPlayerIds.length > 0) {
    emitTournamentMatchReady(io, {
      tournamentId,
      tournamentMatchId,
      roomCode,
      playerIds: notifyPlayerIds,
    });

    console.log(
      `[TournamentRoom] notified after persistence tournamentId=${tournamentId} matchId=${tournamentMatchId} roomCode=${roomCode} players=${notifyPlayerIds.length}`
    );
  }

  res.json({ ok: true });
});

app.get("/health", (_req, res) => {
  const realtimeRegistry = getRealtimeRegistryStats();

  res.json({
    ok: true,
    service: "penalty444-realtime-server",
    rooms: rooms.size,
    tournamentMatchRooms: tournamentMatchRooms.size,
    publicOffers: publicOffers.size,
    rankedQueue: rankedQueue.size,
    activePlayers: playerActiveRooms.size,
    connectedSockets: io.engine.clientsCount,
    registeredPlayers: realtimeRegistry.registeredPlayers,
    registeredPlayerSockets: realtimeRegistry.registeredPlayerSockets,
    subscribedTournaments: realtimeRegistry.subscribedTournaments,
    tournamentSubscriberSockets: realtimeRegistry.tournamentSubscriberSockets,
  });
});

function buildPlayerNames(room: Room) {
  const playerNames: Record<string, string> = {};

  for (const player of room.players) {
    playerNames[player.playerId] = player.username;
  }

  return playerNames;
}

function buildRoomUpdatePayload(roomCode: string, room: Room) {
  return {
    roomCode,
    players: room.players.map((player) => player.playerId),
    playerNames: buildPlayerNames(room),
    playerCount: room.players.length,
    isReady: room.players.length === 2,
    roles: room.roles,
    kickerPlayerId: getPlayerByRole(room, "KICKER") ?? null,
    keeperPlayerId: getPlayerByRole(room, "KEEPER") ?? null,
  };
}

function emitRoomUpdate(roomCode: string, room: Room) {
  ensureAuthoritativeRoomRoles(room);

  const payload = buildRoomUpdatePayload(roomCode, room);
  io.to(roomCode).emit("room:update", payload);
  mirrorToSpectators(room, "room:update", payload);
  logRoomStateEmit("room:update", roomCode, room);
  touchRoomActivity(room);
}

// Phase 9 — hardening: directly emit the current `room:update` payload to a
// single socket right after it joins the room channel. Closes a race where
// `io.to(roomCode)` broadcasts (e.g. from `publicOffer:join`) fire before
// this socket's `socket.join(code)` lands, leaving it on a stale
// `playerCount` and stuck on the "Waiting for opponent" overlay.
function emitRoomUpdateToSocket(socket: Socket, roomCode: string, room: Room) {
  const payload = buildRoomUpdatePayload(roomCode, room);
  socket.emit("room:update", payload);
}

function isTournamentRoom(room: Room): boolean {
  return room.matchType === "tournament";
}

function isPlayerAllowedInTournamentRoom(room: Room, playerId: string): boolean {
  const normalizedId = playerId.trim();
  if (!normalizedId) return false;
  const allowed = room.allowedPlayerIds ?? [];
  return allowed.includes(normalizedId);
}

function emitMatchState(roomCode: string, room: Room) {
  ensureAuthoritativeRoomRoles(room);

  const matchStartedAt = room.matchStartedAt;
  const earlyCancelDeadlineAt =
    isTournamentRoom(room) || matchStartedAt === undefined
      ? undefined
      : matchStartedAt + EARLY_CANCEL_MS;

  const kickerPlayerId = getPlayerByRole(room, "KICKER") ?? null;
  const keeperPlayerId = getPlayerByRole(room, "KEEPER") ?? null;

  // Reconnect/refresh safety: broadcast which roles have already locked a
  // pick this round (booleans only — no lane data). This lets a rejoining
  // client know an opponent has already locked without ever exposing the
  // opponent's chosen lane. Picks themselves remain server-private until
  // resolveRound emits match:result.
  const picksLocked = {
    KICKER: Boolean(room.picks.KICKER),
    KEEPER: Boolean(room.picks.KEEPER),
  };

  const payload = {
    roomCode,
    roles: room.roles,
    kickerPlayerId,
    keeperPlayerId,
    playerNames: buildPlayerNames(room),
    scores: room.scores,
    round: room.round,
    maxRounds: room.maxRounds,
    matchEnded: room.matchEnded,
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
    matchStartedAt,
    earlyCancelDeadlineAt,
    matchInstance: room.matchInstance ?? 1,
    matchType: room.matchType,
    tournamentId: isTournamentRoom(room) ? room.tournamentId : undefined,
    picksLocked,
    isResolving: Boolean(room.isResolving),
  };
  io.to(roomCode).emit("match:update", payload);
  // Scoreboard / round / status are safe for spectators (no pick state).
  mirrorToSpectators(room, "match:update", payload);
  logRoomStateEmit("match:update", roomCode, room);
  touchRoomActivity(room);
}

async function resolveActivePenalty444SeasonId(): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("seasons")
    .select("id")
    .eq("game_id", "penalty444")
    .eq("is_active", true)
    .order("season_number", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("Failed to resolve active season:", error.message);
    return null;
  }

  return data?.[0]?.id ?? null;
}

/**
 * Sprint 1 TASK 7: bracket advancement is strictly idempotent.
 *
 * Guards in order:
 *   - `room.bracketAdvanced` short-circuits in-process duplicates.
 *   - Load slot; if `winner_entry_id` is already set:
 *       * same winner → log "duplicate skipped" and bail.
 *       * different winner → log "winner conflict" and bail without
 *         overwriting (this would otherwise corrupt the bracket).
 *   - The slot UPDATE uses `.is("winner_entry_id", null)` so the
 *     transition completed→completed never silently overwrites.
 *   - Parent feeder UPDATE uses `.is(<feeder>, null)` for the same
 *     guard.
 */
async function advanceTournamentFromRoom(room: Room) {
  if (room.matchType !== "tournament") return;
  if (room.bracketAdvanced) {
    console.log(
      `[TournamentAdvance] duplicate skipped (in-memory flag) roomCode=${room.code} matchId=${room.tournamentMatchId ?? "—"}`
    );
    return;
  }

  if (!room.tournamentMatchId || !room.tournamentId) {
    console.warn("[tournament advance] missing tournament ids on room", {
      roomCode: room.code,
    });
    return;
  }

  if (!supabase) {
    console.warn(
      "[tournament advance] Supabase not configured; bracket not updated."
    );
    return;
  }

  const outcome = resolveMatchOutcome(room);

  if (!outcome) {
    console.warn("[tournament advance] could not resolve match outcome", {
      roomCode: room.code,
      tournamentMatchId: room.tournamentMatchId,
    });
    return;
  }

  if (outcome.isDraw || !outcome.winner) {
    console.warn(
      "[tournament advance] draw or no winner; slot not completed",
      {
        roomCode: room.code,
        tournamentMatchId: room.tournamentMatchId,
        firstScore: outcome.firstScore,
        secondScore: outcome.secondScore,
      }
    );
    return;
  }

  const winnerUserId = outcome.winner.playerId;
  const completedAt = new Date().toISOString();

  const { data: slot, error: slotError } = await supabase
    .from("tournament_matches")
    .select(
      "id, tournament_id, entry_one_id, entry_two_id, slot_index, next_match_id, winner_entry_id, room_code, status"
    )
    .eq("id", room.tournamentMatchId)
    .maybeSingle();

  if (slotError) {
    console.error(
      "[tournament advance] failed to load tournament match:",
      slotError.message
    );
    return;
  }

  if (!slot) {
    console.warn("[tournament advance] tournament match row not found", {
      tournamentMatchId: room.tournamentMatchId,
      roomCode: room.code,
    });
    return;
  }

  if (slot.tournament_id !== room.tournamentId) {
    console.warn("[tournament advance] tournament id mismatch on slot", {
      roomTournamentId: room.tournamentId,
      slotTournamentId: slot.tournament_id,
    });
    return;
  }

  if (slot.room_code && slot.room_code !== room.code) {
    console.warn("[tournament advance] room_code mismatch", {
      expected: room.code,
      stored: slot.room_code,
      tournamentMatchId: room.tournamentMatchId,
    });
  }

  if (!slot.entry_one_id || !slot.entry_two_id) {
    console.warn("[tournament advance] slot missing both entries", {
      tournamentMatchId: slot.id,
    });
    return;
  }

  const { data: entryRows, error: entriesError } = await supabase
    .from("tournament_entries")
    .select("id, user_id")
    .in("id", [slot.entry_one_id, slot.entry_two_id]);

  if (entriesError) {
    console.error(
      "[tournament advance] failed to load entries:",
      entriesError.message
    );
    return;
  }

  const winnerEntry = (entryRows ?? []).find(
    (row) => row.user_id === winnerUserId
  );

  if (!winnerEntry) {
    console.warn(
      "[tournament advance] winner auth user is not a slot participant",
      {
        winnerUserId,
        tournamentMatchId: slot.id,
      }
    );
    return;
  }

  const winnerEntryId = winnerEntry.id;

  if (slot.winner_entry_id && slot.winner_entry_id !== winnerEntryId) {
    console.error(
      "[TournamentAdvance] winner conflict — slot already has a different winner; refusing to overwrite",
      {
        tournamentMatchId: slot.id,
        existingWinnerEntryId: slot.winner_entry_id,
        winnerEntryId,
      }
    );
    room.bracketAdvanced = true;
    return;
  }

  if (slot.winner_entry_id && slot.winner_entry_id === winnerEntryId) {
    console.log(
      `[TournamentAdvance] duplicate skipped (slot already won by same entry) tournamentMatchId=${slot.id}`
    );
    room.bracketAdvanced = true;
    return;
  }

  let nextMatchId = slot.next_match_id;

  if (!slot.winner_entry_id) {
    const { data: completedRow, error: completeError } = await supabase
      .from("tournament_matches")
      .update({
        winner_entry_id: winnerEntryId,
        status: "completed",
        completed_at: completedAt,
      })
      .eq("id", slot.id)
      .is("winner_entry_id", null)
      .select("id, next_match_id")
      .maybeSingle();

    if (completeError) {
      console.error(
        "[tournament advance] failed to complete slot:",
        completeError.message
      );
      return;
    }

    if (completedRow) {
      nextMatchId = completedRow.next_match_id;
      console.log("[TournamentAdvance] applied", {
        tournamentMatchId: slot.id,
        winnerEntryId,
        roomCode: room.code,
      });
    } else {
      const { data: racedSlot, error: racedError } = await supabase
        .from("tournament_matches")
        .select("id, winner_entry_id, next_match_id")
        .eq("id", slot.id)
        .maybeSingle();

      if (racedError || !racedSlot?.winner_entry_id) {
        console.error(
          "[tournament advance] slot completion race could not be resolved"
        );
        return;
      }

      if (racedSlot.winner_entry_id !== winnerEntryId) {
        console.warn(
          "[tournament advance] slot completed by another winner in race",
          {
            tournamentMatchId: slot.id,
            winnerEntryId: racedSlot.winner_entry_id,
          }
        );
        room.bracketAdvanced = true;
        return;
      }

      nextMatchId = racedSlot.next_match_id;
    }
  }

  if (!nextMatchId) {
    const completed = await maybeCompleteTournament(
      supabase,
      room.tournamentId
    );

    if (!completed) {
      console.error(
        "[tournament advance] final slot finished but tournament not completed",
        {
          tournamentId: room.tournamentId,
          tournamentMatchId: slot.id,
          winnerEntryId,
        }
      );
      return;
    }

    console.log("[tournament advance] tournament completed", {
      tournamentId: room.tournamentId,
      winnerUserId,
    });
    room.bracketAdvanced = true;

    // Phase 11 TASK 5: foundation-only economy settlement when a
    // tournament completes. No-op when economy off or no entry fee
    // escrows exist. The underlying helper inserts a settlement_events
    // row and emits an audit event but does NOT distribute prize money
    // (waiting on Phase 12 prize distribution work).
    try {
      await settleTournamentEconomyForTournament(room.tournamentId);
    } catch (error) {
      console.error("[Settlement] tournament economy settle crashed:", error);
    }
    return;
  }

  const { data: parent, error: parentError } = await supabase
    .from("tournament_matches")
    .select("id, entry_one_id, entry_two_id, status")
    .eq("id", nextMatchId)
    .maybeSingle();

  if (parentError) {
    console.error(
      "[tournament advance] failed to load parent slot:",
      parentError.message
    );
    return;
  }

  if (!parent) {
    console.warn("[tournament advance] parent match row not found", {
      nextMatchId,
      childMatchId: slot.id,
    });
    room.bracketAdvanced = true;
    return;
  }

  const feederIsEntryOne = slot.slot_index % 2 === 0;
  const feederColumn = feederIsEntryOne ? "entry_one_id" : "entry_two_id";
  const existingFeeder = feederIsEntryOne
    ? parent.entry_one_id
    : parent.entry_two_id;

  if (existingFeeder && existingFeeder !== winnerEntryId) {
    console.warn("[tournament advance] conflicting parent feeder value", {
      parentMatchId: parent.id,
      feederColumn,
      existingFeeder,
      winnerEntryId,
    });
    room.bracketAdvanced = true;
    return;
  }

  if (!existingFeeder) {
    const feederPatch = feederIsEntryOne
      ? { entry_one_id: winnerEntryId }
      : { entry_two_id: winnerEntryId };

    let feederQuery = supabase
      .from("tournament_matches")
      .update(feederPatch)
      .eq("id", parent.id);

    feederQuery = feederIsEntryOne
      ? feederQuery.is("entry_one_id", null)
      : feederQuery.is("entry_two_id", null);

    const { error: feederError } = await feederQuery;

    if (feederError) {
      console.error(
        "[tournament advance] failed to set parent feeder:",
        feederError.message
      );
      return;
    }

    console.log("[tournament advance] parent feeder set", {
      parentMatchId: parent.id,
      feederColumn,
      winnerEntryId,
    });
  }

  const { data: parentAfter, error: parentAfterError } = await supabase
    .from("tournament_matches")
    .select("id, entry_one_id, entry_two_id, status")
    .eq("id", parent.id)
    .maybeSingle();

  if (parentAfterError || !parentAfter) {
    console.error(
      "[tournament advance] failed to reload parent slot:",
      parentAfterError?.message
    );
    room.bracketAdvanced = true;
    return;
  }

  if (
    parentAfter.entry_one_id &&
    parentAfter.entry_two_id &&
    parentAfter.status === "pending"
  ) {
    const { error: readyError } = await supabase
      .from("tournament_matches")
      .update({ status: "ready" })
      .eq("id", parent.id)
      .eq("status", "pending");

    if (readyError) {
      console.error(
        "[tournament advance] failed to mark parent ready:",
        readyError.message
      );
    } else {
      console.log("[tournament advance] parent slot ready", {
        parentMatchId: parent.id,
      });
    }
  }

  await reconcileTournamentCompletion(supabase, room.tournamentId);
  room.bracketAdvanced = true;
}

/**
 * Sprint 1 TASK 3: save match result with strict idempotency.
 *
 * Layers of defense (any one of which is sufficient to prevent a double
 * application of RP / advancement):
 *   1. In-memory: `room.resultSaved` flips before we await the DB call.
 *   2. DB: insert keyed on (room_code, match_instance). When the DB-level
 *      unique constraint is in place (see docs/hardening-sprint-1-checklist.md)
 *      a duplicate insert returns a unique-violation error which we
 *      detect by Postgres code "23505" and treat as a benign duplicate.
 *      Even without the constraint we still rely on (1).
 *   3. RP: `applyPlayerProgressionFromMatch` itself short-circuits when
 *      `room.progressionApplied` is already true.
 *
 * Returns `true` only when the result was newly persisted (used by
 * `endMatch` to gate stake settlement to a "result first" ordering —
 * Sprint 1 TASK 9).
 */
async function saveMatchResult(room: Room): Promise<boolean> {
  if (!supabase) {
    console.warn("Supabase backend client is not configured. Match not saved.");
    return false;
  }

  if (room.resultSaved) {
    console.log(
      `[Settlement] duplicate result skipped (in-memory flag) roomCode=${room.code} instanceId=${room.matchInstanceId}`
    );
    return false;
  }

  const outcome = resolveMatchOutcome(room);
  if (!outcome) return false;

  // Flip BEFORE the await to close the race window where a concurrent
  // caller (e.g. endMatch racing against a stale resolveRound timer)
  // could enter this function in parallel.
  room.resultSaved = true;

  const {
    firstPlayer,
    secondPlayer,
    firstScore,
    secondScore,
    isDraw,
    winner,
    loser,
  } = outcome;

  const seasonId = await resolveActivePenalty444SeasonId();
  if (!seasonId) {
    console.warn("No active Penalty444 season found; saving match without season_id.");
  }

  const payload = {
    room_code: room.code,
    match_type: room.matchType,
    game_id: "penalty444",
    season_id: seasonId,

    player_one_id: firstPlayer.playerId,
    player_one_username: firstPlayer.username,
    player_one_score: firstScore,

    player_two_id: secondPlayer.playerId,
    player_two_username: secondPlayer.username,
    player_two_score: secondScore,

    winner_id: winner?.playerId || null,
    winner_username: winner?.username || null,
    loser_id: loser?.playerId || null,
    loser_username: loser?.username || null,

    rounds: room.maxRounds,
    is_draw: isDraw,
    match_instance: room.matchInstance ?? 1,
  };

  const { error } = await supabase.from("match_results").insert(payload);

  // Unique-violation Postgres code: treat as a benign duplicate. Other
  // failures invalidate the in-memory flag so a future retry can succeed.
  const isUniqueViolation =
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate"));

  if (error && !isUniqueViolation) {
    console.error("Failed to save match result:", error.message);
    room.resultSaved = false;
    return false;
  }

  if (isUniqueViolation) {
    console.log(
      `[Settlement] duplicate result skipped (db unique) roomCode=${room.code} instanceId=${room.matchInstanceId}`
    );
    // Don't run RP / advancement again — another writer already won.
    return false;
  }

  console.log(
    `[Settlement] result insert created roomCode=${room.code} instanceId=${room.matchInstanceId}`
  );

  try {
    await advanceTournamentFromRoom(room);
  } catch (advanceError) {
    console.error("Tournament advancement crashed:", advanceError);
  }

  // Phase 6: real competitive progression. Runs after bracket advancement
  // so tournament context (final / champion) is up to date when we award
  // bonuses. Never throws into the match save path; errors are logged.
  // Sprint 1 TASK 3: progression itself is also gated by
  // `room.progressionApplied` so a duplicate caller bails.
  try {
    await applyPlayerProgressionFromMatch(supabase, room, outcome);
  } catch (progressionError) {
    console.error("Player progression crashed:", progressionError);
  }

  return true;
}

function endMatch(roomCode: string, room: Room) {
  if (room.matchEnded) return;

  if (room.disconnectedPlayerId || room.disconnectForfeitTimeout) {
    console.log(
      `[Disconnect] cleanup roomCode=${roomCode} ` +
        `playerId=${room.disconnectedPlayerId ?? "—"} reason=match_ended`
    );
  }

  clearRoomTimer(room);

  // Sprint 1 TASK 6: explicitly leave `isResolving` consistent with the
  // ended state — the continuation timer guards against late wakes.
  room.isResolving = false;

  room.matchEnded = true;
  room.rematchVotes = [];
  room.picks = {};

  diagLog("[END MATCH CLEAR]", {
    roomCode,
    players: room.players.map((p) => p.playerId),
    activeMap: Array.from(playerActiveRooms.entries()),
  });

  clearPlayersActiveRoomsForRoom(room);

  room.players.forEach((p) => {
    if (p?.playerId) {
      playerActiveRooms.delete(p.playerId);
    }
  });

  diagLog("[AFTER CLEAR]", {
    activeMap: Array.from(playerActiveRooms.entries()),
  });

  const matchEndPayload = {
    scores: room.scores,
    tournamentId: isTournamentRoom(room) ? room.tournamentId : undefined,
  };
  io.to(roomCode).emit("match:end", matchEndPayload);
  // Spectators get the official result-safe payload too.
  mirrorToSpectators(room, "match:end", matchEndPayload);

  emitMatchState(roomCode, room);

  // Sprint 1 TASK 9: settlement strictly AFTER result save success.
  //
  // We launch a single async chain so that stake settlement only fires
  // if `saveMatchResult` newly persisted a row. For free matches
  // (`stakeAmount <= 0`) the stake path is a no-op anyway; the ordering
  // is the production-ready contract we want before adding wallet logic.
  //
  // Sprint 7: `finalizationInFlight` is set synchronously here (before
  // the first await) so it is already `true` by the time any
  // `match:rematch` event fired immediately after `match:end` is
  // processed. `resetRoomForRematch` checks this flag and, if set,
  // defers the room reset via `pendingRematchReset` until the `finally`
  // block below clears the flag — preventing a fast rematch from
  // mutating `room.matchInstance`/`resultSaved`/`progressionApplied`
  // while this chain is still reading/writing them.
  room.finalizationInFlight = true;
  (async () => {
    try {
      let saved = false;
      try {
        saved = await saveMatchResult(room);
      } catch (error) {
        console.error("Match result save crashed:", error);
      }

      if (!saved && !room.resultSaved) {
        console.warn(
          `[Settlement] stake settlement skipped result save failed roomCode=${roomCode}`
        );
      } else if (room.settlementStarted) {
        console.log(
          `[Settlement] duplicate stake settlement skipped roomCode=${roomCode}`
        );
      } else {
        room.settlementStarted = true;
        console.log(
          `[Settlement] result saved before stake settlement roomCode=${roomCode}`
        );
        try {
          await settleStakes(room);
        } catch (error) {
          console.error("Stake settlement crashed:", error);
        }

        // Phase 11 TASK 2: economy settlement runs in parallel with the
        // legacy stake settle. No-op when economy off / free match. We
        // intentionally run this AFTER `settleStakes` so the legacy path
        // is untouched and any economy failure cannot poison the legacy
        // settlement state.
        try {
          await settleMatchEconomyForRoom(room);
        } catch (error) {
          console.error("[Settlement] economy settle crashed:", error);
        }
      }
    } finally {
      room.finalizationInFlight = false;

      // Sprint 7: a rematch was accepted while we were finalizing the
      // previous match — perform the deferred reset now that it's safe.
      if (room.pendingRematchReset) {
        room.pendingRematchReset = false;
        if (room.pendingRematchResetTimeout) {
          clearTimeout(room.pendingRematchResetTimeout);
          room.pendingRematchResetTimeout = undefined;
        }
        console.log(
          `[Rematch] performing deferred reset after finalization ` +
            `roomCode=${roomCode} finalizationInFlight=false pendingRematchReset=false`
        );
        resetRoomForRematch(roomCode, room);
      }

      // Sprint 1 TASK 4: schedule the room for delayed deletion so memory
      // doesn't leak. Cancellable if a rematch starts before the timer.
      // Skip if a deferred rematch already reset the room — cleanup
      // would otherwise tear down the freshly-started match instance.
      if (!room.pendingRematchReset && room.matchEnded) {
        scheduleRoomCleanup(io, roomCode, "match-ended");
      }
    }
  })();
}

async function abortMatchEarly(
  roomCode: string,
  room: Room,
  abortedByPlayerId: string
) {
  room.matchEnded = true;

  clearRoomTimer(room);

  room.isResolving = false;
  room.rematchVotes = [];
  room.picks = {};
  room.disconnectedPlayerId = undefined;
  room.disconnectedAt = undefined;

  clearPlayersActiveRoomsForRoom(room);

  room.players.forEach((p) => {
    if (p?.playerId) {
      playerActiveRooms.delete(p.playerId);
    }
  });

  await refundBothStakes(room);

  // Phase 11 TASK 3: parallel economy refund for every locked match
  // escrow. No-op when economy off, stake=0, or no escrows exist.
  try {
    await refundAllMatchEscrows(room);
  } catch (error) {
    console.error("[Refund] economy refund crashed:", error);
  }

  const abortPayload = {
    roomCode,
    abortedBy: abortedByPlayerId,
    matchInstance: room.matchInstance ?? 1,
    reason: "early_cancel",
  };
  // Emit directly to each player socket so the event reaches players who
  // navigated away from the match page (and left the socket.io room) before
  // the abort fired. Mirrors the delivery pattern used by match:cancelled.
  for (const p of room.players) {
    io.to(p.socketId).emit("match:aborted", abortPayload);
  }
  mirrorToSpectators(room, "match:aborted", abortPayload);

  emitMatchState(roomCode, room);
  emitRoomUpdate(roomCode, room);

  // Sprint 1 TASK 4: aborted rooms also get scheduled for cleanup.
  scheduleRoomCleanup(io, roomCode, "match-aborted");
}

const resolveRoundSeqByRoom = new Map<string, number>();
bindResolveSeqMap(resolveRoundSeqByRoom);

/**
 * Arm next-round reconnect grace when a player is still absent after
 * the continuation advances. Delegates to the shared disconnect-grace
 * module so forfeit timers, generation guards, and reconnect cleanup
 * stay consistent with the mid-round `NO_PICK_GRACE_ARMED` path.
 */
function startDisconnectGraceForAbsentPlayer(
  roomCode: string,
  room: Room,
  absentPlayerId: string
): void {
  armDisconnectForfeitGrace(
    io,
    roomCode,
    room,
    absentPlayerId,
    "NEXT_ROUND_GRACE_FOR_ABSENT",
    endMatch
  );
}

function resolveRound(roomCode: string, room: Room, fromTimeout = false) {
  if (room.matchEnded) return;
  if (room.isResolving) {
    console.log(
      `[resolveRound] skip duplicate room=${roomCode} round=${room.round} fromTimeout=${fromTimeout}`
    );
    // === Reveal-deadlock instrumentation (logs only) ===
    //
    // Terminal symptom of the hypothesised deadlock: the pick timer
    // expires (or both-picks branch fires) but `isResolving` is
    // still true from a previous round whose continuation was
    // dropped by a mid-resolve disconnect → reconnect cycle.
    // Includes the live continuation-timer presence so we can tell
    // whether the round is actually mid-resolve (legitimate skip)
    // or stuck (deadlock).
    diagWarn(
      `[diag:reveal-deadlock] AUTH_DEADLOCK_CANDIDATE_RESOLVE_SKIPPED_ALREADY_RESOLVING ` +
        `roomCode=${roomCode} ` +
        `round=${room.round} ` +
        `fromTimeout=${fromTimeout} ` +
        `hasContinuationTimeout=${Boolean(room.resolveContinuationTimeout)} ` +
        `hasKickerPick=${Boolean(room.picks.KICKER)} ` +
        `hasKeeperPick=${Boolean(room.picks.KEEPER)} ` +
        `phase=${room.phase}`
    );
    // === end instrumentation ===
    return;
  }

  room.isResolving = true;
  clearPickTimer(room);
  touchRoomActivity(room);

  const resolveSeq = (resolveRoundSeqByRoom.get(roomCode) ?? 0) + 1;
  resolveRoundSeqByRoom.set(roomCode, resolveSeq);
  const resolvingRound = room.round;

  ensureAuthoritativeRoomRoles(room);

  const kickerPick = room.picks.KICKER;
  const keeperPick = room.picks.KEEPER;
  const kickerPlayerId = getPlayerByRole(room, "KICKER") ?? null;
  const keeperPlayerId = getPlayerByRole(room, "KEEPER") ?? null;
  const result = resolveShot(kickerPick, keeperPick);
  const pointWinnerRole = getPointWinnerRole(kickerPick, keeperPick, result);

  console.log(
    `[resolveRound] room=${roomCode} matchType=${room.matchType ?? "unknown"} round=${resolvingRound} seq=${resolveSeq} fromTimeout=${fromTimeout} kickerPlayerId=${kickerPlayerId ?? "—"} keeperPlayerId=${keeperPlayerId ?? "—"} kickerPick=${kickerPick ?? "—"} keeperPick=${keeperPick ?? "—"} result=${result} rule=${kickerPick && keeperPick ? (kickerPick === keeperPick ? "same_lane_SAVE" : "different_lane_GOAL") : "partial"}`
  );

  // Phase 6C — diagnostic for the "LEFT vs RIGHT shows SAVE" class
  // of bugs. We deliberately do NOT mutate `result` here: the rule
  // (`resolveShot`) is the single authoritative source. This log
  // gives us forensic evidence whenever a contradictory payload is
  // about to be emitted — if it ever fires we know the bug is on
  // the server side, not in the client renderer.
  if (kickerPick && keeperPick) {
    if (kickerPick !== keeperPick && result === "SAVE") {
      console.error(
        `[invariant:result] DIFFERENT lanes resolved as SAVE — should be GOAL ` +
          `roomCode=${roomCode} matchInstance=${room.matchInstance} ` +
          `round=${resolvingRound} kickerPick=${kickerPick} keeperPick=${keeperPick} ` +
          `result=${result}`
      );
    }
    if (kickerPick === keeperPick && result === "GOAL") {
      console.error(
        `[invariant:result] SAME lane resolved as GOAL — should be SAVE ` +
          `roomCode=${roomCode} matchInstance=${room.matchInstance} ` +
          `round=${resolvingRound} kickerPick=${kickerPick} keeperPick=${keeperPick} ` +
          `result=${result}`
      );
    }
  }

  if (pointWinnerRole) {
    const pointWinnerId = getPlayerByRole(room, pointWinnerRole);

    if (pointWinnerId) {
      room.scores[pointWinnerId] = (room.scores[pointWinnerId] || 0) + 1;
    }
  }

  let statusMessage = "";

  if (fromTimeout) {
    if (!kickerPick && !keeperPick) {
      statusMessage = "Both players timed out → DRAW. No point awarded.";
    } else if (!kickerPick) {
      statusMessage = "Kicker timed out → SAVE. No point awarded.";
    } else if (!keeperPick) {
      statusMessage = "Keeper timed out → GOAL. Kicker gets the point.";
    }
  }

  const matchResultPayload = {
    roomCode,
    round: resolvingRound,
    kickerPlayerId,
    keeperPlayerId,
    kickerPick: kickerPick || null,
    keeperPick: keeperPick || null,
    result,
    statusMessage,
  };
  io.to(roomCode).emit("match:result", matchResultPayload);
  // Spectator-safe: this fires AFTER picks have been revealed via the
  // server-authoritative resolve. Pre-reveal picks are never emitted.
  mirrorToSpectators(room, "match:result", matchResultPayload);

  if (room.resolveContinuationTimeout) {
    clearTimeout(room.resolveContinuationTimeout);
    room.resolveContinuationTimeout = undefined;
  }

  const continuationPauseMs =
    isTournamentRoom(room) && !fromTimeout
      ? TOURNAMENT_ROUND_CONTINUATION_MS
      : RESULT_REVEAL_PAUSE_MS;

  room.resolveContinuationTimeout = setTimeout(() => {
    room.resolveContinuationTimeout = undefined;

    const r = rooms.get(roomCode);
    if (!r) {
      // Room is gone. Nothing to mutate.
      return;
    }

    // Sprint 1 TASK 6: bail without mutating isResolving on stale
    // continuations. The matching authoritative continuation will set
    // state for the active sequence.
    if (resolveRoundSeqByRoom.get(roomCode) !== resolveSeq) {
      console.log(
        `[Resolve] stale continuation skipped roomCode=${roomCode} round=${r.round} seq=${resolveSeq}`
      );
      return;
    }

    if (r.matchEnded) {
      // Match already ended (likely via forfeit / disconnect). Leave the
      // ended room state stable — do NOT reset isResolving on an ended
      // room (that would invite "late continuation rearms timer" bugs).
      console.log(
        `[Resolve] ended room no reset roomCode=${roomCode} seq=${resolveSeq}`
      );
      return;
    }

    // From here on we're committed to either ending the match or arming
    // the next round. Explicit state transitions only — no blanket
    // `r.isResolving = false` in a finally.
    const totalNormalTurns = r.maxRounds * 2;
    const isFinalNormalTurn =
      r.phase === "NORMAL" && r.round >= totalNormalTurns;

    const playerIds = r.players.map((player) => player.playerId);
    const firstPlayerId = playerIds[0];
    const secondPlayerId = playerIds[1];

    const firstScore = firstPlayerId ? r.scores[firstPlayerId] || 0 : 0;
    const secondScore = secondPlayerId ? r.scores[secondPlayerId] || 0 : 0;

    const kicksTakenByFirst = Math.ceil(r.round / 2);
    const kicksTakenBySecond = Math.floor(r.round / 2);

    const remainingFirst = r.maxRounds - kicksTakenByFirst;
    const remainingSecond = r.maxRounds - kicksTakenBySecond;

    const firstAlreadyWon =
      r.phase === "NORMAL" && firstScore > secondScore + remainingSecond;

    const secondAlreadyWon =
      r.phase === "NORMAL" && secondScore > firstScore + remainingFirst;

    if (firstAlreadyWon || secondAlreadyWon) {
      // endMatch sets matchEnded; do not flip isResolving here.
      endMatch(roomCode, r);
      return;
    }

    if (isFinalNormalTurn) {
      if (shouldEnterSuddenDeath(r)) {
        r.phase = "SUDDEN_DEATH";
        r.suddenDeathRound = 1;
        r.picks = {};
        // Invalidate the previous round's pick-window timestamp before the
        // absent-player-grace branch (below) can skip `startRoundTimer` and
        // leave it stale — see RECONNECT_FRESH_TIMER_NO_PICK_WINDOW in
        // disconnectGrace.ts.
        r.pickWindowStartedAt = undefined;
        r.round += 1;
        swapRoles(r);

        emitRoomUpdate(roomCode, r);
        emitMatchState(roomCode, r);
        // Next round is officially starting → clear resolving just before.
        r.isResolving = false;
        console.log(
          `[Resolve] next round armed roomCode=${roomCode} round=${r.round} phase=${r.phase}`
        );

        // Next-round absent-player grace (PR hotfix/next-round-absent-player-grace).
        //
        // If a player disconnected during the just-resolved round but
        // their pick was already locked, the PR #19 strict-disconnect
        // classifier intentionally did NOT arm a 39s forfeit (their
        // pick was final, the current round resolves fairly). But by
        // the time the continuation fires here, they may still be
        // absent — `player.present === false`. Starting the next
        // round's 10s pick timer immediately would penalise them for
        // a disconnect that happened AFTER they already acted in the
        // previous round.
        //
        // PR #21 patch — order of operations matters: the absent-player
        // check MUST run BEFORE any `match:status { timeoutSeconds: 10 }`
        // emit. Previously the entry branch eagerly broadcast
        // "Match tied. Sudden Death begins." with `timeoutSeconds: 10`,
        // then armed the 39s grace right after, producing a client UI
        // that flickered between a 10s pick countdown and a 39s
        // reconnect countdown.
        //
        // The grace helper emits its own 39s `match:status` with
        // `expiresAt`, so we deliberately do NOT emit a phase-transition
        // status in the absent case — `emitRoomUpdate`/`emitMatchState`
        // above already carry the SUDDEN_DEATH phase change, and the
        // grace status carries the only user-facing copy that matters
        // until reconnect.
        const absentInSuddenDeath = r.players.find((p) => !p.present);
        if (absentInSuddenDeath && r.players.length === 2) {
          startDisconnectGraceForAbsentPlayer(
            roomCode,
            r,
            absentInSuddenDeath.playerId
          );
          return;
        }

        // Both players present → safe to announce the 10s sudden-death
        // window AND start the pick timer. `startRoundTimer` will also
        // emit a `match:status` with `timeoutSeconds: 10` immediately
        // after; this entry-banner emit is kept for the explicit
        // "Match tied. Sudden Death begins." copy.
        io.to(roomCode).emit("match:status", {
          roomCode,
          message: "Match tied. Sudden Death begins.",
          timeoutSeconds: 10,
          phase: r.phase,
          suddenDeathRound: r.suddenDeathRound,
        });

        startRoundTimer(roomCode, r);
        return;
      }

      endMatch(roomCode, r);
      return;
    }

    if (r.phase === "SUDDEN_DEATH" && shouldEndSuddenDeath(r)) {
      endMatch(roomCode, r);
      return;
    }

    if (r.phase === "SUDDEN_DEATH") {
      const suddenTurnsPlayed = r.round - totalNormalTurns;

      if (suddenTurnsPlayed > 0 && suddenTurnsPlayed % 2 === 0) {
        r.suddenDeathRound += 1;
      }
    }

    swapRoles(r);

    r.picks = {};
    // Invalidate the previous round's pick-window timestamp before the
    // absent-player-grace branch (below) can skip `startRoundTimer` and
    // leave it stale — see RECONNECT_FRESH_TIMER_NO_PICK_WINDOW in
    // disconnectGrace.ts.
    r.pickWindowStartedAt = undefined;
    r.round += 1;

    emitRoomUpdate(roomCode, r);
    emitMatchState(roomCode, r);
    r.isResolving = false;
    console.log(
      `[Resolve] next round armed roomCode=${roomCode} round=${r.round} phase=${r.phase}`
    );
    // Next-round absent-player grace — see comment on the sudden-death
    // entry branch above. The fix applies identically here for normal
    // and mid-sudden-death rounds because both reach this code path
    // after `swapRoles` / `picks = {}` / `round += 1`.
    const absentInNextRound = r.players.find((p) => !p.present);
    if (absentInNextRound && r.players.length === 2) {
      startDisconnectGraceForAbsentPlayer(
        roomCode,
        r,
        absentInNextRound.playerId
      );
      return;
    }
    startRoundTimer(roomCode, r);
  }, continuationPauseMs);
}

bindRoundTimers({
  io,
  resolveRound,
});

// Phase 6C — the readiness authority MUST be bound before
// `bindRoomLifecycle` so that lifecycle-time `evaluateMatchStart`
// calls (made from `createRoomWithPlayers` / `createTournamentRoom`)
// have a non-null deps slot to resolve.
bindReadinessAuthority({
  io,
  startRoundTimer,
});

bindRoomLifecycle({
  io,
  emitRoomUpdate,
  emitMatchState,
  startRoundTimer,
});

bindPublicOfferHandlers({
  io,
  createRoomWithPlayers,
  getTrackedActiveRoom,
  playerIsBusyInDifferentRoom,
  getStakeAmount,
  lockStake,
  unlockStake,
  setPlayerActiveRoom,
  clearPlayerActiveRoom,
  emitRoomUpdate,
  emitMatchState,
  startRoundTimer,
});

bindRankedHandlers({
  io,
  createRoomWithPlayers,
  getTrackedActiveRoom,
});

bindRoomSocketHandlers({
  io,
  createRoomWithPlayers,
  getTrackedActiveRoom,
  playerIsBusyInDifferentRoom,
  setPlayerActiveRoom,
  clearPlayerActiveRoom,
  isTournamentRoom,
  isPlayerAllowedInTournamentRoom,
  emitRoomUpdate,
  emitRoomUpdateToSocket,
  emitMatchState,
  startRoundTimer,
  endMatch,
});

bindMatchActionHandlers({
  io,
  resolveRound,
  endMatch,
  abortMatchEarly,
  isTournamentRoom,
});

bindRematchHandlers({
  io,
  startRoundTimer,
  emitMatchState,
  emitRoomUpdate,
  isTournamentRoom,
});

io.on("connection", (socket) => {
  console.log(
    `Socket connected: ${socket.id}. Connected sockets: ${io.engine.clientsCount}`
  );

  // Transport diagnostics (logs only — no behaviour change).
  logSocketConnect(io, socket);

  // Server-authoritative active-room snapshot. The lobby's Resume Match
  // card was previously driven only by client localStorage, which is
  // unreliable across reconnect / refresh / cleared storage. We surface
  // the authoritative `playerActiveRooms` tracking via a snapshot the
  // client can consume on (re)connect. `getTrackedActiveRoom` already
  // returns null for missing/ended rooms, so ended matches are never
  // exposed here.
  const emitActiveRoomSnapshot = (playerId?: string | null) => {
    const id = typeof playerId === "string" ? playerId.trim() : "";
    if (!id) {
      socket.emit("activeRoom:snapshot", { roomCode: null });
      return;
    }
    const roomCode = getTrackedActiveRoom(id);
    socket.emit("activeRoom:snapshot", { roomCode: roomCode ?? null });
    diagLog(
      `[active-room:snapshot] socketId=${socket.id} player=${id} room=${roomCode ?? "none"}`
    );
  };

  // Sprint 2 TASK 2 + Sprint 4 TASK 3: best-effort Supabase JWT
  // verification on connect. We retain the handle on `socket.data.authPromise`
  // so async handlers can await freshness when needed. The synchronous
  // fields `socket.data.authenticated` / `authError` are populated by
  // `verifySocketJwt` before resolution.
  void bindSocketJwtVerification(socket).then((result) => {
    if (result.ok === true) {
      console.log(
        `[Security] jwt verified socketId=${socket.id} userId=${result.userId}`
      );

      // Public-offer host-disconnect grace revival hook.
      //
      // When a host's lobby reconnects after a brief disconnect, the
      // new socket lands here with a verified Supabase userId that
      // matches the offer's `hostPlayerId`. Revive any of their
      // offers that are sitting in the disconnect-grace window.
      // Safe + cheap when no matching offer exists.
      revivePublicOffersForPlayer(result.userId, socket.id);

      // Surface the authoritative active room so the lobby can restore
      // the Resume Match card after a reconnect/refresh.
      emitActiveRoomSnapshot(result.userId);

      // Signal the client that JWT verification is complete so it can
      // safely emit player-owned events (room:join, player:present,
      // player:register). Without this, clients that emit on `connect`
      // race the async verification window and get rejected under
      // SOCKET_JWT_ENFORCE=true.
      socket.emit("socket:authenticated", { userId: result.userId });
    } else {
      const reason = result.reason;
      if (reason !== "no_token" && reason !== "no_backend") {
        console.warn(
          `[Security] jwt verify failed socketId=${socket.id} reason=${reason}`
        );
      }
      // Always emit so the client's waitForSocketAuth() resolves even
      // on failure (anonymous sockets, missing token, etc.).
      socket.emit("socket:authenticated", { userId: null });
    }
  });

  socket.emit("connected", {
    socketId: socket.id,
  });

  emitPublicOffersToSocket(socket.id, "connection snapshot");

  registerPublicOfferHandlers(socket);
  registerRankedHandlers(socket);
  registerRoomSocketHandlers(socket);
  registerMatchActionHandlers(socket);
  registerRematchHandlers(socket);
  // Sprint 1 TASK 1: spectator handlers live on the SAME socket but
  // only ever touch the spectator channel and `room.spectatorSocketIds`.
  registerSpectatorHandlers(socket);

  socket.on("room:leave", ({ roomCode }: { roomCode?: string }) => {
    const code = normalizeRoomCode(roomCode ?? "");
    if (!code) return;
    socket.leave(code);
  });

  socket.on(
    "room:join",
    ({ roomCode }: { roomCode?: string; playerId?: string }) => {
      const code = normalizeRoomCode(roomCode ?? "");
      if (!code) return;

      setImmediate(() => {
        const room = rooms.get(code);
        if (!room || room.players.length !== 2) return;

        if (ensureAuthoritativeRoomRoles(room)) {
          emitRoomUpdate(code, room);
          emitMatchState(code, room);
        }
      });
    }
  );

  socket.on(
    "player:register",
    ({ playerId }: { playerId?: string }) => {
      if (typeof playerId !== "string" || playerId.trim().length === 0) {
        return;
      }

      const trimmed = playerId.trim();

      // If the socket has a verified JWT it must match the claimed playerId.
      // A token proving a different identity is never overridden by a
      // client-supplied claim, regardless of SOCKET_JWT_ENFORCE mode.
      const verifiedUserId = socket.data.userId ?? null;
      if (verifiedUserId && verifiedUserId !== trimmed) {
        console.warn(
          `[Security] player:register identity mismatch socketId=${socket.id} ` +
            `claimed=${trimmed} verified=${verifiedUserId} — rejected`
        );
        return;
      }
      if (!verifiedUserId && process.env.SOCKET_JWT_ENFORCE === "true") {
        console.warn(
          `[Security] player:register unauthenticated socketId=${socket.id} ` +
            `claimed=${trimmed} — rejected`
        );
        return;
      }

      registerPlayerSocket(trimmed, socket.id);
      console.log(
        `[tournament-registry] player:register playerId=${trimmed} socketId=${socket.id}`
      );

      // Public-offer host-disconnect grace revival hook.
      //
      // The web lobby emits `player:register` on connect / reconnect.
      // This is the no-JWT-needed path back to offer revival — even
      // when SOCKET_JWT_ENFORCE is off and `socket.data.userId` is
      // null, a returning host's lobby will reach this handler with
      // its playerId in the payload, and we revive their offer
      // before the 15s grace timer would otherwise wipe it.
      revivePublicOffersForPlayer(trimmed, socket.id);

      // Resume Match recovery: the lobby emits `player:register` on
      // connect/reconnect even without JWT, so this is the reliable
      // path to restore the active-room snapshot client-side.
      emitActiveRoomSnapshot(trimmed);
    }
  );

  // Explicit client-initiated active-room snapshot request. The lobby
  // can call this on socket (re)connect to recover the Resume Match
  // card regardless of localStorage state. Prefers the JWT-verified
  // userId; falls back to the playerId in the payload (legacy / soft
  // mode) so the snapshot works before/without auth.
  socket.on(
    "activeRoom:request",
    (payload?: { playerId?: string }) => {
      const verifiedUserId =
        typeof socket.data.userId === "string" && socket.data.userId.trim()
          ? socket.data.userId.trim()
          : null;
      const claimed =
        typeof payload?.playerId === "string" ? payload.playerId.trim() : "";

      // Sprint 6 — in enforce mode an unauthenticated socket cannot read
      // another player's active-room snapshot by simply claiming their
      // playerId. Without a verified JWT we return an empty snapshot
      // instead of trusting the payload.
      if (!verifiedUserId && jwtEnforcementEnabled()) {
        if (claimed) {
          console.warn(
            `[Security] activeRoom:request unauthenticated socketId=${socket.id} ` +
              `claimed=${claimed} — rejected`
          );
        }
        emitActiveRoomSnapshot(null);
        return;
      }

      emitActiveRoomSnapshot(verifiedUserId ?? claimed);
    }
  );

  socket.on(
    "tournament:subscribe",
    ({ tournamentId }: { tournamentId?: string }) => {
      if (typeof tournamentId !== "string" || tournamentId.trim().length === 0) {
        return;
      }

      // Sprint 5 TASK 7: in enforce mode an unauthenticated socket
      // cannot subscribe to tournament updates. The subscription
      // surface is read-only but ties up a real socket; we'd rather
      // not run a flood of anon connections through the registry once
      // the platform is gated behind auth.
      if (
        process.env.SOCKET_JWT_ENFORCE === "true" &&
        !socket.data.userId
      ) {
        console.warn(
          `[Security] tournament:subscribe unauthenticated socketId=${socket.id} ` +
            `tournamentId=${tournamentId.trim()} — rejected`
        );
        return;
      }

      subscribeSocketToTournament(tournamentId, socket.id);
      console.log(
        `[tournament-registry] tournament:subscribe tournamentId=${tournamentId.trim()} socketId=${socket.id}`
      );
    }
  );

  socket.on(
    "tournament:unsubscribe",
    ({ tournamentId }: { tournamentId?: string }) => {
      if (typeof tournamentId !== "string" || tournamentId.trim().length === 0) {
        return;
      }

      unsubscribeSocketFromTournament(tournamentId, socket.id);
      console.log(
        `[tournament-registry] tournament:unsubscribe tournamentId=${tournamentId.trim()} socketId=${socket.id}`
      );
    }
  );

  socket.on("disconnect", async (reason) => {
    console.log(
      `Socket disconnected: ${socket.id}. reason=${reason}. Connected sockets: ${io.engine.clientsCount}`
    );

    // Transport diagnostics — record disconnect for reconnect-duration
    // correlation. Best-effort playerId/roomCode lookup from the rooms
    // map (read-only). Logs only.
    {
      let diagPlayerId: string | null = socket.data?.userId ?? null;
      let diagRoomCode: string | null = null;
      for (const room of rooms.values()) {
        const p = room.players.find((rp) => rp.socketId === socket.id);
        if (p) {
          diagPlayerId = p.playerId;
          diagRoomCode = room.code;
          break;
        }
      }
      logSocketDisconnect(socket, reason, diagPlayerId, diagRoomCode);
    }

    unregisterSocket(socket.id);
    console.log(
      `[tournament-registry] disconnect cleanup socketId=${socket.id}`
    );

    // Sprint 1 TASK 1: drop any spectator memberships this socket held.
    pruneSpectatorOnDisconnect(socket.id);

    // Sprint 4 TASK 6 + TASK 13: drop replay-guard and rate-limit state
    // bound to this socket so memory doesn't accumulate over long
    // server uptimes.
    pruneSocketEventHistory(socket.id);
    pruneRateLimitForSocket(socket.id);

    removeRankedQueueEntryBySocketId(socket.id);

    // Public-offer host-disconnect grace (PR hotfix/public-offer-host-grace).
    //
    // Previously a brief disconnect (refresh / nav / network blip) deleted
    // the host's public offer immediately, refunding the stake and forcing
    // the host to rebuild from scratch. Now we arm a `PUBLIC_OFFER_HOST_GRACE_MS`
    // window via `scheduleHostDisconnectGrace`:
    //   - If the host's lobby reconnects (JWT-verified userId OR
    //     `player:register`) inside the window, `revivePublicOffersForPlayer`
    //     cancels the timer and re-binds the new socket.
    //   - If the window elapses, `removeAbandonedPublicOffer` performs the
    //     same teardown the old immediate-delete did (unlock stake +
    //     economy refund + room cleanup + lobby emit).
    //
    // Guests cannot accept an offer while it's mid-grace — the
    // `publicOffer:join` handler short-circuits with a "Host is
    // reconnecting" message.
    for (const offer of publicOffers.values()) {
      const room = rooms.get(offer.roomCode);
      const host = room?.players.find(
        (player) => player.playerId === offer.hostPlayerId
      );

      if (host?.socketId === socket.id) {
        if (publicOffers.has(offer.offerId)) {
          scheduleHostDisconnectGrace(offer.offerId);
        }

        break;
      }
    }

    for (const room of rooms.values()) {
      const player = room.players.find(
        (roomPlayer) => roomPlayer.socketId === socket.id
      );

      if (!player) continue;

      // Phase 6C — drop presence first, regardless of which branch
      // below we take. The pre-start branch uses it directly via
      // `evaluateMatchStart`; the post-start branches don't read it.
      player.present = false;

      // Presence diagnostics — disconnect is an "absent" transition.
      logPresenceTransition(
        room.code,
        player.playerId,
        false,
        "disconnect",
        socket.id
      );

      // ============================================================
      // Strict disconnect/reconnect policy (PR hotfix/strict-disconnect-policy)
      //
      // We classify the room state at the moment of disconnect and
      // apply ONLY the cleanup that is safe for that state. The
      // previous "one-size-fits-all" behaviour (clearRoomTimer + 39s
      // forfeit on every active-match disconnect) caused:
      //   - reveal deadlock (clearing continuation mid-resolve)
      //   - pick unlock (clearing pick timer while own pick was final)
      //   - forfeit fires into wrong round (39s outliving the round
      //     it was armed for)
      //
      // Classification:
      //   matchEnded     – no gameplay timer action, no countdown emit
      //   preMatch       – delegate to readiness authority (Phase 6C)
      //   resolving      – preserve continuation, no forfeit, no clears
      //   ownPickLocked  – preserve pick, no forfeit, leave pick timer
      //                    running for opponent
      //   noPickYet      – classic 39s grace + paused pick timer
      // ============================================================

      // Rule 5 — match already ended. No reveal/forfeit/timer events
      // should ever fire here. Just refresh room state (presence) and
      // bail. Crucially, do NOT emit "Opponent disconnected. Waiting
      // for reconnect..." — there is no reconnect window to wait for.
      if (room.matchEnded) {
        diagLog(
          `[diag:disconnect-policy] MATCH_ENDED_NO_ACTION ` +
            `roomCode=${room.code} playerId=${player.playerId}`
        );
        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        return;
      }

      // Phase 6C — pre-match disconnect path.
      //
      // If the match never actually started (no `matchStartedAt`)
      // there is nothing to forfeit. The readiness authority will
      // either arm the return window or wait quietly depending on
      // the remaining presence state. The 39s reconnect-forfeit is
      // skipped entirely — it only ever applied to mid-match.
      if (room.matchStartedAt === undefined) {
        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        evaluateMatchStart(room.code, room);
        return;
      }

      // Defensive: a started match should always have exactly two
      // players in `room.players`. If somehow we're here with a
      // different shape, fall back to a quiet status emit and bail —
      // we don't want to arm a forfeit against a degenerate room.
      if (room.players.length !== 2) {
        io.to(room.code).emit("match:status", {
          roomCode: room.code,
          message: "Opponent disconnected. Waiting for reconnect...",
          phase: room.phase,
          suddenDeathRound: room.suddenDeathRound,
        });

        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        return;
      }

      // From here on: 2-player, started, not-ended match.
      const role = room.roles[player.playerId];
      const ownPickLocked = role ? Boolean(room.picks[role]) : false;
      const bothPicksLocked = Boolean(
        room.picks.KICKER && room.picks.KEEPER
      );
      const isResolving = Boolean(room.isResolving);

      // Existing reveal-deadlock instrumentation — kept verbatim per
      // PR #17 contract. Augmented with the classifier outcome.
      diagLog(
        `[diag:reveal-deadlock] AUTH_DEADLOCK_TRACE_DISCONNECT_DURING_MATCH ` +
          `roomCode=${room.code} ` +
          `playerId=${player.playerId} ` +
          `isResolving=${isResolving} ` +
          `hasContinuationTimeout=${Boolean(room.resolveContinuationTimeout)} ` +
          `round=${room.round} ` +
          `phase=${room.phase} ` +
          `ownPickLocked=${ownPickLocked} ` +
          `bothPicksLocked=${bothPicksLocked}`
      );

      // ---------- Rule 2: both picks locked / resolving ----------
      // Reveal/result pipeline is mid-flight. The continuation timer
      // owns the transition to next round / `endMatch`. Touching it
      // here is exactly what caused the orphan-resolution deadlock.
      //
      // Policy:
      //   - DO NOT clear `resolveContinuationTimeout`
      //   - DO NOT reset `room.isResolving` / `room.picks`
      //   - DO NOT arm 39s forfeit
      //   - emit a neutral status only (no countdown copy)
      //
      // We still call `clearRoomTimer` with `preserveResolution: true`
      // so any phantom waitingForReturn / staging handles get cleaned,
      // but the continuation block is left strictly intact.
      if (isResolving || bothPicksLocked) {
        diagLog(
          `[diag:disconnect-policy] PRESERVE_RESOLUTION ` +
            `roomCode=${room.code} playerId=${player.playerId} ` +
            `isResolving=${isResolving} bothPicksLocked=${bothPicksLocked}`
        );

        clearRoomTimer(room, { preserveResolution: true });

        io.to(room.code).emit("match:status", {
          roomCode: room.code,
          message: "Opponent connection lost. Result continues.",
          phase: room.phase,
          suddenDeathRound: room.suddenDeathRound,
        });

        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        return;
      }

      // ---------- Rule 4: own pick already locked, opponent not ----------
      // The disconnected player has already submitted this round's
      // pick — that pick is FINAL. We must not unlock it, must not
      // restart their decision, and must not arm a 39s forfeit that
      // would later fire into the NEXT round's pick window.
      //
      // Policy:
      //   - DO NOT clear submitted picks
      //   - DO NOT clear pick timer (opponent still has live decision)
      //   - DO NOT set `disconnectedPlayerId` (matchActions' role-pick
      //     guard `if (room.picks[role]) return;` already blocks
      //     duplicate picks, and setting `disconnectedPlayerId` would
      //     incorrectly block the disconnected player's NEXT-round
      //     pick after role swap)
      //   - DO NOT arm 39s forfeit
      //   - emit a neutral status only
      //
      // If the player never reconnects, the round will resolve via
      // pick-timer or opponent's pick, and subsequent rounds will
      // time out naturally for the absent player.
      if (ownPickLocked) {
        diagLog(
          `[diag:disconnect-policy] OWN_PICK_LOCKED_NO_FORFEIT ` +
            `roomCode=${room.code} playerId=${player.playerId} ` +
            `role=${role} round=${room.round}`
        );

        io.to(room.code).emit("match:status", {
          roomCode: room.code,
          message: "Opponent connection lost. Their pick is locked.",
          phase: room.phase,
          suddenDeathRound: room.suddenDeathRound,
        });

        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        return;
      }

      // ---------- Grace-ownership guard (second concurrent disconnect) ----------
      // If a DIFFERENT player is already inside an active forfeit grace
      // window, a second player disconnecting here must NOT steal it.
      // The old behaviour called clearRoomTimer + armDisconnectForfeitGrace
      // unconditionally, which destroyed the original owner's timer,
      // reassigned `disconnectedPlayerId`, and reset the 39s clock — letting
      // a refreshing/leaving second player extend or hijack the countdown.
      // Preserve the original grace owner, timer, and expiry untouched.
      const activeGraceOwnedByOther =
        typeof room.disconnectedPlayerId === "string" &&
        room.disconnectedPlayerId !== player.playerId &&
        typeof room.disconnectForfeitExpiresAt === "number" &&
        room.disconnectForfeitExpiresAt > Date.now();

      if (activeGraceOwnedByOther) {
        diagLog(
          `[diag:disconnect-policy] PRESERVE_EXISTING_GRACE_ON_SECOND_DISCONNECT ` +
            `roomCode=${room.code} secondDisconnectPlayerId=${player.playerId} ` +
            `graceOwnerPlayerId=${room.disconnectedPlayerId} ` +
            `expiresAt=${room.disconnectForfeitExpiresAt} round=${room.round}`
        );

        emitRoomUpdate(room.code, room);
        emitMatchState(room.code, room);
        return;
      }

      // ---------- Rule 3: no pick yet — classic 39s grace ----------
      // Disconnected player owes a pick this round. Pause the pick
      // timer (so they don't get auto-resolved against), mark them
      // disconnected (so matchActions blocks any pre-reconnect picks
      // from a stray duplicate socket), and arm the 39s forfeit.
      clearRoomTimer(room);

      armDisconnectForfeitGrace(
        io,
        room.code,
        room,
        player.playerId,
        "NO_PICK_GRACE_ARMED",
        endMatch
      );

      emitRoomUpdate(room.code, room);
      emitMatchState(room.code, room);

      return;
    }
  });
});

// Sprint 1 TASK 8: start the stale-room sweep. Runs every 60s and
// removes empty / idle / dangling rooms based on `lastActivityAt`.
startStaleRoomSweeper(io);

/**
 * Phase 12 TASK 9 — Tournament room mapping rehydration.
 *
 * `tournamentMatchRooms` is in-memory; on a hot restart the realtime
 * server forgot which `tournament_match_id → room_code` mappings were
 * already issued. The next `POST /internal/tournament-rooms` call
 * minted a NEW room code, leaving the persisted `tournament_matches.room_code`
 * out of sync.
 *
 * This boot-time pass rebuilds the map from the durable source of
 * truth: `tournament_matches.room_code`. It is a NO-OP when no rows
 * match. We don't reconstruct the in-memory `Room` object — that's a
 * heavier lift; if a tournament match was actively mid-game the player
 * must rejoin via the lobby flow. Documented in
 * `docs/economy-operations.md`.
 */
async function rehydrateTournamentRoomsMap(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from("tournament_matches")
      .select("id, room_code, status, winner_entry_id")
      .not("room_code", "is", null)
      .is("winner_entry_id", null)
      .in("status", ["pending", "in_progress", "ready"]);

    if (error) {
      console.warn(
        "[TournamentRoom] rehydration query failed:",
        error.message
      );
      return;
    }
    let restored = 0;
    for (const row of data ?? []) {
      const matchId = row.id as string;
      const roomCode = row.room_code as string | null;
      if (!roomCode) continue;
      tournamentMatchRooms.set(matchId, roomCode);
      restored += 1;
    }
    console.log(
      `[TournamentRoom] rehydrated ${restored} tournament_match→room_code mappings`
    );
  } catch (err) {
    console.warn("[TournamentRoom] rehydration crashed:", err);
  }
}
void rehydrateTournamentRoomsMap();

// Phase 12 TASK 10: hard launch blocker check. We REFUSE to start the
// server when real-money is enabled without JWT enforcement. Any other
// blocker is logged loudly but does not abort startup (real money is
// the only fatal mismatch).
function economyLaunchBlockers(): string[] {
  const blockers: string[] = [];
  const realMoney = process.env.ECONOMY_REAL_MONEY_ENABLED === "true";
  const jwtEnforce = process.env.SOCKET_JWT_ENFORCE === "true";
  const economyEnabled = process.env.ECONOMY_ENABLED === "true";

  if (realMoney && !jwtEnforce) {
    blockers.push(
      "ECONOMY_REAL_MONEY_ENABLED=true but SOCKET_JWT_ENFORCE!=true"
    );
  }
  if (realMoney && !economyEnabled) {
    blockers.push(
      "ECONOMY_REAL_MONEY_ENABLED=true but ECONOMY_ENABLED!=true"
    );
  }
  return blockers;
}

// Sprint 5 TASK 4: log a fingerprint of the loaded internal secret so
// operators can verify "the right secret is in this process" without
// the value ever appearing in logs. Empty / missing secret prints
// nothing instead of "**" so rotated/misconfigured deployments stay
// obvious.
if (realtimeInternalSecret) {
  console.log(
    `[boot] REALTIME_INTERNAL_SECRET fingerprint=${maskSecret(realtimeInternalSecret)}`
  );
}

// Sprint 5 TASK 8: validate the env BEFORE we start the existing
// economy launch-blocker check. The new validator covers a strict
// superset (ALLOWED_ORIGINS in prod, presence of Supabase / internal
// secret) and prints a redacted boot banner. Fatal validator failures
// short-circuit the boot here.
try {
  validateRealtimeServerEnv();
} catch (error) {
  console.error(
    "[boot] FATAL: env validation rejected startup:",
    error instanceof Error ? error.message : error
  );
  if (isProduction()) {
    process.exit(1);
  } else {
    console.warn(
      "[boot] continuing in development — production env would have aborted"
    );
  }
}

const launchBlockers = economyLaunchBlockers();
if (launchBlockers.length > 0) {
  const realMoney = process.env.ECONOMY_REAL_MONEY_ENABLED === "true";
  if (realMoney) {
    console.error(
      "[Economy] FATAL: real money is enabled with launch blockers:",
      launchBlockers
    );
    // Fail-closed: refuse to bind the port. Real money MUST NOT start
    // unless every blocker is cleared.
    process.exit(1);
  }
  for (const blocker of launchBlockers) {
    console.warn(`[Economy] launch blocker (non-fatal): ${blocker}`);
  }
}

// Sprint 4 TASK 3: even when real money is OFF, warn loudly when the
// economy is enabled without socket JWT enforcement. This is not fatal
// (test mode is allowed to run with anonymous sockets) but operators
// must SEE the gap so they don't leave it on accidentally before
// flipping the real-money flag.
if (
  process.env.ECONOMY_ENABLED === "true" &&
  process.env.SOCKET_JWT_ENFORCE !== "true" &&
  process.env.ECONOMY_REAL_MONEY_ENABLED !== "true"
) {
  console.warn(
    "[Security] ECONOMY_ENABLED=true with SOCKET_JWT_ENFORCE!=true. " +
      "This is acceptable for test mode but MUST be true before real money."
  );
}

server.listen(4000, () => {
  const policy = describeOriginPolicy();
  console.log(
    `Server running on http://localhost:4000 — CORS mode=${policy.mode}, ` +
      `origin entries=${policy.count}`
  );
});