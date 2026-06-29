import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Beta Tester Guide — 444 ARENA",
  description:
    "Help us test Penalty444 Free Play before wider release. What to test, what to report, and fair-play conduct. Free Play only — no real money.",
};

// ─── Static content ──────────────────────────────────────────────────────────

const WHAT_TO_TEST = [
  "Sign up / log in",
  "Open the lobby",
  "Create a private room",
  "Join a room using a code",
  "Use public offers / quick play",
  "Play a full Penalty444 match",
  "Test sudden death if a match draws",
  "Try the rematch flow",
  "Check your match history",
  "Check the leaderboard and player search",
  "Use lobby chat respectfully",
  "Submit beta feedback from your Account page or the feedback form",
];

const WHAT_TO_REPORT = [
  "Login / signup problems",
  "Match connection issues",
  "Timer or pick-selection problems",
  "Wrong score or result",
  "Match history missing or incorrect",
  "Leaderboard or search problems",
  "Chat abuse or confusing chat behavior",
  "Mobile layout issues",
  "Anything confusing",
];

const NOT_REAL_MONEY = [
  "Do not send money.",
  "Do not expect deposits or withdrawals.",
  "Do not treat wallet balances as cash.",
  "Do not expect cash prizes.",
  "This beta is Free Play only.",
];

const CONDUCT = [
  "Be respectful in lobby chat.",
  "Do not spam.",
  "Do not abuse other testers.",
  "Report bugs clearly.",
  "Mention your device / browser if possible.",
];

const QUICK_LINKS = [
  { href: "/lobby", label: "Start Testing", hint: "Lobby" },
  { href: "/leaderboard", label: "Leaderboard", hint: "Rankings" },
  { href: "/matches", label: "Match History", hint: "Your games" },
  { href: "/account", label: "Account / Feedback", hint: "Profile" },
];

const COMING_SOON = [
  "Wallet deposits / withdrawals",
  "Paid matches",
  "Cash prizes",
  "Tournaments",
  "Chess444",
  "Draught444",
  "Crush444",
  "Card444",
  "Unity / 3D version",
];

// ─── Small presentational helpers ────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  accent = "blue",
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: "blue" | "emerald" | "amber" | "red";
  children: React.ReactNode;
}) {
  const accentText = {
    blue: "text-[#9AD2FF]",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
  }[accent];

  return (
    <section className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="border-b border-[#1B2433] px-4 py-3 sm:px-5">
        <h2 className={`text-sm font-black uppercase tracking-widest ${accentText}`}>
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500/50 bg-emerald-500/10 text-[10px] font-black text-emerald-300"
        aria-hidden
      >
        ✓
      </span>
      <span className="text-sm text-zinc-200">{children}</span>
    </li>
  );
}

function BulletItem({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === "warn" ? "bg-red-400" : "bg-zinc-500"
        }`}
        aria-hidden
      />
      <span
        className={`text-sm ${tone === "warn" ? "text-red-100" : "text-zinc-200"}`}
      >
        {children}
      </span>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BetaGuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3 py-8 pb-24 sm:px-4">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-400/70">
          444 ARENA · Free Play Beta
        </p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
          Beta Tester Guide
        </h1>
        <p className="text-zinc-400">
          Help us test Penalty444 Free Play before wider release.
        </p>
      </div>

      {/* Beta status card */}
      <section className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:p-5">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
            aria-hidden
          />
          Penalty444 · Free Play Beta
        </div>
        <ul className="mt-3 space-y-1.5">
          <BulletItem>Penalty444 is currently in Free Play Beta.</BulletItem>
          <BulletItem>All matches are for testing and fun.</BulletItem>
          <BulletItem>No real money is active.</BulletItem>
          <BulletItem>
            Wallet, deposits, withdrawals, paid tournaments, and prizes are
            Coming Soon only.
          </BulletItem>
        </ul>
      </section>

      {/* Feedback CTA → existing Account feedback anchor */}
      <section className="overflow-hidden rounded-2xl border border-[#3B9EFF]/30 bg-[#3B9EFF]/[0.06] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-zinc-200">
            Found a bug or issue? Report it from your Account feedback panel.
          </p>
          <Link
            href="/account#beta-feedback"
            className="inline-flex min-h-[40px] w-full shrink-0 items-center justify-center rounded-xl border border-[#3B9EFF]/45 bg-[#3B9EFF]/10 px-4 py-2 text-sm font-bold text-[#9AD2FF] transition-colors hover:border-[#3B9EFF]/70 hover:bg-[#3B9EFF]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black sm:w-auto"
          >
            Report a Beta Issue →
          </Link>
        </div>
      </section>

      {/* Quick links */}
      <section>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Quick Links
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-[#1B2433] bg-[#0D1420] px-3 py-3 transition-colors hover:border-[#3B9EFF]/45 hover:bg-[#3B9EFF]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              <p className="text-sm font-bold text-white">{link.label}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">{link.hint}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* What to test */}
      <SectionCard
        title="What to Test"
        subtitle="Walk through these and tell us what breaks or feels off."
        accent="emerald"
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {WHAT_TO_TEST.map((item) => (
            <CheckItem key={item}>{item}</CheckItem>
          ))}
        </ul>
      </SectionCard>

      {/* What to report */}
      <SectionCard
        title="What to Report"
        subtitle="Spotted any of these? Send us feedback."
        accent="blue"
      >
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {WHAT_TO_REPORT.map((item) => (
            <BulletItem key={item}>{item}</BulletItem>
          ))}
        </ul>
        <div className="mt-4">
          <Link
            href="/account#beta-feedback"
            className="inline-flex rounded-xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-4 py-2 text-sm font-black text-white transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          >
            Submit Feedback
          </Link>
        </div>
      </SectionCard>

      {/* Free Play warning */}
      <SectionCard
        title="This Is Free Play Only"
        subtitle="No real money is involved at any point."
        accent="red"
      >
        <ul className="space-y-1.5">
          {NOT_REAL_MONEY.map((item) => (
            <BulletItem key={item} tone="warn">
              {item}
            </BulletItem>
          ))}
        </ul>
      </SectionCard>

      {/* Fair play / conduct */}
      <SectionCard
        title="Fair Play & Conduct"
        subtitle="Keep the beta friendly for everyone."
        accent="amber"
      >
        <ul className="space-y-1.5">
          {CONDUCT.map((item) => (
            <BulletItem key={item}>{item}</BulletItem>
          ))}
        </ul>
      </SectionCard>

      {/* Coming soon */}
      <SectionCard
        title="Coming Soon"
        subtitle="Not available in beta — future features only."
      >
        <div className="flex flex-wrap gap-2">
          {COMING_SOON.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-black/40 px-3 py-1 text-[11px] font-semibold text-zinc-500"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600"
                aria-hidden
              />
              {item}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-600">
          These are listed for transparency and are intentionally inactive
          during the Free Play Beta.
        </p>
      </SectionCard>

      {/* Footer CTA */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
        <Link
          href="/lobby"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2.5 text-sm font-black text-zinc-950 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/75 focus-visible:ring-offset-1 focus-visible:ring-offset-black sm:w-auto"
        >
          Start Testing ⚽
        </Link>
        <Link
          href="/how-to-play"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-600 bg-[#0D1420] px-5 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:border-zinc-400 hover:bg-[#141d2b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black sm:w-auto"
        >
          How to Play
        </Link>
      </div>
    </div>
  );
}
