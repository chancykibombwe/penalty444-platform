"use client";

import Link from "next/link";

type HeroBannerProps = {
  /** Primary CTA route. Defaults to `/lobby`. */
  primaryHref?: string;
  /** Secondary text-link route. Defaults to `/tournaments`. */
  secondaryHref?: string;
};

export default function HeroBanner({
  primaryHref = "/lobby",
  secondaryHref = "/tournaments",
}: HeroBannerProps) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black px-3.5 py-4 shadow-2xl sm:px-6 sm:py-5 lg:min-h-[19rem]"
      aria-label="444 Arena hero"
    >
      {/* Scene keyframes — component-scoped, disabled under reduced motion,
          matching the codebase's p444* animation convention. */}
      <style>{`
        @keyframes p444HomeHeroBeam { from { rotate: 14deg } to { rotate: 22deg } }
        @keyframes p444HomeHeroBall { 0%,100% { translate: 0 0 } 50% { translate: 0 -12px } }
        @media (prefers-reduced-motion: reduce) {
          .p444-home-hero-beam, .p444-home-hero-ball { animation: none !important }
        }
      `}</style>

      {/* Background glow orbs (cyan primary + gold accent — locked palette) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-cyan-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-16 h-80 w-80 rounded-full bg-amber-500/15 blur-3xl"
      />
      {/* Right-side arena wash — anchors the desktop stadium scene. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            "radial-gradient(55% 90% at 82% 32%, rgba(59,158,255,0.30), transparent 60%), radial-gradient(42% 70% at 92% 88%, rgba(30,111,224,0.22), transparent 60%)",
        }}
      />
      {/* Grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* ── Desktop stadium scene: perspective pitch + goal net + light beams.
             All aria-hidden, lg-only, so mobile/tablet keep the clean hero. ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-3/5 lg:block"
        style={{
          transform: "perspective(600px) rotateX(58deg)",
          transformOrigin: "bottom",
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 79px, rgba(59,158,255,0.10) 79px 80px), linear-gradient(rgba(59,158,255,0.06), transparent)",
        }}
      />
      <div
        aria-hidden
        className="p444-home-hero-beam pointer-events-none absolute -top-56 right-[18%] hidden h-[34rem] w-52 blur-2xl lg:block"
        style={{
          background:
            "linear-gradient(rgba(59,158,255,0.26), transparent 70%)",
          transformOrigin: "top center",
          animation: "p444HomeHeroBeam 9s ease-in-out infinite alternate",
        }}
      />
      <div
        aria-hidden
        className="p444-home-hero-beam pointer-events-none absolute -top-56 right-[34%] hidden h-[34rem] w-52 blur-2xl lg:block"
        style={{
          background:
            "linear-gradient(rgba(34,211,238,0.16), transparent 70%)",
          transformOrigin: "top center",
          animation: "p444HomeHeroBeam 9s ease-in-out -4s infinite alternate",
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 300 260"
        className="pointer-events-none absolute bottom-0 right-[5%] hidden h-4/5 w-[32%] opacity-40 lg:block"
      >
        <g stroke="rgba(154,210,255,0.35)" strokeWidth="1.5" fill="none">
          <path d="M20 250 L20 30 L280 10 L280 250" />
          <path d="M20 30 L60 60 L60 250 M280 10 L240 45 L240 250 M60 60 L240 45" />
        </g>
        <g stroke="rgba(154,210,255,0.18)" fill="none">
          <path d="M60 90 H240 M60 120 H240 M60 150 H240 M60 180 H240 M60 210 H240" />
          <path d="M90 55 V250 M120 53 V250 M150 51 V250 M180 49 V250 M210 47 V250" />
        </g>
      </svg>

      <div className="relative flex items-center justify-between gap-6">
        <div className="max-w-2xl">
          {/* Platform badge */}
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/45 bg-cyan-500/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.28em] text-cyan-100 sm:text-[10px] sm:tracking-[0.32em]">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.9)]"
              aria-hidden
            />
            444 Arena · Free Play Beta
          </p>

          {/* Main headline — locked copy: "SKILL WINS / EVERY TIME"
              (uppercase applied via the h1's `uppercase` class, matching
              the existing pattern rather than hardcoding caps in JSX). */}
          <h1 className="mt-1.5 text-2xl font-black uppercase leading-tight tracking-tight sm:text-3xl md:text-4xl">
            <span className="block bg-gradient-to-r from-arena-primary to-arena-primary-deep bg-clip-text text-transparent">
              Skill Wins
            </span>
            <span className="block bg-gradient-to-r from-arena-primary to-arena-primary-deep bg-clip-text text-transparent">
              Every Time
            </span>
          </h1>
          <p className="mt-1 text-sm font-bold text-zinc-300 sm:text-base">
            Step into the arena. Pick your side. Outplay your opponent.
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">
            Free to play · No real money · No cash prizes
          </p>

          {/* Primary CTA + secondary text links */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href={primaryHref}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-arena-primary to-arena-primary-deep px-5 py-1.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_0_28px_rgba(59,158,255,0.4)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/75 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:w-auto"
            >
              <span aria-hidden>▶</span> PLAY FREE
            </Link>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-1">
              <Link
                href="/beta-guide"
                className="text-xs font-bold text-emerald-300/80 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
              >
                Beta Guide →
              </Link>
              <Link
                href="/how-to-play"
                className="text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/60"
              >
                How to Play →
              </Link>
              <Link
                href={secondaryHref}
                className="text-xs font-bold text-[#E0A000]/70 transition-colors hover:text-[#E0A000] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60"
              >
                Tournaments →
              </Link>
            </div>
          </div>

          {/* New-tester hint → Beta Guide */}
          <p className="mt-2 text-[11px] text-zinc-500 sm:text-xs">
            New tester?{" "}
            <Link
              href="/beta-guide"
              className="font-semibold text-emerald-300/80 underline-offset-2 transition-colors hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
            >
              Read the Beta Guide
            </Link>{" "}
            first — Free Play only.
          </p>

          {/* Beta safety notice */}
          <p className="mt-3 hidden text-[10px] text-zinc-600 sm:block">
            444 ARENA is a free-play beta · No deposits · No withdrawals · No paid matches
          </p>
        </div>

        {/* Floating 444 ball — desktop only, gently hovers (still under
            reduced motion). Cyan-primary glow, locked brand. */}
        <div
          aria-hidden
          className="relative hidden h-32 w-32 shrink-0 items-center justify-center lg:flex"
        >
          <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-2xl" />
          <div
            className="p444-home-hero-ball relative grid h-28 w-28 place-items-center rounded-full font-black italic"
            style={{
              background:
                "radial-gradient(circle at 35% 30%, #ffffff, #cfe3ff 45%, #2b6fd4 92%)",
              boxShadow:
                "0 0 55px rgba(59,158,255,0.55), inset -12px -16px 28px rgba(14,32,72,0.5)",
              color: "#12213f",
              fontSize: "30px",
              animation: "p444HomeHeroBall 5s ease-in-out infinite",
            }}
          >
            444
          </div>
        </div>
      </div>
    </section>
  );
}
