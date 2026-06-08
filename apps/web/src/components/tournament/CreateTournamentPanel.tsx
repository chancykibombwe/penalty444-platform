"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

const MAX_PLAYER_OPTIONS = [4, 8, 16, 32, 64, 128] as const;

type CreateTournamentPanelProps = {
  onCreated?: () => void;
};

/** Parses `<input type="datetime-local">` as local wall time (no UTC shift). */
function parseDatetimeLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
}

function formatDatetimeLocalInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export default function CreateTournamentPanel({
  onCreated,
}: CreateTournamentPanelProps) {
  const router = useRouter();
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

      let startsAtIso: string | null = null;

      if (startsAt.trim()) {
        const localStart = parseDatetimeLocal(startsAt);

        if (!localStart) {
          setStatus(
            "Invalid start time. Use the date picker (YYYY-MM-DD HH:MM local)."
          );
          setCreating(false);
          return;
        }

        const now = new Date();
        if (localStart.getTime() < now.getTime() - 60_000) {
          setStatus("Start time must be in the future.");
          setCreating(false);
          return;
        }

        startsAtIso = localStart.toISOString();

        console.log("[tournament create] starts_at", {
          input: startsAt,
          localDisplay: localStart.toString(),
          iso: startsAtIso,
          year: localStart.getFullYear(),
          month: localStart.getMonth() + 1,
          day: localStart.getDate(),
          hour: localStart.getHours(),
          minute: localStart.getMinutes(),
        });
      }

      const { data: created, error } = await supabase
        .from("tournaments")
        .insert({
          game_id: "penalty444",
          name: trimmedName,
          status: "registration",
          format: "single_elimination",
          max_players: maxPlayers,
          rounds_per_match: roundsPerMatch,
          created_by: identity.playerId,
          starts_at: startsAtIso,
        })
        .select("id")
        .single();

      if (error) {
        setStatus(error.message);
        setCreating(false);
        return;
      }

      setName("");
      setStartsAt("");
      // Beta UX: the host is the creator (`created_by`), not automatically a
      // participant — that requires a separate `tournament_entries` row via
      // the existing Join Tournament flow. Send the host straight to the
      // detail page, which already shows host status and a Join Tournament
      // action so they can decide whether to also play.
      setStatus(
        "Tournament created. You are hosting this event. Join as a player from the tournament page if you want to compete."
      );
      onCreated?.();

      if (created?.id) {
        router.push(`/tournaments/${created.id}`);
      }
    } catch {
      setStatus("Failed to create tournament.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-6 rounded-3xl border border-amber-500/25 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-[0_0_40px_rgba(245,158,11,0.08)]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/85 sm:text-xs">
          Host
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
          Host a Tournament
        </h2>
        <p className="mt-2 text-zinc-400">
          Create a scheduled knockout event. Free entry, single elimination —
          your bracket goes live the moment you start it.
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={creating}
              onClick={() => setStartsAt(formatDatetimeLocalInput(new Date()))}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-amber-500/50 disabled:opacity-50"
            >
              Now (local)
            </button>
          </div>
          <span className="mt-1 block text-xs text-zinc-500">
            Optional. Stored as UTC ISO; picker uses your local timezone.
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
