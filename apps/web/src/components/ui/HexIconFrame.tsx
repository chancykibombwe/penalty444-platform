import type { ReactNode } from "react";

export type HexIconFrameTone = "primary" | "purple" | "positive" | "gold" | "muted";

const TONE_CLASS: Record<HexIconFrameTone, string> = {
  primary: "bg-[#3B9EFF]/15 text-[#3B9EFF] ring-1 ring-[#3B9EFF]/40",
  purple: "bg-[#8B5CF6]/15 text-[#8B5CF6] ring-1 ring-[#8B5CF6]/40",
  positive: "bg-[#22C55E]/15 text-[#22C55E] ring-1 ring-[#22C55E]/40",
  gold: "bg-[#E0A000]/15 text-[#E0A000] ring-1 ring-[#E0A000]/40",
  muted: "bg-white/5 text-[#9AA4B2] ring-1 ring-white/10",
};

const SIZE_CLASS = {
  sm: "h-9 w-9 text-lg",
  md: "h-12 w-12 text-2xl",
  lg: "h-14 w-14 text-3xl",
};

type Props = {
  children: ReactNode;
  tone?: HexIconFrameTone;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
};

/**
 * Hexagon icon wrapper — recurring container for game/action icons across
 * Home, Lobby, Leaderboard and the bottom nav per the Premium UI spec.
 */
export default function HexIconFrame({
  children,
  tone = "primary",
  size = "md",
  className = "",
}: Props) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${SIZE_CLASS[size]} ${TONE_CLASS[tone]} ${className}`}
      style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" }}
      aria-hidden
    >
      {children}
    </div>
  );
}
