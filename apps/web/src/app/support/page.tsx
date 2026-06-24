import Link from "next/link";

export const metadata = {
  title: "Help Center — 444 Arena",
  description: "Get help with 444 Arena. Find answers, report issues, and learn the fair play rules.",
};

const SECTIONS = [
  {
    id: "game-help",
    icon: "⚽",
    title: "Game Help",
    items: [
      {
        q: "How do I start a match?",
        a: "Go to the Lobby, find an open room, or create a private room with a code.",
      },
      {
        q: "How does scoring work?",
        a: "Players alternate between kicker and keeper each round. Score 3 rounds first to win.",
      },
      {
        q: "What is the rating system?",
        a: "Your rank points go up when you win and down when you lose. 10 matches exit placement; 20 matches unlock an official rank.",
      },
      {
        q: "How do tournaments work?",
        a: "Free-entry single-elimination brackets. Join from the Tournaments page. Host starts when ready.",
      },
    ],
  },
  {
    id: "account",
    icon: "👤",
    title: "Account & Profile",
    items: [
      {
        q: "How do I create an account?",
        a: "Click Sign In on any page. You can register with an email address — it's free.",
      },
      {
        q: "Can I change my username?",
        a: "Username changes are not available in beta. This will be added in a future update.",
      },
      {
        q: "How do I delete my account?",
        a: "Email info.chancykibombwe@gmail.com with the subject 'Account Deletion Request' and your registered email.",
      },
    ],
  },
  {
    id: "fair-play",
    icon: "⚖️",
    title: "Fair Play Rules",
    items: [
      {
        q: "What counts as cheating?",
        a: "Exploiting bugs, using automation, or intentionally disconnecting to avoid a loss. All violations are reviewed.",
      },
      {
        q: "What happens if I get reported?",
        a: "Reports are reviewed manually. Confirmed violations result in a warning or ban depending on severity.",
      },
      {
        q: "Can I appeal a ban?",
        a: "Yes. Email info.chancykibombwe@gmail.com with 'Ban Appeal' in the subject line.",
      },
    ],
  },
  {
    id: "report",
    icon: "🚩",
    title: "Report a Problem",
    items: [
      {
        q: "How do I report a bug?",
        a: "Email info.chancykibombwe@gmail.com with 'Bug Report' in the subject. Include your username and a description of what happened.",
      },
      {
        q: "How do I report another player?",
        a: "Email info.chancykibombwe@gmail.com with 'Player Report', the offending username, and a brief description.",
      },
    ],
  },
  {
    id: "contact",
    icon: "✉️",
    title: "Contact Support",
    items: [
      {
        q: "How do I reach the team?",
        a: "Email info.chancykibombwe@gmail.com. We aim to respond within 2–3 business days.",
      },
      {
        q: "Is there live chat?",
        a: "Live chat is not available in beta. Email is the only supported channel for now.",
      },
    ],
  },
  {
    id: "legal",
    icon: "📋",
    title: "Legal & Privacy",
    items: [
      {
        q: "Is this a gambling platform?",
        a: "No. 444 Arena is a free-to-play skill competition platform. No real money, no deposits, no withdrawals in beta.",
      },
      {
        q: "What data do you collect?",
        a: "We collect account info (email, username) and gameplay stats to power rankings. We do not sell your data.",
      },
      {
        q: "Where can I read the full terms?",
        a: "Full terms and privacy policy will be published before the platform exits beta.",
      },
    ],
  },
] as const;

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      {/* Header */}
      <div
        className="rounded-2xl px-5 py-5"
        style={{
          background: "rgba(10,14,26,0.95)",
          border: "1px solid rgba(55,85,160,0.35)",
        }}
      >
        <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">
          444 Arena
        </p>
        <h1 className="mt-1 text-xl font-black text-white">Help Center</h1>
        <p className="mt-1 text-[12px] leading-snug text-zinc-400">
          Find answers to common questions, report a problem, or contact the team.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="#report"
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
            style={{
              background: "rgba(55,85,160,0.28)",
              border: "1px solid rgba(55,85,160,0.50)",
            }}
          >
            Report a Problem
          </a>
          <a
            href="#contact"
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-zinc-300"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            Contact Support
          </a>
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-zinc-400"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>

      {/* Beta notice */}
      <div
        className="rounded-xl px-4 py-3"
        style={{
          background: "rgba(255,200,50,0.06)",
          border: "1px solid rgba(255,200,50,0.20)",
        }}
      >
        <p className="text-[11px] font-bold text-amber-300/80">
          Beta Platform Notice
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
          444 Arena is in public free-play beta. No real money, no deposits, no withdrawals. Wallet and prize features are not available yet.
        </p>
      </div>

      {/* FAQ sections */}
      {SECTIONS.map((section) => (
        <section key={section.id} id={section.id} aria-label={section.title}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{section.icon}</span>
            <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px]">
              {section.title}
            </p>
          </div>
          <div className="space-y-2">
            {section.items.map((item) => (
              <div
                key={item.q}
                className="rounded-xl px-4 py-3"
                style={{
                  background: "rgba(10,14,26,0.90)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <p className="text-[12px] font-black text-white">{item.q}</p>
                <p className="mt-1 text-[11px] leading-snug text-zinc-400">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <footer className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/60 px-4 py-3 text-center text-[11px] text-zinc-500">
        444 Arena · Help Center · Free play beta — no real-money features
      </footer>
    </div>
  );
}
