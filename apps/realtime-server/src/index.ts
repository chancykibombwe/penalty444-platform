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
      notifyPlayerIds?: string[];
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
        `[tournament-registry] tournament:matchReady tournamentId=${tournamentId} matchId=${tournamentMatchId} roomCode=${roomCode} existing=${existing} players=${notifyPlayerIds.length}`
      );
    };

    const existingCode = tournamentMatchRooms.get(tournamentMatchId);
    if (existingCode && rooms.has(existingCode)) {
      notifyPlayers(existingCode, true);
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

      notifyPlayers(code, false);
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

  io.to(roomCode).emit("room:update", {
    roomCode,
    players: room.players.map((player) => player.playerId),
    playerNames: buildPlayerNames(room),
    playerCount: room.players.length,
    isReady: room.players.length === 2,
    roles: room.roles,
    kickerPlayerId: getPlayerByRole(room, "KICKER") ?? null,
    keeperPlayerId: getPlayerByRole(room, "KEEPER") ?? null,
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
  ensureAuthoritativeRoomRoles(room);

  const matchStartedAt = room.matchStartedAt;
  const earlyCancelDeadlineAt =
    isTournamentRoom(room) || matchStartedAt === undefined
      ? undefined
      : matchStartedAt + EARLY_CANCEL_MS;

  const kickerPlayerId = getPlayerByRole(room, "KICKER") ?? null;
  const keeperPlayerId = getPlayerByRole(room, "KEEPER") ?? null;

  io.to(roomCode).emit("match:update", {
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
    tournamentId: isTournamentRoom(room) ? room.tournamentId : undefined,
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

const resolveRoundSeqByRoom = new Map<string, number>();

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

  io.to(roomCode).emit("match:result", {
    roomCode,
    round: resolvingRound,
    kickerPlayerId,
    keeperPlayerId,
    kickerPick: kickerPick || null,
    keeperPick: keeperPick || null,
    result,
    statusMessage,
  });

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
      room.isResolving = false;
      return;
    }

    if (resolveRoundSeqByRoom.get(roomCode) !== resolveSeq) {
      console.log(
        `[resolveRound] skip stale continuation room=${roomCode} round=${r.round} seq=${resolveSeq}`
      );
      r.isResolving = false;
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
            roomCode,
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

  socket.emit("connected", {
    socketId: socket.id,
  });

  emitPublicOffersToSocket(socket.id, "connection snapshot");

  registerPublicOfferHandlers(socket);
  registerRankedHandlers(socket);
  registerRoomSocketHandlers(socket);
  registerMatchActionHandlers(socket);
  registerRematchHandlers(socket);

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

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});