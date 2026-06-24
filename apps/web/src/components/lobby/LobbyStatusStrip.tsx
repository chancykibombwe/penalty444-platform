"use client";

import { useEffect, useState } from "react";
import { useLobbyConnection } from "../../lib/socket/LobbyConnectionProvider";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

export default function LobbyStatusStrip() {
  const { connected, ready, reconnecting } = useLobbyConnection();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentPlayerIdentity().then((id) => {
      setUsername(id?.username ?? null);
    });
  }, []);

  const connLabel = !ready
    ? null
    : reconnecting
    ? "Reconnecting…"
    : connected
    ? "Connected"
    : "Disconnected";

  const connColor: string | null = !ready
    ? null
    : reconnecting
    ? "#f59e0b"
    : connected
    ? "#22c55e"
    : "#ef4444";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3 py-2"
      style={{
        background: "rgba(10,14,26,0.80)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
      role="status"
      aria-live="polite"
      aria-label="Lobby status"
    >
      {connLabel && connColor ? (
        <span className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: connColor,
              boxShadow: `0 0 5px ${connColor}`,
            }}
            aria-hidden
          />
          <span className="text-[11px] font-bold" style={{ color: connColor }}>
            {connLabel}
          </span>
        </span>
      ) : null}

      <span
        className="rounded-full font-black uppercase"
        style={{
          fontSize: "9px",
          letterSpacing: "0.18em",
          padding: "1px 7px",
          background: "rgba(34,211,238,0.09)",
          border: "1px solid rgba(34,211,238,0.25)",
          color: "rgba(103,232,249,0.80)",
        }}
      >
        Free Play Beta
      </span>

      {username ? (
        <span className="text-[11px] text-zinc-500">
          Signed in as{" "}
          <span className="font-bold text-zinc-300">{username}</span>
        </span>
      ) : null}
    </div>
  );
}
