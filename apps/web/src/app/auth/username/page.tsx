"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase/client";

export default function UsernamePage() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("Checking your account...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/auth/login");
        return;
      }

      setUserId(session.user.id);
      setStatus("");
    }

    loadUser();
  }, [router]);

  async function handleSaveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = username.trim();

    setStatus("");

    if (!cleanUsername) {
      setStatus("Enter a username.");
      return;
    }

    if (cleanUsername.length < 3) {
      setStatus("Username must be at least 3 characters.");
      return;
    }

    if (cleanUsername.length > 20) {
      setStatus("Username must be 20 characters or less.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      setStatus("Use only letters, numbers, and underscores.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      username: cleanUsername,
    });

    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes("duplicate")) {
        setStatus("That username is already taken.");
        return;
      }

      setStatus(error.message);
      return;
    }

    router.push("/lobby");
    router.refresh();
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-2xl font-bold text-white">Choose Username</h1>
      <p className="mt-2 text-sm text-zinc-400">
        This name will represent you in Penalty444 matches.
      </p>

      <form onSubmit={handleSaveUsername} className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-sm text-zinc-300">Username</label>
          <input
            type="text"
            placeholder="PenaltyKing"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none"
          />
        </div>

        {status ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
            {status}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !userId}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save Username"}
        </button>
      </form>
    </section>
  );
}