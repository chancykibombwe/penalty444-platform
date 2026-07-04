"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement, SVGProps } from "react";

/**
 * BottomMobileNav — mobile bottom nav shell for the Home redesign (locked
 * Figma frames: Home Mobile 390/360 V1).
 *
 * Items: Home · Lobby · Wallet (Soon) · Account · More.
 * - Mobile-only (`md:hidden`), fixed to the bottom, token-based (arena-*).
 * - Mounted by HomeMobileShell on the Home page only; the global Navbar
 *   hides its own mobile bottom nav on `/` so the two never stack.
 * - Wallet is a DISABLED "Soon" item — no route, no wallet activation,
 *   Coming Soon only.
 * - "More" links to the existing /support Help Center for now; a later Home
 *   PR may expand it into a proper menu/sheet.
 *
 * Presentation/navigation-only. No data, no sockets, no new behavior.
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

function WalletIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
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

function MoreIcon(props: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

type ShellNavItem = {
  id: string;
  label: string;
  href: string | null; // null → disabled (Wallet Soon)
  Icon: (props: NavIconProps) => ReactElement;
  soon?: boolean;
};

const ITEMS: ShellNavItem[] = [
  { id: "home", label: "Home", href: "/", Icon: HomeIcon },
  { id: "lobby", label: "Lobby", href: "/lobby", Icon: LobbyIcon },
  // Wallet stays Coming Soon — deliberately NOT a link. No wallet activation.
  { id: "wallet", label: "Wallet", href: null, Icon: WalletIcon, soon: true },
  { id: "account", label: "Account", href: "/account", Icon: AccountIcon },
  { id: "more", label: "More", href: "/support", Icon: MoreIcon },
];

export default function BottomMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-arena-border bg-arena-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Home mobile"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
        {ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : item.href !== null && pathname?.startsWith(item.href);

          if (item.href === null) {
            return (
              <li key={item.id}>
                <span
                  className="flex min-h-[52px] cursor-default flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-bold text-arena-muted"
                  aria-disabled="true"
                >
                  <item.Icon className="h-4 w-4" aria-hidden />
                  <span className="flex items-center gap-1 whitespace-nowrap leading-none">
                    {item.label}
                    <span className="rounded border border-arena-border bg-black/40 px-0.5 text-[7px] font-black uppercase tracking-[0.1em]">
                      Soon
                    </span>
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.id} className="relative">
              {active ? (
                <span
                  className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-full bg-arena-primary shadow-[0_0_8px_rgba(59,158,255,0.8)]"
                  aria-hidden
                />
              ) : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/70 focus-visible:ring-inset ${
                  active ? "text-arena-primary" : "text-arena-muted hover:text-zinc-300"
                }`}
              >
                <item.Icon className="h-4 w-4" aria-hidden />
                <span className="whitespace-nowrap leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
