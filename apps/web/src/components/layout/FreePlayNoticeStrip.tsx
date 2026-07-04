"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * FreePlayNoticeStrip — the global "Free Play Beta · No real money · No cash
 * prizes" strip, extracted verbatim from app/layout.tsx.
 *
 * Per the locked Home design (Home Mobile 390/360 V1, Home Desktop V1) the
 * Home page shows no beta warning banner — Home carries its own Free Play
 * messaging in the hero, the ⚡ FREE PLAY pill, and the page footer. Every
 * other route keeps the strip exactly as before.
 */
export default function FreePlayNoticeStrip() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <div className="border-b border-[#1B2433] bg-[#080C12] py-1 text-center text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
      <Link
        href="/games/penalty444"
        className="hover:text-zinc-200"
      >
        Free Play Beta
      </Link>
      {" "}· No real money · No cash prizes
    </div>
  );
}
