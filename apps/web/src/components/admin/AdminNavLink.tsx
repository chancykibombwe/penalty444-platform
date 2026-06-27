"use client";

/**
 * Convenience Admin nav link (display-only).
 *
 * Rendered only when the secure useIsAdmin() check has confirmed the viewer is
 * an approved admin. This link is NOT a security boundary — /admin and
 * /admin/beta enforce their own server-side authorization regardless of
 * whether this link is shown.
 */

import Link from "next/link";

const BASE =
  "inline-flex items-center gap-1.5 rounded-xl border border-amber-400/45 bg-amber-500/10 font-bold text-amber-100 transition-colors hover:border-amber-300/70 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black";

const SIZE = {
  desktop: "px-3 py-2 text-sm",
  mobile: "px-2 py-1.5 text-[11px]",
} as const;

function ShieldIcon() {
  return (
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
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    </svg>
  );
}

export default function AdminNavLink({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  return (
    <Link href="/admin/beta" className={`${BASE} ${SIZE[variant]}`} aria-label="Admin dashboard">
      <ShieldIcon />
      Admin
    </Link>
  );
}
