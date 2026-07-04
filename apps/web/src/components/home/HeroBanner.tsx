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
      className="relative overflow-hidden rounded-3xl border border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black px-3.5 py-4 shadow-2xl sm:px-6 sm:py-5"
      aria-label="444 Arena hero"
    >
      {/* Background glow orbs */}
      <div
        aria-hidden
        className="home-hero-glow pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-cyan-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="home-hero-glow pointer-events-none absolute -bottom-40 -right-16 h-80 w-80 rounded-full bg-amber-500/15 blur-3xl"
        style={{ animationDelay: "2s" }}
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

        {/* Decorative arena graphic — desktop only */}
        <div
          aria-hidden
          className="relative hidden h-28 w-28 shrink-0 items-center justify-center lg:flex"
        >
          <div className="absolute inset-0 rounded-full border border-cyan-400/15" />
          <div className="absolute inset-4 rounded-full border border-cyan-400/10" />
          <div className="absolute inset-8 rounded-full border border-amber-400/10" />
          <div className="absolute inset-0 rounded-full bg-cyan-500/8 blur-2xl" />
          <span className="relative text-5xl">⚽</span>
        </div>
      </div>
    </section>
  );
}
