import "./globals.css";
import Navbar from "../components/layout/Navbar";
import ActiveMatchRecovery from "../components/match/ActiveMatchRecovery";
import MatchReadyNotification from "../components/match/MatchReadyNotification";
import TournamentMatchReadyNotification from "../components/tournament/TournamentMatchReadyNotification";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-white" suppressHydrationWarning>
        <ActiveMatchRecovery />
        <MatchReadyNotification />
        <TournamentMatchReadyNotification />
        <Navbar />
        <main className="p-6 pb-28 md:pb-6">{children}</main>
      </body>
    </html>
  );
}