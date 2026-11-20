import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import RouteAwareAppShell from "../components/layout/RouteAwareAppShell";

/**
 * Stage 6O-D1 — Poppins via next/font/google (built into Next.js 16).
 * Weights 400–800 per approved design system. No binary font files committed.
 * `variable` exposes --font-poppins for globals.css --font-sans.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-poppins",
});

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
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <body
        className="bg-arena-bg text-white antialiased"
        suppressHydrationWarning
      >
        <RouteAwareAppShell>{children}</RouteAwareAppShell>
      </body>
    </html>
  );
}
