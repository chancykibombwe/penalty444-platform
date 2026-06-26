"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type GradientButtonVariant = "primary" | "purple";

const VARIANT_CLASS: Record<GradientButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] text-white shadow-[0_0_24px_rgba(59,158,255,0.35)] hover:shadow-[0_0_32px_rgba(59,158,255,0.5)]",
  purple:
    "bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] hover:shadow-[0_0_32px_rgba(139,92,246,0.5)]",
};

const BASE_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-6 py-3 text-[15px] font-black uppercase tracking-wide transition-all duration-200 motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

type CommonProps = {
  variant?: GradientButtonVariant;
  children: ReactNode;
  className?: string;
};

type LinkProps = CommonProps & {
  href: string;
};

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function GradientButton(props: LinkProps | ButtonProps) {
  const { variant = "primary", children, className = "" } = props;
  const classes = `${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`;

  if ("href" in props) {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variant: _variant, children: _children, className: _className, ...buttonProps } = props;

  return (
    <button {...buttonProps} className={classes}>
      {children}
    </button>
  );
}

export default GradientButton;
