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
import {
  playerActiveRooms,
  publicOffers,
  rankedQueue,
  rooms,
  tournamentMatchRooms,
} from "./state/stores";
import {
  getPlayerByRole,
  getPointWinnerRole,
  resolveShot,
  swapRoles,
} from "./gameplay/resolveShot";
import { resolveMatchOutcome } from "./gameplay/matchOutcome";
import {
  shouldEndSuddenDeath,
  shouldEnterSuddenDeath,
} from "./gameplay/suddenDeath";
import {
  bindRoundTimers,
  clearRoomTimer,
  startRoundTimer,
} from "./gameplay/timers";
import { normalizeRoomCode } from "./room/codes";
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
  bindRoomSocketHandlers,
  registerRoomSocketHandlers,
} from "./socket/rooms";
import {
  bindStakesSocketServer,
  getStakeAmount,
  lockStake,
  refundBothStakes,
  settleStakes,
  unlockStake,
} from "./wallet/stakes";

export { createTournamentRoom } from "./room/lifecycle";
import type {
  Lane,
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

app.post("/internal/tournament-rooms", (req, res) => {
    if (!isAuthorizedInternalRequest(req)) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const body = req.body as {
      tournamentId?: string;
      tournamentMatchId?: string;
      allowedPlayerIds?: string[];
      maxRounds?: number;
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
    const maxRounds =
      typeof body.maxRounds === "number" && body.maxRounds > 0
        ? body.maxRounds
        : 3;

    if (!tournamentId || !tournamentMatchId) {
      res.status(400).json({
        error: "tournamentId and tournamentMatchId are required.",
      });
      return;
    }

    const existingCode = tournamentMatchRooms.get(tournamentMatchId);
    if (existingCode && rooms.has(existingCode)) {
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "penalty444-realtime-server",
    rooms: rooms.size,
    tournamentMatchRooms: tournamentMatchRooms.size,
    publicOffers: publicOffers.size,
    rankedQueue: rankedQueue.size,
    activePlayers: playerActiveRooms.size,
    connectedSockets: io.engine.clientsCount,
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
  io.to(roomCode).emit("room:update", {
    roomCode,
    players: room.players.map((player) => player.playerId),
    playerNames: buildPlayerNames(room),
    playerCount: room.players.length,
    isReady: room.players.length === 2,
    roles: room.roles,
  });
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
  const matchStartedAt = room.matchStartedAt;
  const earlyCancelDeadlineAt =
    isTournamentRoom(room) || matchStartedAt === undefined
      ? undefined
      : matchStartedAt + EARLY_CANCEL_MS;

  io.to(roomCode).emit("match:update", {
    roles: room.roles,
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
  });
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

async function advanceTournamentFromRoom(room: Room) {
  if (room.matchType !== "tournament") return;
  if (room.bracketAdvanced) return;

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
    console.warn("[tournament advance] slot already has a different winner", {
      tournamentMatchId: slot.id,
      existingWinnerEntryId: slot.winner_entry_id,
      winnerEntryId,
    });
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
      console.log("[tournament advance] slot completed", {
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
    const { error: tournamentError } = await supabase
      .from("tournaments")
      .update({
        status: "completed",
        winner_id: winnerUserId,
        updated_at: completedAt,
      })
      .eq("id", room.tournamentId)
      .eq("status", "in_progress");

    if (tournamentError) {
      console.error(
        "[tournament advance] failed to complete tournament:",
        tournamentError.message
      );
      return;
    }

    console.log("[tournament advance] tournament completed", {
      tournamentId: room.tournamentId,
      winnerUserId,
    });
    room.bracketAdvanced = true;
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

  room.bracketAdvanced = true;
}

async function saveMatchResult(room: Room) {
  if (!supabase) {
    console.warn("Supabase backend client is not configured. Match not saved.");
    return;
  }

  if (room.resultSaved) return;

  const outcome = resolveMatchOutcome(room);
  if (!outcome) return;

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

  if (error) {
    console.error("Failed to save match result:", error.message);
    return;
  }

  room.resultSaved = true;
  console.log(`Saved match result for room ${room.code}`);

  try {
    await advanceTournamentFromRoom(room);
  } catch (advanceError) {
    console.error("Tournament advancement crashed:", advanceError);
  }
}

function endMatch(roomCode: string, room: Room) {
  if (room.matchEnded) return;

  clearRoomTimer(room);

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

  io.to(roomCode).emit("match:end", {
    scores: room.scores,
  });

  emitMatchState(roomCode, room);

  saveMatchResult(room).catch((error) => {
    console.error("Match result save crashed:", error);
  });

  settleStakes(room).catch((error) => {
    console.error("Stake settlement crashed:", error);
  });
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

  io.to(roomCode).emit("match:aborted", {
    roomCode,
    abortedBy: abortedByPlayerId,
    matchInstance: room.matchInstance ?? 1,
    reason: "early_cancel",
  });

  emitMatchState(roomCode, room);
  emitRoomUpdate(roomCode, room);
}

function resolveRound(roomCode: string, room: Room, fromTimeout = false) {
  if (room.matchEnded) return;
  if (room.isResolving) return;

  const kickerPick = room.picks.KICKER;
  const keeperPick = room.picks.KEEPER;
  const result = resolveShot(kickerPick, keeperPick);
  const pointWinnerRole = getPointWinnerRole(kickerPick, keeperPick, result);

  if (pointWinnerRole) {
    const pointWinnerId = getPlayerByRole(room, pointWinnerRole);

    if (pointWinnerId) {
      room.scores[pointWinnerId] = (room.scores[pointWinnerId] || 0) + 1;
    }
  }

  clearRoomTimer(room);

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

  io.to(roomCode).emit("match:result", {
    kickerPick: kickerPick || null,
    keeperPick: keeperPick || null,
    result,
    statusMessage,
  });

  room.isResolving = true;

  if (room.resolveContinuationTimeout) {
    clearTimeout(room.resolveContinuationTimeout);
    room.resolveContinuationTimeout = undefined;
  }

  room.resolveContinuationTimeout = setTimeout(() => {
    room.resolveContinuationTimeout = undefined;

    const r = rooms.get(roomCode);
    if (!r) {
      room.isResolving = false;
      return;
    }

    if (r.matchEnded) {
      r.isResolving = false;
      return;
    }

    try {
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
            message: "Match tied. Sudden Death begins.",
            timeoutSeconds: 10,
            phase: r.phase,
            suddenDeathRound: r.suddenDeathRound,
          });

          emitRoomUpdate(roomCode, r);
          emitMatchState(roomCode, r);
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
      startRoundTimer(roomCode, r);
    } finally {
      r.isResolving = false;
    }
  }, RESULT_REVEAL_PAUSE_MS);
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

function resetRoomForRematch(roomCode: string, room: Room) {
  if (isTournamentRoom(room)) {
    return;
  }

  clearRoomTimer(room);

  room.isResolving = false;

  room.matchInstance = (room.matchInstance ?? 1) + 1;

  room.picks = {};
  room.round = 1;
  room.phase = "NORMAL";
  room.suddenDeathRound = 0;
  room.matchEnded = false;
  room.matchStartedAt = undefined;
  room.rematchVotes = [];
  room.resultSaved = false;
  room.stakeSettled = room.stakeAmount > 0;
  room.scores = {};
  room.disconnectedPlayerId = undefined;
  room.disconnectedAt = undefined;
  room.disconnectForfeitTimeout = undefined;

  const first = room.players[0];
  const second = room.players[1];

  if (first) {
    room.roles[first.playerId] = "KICKER";
    room.scores[first.playerId] = 0;
    setPlayerActiveRoom(first.playerId, roomCode);
  }

  if (second) {
    room.roles[second.playerId] = "KEEPER";
    room.scores[second.playerId] = 0;
    setPlayerActiveRoom(second.playerId, roomCode);
  }

  emitRoomUpdate(roomCode, room);
  emitMatchState(roomCode, room);
  startRoundTimer(roomCode, room);
}

io.on("connection", (socket) => {
  console.log(
    `Socket connected: ${socket.id}. Connected sockets: ${io.engine.clientsCount}`
  );

  socket.emit("connected", {
    socketId: socket.id,
  });

  emitPublicOffersToSocket(socket.id, "connection snapshot");

  registerPublicOfferHandlers(socket);
  registerRankedHandlers(socket);
  registerRoomSocketHandlers(socket);

  socket.on(
    "match:pick",
    ({
      roomCode,
      lane,
      playerId,
    }: {
      roomCode: string;
      lane: Lane;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (room.matchEnded) return;
      if (room.isResolving) return;
      if (room.disconnectedPlayerId === playerId) return;

      const role = room.roles[playerId];

      if (!role) return;
      if (room.picks[role]) return;

      room.picks[role] = lane;

      io.to(code).emit("match:status", {
        message: `${
          room.players.find((player) => player.playerId === playerId)
            ?.username || "Player"
        } locked pick.`,
        phase: room.phase,
        suddenDeathRound: room.suddenDeathRound,
      });

      if (room.picks.KICKER && room.picks.KEEPER) {
        resolveRound(code, room);
      }
    }
  );

  socket.on(
    "match:rematch",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (!room.matchEnded) return;

      if (isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches do not allow rematches.",
        });
        return;
      }

      if (room.stakeAmount > 0) {
        socket.emit("error:message", {
          message:
            "Staked rematch is not enabled yet. Return to lobby and create a new offer.",
        });
        return;
      }

      if (!room.rematchVotes.includes(playerId)) {
        room.rematchVotes.push(playerId);
      }

      io.to(code).emit("match:rematch:update", {
        votes: room.rematchVotes.length,
        required: room.players.length,
        lastRequesterId: playerId,
      });

      if (room.players.length === 2 && room.rematchVotes.length === 2) {
        io.to(code).emit("match:rematch:accepted");
        resetRoomForRematch(code, room);
      }
    }
  );

  socket.on(
    "match:rematch:decline",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (!room.matchEnded) return;

      if (isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches do not allow rematches.",
        });
        return;
      }

      room.rematchVotes = [];

      io.to(code).emit("match:rematch:update", {
        votes: 0,
        required: room.players.length,
        lastRequesterId: null,
      });

      io.to(code).emit("match:rematch:declined", {
        declinedBy: playerId,
      });
    }
  );

  socket.on(
    "match:abortEarly",
    async ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found." });
        return;
      }

      if (isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches cannot be cancelled.",
        });
        return;
      }

      if (room.players.length !== 2) {
        socket.emit("error:message", {
          message: "Match is not ready to cancel.",
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "Match has already ended.",
        });
        return;
      }

      if (room.matchStartedAt === undefined) {
        socket.emit("error:message", {
          message: "Match has not started yet.",
        });
        return;
      }

      if (Date.now() - room.matchStartedAt >= EARLY_CANCEL_MS) {
        socket.emit("error:message", {
          message:
            "Early cancel window has expired. Use forfeit if you want to leave.",
        });
        return;
      }

      if (room.isResolving) {
        socket.emit("error:message", {
          message: "Cannot cancel while a round is resolving.",
        });
        return;
      }

      if (room.picks.KICKER || room.picks.KEEPER) {
        socket.emit("error:message", {
          message: "Cannot cancel after a pick has been submitted.",
        });
        return;
      }

      const playerInRoom = room.players.some(
        (player) => player.playerId === playerId
      );

      if (!playerInRoom) {
        socket.emit("error:message", {
          message: "You are not in this match.",
        });
        return;
      }

      try {
        await abortMatchEarly(code, room, playerId);
      } catch (error) {
        console.error("match:abortEarly failed:", error);
        socket.emit("error:message", {
          message: "Failed to cancel match.",
        });
      }
    }
  );

  socket.on(
    "match:forfeit",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found." });
        return;
      }

      if (room.players.length !== 2) {
        socket.emit("error:message", {
          message: "Match is not ready for forfeit.",
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "Match has already ended.",
        });
        return;
      }

      if (room.matchStartedAt === undefined) {
        socket.emit("error:message", {
          message: "Match has not started yet.",
        });
        return;
      }

      if (
        !isTournamentRoom(room) &&
        Date.now() - room.matchStartedAt < EARLY_CANCEL_MS
      ) {
        socket.emit("error:message", {
          message:
            "Use cancel match during the first 5 seconds instead of forfeit.",
        });
        return;
      }

      if (room.isResolving) {
        socket.emit("error:message", {
          message: "Cannot forfeit while a round is resolving.",
        });
        return;
      }

      const playerInRoom = room.players.some(
        (player) => player.playerId === playerId
      );

      if (!playerInRoom) {
        socket.emit("error:message", {
          message: "You are not in this match.",
        });
        return;
      }

      const opponent = room.players.find(
        (player) => player.playerId !== playerId
      );

      if (!opponent) {
        socket.emit("error:message", {
          message: "Opponent not found.",
        });
        return;
      }

      if (room.disconnectForfeitTimeout) {
        clearTimeout(room.disconnectForfeitTimeout);
        room.disconnectForfeitTimeout = undefined;
      }

      room.disconnectedPlayerId = undefined;
      room.disconnectedAt = undefined;

      const maxScore = Math.max(...Object.values(room.scores || {}), 0);
      room.scores[opponent.playerId] = maxScore + 1;

      endMatch(code, room);
    }
  );

  socket.on("disconnect", async (reason) => {
    console.log(
      `Socket disconnected: ${socket.id}. reason=${reason}. Connected sockets: ${io.engine.clientsCount}`
    );

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

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});