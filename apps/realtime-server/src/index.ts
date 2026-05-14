import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

type Lane = "LEFT" | "CENTER" | "RIGHT";
type Role = "KICKER" | "KEEPER";
type ShotResult = "GOAL" | "SAVE" | "DRAW";
type MatchType = "private" | "public" | "unknown";
type MatchPhase = "NORMAL" | "SUDDEN_DEATH";

const PICK_TIMEOUT_MS = 10000;
const MAX_SUDDEN_DEATH_CYCLES = 10;

type RoomPlayer = {
  playerId: string;
  socketId: string;
  username: string;
};

type Room = {
  code: string;
  /** Increments when a rematch starts in the same room; pairs with room_code for saved rows. */
  matchInstance: number;
  players: RoomPlayer[];
  roles: Record<string, Role>;
  picks: Partial<Record<Role, Lane>>;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: MatchPhase;
  suddenDeathRound: number;
  rematchVotes: string[];
  matchEnded: boolean;
  matchType: MatchType;
  stakeLabel: string;
  stakeAmount: number;
  stakeSettled: boolean;
  resultSaved: boolean;
  timeout?: NodeJS.Timeout;
  isResolving: boolean;
  resolveContinuationTimeout?: NodeJS.Timeout;
  disconnectedPlayerId?: string;
  disconnectedAt?: number;
  disconnectForfeitTimeout?: NodeJS.Timeout;
};

type PublicMatchOffer = {
  offerId: string;
  roomCode: string;
  hostPlayerId: string;
  hostUsername: string;
  stakeLabel: string;
  stakeAmount: number;
  rounds: number;
  createdAt: number;
};

const rooms = new Map<string, Room>();
const publicOffers = new Map<string, PublicMatchOffer>();
const playerActiveRooms = new Map<string, string>();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "penalty444-realtime-server",
    rooms: rooms.size,
    publicOffers: publicOffers.size,
    activePlayers: playerActiveRooms.size,
    connectedSockets: io.engine.clientsCount,
  });
});

function cleanUsername(username?: string) {
  return username?.trim() || "Player";
}

