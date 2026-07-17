import "./globals.css";
import type { Metadata, Viewport } from "next";
import RouteAwareAppShell from "../components/layout/RouteAwareAppShell";

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
  // html/body, metadata and viewport stay here. Body content is delegated to the
  // route-aware shell, which renders the full app chrome + global runtime on all
  // routes EXCEPT /dev/unity-staging (B6C staging isolation — no Socket.IO / auth
  // components mount there). See RouteAwareAppShell.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-white" suppressHydrationWarning>
        <RouteAwareAppShell>{children}</RouteAwareAppShell>
      </body>
    </html>
  );
}
