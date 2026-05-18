import type { Server } from "socket.io";
import { supabase } from "../config";
import type { Room } from "../types/room";

let socketServer: Server | null = null;

export function bindStakesSocketServer(io: Server): void {
  socketServer = io;
}

function getSocketServer(): Server {
  if (!socketServer) {
    throw new Error("bindStakesSocketServer must be called before wallet emits.");
  }
  return socketServer;
}

export function getStakeAmount(stakeLabel?: string) {
  const label = stakeLabel?.trim().toUpperCase();

  if (!label || label === "FREE") return 0;
  if (label === "K10") return 10;
  if (label === "K50") return 50;
  if (label === "K100") return 100;

  return 0;
}

export async function lockStake(playerId: string, stakeAmount: number) {
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

export async function unlockStake(playerId: string, stakeAmount: number) {
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

export async function settleStakes(room: Room) {
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

    getSocketServer().to(room.code).emit("wallet:update", {
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

  getSocketServer().to(room.code).emit("wallet:update", {
    reason: "settlement",
    roomCode: room.code,
    winnerId: winner.playerId,
    loserId: loser.playerId,
  });

  console.log(
    `Secure settlement complete: ${winner.username} won ${room.stakeAmount}`
  );
}

export async function refundBothStakes(room: Room) {
  if (room.stakeSettled) return;

  if (room.stakeAmount <= 0) {
    room.stakeSettled = true;
    return;
  }

  if (room.players.length < 2) return;

  const playerOne = room.players[0];
  const playerTwo = room.players[1];

  if (!playerOne || !playerTwo) return;

  await unlockStake(playerOne.playerId, room.stakeAmount);
  await unlockStake(playerTwo.playerId, room.stakeAmount);

  room.stakeSettled = true;

  getSocketServer().to(room.code).emit("wallet:update", {
    reason: "early_abort_unlock",
    roomCode: room.code,
  });
}
