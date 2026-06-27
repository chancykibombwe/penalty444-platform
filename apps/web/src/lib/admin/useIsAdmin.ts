"use client";

/**
 * Client hook: is the current user an approved admin?
 *
 * Calls the server-only /api/admin/me check, which validates the Supabase JWT
 * and compares the email against ADMIN_EMAILS server-side. The browser only
 * ever receives a boolean — the admin email list never crosses the network.
 *
 * This is convenience-only (decides whether to render the Admin nav link). It
 * is NOT a security boundary — the admin pages/routes enforce their own
 * server-side authorization independently.
 *
 * Returns:
 *   null  → still checking (render nothing)
 *   false → not an admin / logged out / check failed
 *   true  → confirmed admin
 */

import { useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import type { AdminMeResponse } from "../../app/api/admin/me/route";

export function useIsAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (!cancelled) setIsAdmin(false);
          return;
        }

        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setIsAdmin(false);
          return;
        }

        const json = (await res.json()) as AdminMeResponse;
        if (!cancelled) setIsAdmin(json.isAdmin === true);
      } catch {
        // Fail closed — silently hide the link on any error.
        if (!cancelled) setIsAdmin(false);
      }
    }

    void check();

    // Re-check when auth state changes (login / logout).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void check();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return isAdmin;
}
