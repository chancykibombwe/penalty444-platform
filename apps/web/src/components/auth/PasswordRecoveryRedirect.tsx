"use client";

/**
 * Global recovery gate: if Supabase establishes a PASSWORD_RECOVERY session
 * (or a recovery callback is detected) while the user is not already on
 * `/auth/reset-password`, send them there before lobby/home flows can take over.
 *
 * Also clears abandoned recovery sessionStorage markers on ordinary auth
 * transitions so a later normal sign-in cannot resurface the reset form.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  PASSWORD_RECOVERY_PATH,
  clearRecoveryFlag,
  isPasswordRecoveryCallback,
  isPkceRecoveryCandidate,
  parseAuthCallbackParams,
  shouldClearStaleRecoveryFlag,
  writeRecoveryFlag,
} from "../../lib/auth/passwordRecovery";

export default function PasswordRecoveryRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onResetPasswordPath = pathname === PASSWORD_RECOVERY_PATH;
    const params = parseAuthCallbackParams(
      window.location.search,
      window.location.hash
    );
    const callbackIsRecovery = isPasswordRecoveryCallback(params);
    const pkceCandidate = isPkceRecoveryCandidate(params, onResetPasswordPath);

    if (callbackIsRecovery || pkceCandidate) {
      writeRecoveryFlag(window.sessionStorage);
      if (!onResetPasswordPath) {
        router.replace(PASSWORD_RECOVERY_PATH);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        writeRecoveryFlag(window.sessionStorage);
        if (pathname !== PASSWORD_RECOVERY_PATH) {
          router.replace(PASSWORD_RECOVERY_PATH);
        }
        return;
      }

      if (
        shouldClearStaleRecoveryFlag({
          authEvent: event,
          onResetPasswordPath,
          callbackIsRecovery,
          pkceRecoveryCandidate: pkceCandidate,
        })
      ) {
        clearRecoveryFlag(window.sessionStorage);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
