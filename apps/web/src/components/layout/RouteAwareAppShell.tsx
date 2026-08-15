"use client";

/**
 * Route-aware application shell.
 *
 * Isolated verification routes (`/dev/unity-staging`, `/dev/unity-b6d3c`) are
 * contractually **not a live match**: no Socket.IO, no Supabase/auth, no
 * active-match recovery, no match/tournament-ready notifications, no auth-aware
 * navbar. The normal root layout, however, globally mounts `ActiveMatchRecovery`
 * and `MatchReadyNotification`, whose mount-time `getSocket()` opens the
 * realtime Socket.IO connection and binds Supabase auth for the handshake. That
 * leaked the realtime/auth runtime onto those verification routes.
 *
 * This shell fixes that at the mount level (not cosmetically): on exactly the
 * isolated paths below, the global runtime/chrome components are **never
 * rendered**, so their mount-time effects never run and no socket/auth work is
 * initialized. Every other route renders the exact existing shell unchanged.
 *
 * Import-safety: `getSocket()` is lazy (the `io()` call lives inside `getSocket`,
 * not at module scope) and every global component calls it only inside a mount
 * `useEffect`, so statically importing them here has no side effect — only
 * mounting does, which the isolated branch avoids.
 *
 * Each isolated route keeps its own server + client security gates
 * (production `notFound()`, env flags, validated origin + version, same-origin
 * relative URLs, strict inbound origin/source validation, ready/error allowlist,
 * mock events only).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import FreePlayNoticeStrip from "./FreePlayNoticeStrip";
import ActiveMatchRecovery from "../match/ActiveMatchRecovery";
import MatchReadyNotification from "../match/MatchReadyNotification";
import TournamentMatchReadyNotification from "../tournament/TournamentMatchReadyNotification";

/**
 * Exact pathname set for shell isolation. Query strings are not part of the
 * pathname, so `/dev/unity-staging?version=…` still matches.
 * Do NOT broaden this to all `/dev/*`.
 */
export const ISOLATED_DEV_ROUTES = new Set([
  "/dev/unity-staging",
  "/dev/unity-b6d3c",
]);

/** Pure helper — exact path only; never prefix-matches `/dev/*`. */
export function isIsolatedDevRoute(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && ISOLATED_DEV_ROUTES.has(pathname);
}

export default function RouteAwareAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // ── Isolated shell: no global realtime/auth/chrome components mount. ──
  if (isIsolatedDevRoute(pathname)) {
    return <main>{children}</main>;
  }

  // ── Normal shell — identical to the previous RootLayout body. ──
  const feedbackBody = encodeURIComponent(
    "What happened:\n\nRoom code (if available):\n\nBrowser / device:\n\n(Attach a screenshot if possible)"
  );
  const feedbackHref = `mailto:info.chancykibombwe@gmail.com?subject=%5B444%20ARENA%20Beta%5D%20Bug%20Report&body=${feedbackBody}`;

  return (
    <>
      <ActiveMatchRecovery />
      <MatchReadyNotification />
      <TournamentMatchReadyNotification />
      <Navbar />

      {/* Free Play Beta notice strip — hidden on Home per the locked Home
          design (Home keeps Free Play messaging in hero/pill/footer). */}
      <FreePlayNoticeStrip />

      <main className="p-4 pb-28 md:p-6 md:pb-6">{children}</main>

      {/* Persistent beta feedback footer */}
      <footer className="border-t border-[#1B2433] bg-[#080C12] px-4 py-3 text-center text-[11px] text-zinc-400 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-3">
        444 ARENA · Free Play Beta ·{" "}
        <a href={feedbackHref} className="underline hover:text-zinc-200">
          Report a bug
        </a>
        {" "}·{" "}
        <Link href="/games/penalty444" className="hover:text-zinc-300">
          How to play
        </Link>
      </footer>
    </>
  );
}
