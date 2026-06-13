"use client";

import { useState, type ReactNode } from "react";

type ExpandToggleProps = {
  label: string;
  expandedLabel?: string;
  children: ReactNode;
};

export default function ExpandToggle({
  label,
  expandedLabel = "Show less",
  children,
}: ExpandToggleProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? children : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#1B2433] bg-[#111827]/60 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
      >
        {open ? expandedLabel : label}
        <span
          aria-hidden
          className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
    </>
  );
}
