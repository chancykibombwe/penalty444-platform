"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement, SVGProps } from "react";
import HomeCardSurface from "../HomeCardSurface";
import BetaFreePlayPanel from "./BetaFreePlayPanel";

/**
 * DesktopSidebar — left navigation rail for the Home Desktop V1 layout.
 *
 * Desktop-only (mounted inside a `hidden lg:*` container by HomeDesktopLayout).
 * This is an ADDITIVE, contextual rail — it does not replace or modify the
 * global Navbar routing; it links to the same existing destinations. Wallet is
 * a disabled "Soon" item (no route, no wallet activation). Below the nav sits
 * the locked beta / free-play panel.
 *
 * Presentation/navigation-only: no data, no sockets, no new behavior.
 */

type NavIconProps = SVGProps<SVGSVGElement>;

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
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </svg>
  );
}

type SidebarItem = {
  id: string;
  label: string;
  href: string | null;
  matchPrefixes: string[];
  Icon: (props: NavIconProps) => ReactElement;
  competitive?: boolean;
  soon?: boolean;
};

const ITEMS: SidebarItem[] = [
  { id: "home", label: "Home", href: "/", matchPrefixes: ["/"], Icon: HomeIcon },
  { id: "lobby", label: "Lobby", href: "/lobby", matchPrefixes: ["/lobby", "/play", "/games"], Icon: LobbyIcon },
  { id: "tournaments", label: "Tournaments", href: "/tournaments", matchPrefixes: ["/tournaments"], Icon: TrophyIcon, competitive: true },
  { id: "leaderboard", label: "Leaderboard", href: "/leaderboard", matchPrefixes: ["/leaderboard"], Icon: LeaderboardIcon },
  { id: "account", label: "Account", href: "/account", matchPrefixes: ["/account"], Icon: AccountIcon },
  // Wallet stays Coming Soon — deliberately NOT a link. No wallet activation.
  { id: "wallet", label: "Wallet", href: null, matchPrefixes: [], Icon: WalletIcon, soon: true },
];

function isActive(pathname: string | null, item: SidebarItem): boolean {
  if (!pathname) return false;
  if (item.id === "home") return pathname === "/" || pathname === "";
  return item.matchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <nav className="space-y-4" aria-label="Home sections">
      <HomeCardSurface className="p-2.5">
        <ul className="space-y-1">
          {ITEMS.map((item) => {
            if (item.href === null) {
              return (
                <li key={item.id}>
                  <span
                    className="flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold text-arena-muted"
                    aria-disabled="true"
                  >
                    <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                    <span className="ml-auto rounded border border-arena-border bg-black/40 px-1 py-0.5 text-[8px] font-black uppercase tracking-[0.14em]">
                      Soon
                    </span>
                  </span>
                </li>
              );
            }

            const active = isActive(pathname, item);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
                    active
                      ? item.competitive
                        ? "bg-arena-gold/15 text-[#FBD38D] ring-1 ring-arena-gold/40"
                        : "bg-arena-primary/15 text-[#9AD2FF] ring-1 ring-arena-primary/40"
                      : item.competitive
                        ? "text-arena-gold/60 hover:bg-arena-gold/10 hover:text-arena-gold/90"
                        : "text-[#9AA4B2] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </HomeCardSurface>

      <BetaFreePlayPanel />
    </nav>
  );
}
