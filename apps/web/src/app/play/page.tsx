"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";

export default function PlayPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setLoggedIn(!!session);
      setChecking(false);
    }

    checkUser();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      checkUser();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Play Penalty444</h1>
        <p className="mt-2 text-zinc-400">
          Choose how you want to enter the game.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold text-white">Guest vs AI</h2>
          <p className="mt-3 text-zinc-400">
            Quick access. No account required.
          </p>

          <Link
            href="/guest"
            className="mt-6 inline-block rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950"
          >
            Start Guest Match
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold text-white">Live Multiplayer</h2>
          <p className="mt-3 text-zinc-400">
            {loggedIn
              ? "Enter the lobby and challenge real players."
              : "Login to access the lobby and challenge real players."}
          </p>

          <Link
            href={loggedIn ? "/lobby" : "/auth/login"}
            className="mt-6 inline-block rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white"
          >
            {checking
              ? "Checking..."
              : loggedIn
              ? "Enter Lobby"
              : "Login to Play Live"}
          </Link>
        </div>
      </div>
    </section>
  );
}