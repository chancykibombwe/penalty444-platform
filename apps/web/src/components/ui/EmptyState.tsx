import type { ReactNode } from "react";

type Props = {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
};

/**
 * Shared empty/unavailable-data block — icon + up to two muted lines.
 * Used wherever live data isn't available yet so we never show a fake
 * placeholder value (Phase 8B honest-data policy).
 */
export default function EmptyState({ icon, title, subtitle, className = "" }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#1B2433] bg-[#0D1420] px-5 py-8 text-center ${className}`}
    >
      {icon ? (
        <div className="text-2xl text-[#5A6472]" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-bold text-zinc-300">{title}</p>
      {subtitle ? <p className="text-xs text-[#9AA4B2]">{subtitle}</p> : null}
    </div>
  );
}
