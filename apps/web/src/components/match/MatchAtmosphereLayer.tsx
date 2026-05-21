"use client";

import type { PresentationAccent } from "./matchPresentation";

/**
 * Background atmosphere layer for match screens.
 *
 * Purely presentational. Renders fixed under the match content with a
 * subtle vignette + diffuse stadium glow. The accent tints the glow:
 *   - cyan       → casual / ranked stadium feel
 *   - gold       → tournament rounds
 *   - gold-final → championship match
 *
 * Pointer-events disabled so it never interferes with controls. No layout
 * impact; safe to mount alongside any existing layout.
 */
export default function MatchAtmosphereLayer({
  accent = "cyan",
  intense = false,
}: {
  accent?: PresentationAccent;
  intense?: boolean;
}) {
  const baseColor =
    accent === "gold-final"
      ? "rgba(250, 204, 21, 0.18)"
      : accent === "gold"
        ? "rgba(245, 158, 11, 0.13)"
        : "rgba(56, 189, 248, 0.10)";

  const secondaryColor =
    accent === "gold-final"
      ? "rgba(251, 146, 60, 0.16)"
      : accent === "gold"
        ? "rgba(234, 88, 12, 0.10)"
        : "rgba(99, 102, 241, 0.09)";

  const intensity = intense ? 1.25 : 1;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(60% 50% at 50% 0%, ${baseColor} 0%, transparent 60%), radial-gradient(45% 35% at 50% 100%, ${secondaryColor} 0%, transparent 70%)`,
          opacity: 0.9 * intensity,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        className="p444-atmosphere-orb absolute -left-32 top-1/3 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${baseColor} 0%, transparent 70%)`,
          opacity: 0.4 * intensity,
        }}
      />
      <div
        className="p444-atmosphere-orb absolute -right-40 -top-20 h-[24rem] w-[24rem] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${secondaryColor} 0%, transparent 70%)`,
          opacity: 0.35 * intensity,
          animationDirection: "reverse",
        }}
      />
    </div>
  );
}
