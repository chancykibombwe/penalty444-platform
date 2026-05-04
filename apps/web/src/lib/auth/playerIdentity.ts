import { supabase } from "../supabase/client";

export type PlayerIdentity = {
  playerId: string;
  username: string;
};

/**
 * Returns authenticated multiplayer identity (Supabase `user.id` as `playerId`).
 * Returns `null` when there is no session — callers must not emit socket events and should redirect to login.
 */
export async function getCurrentPlayerIdentity(): Promise<PlayerIdentity | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", session.user.id)
    .maybeSingle();

  return {
    playerId: session.user.id,
    username: data?.username || "Player",
  };
}