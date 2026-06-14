"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactElement, type SVGProps } from "react";
import NotificationBell from "../live/NotificationBell";
import WalletPill from "../ui/WalletPill";
import { getActiveMatch } from "../../lib/match/activeMatch";
import { supabase } from "../../lib/supabase/client";

type NavIconProps = SVGProps<SVGSVGElement>;

type NavItem = {
  /** Stable id for active matching. */
  id: string;
  /** Visible label (kept short for mobile). */
  label: string;
  /** Auth-aware href is resolved at render. */
  buildHref: (loggedIn: boolean) => string;
  /** Pathname prefixes that count as active. */
  matchPrefixes: string[];
  /** Inline icon for mobile bottom nav + optional desktop pre-label. */
  Icon: (props: NavIconProps) => ReactElement;
  /**
   * Treat this tab as the gold "competitive" accent (Tournaments).
   * Active styling pulses gold; idle styling keeps a subtle amber tint.
   */
  competitive?: boolean;
};

function HomeIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function LobbyIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l5 3" />
    </svg>
  );
}

function TrophyIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3" />
      <path d="M9 14h6l-1 5h-4l-1-5Z" />
      <path d="M8 21h8" />
    </svg>
  );
}

function LeaderboardIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="11" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="16" y="14" width="4" height="6" rx="1" />
    </svg>
  );
}

function AccountIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function WalletIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M16 14h.01" />
      <path d="M2 10h20" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", buildHref: () => "/", matchPrefixes: ["/"], Icon: HomeIcon },
  { id: "lobby", label: "Lobby", buildHref: () => "/lobby", matchPrefixes: ["/lobby", "/play", "/games"], Icon: LobbyIcon },
  {
    id: "tournaments",
    label: "Tournaments",
    buildHref: () => "/tournaments",
    matchPrefixes: ["/tournaments"],
    Icon: TrophyIcon,
    competitive: true,
  },
  { id: "leaderboard", label: "Leaderboard", buildHref: () => "/leaderboard", matchPrefixes: ["/leaderboard"], Icon: LeaderboardIcon },
  { id: "wallet", label: "Wallet", buildHref: () => "/wallet", matchPrefixes: ["/wallet"], Icon: WalletIcon },
  {
    id: "account",
    label: "Account",
    buildHref: (loggedIn) => (loggedIn ? "/account" : "/auth/login"),
    matchPrefixes: ["/account", "/auth"],
    Icon: AccountIcon,
  },
];

function isItemActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.id === "home") {
    return pathname === "/" || pathname === "";
  }
  return item.matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [accountLabel, setAccountLabel] = useState("Account");

  async function refreshAuthState() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoggedIn(false);
      setAccountLabel("Account");
      return;
    }

    setLoggedIn(true);

    const userId = session.user.id;

    const { data: stats } = await supabase
      .from("player_stats")
      .select("username")
      .eq("game_id", "penalty444")
      .eq("user_id", userId)
      .maybeSingle();

    if (stats?.username) {
      setAccountLabel(stats.username);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();

    setAccountLabel(profile?.username || "Account");
  }

  function refreshActiveMatch() {
    const activeMatch = getActiveMatch();
    setActiveRoomCode(activeMatch?.roomCode || null);
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
    window.addEventListener(
      "penalty444:active-match-changed",
      onActiveMatchChanged
    );

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
    <>
      {/* Desktop / tablet top bar (md+).
          `relative z-50` keeps the header above the match page's
          pre-start overlay (`z-40`) so Home / Lobby / Wallet / etc.
          stay clickable while a creator is waiting for an opponent
          on `/match/[roomCode]`. Without it the `fixed inset-0`
          overlay covers the navbar visually AND blocks taps. */}
      <header className="relative z-50 border-b border-zinc-800 bg-gradient-to-b from-zinc-950 to-black">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 md:py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-base font-black tracking-tight text-white sm:text-lg md:text-xl"
            aria-label="444 ARENA home"
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-amber-500 text-[11px] font-black text-zinc-950 shadow-[0_0_20px_rgba(34,211,238,0.35)]"
              aria-hidden
            >
              444
            </span>
            <span className="hidden sm:inline">444 ARENA</span>
          </Link>

          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="Primary"
          >
            {NAV_ITEMS.map((item) => {
              const href = item.buildHref(loggedIn);
              const active = isItemActive(pathname, item);
              return (
                <Link
                  key={item.id}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold tracking-wide transition-colors ${
                    active
                      ? item.competitive
                        ? "bg-[#E0A000]/15 text-[#FBD38D] shadow-[0_0_18px_rgba(224,160,0,0.25)] ring-1 ring-[#E0A000]/40"
                        : "bg-[#3B9EFF]/15 text-[#9AD2FF] shadow-[0_0_18px_rgba(59,158,255,0.22)] ring-1 ring-[#3B9EFF]/40"
                      : item.competitive
                        ? "text-[#E0A000]/80 hover:bg-[#E0A000]/10 hover:text-[#FBD38D]"
                        : "text-[#9AA4B2] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <item.Icon className="h-4 w-4" aria-hidden />
                  <span>
                    {item.id === "account" ? accountLabel : item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Right-side actions on desktop. Always shows Resume Match if active. */}
          <div className="hidden items-center gap-2 md:flex">
            <WalletPill />
            {activeRoomCode ? (
              <Link
                href={`/match/${activeRoomCode}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-3 py-2 text-sm font-black text-zinc-950 shadow-lg hover:from-emerald-300 hover:to-cyan-300"
              >
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-950/70"
                  aria-hidden
                />
                Resume Match
              </Link>
            ) : null}
            <NotificationBell />
          </div>

          {/* Mobile-only compact controls: Wallet pill, Resume Match (if any) + bell */}
          <div className="flex items-center gap-2 md:hidden">
            <WalletPill />
            {activeRoomCode ? (
              <Link
                href={`/match/${activeRoomCode}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 px-2.5 py-1.5 text-[11px] font-black text-zinc-950 shadow-md"
                aria-label="Resume match in progress"
              >
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-950/70"
                  aria-hidden
                />
                Resume
              </Link>
            ) : null}
            <NotificationBell />
          </div>
        </div>
      </header>

      {/* Mobile bottom nav (visible <md).
          `z-50` (was `z-40`) so it stacks ABOVE the match page's
          pre-start overlay (also `z-40`) — same reason as the
          desktop header: a creator waiting for an opponent must
          still be able to tap Home / Lobby / Wallet without
          having to back out of the match page first. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#1B2433] bg-[#0A0E14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-[#0A0E14]/85 md:hidden"
        aria-label="Primary mobile"
      >
        <ul className="mx-auto grid max-w-md grid-cols-6 px-1">
          {NAV_ITEMS.map((item) => {
            const href = item.buildHref(loggedIn);
            const active = isItemActive(pathname, item);
            const accent = item.competitive ? "#E0A000" : "#3B9EFF";
            return (
              <li key={item.id} className="relative">
                {active ? (
                  <>
                    {/* Glowing top-edge light line for the active tab */}
                    <span
                      className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-full"
                      style={{
                        background: accent,
                        boxShadow: `0 0 8px ${accent}, 0 0 2px ${accent}`,
                      }}
                      aria-hidden
                    />
                    {/* Faint upward light bleed from the active tab */}
                    <span
                      className="pointer-events-none absolute inset-x-0 top-0 h-10 opacity-25"
                      style={{
                        background: `linear-gradient(to bottom, ${accent}, transparent)`,
                      }}
                      aria-hidden
                    />
                  </>
                ) : null}
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors"
                  style={{ color: active ? accent : "#5A6472" }}
                >
                  <item.Icon className="h-4 w-4" aria-hidden />
                  <span className="whitespace-nowrap leading-none">
                    {item.id === "account"
                      ? loggedIn
                        ? "Account"
                        : "Sign in"
                      : item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
