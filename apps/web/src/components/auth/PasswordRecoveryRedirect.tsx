"use client";

/**
 * Global recovery gate: if Supabase establishes a PASSWORD_RECOVERY session
 * (or the URL carries type=recovery) while the user is not already on
 * `/auth/reset-password`, send them there before lobby/home flows can take over.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  PASSWORD_RECOVERY_PATH,
  isPasswordRecoveryCallback,
  parseAuthCallbackParams,
  writeRecoveryFlag,
} from "../../lib/auth/passwordRecovery";

export default function PasswordRecoveryRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const params = parseAuthCallbackParams(
      window.location.search,
      window.location.hash
    );

    if (isPasswordRecoveryCallback(params)) {
      writeRecoveryFlag(window.sessionStorage);
      if (pathname !== PASSWORD_RECOVERY_PATH) {
        router.replace(PASSWORD_RECOVERY_PATH);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY") return;
      writeRecoveryFlag(window.sessionStorage);
      if (pathname !== PASSWORD_RECOVERY_PATH) {
        router.replace(PASSWORD_RECOVERY_PATH);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
