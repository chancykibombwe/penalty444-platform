"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getActiveMatch } from "../../lib/match/activeMatch";
import { disconnectSocket } from "../../lib/socket/client";
import { supabase } from "../../lib/supabase/client";

type NavItem = {
  href: string;
  label: string;
};

const baseNavItems: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/lobby", label: "Lobby" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/wallet", label: "Wallet" },
];

export default function Navbar() {
  const router = useRouter();
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  async function refreshAuthState() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setLoggedIn(!!session);
  }

  function refreshActiveMatch() {
    const activeMatch = getActiveMatch();
    setActiveRoomCode(activeMatch?.roomCode || null);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    disconnectSocket();
    refreshActiveMatch();
    router.replace("/");
  }

  useEffect(() => {
    refreshAuthState();
    refreshActiveMatch();

    function onStorage() {
      refreshActiveMatch();
    }

    function onActiveMatchChanged() {
      refreshActiveMatch();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("penalty444:active-match-changed", onActiveMatchChanged);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refreshAuthState();
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "penalty444:active-match-changed",
        onActiveMatchChanged
      );
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="text-xl font-bold text-white">
          444 ARENA
        </Link>

        <nav className="flex flex-wrap items-center gap-4 text-sm text-zinc-300">
          {baseNavItems.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-white">
              {item.label}
            </Link>
          ))}

          {activeRoomCode ? (
            <Link
              href={`/match/${activeRoomCode}`}
              className="rounded-xl bg-emerald-400 px-3 py-2 font-semibold text-zinc-950 hover:bg-emerald-300"
            >
              Resume Match
            </Link>
          ) : null}

          {loggedIn ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-white hover:border-zinc-500"
            >
              Logout
            </button>
          ) : (
            <Link
              href="/auth/login"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-white hover:border-zinc-500"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}