"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type HeroBannerProps = {
  /** Primary CTA route. Defaults to `/lobby` ("Play now"). */
  primaryHref?: string;
  /** Secondary CTA route. Defaults to `/tournaments`. */
  secondaryHref?: string;
};

const ROTATING_TAGLINES = [
  {
    headline: "Skill wins every time.",
    subtext: "Real players. Real battles. Real rankings.",
  },
  {
    headline: "Outplay. Outscore. Outrank.",
    subtext: "Climb the ranks. Prove your skill.",
  },
  {
    headline: "Step into the arena.",
    subtext: "Tournaments coming soon. Free Play is live.",
  },
];

/**
 * Splits a headline into two halves for the two-tone treatment
 * (white + accent gradient) used across the rotating taglines.
 */
function splitHeadline(headline: string): [string, string] {
  const words = headline.replace(/\.$/, "").split(" ");
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

export default function HeroBanner({
  primaryHref = "/lobby",
  secondaryHref = "/tournaments",
}: HeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % ROTATING_TAGLINES.length);
    }, 5_500);
    return () => window.clearInterval(id);
  }, []);

  const tagline = useMemo(
    () => ROTATING_TAGLINES[activeIndex] ?? ROTATING_TAGLINES[0],
    [activeIndex]
  );

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-zinc-950 to-black px-5 py-8 shadow-2xl sm:px-8 sm:py-12"
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

      <div className="relative max-w-2xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/45 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.32em] text-cyan-100">
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.9)]"
            aria-hidden
          />
          444 Arena · Live
        </p>

        <h1
          key={`headline-${activeIndex}`}
          className="mt-4 text-3xl font-black uppercase leading-tight tracking-tight sm:text-4xl md:text-5xl"
          style={{ animation: "homeFeedFade 0.45s ease-out forwards" }}
        >
          {(() => {
            const [first, second] = splitHeadline(tagline.headline);
            return (
              <>
                <span className="text-white">{first}</span>{" "}
                <span className="bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] bg-clip-text text-transparent">
                  {second}
                </span>
              </>
            );
          })()}
        </h1>

        <p
          key={`subtext-${activeIndex}`}
          className="mt-3 max-w-md text-sm leading-relaxed text-zinc-300 sm:text-base"
          style={{ animation: "homeFeedFade 0.5s ease-out forwards" }}
        >
          {tagline.subtext}
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href={primaryHref}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-6 py-3 text-sm font-black uppercase tracking-wide text-white shadow-[0_0_28px_rgba(59,158,255,0.4)] transition-transform hover:scale-[1.02] sm:text-base"
          >
            ▶ Play Now
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-[#E0A000]/55 bg-transparent px-6 py-3 text-sm font-black uppercase tracking-wide text-[#E0A000] transition-transform hover:scale-[1.02] hover:bg-[#E0A000]/10 sm:text-base"
          >
            🏆 Tournaments
          </Link>
        </div>

        <div
          className="mt-6 flex items-center gap-2"
          role="tablist"
          aria-label="Hero tagline indicators"
        >
          {ROTATING_TAGLINES.map((_, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Show tagline ${index + 1}`}
                data-active={active}
                onClick={() => setActiveIndex(index)}
                className="home-hero-indicators-dot"
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
