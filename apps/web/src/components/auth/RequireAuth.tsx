"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { disconnectSocket } from "../../lib/socket/client";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session) {
        router.replace("/auth/login");
        return;
      }

      setChecking(false);
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        disconnectSocket();
        setChecking(true);
        router.replace("/auth/login");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold text-white">Checking access...</h1>
        <p className="mt-2 text-zinc-400">
          Please wait while we confirm your login.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}