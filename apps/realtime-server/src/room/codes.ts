export function cleanUsername(username?: string) {
  return username?.trim() || "Player";
}

export function normalizeRoomCode(roomCode?: string) {
  return roomCode?.trim()?.toUpperCase() || "";
}

export function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export function generateOfferId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
