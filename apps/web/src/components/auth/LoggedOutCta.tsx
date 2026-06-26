"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";

/**
 * Auth discoverability CTA for logged-out visitors (PR #137).
 *
 * Read-only session check — this never changes auth behavior, redirects, or
 * session handling. It simply surfaces clear "Create Account" / "Log In"
 * entry points and renders nothing once a session is confirmed, so signed-in
 * users never see signup prompts.
 *
 * Variants:
 *   - "hero": compact inline text links (used under the home hero).
 *   - "card": bordered call-to-action block (used on the How to Play page).
 */
type AuthStatus = "checking" | "authenticated" | "anonymous";

type Props = {
  variant?: "hero" | "card";
  className?: string;
};

export default function LoggedOutCta({
  variant = "hero",
  className = "",
}: Props) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setStatus(session ? "authenticated" : "anonymous");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? "authenticated" : "anonymous");
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Only confirmed logged-out visitors see auth prompts. While the session is
  // still being confirmed we render nothing, so signed-in users never see a
  // flash of "create an account" messaging.
  if (status !== "anonymous") return null;

  if (variant === "card") {
    return (
      <section
        aria-label="Create an account"
        className={`rounded-2xl border border-[#3B9EFF]/30 bg-[#3B9EFF]/5 p-4 sm:p-5 ${className}`}
      >
        <p className="text-sm font-black text-white sm:text-base">
          Create a free account to play and save your stats
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          Free Play beta — no entry fees, no real money. Your matches, rank, and
          stats are saved to your account.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href="/auth/signup"
            className="inline-flex min-h-[40px] items-center rounded-xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-5 py-2 text-sm font-black text-white shadow-[0_0_18px_rgba(59,158,255,0.3)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Create Account
          </Link>
          <Link
            href="/auth/login"
            className="inline-flex min-h-[40px] items-center rounded-xl border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Log In
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Create an account or log in"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs ${className}`}
    >
      <Link
        href="/auth/signup"
        className="font-bold text-[#9AD2FF] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#3B9EFF]/60"
      >
        New here? Create a free account →
      </Link>
      <Link
        href="/auth/login"
        className="font-semibold text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/60"
      >
        Already have an account? Log in
      </Link>
    </section>
  );
}
