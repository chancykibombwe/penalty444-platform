import Link from "next/link";

/**
 * "Wallet Coming Soon" pill for the top app bar. Wallet is read-only /
 * not yet live during beta — this never shows a balance.
 */
export default function WalletPill() {
  return (
    <Link
      href="/wallet"
      className="inline-flex items-center gap-1.5 rounded-full border border-[#5A6472]/50 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#9AA4B2] transition-colors hover:border-[#3B9EFF]/40 hover:text-[#3B9EFF]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <rect x="2" y="6" width="20" height="14" rx="2" />
        <path d="M16 14h.01" />
        <path d="M2 10h20" />
      </svg>
      Wallet Coming Soon
    </Link>
  );
}
