import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to Play Penalty444 — 444 ARENA",
  description:
    "Learn how to play Penalty444: a free-to-play 1v1 penalty shootout on 444 ARENA. No real money, no cash prizes.",
};

export default function Penalty444GamePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-500">
          444 ARENA · Free Play Beta
        </p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
          Penalty444
        </h1>
        <p className="text-zinc-400">
          1v1 penalty shootout — pure skill, no real money, no cash prizes.
        </p>

        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#3B9EFF]/55 bg-[#3B9EFF]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#9AD2FF]">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#3B9EFF] shadow-[0_0_8px_rgba(59,158,255,0.8)]" aria-hidden />
          Free Play Beta — no entry fees, no prizes
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/lobby"
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:from-cyan-300"
        >
          Play Free ⚽
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-bold text-white hover:border-zinc-500"
        >
          Back Home
        </Link>
      </div>

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-lg font-black uppercase tracking-wide text-white">
          How it works
        </h2>
        <div className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/80 p-5 space-y-4">
          <Rule
            label="Format"
            text="Two players face off in a penalty shootout. One player is the Kicker; the other is the Keeper. Roles swap each round."
          />
          <Rule
            label="Each round"
            text="Both players secretly pick a lane — LEFT, CENTER, or RIGHT — then reveal simultaneously."
          />
          <Rule
            label="Goal"
            text="Kicker picks LEFT, Keeper picks RIGHT (or any different lane) → GOAL."
          />
          <Rule
            label="Save"
            text="Both pick the same lane → SAVE."
          />
          <Rule
            label="Timeouts"
            text="Kicker times out → SAVE. Keeper times out → GOAL. Both time out → DRAW for that round."
          />
          <Rule
            label="Winning"
            text="Most goals after all rounds wins. Tied after normal rounds? Sudden death continues until one player scores and the other doesn't in the same round."
          />
          <Rule
            label="Rematch"
            text="After a match ends, both players can vote for a rematch in the same room. Or return to the lobby for a fresh game."
          />
        </div>
      </section>

      {/* Game modes */}
      <section className="space-y-4">
        <h2 className="text-lg font-black uppercase tracking-wide text-white">
          Game modes
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ModeCard
            icon="⚡"
            title="Quick Match"
            description="Join the public lobby and get matched with the next available opponent. Free to enter."
          />
          <ModeCard
            icon="🎯"
            title="Private Room"
            description="Create a room code and share it with a friend to play head-to-head. Free to enter."
          />
          <ModeCard
            icon="🏆"
            title="Ranked"
            description="Queue for a rated match. Results affect your rank points and ladder position. Free to enter."
          />
          <ModeCard
            icon="🏟"
            title="Tournaments"
            description="Join bracket tournaments hosted by the community. Free entry during beta."
          />
        </div>
      </section>

      {/* Beta notice */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-amber-300">
          Free Play Beta
        </h2>
        <ul className="space-y-1 text-sm text-zinc-400">
          <li>· Wallet deposits and withdrawals are disabled.</li>
          <li>· No entry fees are charged for any match or tournament.</li>
          <li>· No cash prizes are awarded.</li>
          <li>· Rankings and stats are tracked for competitive play but have no monetary value.</li>
          <li>· Future games shown on the home screen (Chess444, Draught444, Crush444) are not live yet.</li>
        </ul>
      </section>

      {/* Bottom CTA */}
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/lobby"
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:from-cyan-300"
        >
          Play Free ⚽
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-bold text-white hover:border-zinc-500"
        >
          Back Home
        </Link>
      </div>
    </div>
  );
}

function Rule({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-[10px] font-black uppercase tracking-widest text-zinc-500 w-16">
        {label}
      </span>
      <p className="text-sm text-zinc-300">{text}</p>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/80 p-4 space-y-1">
      <div className="flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        <h3 className="text-sm font-black text-white">{title}</h3>
      </div>
      <p className="text-xs text-zinc-400">{description}</p>
    </div>
  );
}
