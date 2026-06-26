import Link from "next/link";

/**
 * "Wallet Coming Soon" pill for the top app bar. Wallet is read-only /
 * not yet live during beta — this never shows a balance.
 */
export default function WalletPill() {
  return (
    <Link
      href="/wallet"
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/50 bg-zinc-900/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:border-zinc-600/60 hover:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      aria-label="Wallet — Coming Soon"
    >
      <span className="text-xs opacity-60" aria-hidden>
        🪙
      </span>
      Wallet Coming Soon
    </Link>
  );
}
