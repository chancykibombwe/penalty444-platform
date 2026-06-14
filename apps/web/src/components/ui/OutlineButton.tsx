"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type OutlineButtonTone = "primary" | "purple" | "positive" | "muted";

const TONE_CLASS: Record<OutlineButtonTone, string> = {
  primary: "border-[#3B9EFF]/55 text-[#3B9EFF] hover:bg-[#3B9EFF]/10",
  purple: "border-[#8B5CF6]/55 text-[#8B5CF6] hover:bg-[#8B5CF6]/10",
  positive: "border-[#22C55E]/55 text-[#22C55E] hover:bg-[#22C55E]/10",
  muted: "border-[#5A6472]/55 text-[#9AA4B2] hover:bg-white/5",
};

const BASE_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border bg-transparent px-6 py-3 text-[15px] font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

type CommonProps = {
  tone?: OutlineButtonTone;
  children: ReactNode;
  className?: string;
};

type LinkProps = CommonProps & {
  href: string;
};

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function OutlineButton(props: LinkProps | ButtonProps) {
  const { tone = "primary", children, className = "" } = props;
  const classes = `${BASE_CLASS} ${TONE_CLASS[tone]} ${className}`;

  if ("href" in props) {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tone: _tone, children: _children, className: _className, ...buttonProps } = props;

  return (
    <button {...buttonProps} className={classes}>
      {children}
    </button>
  );
}

export default OutlineButton;
