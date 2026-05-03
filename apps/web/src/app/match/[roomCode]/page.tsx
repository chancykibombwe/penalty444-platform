"use client";

import { useParams } from "next/navigation";
import RequireAuth from "../../../components/auth/RequireAuth";
import MatchRoomPanel from "../../../components/match/MatchRoomPanel";

export default function MatchPage() {
  const params = useParams();
  const roomCode = params.roomCode as string;

  return (
    <RequireAuth>
      <MatchRoomPanel roomCode={roomCode} />
    </RequireAuth>
  );
}