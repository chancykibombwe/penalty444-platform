import { supabase } from "../supabase/client";

export type PlayerIdentity = {
  playerId: string;
  username: string;
};

export async function getCurrentPlayerIdentity(): Promise<PlayerIdentity> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      playerId: "guest",
      username: "Player",
    };
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