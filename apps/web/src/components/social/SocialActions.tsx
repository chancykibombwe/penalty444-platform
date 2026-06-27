"use client";

import Link from "next/link";
import { useState } from "react";
import { buildChallengeHref } from "../../lib/challenge/challengeLinks";

/**
 * Social action buttons (Phase 9).
 *
 * Display + route-only. None of these touch sockets, gameplay, or
 * persistence systems:
 *
 *   - View Profile     → `/profile/<username>`
 *   - Challenge Player → `/lobby?challenge=<username>` (lobby decides UX)
 *   - Rematch          → existing rematch flow (passes a handler)
 *   - Add Rival        → "Coming soon" toast (no backend yet)
 *
 * Renders consistent tones across pages so the social CTAs feel like a
 * coherent system rather than ad-hoc buttons.
 */
type Variant = "primary" | "ghost" | "amber";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary:
    "border-cyan-400/55 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20",
  ghost: "border-zinc-700 bg-black/40 text-zinc-200 hover:border-cyan-400/45 hover:text-cyan-100",
  amber:
    "border-amber-400/55 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[10px] tracking-widest",
  md: "px-3 py-1.5 text-xs tracking-wider",
};

function classes(variant: Variant, size: Size, extra = ""): string {
  return `inline-flex items-center gap-1.5 rounded-lg border font-black uppercase transition-colors ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

/** Link to a player's public profile. Safe to use anywhere a username is shown. */
export function ViewProfileButton({
  username,
  size = "sm",
  variant = "ghost",
  label = "View Profile",
  className,
}: {
  username: string;
  size?: Size;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={`/profile/${encodeURIComponent(username)}`}
      className={classes(variant, size, className ?? "")}
      aria-label={`View ${username}'s profile`}
    >
      <span aria-hidden>👤</span>
      {label}
    </Link>
  );
}

/**
 * Challenge a player. Routes to the lobby with a `?challenge=<username>`
 * query — the lobby resolves the target, shows the Challenge Player panel,
 * and frames the existing Private Room create/share flow.
 */
export function ChallengePlayerButton({
  username,
  size = "sm",
  variant = "primary",
  label = "Challenge",
  className,
}: {
  username: string;
  size?: Size;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={buildChallengeHref(username)}
      className={classes(variant, size, className ?? "")}
      aria-label={`Challenge ${username}`}
    >
      <span aria-hidden>⚔</span>
      {label}
    </Link>
  );
}

/**
 * Reusable wrapper around an existing rematch handler. When no handler
 * is provided (e.g. on a profile page where there's no live room) it
 * falls back to a Challenge route so the CTA still leads somewhere.
 */
export function RematchButton({
  onClick,
  username,
  size = "sm",
  variant = "primary",
  label = "Rematch",
  disabled,
  className,
}: {
  onClick?: () => void;
  username?: string;
  size?: Size;
  variant?: Variant;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  if (!onClick && username) {
    return (
      <ChallengePlayerButton
        username={username}
        size={size}
        variant={variant}
        label={label}
        className={className}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${classes(variant, size, className ?? "")} disabled:opacity-50`}
    >
      <span aria-hidden>↻</span>
      {label}
    </button>
  );
}

/**
 * Add Rival — explicitly "coming soon" for Phase 9. Shows a small toast
 * the first time it's pressed. No backend write.
 */
export function AddRivalButton({
  size = "sm",
  className,
}: {
  size?: Size;
  className?: string;
}) {
  const [showHint, setShowHint] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          setShowHint(true);
          window.setTimeout(() => setShowHint(false), 2400);
        }}
        className={classes("amber", size, className ?? "")}
      >
        <span aria-hidden>★</span>
        Add Rival
      </button>
      {showHint ? (
        <span
          role="status"
          className="absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-amber-400/55 bg-amber-950/85 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-100 shadow-lg backdrop-blur"
        >
          Coming soon
        </span>
      ) : null}
    </div>
  );
}
