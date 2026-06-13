"use client";

import Link from "next/link";

type HeroBannerProps = {
  /** Primary CTA route. Defaults to `/lobby` ("Play now"). */
  primaryHref?: string;
  /** Secondary CTA route. Defaults to `/tournaments`. */
  secondaryHref?: string;
};

export default function HeroBanner({
  primaryHref = "/lobby",
  secondaryHref = "/tournaments",
}: HeroBannerProps) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black px-4 py-5 shadow-2xl sm:px-6 sm:py-8"
      aria-label="444 Arena hero"
    >
      {/* Background layers */}
      <div
        aria-hidden
        className="home-hero-glow pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-cyan-500/30 blur-3xl"
      />
      <div
        aria-hidden
        className="home-hero-glow pointer-events-none absolute -bottom-40 -right-16 h-80 w-80 rounded-full bg-amber-500/20 blur-3xl"
        style={{ animationDelay: "2s" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative flex items-center justify-between gap-6">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/45 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.32em] text-cyan-100">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.9)]"
              aria-hidden
            />
            444 Arena · Live
          </p>

          <h1 className="mt-3 text-2xl font-black uppercase leading-tight tracking-tight sm:text-3xl md:text-4xl">
            <span className="text-white">Skill Wins</span>{" "}
            <span className="bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] bg-clip-text text-transparent">
              Every Time
            </span>
          </h1>

          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-300 sm:text-base">
            Real players. Real battles. Real rewards.
          </p>

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link
              href={primaryHref}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-6 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_0_28px_rgba(59,158,255,0.4)] transition-transform hover:scale-[1.02] sm:text-base"
            >
              ▶ Play Now
            </Link>
            <Link
              href={secondaryHref}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-[#E0A000]/55 bg-transparent px-5 py-2.5 text-sm font-black uppercase tracking-wide text-[#E0A000] transition-transform hover:scale-[1.02] hover:bg-[#E0A000]/10 sm:text-base"
            >
              🏆 Tournaments
            </Link>
          </div>
        </div>

        {/* Decorative arena graphic — desktop only, fills the empty
            right-hand space so the hero no longer feels bare on
            laptop widths. */}
        <div
          aria-hidden
          className="relative hidden h-48 w-48 shrink-0 items-center justify-center lg:flex"
        >
          <div className="absolute inset-0 rounded-full border border-cyan-400/15" />
          <div className="absolute inset-6 rounded-full border border-cyan-400/10" />
          <div className="absolute inset-12 rounded-full border border-amber-400/10" />
          <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-2xl" />
          <span className="relative text-6xl">⚽</span>
        </div>
      </div>
    </section>
  );
}
