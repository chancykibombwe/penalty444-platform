import express from "express";
import http from "http";
import { Server } from "socket.io";
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
import { verifySocketJwt } from "./security/jwt";
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
  emitPublicOffers,
  emitPublicOffersToSocket,
  registerPublicOfferHandlers,
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
import { bindRematchHandlers, registerRematchHandlers } from "./socket/rematch";
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

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

bindStakesSocketServer(io);
bindSpectatorServer(io);

function isAuthorizedInternalRequest(req: express.Request): boolean {
  if (!realtimeInternalSecret) {
    return false;
  }

  const headerSecret = req.headers["x-realtime-internal-secret"];
  if (typeof headerSecret !== "string" || headerSecret.length === 0) {
    return false;
  }

  return headerSecret === realtimeInternalSecret;
}

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

function emitRoomUpdate(roomCode: string, room: Room) {
  ensureAuthoritativeRoomRoles(room);

  const payload = {
    roomCode,
    players: room.players.map((player) => player.playerId),
    playerNames: buildPlayerNames(room),
    playerCount: room.players.length,
    isReady: room.players.length === 2,
    roles: room.roles,
    kickerPlayerId: getPlayerByRole(room, "KICKER") ?? null,
    keeperPlayerId: getPlayerByRole(room, "KEEPER") ?? null,
  };
  io.to(roomCode).emit("room:update", payload);
  mirrorToSpectators(room, "room:update", payload);
  touchRoomActivity(room);
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
  };
  io.to(roomCode).emit("match:update", payload);
  // Scoreboard / round / status are safe for spectators (no pick state).
  mirrorToSpectators(room, "match:update", payload);
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

  clearRoomTimer(room);

  // Sprint 1 TASK 6: explicitly leave `isResolving` consistent with the
  // ended state — the continuation timer guards against late wakes.
  room.isResolving = false;

  room.matchEnded = true;
  room.rematchVotes = [];
  room.picks = {};

  console.log("[END MATCH CLEAR]", {
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

  console.log("[AFTER CLEAR]", {
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
  (async () => {
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

    // Sprint 1 TASK 4: schedule the room for delayed deletion so memory
    // doesn't leak. Cancellable if a rematch starts before the timer.
    scheduleRoomCleanup(io, roomCode, "match-ended");
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
  io.to(roomCode).emit("match:aborted", abortPayload);
  mirrorToSpectators(room, "match:aborted", abortPayload);

  emitMatchState(roomCode, room);
  emitRoomUpdate(roomCode, room);

  // Sprint 1 TASK 4: aborted rooms also get scheduled for cleanup.
  scheduleRoomCleanup(io, roomCode, "match-aborted");
}

const resolveRoundSeqByRoom = new Map<string, number>();
bindResolveSeqMap(resolveRoundSeqByRoom);

function resolveRound(roomCode: string, room: Room, fromTimeout = false) {
  if (room.matchEnded) return;
  if (room.isResolving) {
    console.log(
      `[resolveRound] skip duplicate room=${roomCode} round=${room.round} fromTimeout=${fromTimeout}`
    );
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
        r.round += 1;
        swapRoles(r);

        io.to(roomCode).emit("match:status", {
          roomCode,
          message: "Match tied. Sudden Death begins.",
          timeoutSeconds: 10,
          phase: r.phase,
          suddenDeathRound: r.suddenDeathRound,
        });

        emitRoomUpdate(roomCode, r);
        emitMatchState(roomCode, r);
        // Next round is officially starting → clear resolving just before.
        r.isResolving = false;
        console.log(
          `[Resolve] next round armed roomCode=${roomCode} round=${r.round} phase=${r.phase}`
        );
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
    r.round += 1;

    emitRoomUpdate(roomCode, r);
    emitMatchState(roomCode, r);
    r.isResolving = false;
    console.log(
      `[Resolve] next round armed roomCode=${roomCode} round=${r.round} phase=${r.phase}`
    );
    startRoundTimer(roomCode, r);
  }, continuationPauseMs);
}

bindRoundTimers({
  io,
  resolveRound,
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
  emitMatchState,
  startRoundTimer,
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

  // Sprint 2 TASK 2: best-effort Supabase JWT verification on connect.
  // Non-blocking — gameplay handlers still work for anonymous clients
  // until the client migration finishes (see docs/socket-auth-plan.md).
  void verifySocketJwt(socket).then((result) => {
    if (result.ok === true) {
      console.log(
        `[Security] jwt verified socketId=${socket.id} userId=${result.userId}`
      );
    } else {
      const reason = result.reason;
      if (reason !== "no_token" && reason !== "no_backend") {
        console.warn(
          `[Security] jwt verify failed socketId=${socket.id} reason=${reason}`
        );
      }
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

      registerPlayerSocket(playerId, socket.id);
      console.log(
        `[tournament-registry] player:register playerId=${playerId.trim()} socketId=${socket.id}`
      );
    }
  );

  socket.on(
    "tournament:subscribe",
    ({ tournamentId }: { tournamentId?: string }) => {
      if (typeof tournamentId !== "string" || tournamentId.trim().length === 0) {
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

    unregisterSocket(socket.id);
    console.log(
      `[tournament-registry] disconnect cleanup socketId=${socket.id}`
    );

    // Sprint 1 TASK 1: drop any spectator memberships this socket held.
    pruneSpectatorOnDisconnect(socket.id);

    removeRankedQueueEntryBySocketId(socket.id);

    for (const offer of publicOffers.values()) {
      const room = rooms.get(offer.roomCode);
      const host = room?.players.find(
        (player) => player.playerId === offer.hostPlayerId
      );

      if (host?.socketId === socket.id) {
        if (publicOffers.has(offer.offerId)) {
          publicOffers.delete(offer.offerId);

          await unlockStake(offer.hostPlayerId, offer.stakeAmount);

          clearPlayerActiveRoom(offer.hostPlayerId);
          emitPublicOffers("host disconnected, offer removed");
        }

        break;
      }
    }

    for (const room of rooms.values()) {
      const player = room.players.find(
        (roomPlayer) => roomPlayer.socketId === socket.id
      );

      if (!player) continue;

      // Only apply reconnect-forfeit to active 2-player matches that are not ended.
      if (room.players.length !== 2 || room.matchEnded) {
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

      // Pause all match timers while we wait for reconnect.
      clearRoomTimer(room);

      room.disconnectedPlayerId = player.playerId;
      room.disconnectedAt = Date.now();

      io.to(room.code).emit("match:status", {
        roomCode: room.code,
        message: "Opponent disconnected. Waiting 39 seconds for reconnect...",
        phase: room.phase,
        suddenDeathRound: room.suddenDeathRound,
      });

      room.disconnectForfeitTimeout = setTimeout(() => {
        const r = rooms.get(room.code);
        if (!r) return;
        if (r.matchEnded) return;

        const disconnectedId = r.disconnectedPlayerId;
        if (!disconnectedId) return;

        const opponent = r.players.find((p) => p.playerId !== disconnectedId);
        if (!opponent) return;

        const maxScore = Math.max(...Object.values(r.scores || {}), 0);
        r.scores[opponent.playerId] = maxScore + 1;

        r.disconnectedPlayerId = undefined;
        r.disconnectedAt = undefined;
        r.disconnectForfeitTimeout = undefined;

        endMatch(r.code, r);
      }, 39_000);

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

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});