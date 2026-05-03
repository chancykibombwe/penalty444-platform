import "./globals.css";
import Navbar from "../components/layout/Navbar";
import ActiveMatchRecovery from "../components/match/ActiveMatchRecovery";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-white" suppressHydrationWarning>
        <ActiveMatchRecovery />
        <Navbar />
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}