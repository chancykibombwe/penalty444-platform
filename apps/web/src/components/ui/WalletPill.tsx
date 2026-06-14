import Link from "next/link";

/**
 * "Wallet Coming Soon" pill for the top app bar. Wallet is read-only /
 * not yet live during beta — this never shows a balance.
 */
export default function WalletPill() {
  return (
    <Link
      href="/wallet"
      className="inline-flex items-center gap-1.5 rounded-full border border-[#E0A000]/40 bg-[#E0A000]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#F5C453] transition-colors hover:border-[#E0A000]/60 hover:text-[#FBD38D]"
    >
      <span className="text-xs" aria-hidden>
        🪙
      </span>
      Wallet Coming Soon
    </Link>
  );
}
