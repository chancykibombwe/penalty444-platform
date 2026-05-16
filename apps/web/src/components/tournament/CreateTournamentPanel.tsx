"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

const MAX_PLAYER_OPTIONS = [4, 8, 16, 32, 64, 128] as const;

type CreateTournamentPanelProps = {
  onCreated?: () => void;
};

export default function CreateTournamentPanel({
  onCreated,
}: CreateTournamentPanelProps) {
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<number>(8);
  const [roundsPerMatch, setRoundsPerMatch] = useState(3);
  const [startsAt, setStartsAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("Tournament name is required.");
      return;
    }

    setCreating(true);
    setStatus("Creating tournament...");

    try {
      const identity = await getCurrentPlayerIdentity();
      if (!identity) {
        setStatus("You must be logged in to create a tournament.");
        setCreating(false);
        return;
      }

      const startsAtIso = startsAt
        ? new Date(startsAt).toISOString()
        : null;

      if (startsAt && Number.isNaN(new Date(startsAt).getTime())) {
        setStatus("Invalid start time.");
        setCreating(false);
        return;
      }

      const { error } = await supabase.from("tournaments").insert({
        game_id: "penalty444",
        name: trimmedName,
        status: "registration",
        format: "single_elimination",
        max_players: maxPlayers,
        rounds_per_match: roundsPerMatch,
        created_by: identity.playerId,
        starts_at: startsAtIso,
      });

      if (error) {
        setStatus(error.message);
        setCreating(false);
        return;
      }

      setName("");
      setStartsAt("");
      setStatus("Tournament created. Players can register now.");
      onCreated?.();
    } catch {
      setStatus("Failed to create tournament.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-6 rounded-3xl border border-amber-500/25 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-[0_0_40px_rgba(245,158,11,0.08)]">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300/80">
          Host
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">Create Tournament</h2>
        <p className="mt-2 text-zinc-400">
          Opens registration immediately. Single elimination, free entry.
        </p>
      </div>

      <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-zinc-300">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Friday Night Cup"
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-amber-500/60"
            disabled={creating}
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-zinc-300">Max players</span>
          <select
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-amber-500/60"
            disabled={creating}
          >
            {MAX_PLAYER_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} players
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-zinc-300">
            Rounds per match
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={roundsPerMatch}
            onChange={(event) =>
              setRoundsPerMatch(Math.max(1, Number(event.target.value) || 3))
            }
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-amber-500/60"
            disabled={creating}
          />
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-zinc-300">Starts at</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-amber-500/60"
            disabled={creating}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Optional. Local time.
          </span>
        </label>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-3.5 font-bold text-zinc-950 shadow-lg shadow-amber-900/40 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create Tournament"}
          </button>
        </div>
      </form>

      {status ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
          {status}
        </div>
      ) : null}
    </section>
  );
}
