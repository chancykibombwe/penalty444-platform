import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Navbar from "../components/layout/Navbar";
import FreePlayNoticeStrip from "../components/layout/FreePlayNoticeStrip";
import ActiveMatchRecovery from "../components/match/ActiveMatchRecovery";
import MatchReadyNotification from "../components/match/MatchReadyNotification";
import TournamentMatchReadyNotification from "../components/tournament/TournamentMatchReadyNotification";

export const metadata: Metadata = {
  title: "444 ARENA — Penalty444 Free Play Beta",
  description:
    "444 ARENA is a free-to-play competitive penalty shootout. No real money, no cash prizes — pure skill. Enter the beta and climb the leaderboard.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Always-dark arena theme — keep the mobile browser chrome (address bar)
  // on-brand instead of flashing white. Matches --color-arena-bg.
  themeColor: "#0a0e14",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const feedbackBody = encodeURIComponent(
    "What happened:\n\nRoom code (if available):\n\nBrowser / device:\n\n(Attach a screenshot if possible)"
  );
  const feedbackHref = `mailto:info.chancykibombwe@gmail.com?subject=%5B444%20ARENA%20Beta%5D%20Bug%20Report&body=${feedbackBody}`;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-white" suppressHydrationWarning>
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
          <a
            href={feedbackHref}
            className="underline hover:text-zinc-200"
          >
            Report a bug
          </a>
          {" "}·{" "}
          <Link
            href="/games/penalty444"
            className="hover:text-zinc-300"
          >
            How to play
          </Link>
        </footer>
      </body>
    </html>
  );
}
