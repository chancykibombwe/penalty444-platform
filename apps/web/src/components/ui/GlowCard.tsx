import type { ReactNode } from "react";

/**
 * Shared "premium" surface card: dark surface + accent border + soft
 * outer glow. Used across Home, Lobby and Leaderboard for featured /
 * active content per the 444 ARENA Premium Mobile UI Pass spec.
 */
export type GlowCardVariant = "primary" | "purple" | "positive" | "gold" | "neutral";

const VARIANT_CLASS: Record<GlowCardVariant, string> = {
  primary:
    "border-[#3B9EFF]/35 shadow-[0_0_28px_rgba(59,158,255,0.16)]",
  purple:
    "border-[#8B5CF6]/35 shadow-[0_0_28px_rgba(139,92,246,0.16)]",
  positive:
    "border-[#22C55E]/35 shadow-[0_0_28px_rgba(34,197,94,0.14)]",
  gold:
    "border-[#E0A000]/40 shadow-[0_0_28px_rgba(224,160,0,0.18)]",
  neutral: "border-[#1B2433]",
};

type Props = {
  children: ReactNode;
  variant?: GlowCardVariant;
  className?: string;
  as?: "div" | "section";
};

export default function GlowCard({
  children,
  variant = "neutral",
  className = "",
  as = "div",
}: Props) {
  const Tag = as;
  return (
    <Tag
      className={`rounded-2xl border bg-[#0D1420] p-4 ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </Tag>
  );
}