function normalizeRoomCode(roomCode?: string) {
  return roomCode?.trim()?.toUpperCase() || "";
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generateOfferId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getStakeAmount(stakeLabel?: string) {
  const label = stakeLabel?.trim().toUpperCase();

  if (!label || label === "FREE") return 0;
  if (label === "K10") return 10;
  if (label === "K50") return 50;
  if (label === "K100") return 100;

  return 0;
}

function getTrackedActiveRoom(playerId?: string) {
  if (!playerId) return null;

  const trackedRoomCode = playerActiveRooms.get(playerId);
  if (!trackedRoomCode) return null;

  const room = rooms.get(trackedRoomCode);

  if (!room || room.matchEnded) {
    playerActiveRooms.delete(playerId);
    return null;
  }

  return trackedRoomCode;
}

function setPlayerActiveRoom(playerId: string, roomCode: string) {
  const code = normalizeRoomCode(roomCode);
  if (!playerId || !code) return;

  playerActiveRooms.set(playerId, code);
  console.log(`[active-room:set] player=${playerId} room=${code}`);
}

function clearPlayerActiveRoom(playerId?: string) {
  if (!playerId) return;

  playerActiveRooms.delete(playerId);
  console.log(`[active-room:clear] player=${playerId}`);
}

function clearPlayersActiveRoomsForRoom(room: Room) {
  for (const player of room.players) {
    clearPlayerActiveRoom(player.playerId);
  }
}

function playerIsBusyInDifferentRoom(playerId: string, targetRoomCode?: string) {
  const trackedRoomCode = getTrackedActiveRoom(playerId);
  if (!trackedRoomCode) return null;

  const targetCode = normalizeRoomCode(targetRoomCode);

  if (targetCode && trackedRoomCode === targetCode) {
    return null;
  }

  return trackedRoomCode;
}

function clearRoomTimer(room: Room) {
  if (room.timeout) {
    clearTimeout(room.timeout);
    room.timeout = undefined;
  }
  if (room.resolveContinuationTimeout) {
    clearTimeout(room.resolveContinuationTimeout);
    room.resolveContinuationTimeout = undefined;
  }
  if (room.disconnectForfeitTimeout) {
    clearTimeout(room.disconnectForfeitTimeout);
    room.disconnectForfeitTimeout = undefined;
  }
}

function resolveShot(kickerLane?: Lane, keeperLane?: Lane): ShotResult {
  if (!kickerLane && !keeperLane) return "DRAW";
  if (!kickerLane && keeperLane) return "SAVE";
  if (kickerLane && !keeperLane) return "GOAL";
  if (kickerLane === keeperLane) return "SAVE";
  return "GOAL";
}

function getPointWinnerRole(
  kickerLane?: Lane,
  keeperLane?: Lane,
  result?: ShotResult
): Role | null {
  if (!kickerLane && !keeperLane) return null;
  if (!kickerLane && keeperLane) return null;
  if (kickerLane && !keeperLane) return "KICKER";
  if (result === "GOAL") return "KICKER";

  return null;
}

function getPlayerByRole(room: Room, role: Role) {
  return Object.keys(room.roles).find(
    (playerId) => room.roles[playerId] === role
  );
}

function swapRoles(room: Room) {
  const currentRoles = { ...room.roles };

  for (const playerId of Object.keys(currentRoles)) {
    room.roles[playerId] =
      currentRoles[playerId] === "KICKER" ? "KEEPER" : "KICKER";
  }
}

function buildPlayerNames(room: Room) {
  const playerNames: Record<string, string> = {};

  for (const player of room.players) {
    playerNames[player.playerId] = player.username;
  }

  return playerNames;
}

function getPublicOffersPayload() {
  return {
    offers: Array.from(publicOffers.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    ),
  };
}

function emitPublicOffers(reason = "manual") {
  const payload = getPublicOffersPayload();

  console.log(
    `[publicOffers:update] reason=${reason} offers=${payload.offers.length} connectedSockets=${io.engine.clientsCount}`
  );

  io.emit("publicOffers:update", payload);
}

function emitPublicOffersToSocket(socketId: string, reason = "socket snapshot") {
  const socket = io.sockets.sockets.get(socketId);

  if (!socket) return;

  const payload = getPublicOffersPayload();

  console.log(
    `[publicOffers:update -> socket] reason=${reason} socket=${socketId} offers=${payload.offers.length}`
  );

  socket.emit("publicOffers:update", payload);
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

function emitMatchState(roomCode: string, room: Room) {
  io.to(roomCode).emit("match:update", {
    roles: room.roles,
    playerNames: buildPlayerNames(room),
    scores: room.scores,
    round: room.round,
    maxRounds: room.maxRounds,
    matchEnded: room.matchEnded,
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
  });
}

async function lockStake(playerId: string, stakeAmount: number) {
  if (stakeAmount <= 0) {
    return { ok: true, message: "Free match. No stake locked." };
  }

  if (!supabase) {
    return { ok: false, message: "Wallet system not configured." };
  }

  const { data, error } = await supabase.rpc("lock_wallet_stake", {
    p_user_id: playerId,
    p_amount: stakeAmount,
  });

  if (error) {
    console.error("Lock RPC error:", error);
    return { ok: false, message: "Failed to lock stake." };
  }

  const result = data?.[0];

  return {
    ok: result?.ok ?? false,
    message: result?.message ?? "Unknown wallet error.",
  };
}

async function unlockStake(playerId: string, stakeAmount: number) {
  if (stakeAmount <= 0) return;
  if (!supabase) return;

  const { error } = await supabase.rpc("unlock_wallet_stake", {
    p_user_id: playerId,
    p_amount: stakeAmount,
  });

  if (error) {
    console.error("Unlock RPC error:", error);
  }
}

async function settleStakes(room: Room) {
  if (!supabase) return;
  if (room.stakeSettled) return;

  if (room.stakeAmount <= 0) {
    room.stakeSettled = true;
    return;
  }

  if (room.players.length < 2) return;

  const playerOne = room.players[0];
  const playerTwo = room.players[1];

  if (!playerOne || !playerTwo) return;

  const playerOneScore = room.scores[playerOne.playerId] || 0;
  const playerTwoScore = room.scores[playerTwo.playerId] || 0;

  const isDraw = playerOneScore === playerTwoScore;

  if (isDraw) {
    await unlockStake(playerOne.playerId, room.stakeAmount);
    await unlockStake(playerTwo.playerId, room.stakeAmount);

    room.stakeSettled = true;
    console.log(`Draw settlement complete for room ${room.code}`);

    io.to(room.code).emit("wallet:update", {
      reason: "draw_unlock",
      roomCode: room.code,
    });

    return;
  }

  const winner = playerOneScore > playerTwoScore ? playerOne : playerTwo;
  const loser = playerOneScore > playerTwoScore ? playerTwo : playerOne;

  const { data, error } = await supabase.rpc("settle_wallet_stakes", {
    p_winner_id: winner.playerId,
    p_loser_id: loser.playerId,
    p_stake_amount: room.stakeAmount,
  });

  if (error) {
    console.error("Settle RPC error:", error);
    return;
  }

  const result = data?.[0];

  if (!result?.ok) {
    console.error("Settlement failed:", result?.message);
    return;
  }

  room.stakeSettled = true;

  io.to(room.code).emit("wallet:update", {
    reason: "settlement",
    roomCode: room.code,
    winnerId: winner.playerId,
    loserId: loser.playerId,
  });

  console.log(
    `Secure settlement complete: ${winner.username} won ${room.stakeAmount}`
  );
}

function createRoomWithPlayers(
  players: RoomPlayer[],
  maxRounds = 3,
  matchType: MatchType = "private",
  stakeLabel = "Free"
) {
  const code = generateRoomCode();
  const firstPlayer = players[0];
  const secondPlayer = players[1];
  const stakeAmount = getStakeAmount(stakeLabel);

  const room: Room = {
    code,
    matchInstance: 1,
    players,
    roles: {},
    picks: {},
    scores: {},
    round: 1,
    maxRounds,
    phase: "NORMAL",
    suddenDeathRound: 0,
    rematchVotes: [],
    matchEnded: false,
    matchType,
    stakeLabel,
    stakeAmount,
    stakeSettled: false,
    resultSaved: false,
    isResolving: false,
  };

  if (firstPlayer) {
    room.roles[firstPlayer.playerId] = "KICKER";
    room.scores[firstPlayer.playerId] = 0;
  }

  if (secondPlayer) {
    room.roles[secondPlayer.playerId] = "KEEPER";
    room.scores[secondPlayer.playerId] = 0;
  }

  rooms.set(code, room);

  for (const player of players) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.join(code);
    setPlayerActiveRoom(player.playerId, code);
  }

  emitRoomUpdate(code, room);
  emitMatchState(code, room);

  if (room.players.length === 2) {
    startRoundTimer(code, room);
  }

  return { code, room };
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

async function saveMatchResult(room: Room) {
  if (!supabase) {
    console.warn("Supabase backend client is not configured. Match not saved.");
    return;
  }

  if (room.resultSaved) return;
  if (room.players.length < 2) return;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;

  const isDraw = firstScore === secondScore;

  const winner = isDraw
    ? null
    : firstScore > secondScore
      ? firstPlayer
      : secondPlayer;

  const loser = isDraw
    ? null
    : firstScore > secondScore
      ? secondPlayer
      : firstPlayer;

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
}

function endMatch(roomCode: string, room: Room) {
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

function startRoundTimer(roomCode: string, room: Room) {
  clearRoomTimer(room);

  if (room.matchEnded) return;
  if (room.players.length < 2) return;

  io.to(roomCode).emit("match:status", {
    message:
      room.phase === "SUDDEN_DEATH"
        ? `Sudden Death ${room.suddenDeathRound}. You have 10 seconds to act.`
        : "New round started. You have 10 seconds to act.",
    timeoutSeconds: 10,
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
  });

  room.timeout = setTimeout(() => {
    resolveRound(roomCode, room, true);
  }, PICK_TIMEOUT_MS);
}

function shouldEnterSuddenDeath(room: Room) {
  if (room.phase !== "NORMAL") return false;

  const totalNormalTurns = room.maxRounds * 2;

  if (room.round < totalNormalTurns) return false;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return false;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;

  return firstScore === secondScore;
}

function shouldEndSuddenDeath(room: Room) {
  if (room.phase !== "SUDDEN_DEATH") return false;

  const totalNormalTurns = room.maxRounds * 2;
  const suddenTurnsPlayed = room.round - totalNormalTurns;

  if (suddenTurnsPlayed <= 0) return false;
  if (suddenTurnsPlayed % 2 !== 0) return false;

  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];

  if (!firstPlayer || !secondPlayer) return false;

  const firstScore = room.scores[firstPlayer.playerId] || 0;
  const secondScore = room.scores[secondPlayer.playerId] || 0;

  if (firstScore !== secondScore) return true;

  if (room.suddenDeathRound >= MAX_SUDDEN_DEATH_CYCLES) return true;

  return false;
}

const RESULT_REVEAL_PAUSE_MS = 3000;

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

function resetRoomForRematch(roomCode: string, room: Room) {
  clearRoomTimer(room);

  room.isResolving = false;

  room.matchInstance = (room.matchInstance ?? 1) + 1;

  room.picks = {};
  room.round = 1;
  room.phase = "NORMAL";
  room.suddenDeathRound = 0;
  room.matchEnded = false;
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

  socket.on("publicOffers:request", () => {
    emitPublicOffersToSocket(socket.id, "client requested snapshot");
  });

  socket.on(
    "activeRoom:clear",
    ({ playerId }: { playerId?: string }) => {
      try {
        if (typeof playerId !== "string" || !playerId.trim()) {
          socket.emit("activeRoom:clear:error", {
            message:
              "Player ID is missing. Unable to clear stale active room.",
          });
          return;
        }

        const normalizedPlayerId = playerId.trim();

        clearPlayerActiveRoom(normalizedPlayerId);

        socket.emit("activeRoom:cleared", {
          message:
            "Your stale active-room entry was cleared locally. Wallet stakes were not modified. You can create or join a match again.",
        });
      } catch (error) {
        console.error("activeRoom:clear crashed:", error);

        socket.emit("activeRoom:clear:error", {
          message:
            error instanceof Error
              ? error.message
              : "Something went wrong while clearing stale active room.",
        });
      }
    }
  );

  socket.on(
    "room:create",
    ({
      playerId,
      username,
    }: {
      playerId: string;
      username?: string;
    }) => {
      const busyRoomCode = getTrackedActiveRoom(playerId);

      if (busyRoomCode) {
        socket.emit("error:message", {
          message: `You are already in an active room (${busyRoomCode}). Finish or leave that match first.`,
        });
        return;
      }

      const playerName = cleanUsername(username);

      const { code } = createRoomWithPlayers(
        [
          {
            playerId,
            socketId: socket.id,
            username: playerName,
          },
        ],
        3,
        "private",
        "Free"
      );

      setPlayerActiveRoom(playerId, code);

      socket.emit("room:created", {
        roomCode: code,
      });

      socket.emit("room:joined", {
        roomCode: code,
      });
    }
  );

  socket.on(
    "room:join",
    ({
      roomCode,
      playerId,
      username,
    }: {
      roomCode: string;
      playerId: string;
      username?: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const playerName = cleanUsername(username);

      if (!code) {
        socket.emit("error:message", { message: "Room code is required" });
        return;
      }

      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found" });
        return;
      }

      const existingPlayer = room.players.find(
        (player) => player.playerId === playerId
      );

      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.username = playerName;

        setPlayerActiveRoom(playerId, code);

        if (room.disconnectedPlayerId === playerId) {
          if (room.disconnectForfeitTimeout) {
            clearTimeout(room.disconnectForfeitTimeout);
            room.disconnectForfeitTimeout = undefined;
          }

          room.disconnectedPlayerId = undefined;
          room.disconnectedAt = undefined;

          io.to(code).emit("match:status", {
            message: "Opponent reconnected. Match continues.",
            phase: room.phase,
            suddenDeathRound: room.suddenDeathRound,
          });

          // Keep reconnect logic simple: always restart the round timer.
          startRoundTimer(code, room);
        }

        socket.join(code);
        socket.emit("room:joined", { roomCode: code });

        emitRoomUpdate(code, room);
        emitMatchState(code, room);
        return;
      }

      const busyDifferentRoomCode = playerIsBusyInDifferentRoom(playerId, code);

      if (busyDifferentRoomCode) {
        socket.emit("error:message", {
          message: `You are already in another active room (${busyDifferentRoomCode}). Finish or leave that match first.`,
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "This match has already ended.",
        });
        return;
      }

      if (room.players.length >= 2) {
        socket.emit("error:message", { message: "Room is full" });
        return;
      }

      room.players.push({
        playerId,
        socketId: socket.id,
        username: playerName,
      });

      room.roles[playerId] = "KEEPER";
      room.scores[playerId] = 0;

      setPlayerActiveRoom(playerId, code);

      socket.join(code);
      socket.emit("room:joined", { roomCode: code });

      emitRoomUpdate(code, room);
      emitMatchState(code, room);

      if (room.players.length === 2) {
        startRoundTimer(code, room);
      }
    }
  );

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

        const busyRoomCode = getTrackedActiveRoom(playerId);

        if (busyRoomCode) {
          socket.emit("publicOffers:error", {
            message: `You are already in an active room (${busyRoomCode}). Finish or leave that match first.`,
          });
          return;
        }

        const playerName = cleanUsername(username);
        const safeRounds = Number.isFinite(rounds) && rounds > 0 ? rounds : 3;
        const safeStakeLabel = stakeLabel?.trim() || "Free";
        const stakeAmount = getStakeAmount(safeStakeLabel);

        const lockResult = await lockStake(playerId, stakeAmount);

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

        const { code } = createRoomWithPlayers(
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
        setPlayerActiveRoom(playerId, code);

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

        const busyDifferentRoomCode = playerIsBusyInDifferentRoom(
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
          await unlockStake(offer.hostPlayerId, offer.stakeAmount);
          clearPlayerActiveRoom(offer.hostPlayerId);
          publicOffers.delete(offerId);
          emitPublicOffers("publicOffer:join room missing");

          socket.emit("publicOffers:error", {
            message: "Room no longer exists.",
          });
          return;
        }

        if (room.matchEnded) {
          publicOffers.delete(offerId);
          clearPlayerActiveRoom(offer.hostPlayerId);
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

        const lockResult = await lockStake(playerId, offer.stakeAmount);

        if (!lockResult.ok) {
          socket.emit("publicOffers:error", {
            message: lockResult.message,
          });
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

        setPlayerActiveRoom(playerId, offer.roomCode);
        setPlayerActiveRoom(offer.hostPlayerId, offer.roomCode);

        publicOffers.delete(offerId);
        emitPublicOffers("publicOffer:join matched");

        emitRoomUpdate(offer.roomCode, room);
        emitMatchState(offer.roomCode, room);

        io.to(offer.roomCode).emit("publicOffer:matched", {
          roomCode: offer.roomCode,
        });

        startRoundTimer(offer.roomCode, room);

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

      await unlockStake(playerId, offer.stakeAmount);

      if (offer.stakeAmount > 0) {
        socket.emit("wallet:update", {
          reason: "stake_unlocked",
          playerId,
        });
      }

      publicOffers.delete(offerId);
      clearPlayerActiveRoom(playerId);
      emitPublicOffers("publicOffer:cancel");

      socket.emit("publicOffer:cancelled", {
        offerId,
      });
    }
  );

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
      });

      if (room.players.length === 2 && room.rematchVotes.length === 2) {
        io.to(code).emit("match:rematch:accepted");
        resetRoomForRematch(code, room);
      }
    }
  );

  socket.on("disconnect", async (reason) => {
    console.log(
      `Socket disconnected: ${socket.id}. reason=${reason}. Connected sockets: ${io.engine.clientsCount}`
    );

    for (const offer of publicOffers.values()) {
      const room = rooms.get(offer.roomCode);
      const host = room?.players.find(
        (player) => player.playerId === offer.hostPlayerId
      );

      if (host?.socketId === socket.id) {
        await unlockStake(offer.hostPlayerId, offer.stakeAmount);

        publicOffers.delete(offer.offerId);
        clearPlayerActiveRoom(offer.hostPlayerId);
        emitPublicOffers("host disconnected, offer removed");

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