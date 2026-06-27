"use client";

/**
 * Lobby Chat client helper.
 *
 * Thin, safe wrapper over the `public.lobby_chat_messages` table.
 * - No money, gameplay, auth, or realtime-server logic here.
 * - RLS allows authenticated users to SELECT visible rows and INSERT their
 *   own visible row only; there is no update/delete path.
 * - Usernames are resolved from the publicly-readable `profiles` table. We
 *   NEVER expose user ids or emails to the UI.
 * - Message text is returned raw and must be rendered as plain text by the
 *   UI (React escapes by default — no dangerouslySetInnerHTML anywhere).
 */

import { supabase } from "../supabase/client";

export const CHAT_MESSAGE_MAX_LENGTH = 280;
/** Client-side cooldown between sends (ms). Light anti-spam for v1. */
export const CHAT_SEND_COOLDOWN_MS = 8000;
/** How many newest visible messages to fetch. */
export const CHAT_FETCH_LIMIT = 40;

type LobbyChatRow = {
  id: string;
  created_at: string;
  user_id: string;
  message: string;
};

export type LobbyChatMessage = {
  id: string;
  createdAt: string;
  /** Resolved display name; never the raw user id or email. */
  username: string;
  message: string;
  /** True when this message belongs to the current viewer. */
  mine: boolean;
};

export type FetchLobbyMessagesResult =
  | { ok: true; messages: LobbyChatMessage[] }
  | { ok: false; error: string };

export type SendLobbyMessageResult =
  | { ok: true }
  | { ok: false; error: string };

function resolveDisplayName(
  userId: string,
  byId: Map<string, string | null>
): string {
  const name = byId.get(userId);
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Player";
}

/**
 * Fetch the latest visible lobby messages, returned oldest → newest so the
 * UI can render them top-to-bottom with the newest at the bottom.
 *
 * Never throws — returns a friendly error result for the panel to render.
 */
export async function fetchLobbyMessages(): Promise<FetchLobbyMessagesResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const viewerId = session?.user.id ?? null;

  // RLS already restricts this to status = 'visible'; the explicit filter
  // keeps the query intention obvious and lets the composite index help.
  const { data, error } = await supabase
    .from("lobby_chat_messages")
    .select("id, created_at, user_id, message")
    .eq("status", "visible")
    .eq("room", "global")
    .order("created_at", { ascending: false })
    .limit(CHAT_FETCH_LIMIT);

  if (error) {
    return { ok: false, error: "Could not load chat. Please try again." };
  }

  const rows = (data ?? []) as LobbyChatRow[];

  // Resolve usernames in a single batched query against the public-read
  // `profiles` table. We never surface user_id in the UI.
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const byId = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    for (const profile of (profiles ?? []) as {
      id: string;
      username: string | null;
    }[]) {
      byId.set(profile.id, profile.username);
    }
  }

  const messages: LobbyChatMessage[] = rows
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      username: resolveDisplayName(row.user_id, byId),
      message: row.message,
      mine: viewerId !== null && row.user_id === viewerId,
    }))
    // Newest last for natural chat reading order.
    .reverse();

  return { ok: true, messages };
}

/**
 * Insert one chat message for the currently logged-in user.
 *
 * Validates and trims client-side; the DB CHECK + RLS are the real guard.
 * Returns a friendly error result (never throws).
 */
export async function sendLobbyMessage(
  rawMessage: string
): Promise<SendLobbyMessageResult> {
  const message = rawMessage.trim();

  if (message.length === 0) {
    return { ok: false, error: "Type a message first." };
  }
  if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Messages are limited to ${CHAT_MESSAGE_MAX_LENGTH} characters.`,
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: false, error: "Please sign in to chat." };
  }

  const { error } = await supabase.from("lobby_chat_messages").insert({
    user_id: session.user.id,
    message,
    // status + room fall back to their 'visible' / 'global' defaults.
  });

  if (error) {
    return {
      ok: false,
      error: "Could not send your message. Please try again.",
    };
  }

  return { ok: true };
}
