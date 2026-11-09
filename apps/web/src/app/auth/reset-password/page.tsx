"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import {
  INVALID_RECOVERY_LINK_MESSAGE,
  clearRecoveryFlag,
  startRecoveryBootstrap,
  validateNewPassword,
  type RecoveryGateState,
} from "../../../lib/auth/passwordRecovery";

type GateState = RecoveryGateState["status"] | "success";

export default function ResetPasswordPage() {
  const [gate, setGate] = useState<GateState>("checking");
  const [gateMessage, setGateMessage] = useState(
    "Checking your reset link..."
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "error" | "success">(
    "neutral"
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bootstrap = startRecoveryBootstrap({
      getSearch: () => window.location.search,
      getHash: () => window.location.hash,
      onResetPasswordPath: true,
      storage: window.sessionStorage,
      getSession: async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return { session };
      },
      onAuthStateChange: (cb) => {
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
          cb(event, session);
        });
        return { unsubscribe: () => subscription.unsubscribe() };
      },
      setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown,
      clearTimeout: (id) => window.clearTimeout(id as number),
      onState: (next) => {
        setGate(next.status);
        setGateMessage(next.message);
      },
    });

    return () => {
      bootstrap.stop();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setStatusTone("neutral");

    if (loading || gate !== "ready") return;

    const validationError = validateNewPassword(password, confirmPassword);
    if (validationError) {
      setStatusTone("error");
      setStatus(validationError);
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      const lower = error.message.toLowerCase();
      setStatusTone("error");
      setStatus(
        lower.includes("expired") ||
          lower.includes("session") ||
          lower.includes("invalid")
          ? INVALID_RECOVERY_LINK_MESSAGE
          : "Unable to update your password. Try again or request a new reset link."
      );
      return;
    }

    clearRecoveryFlag(window.sessionStorage);
    await supabase.auth.signOut();
    setLoading(false);
    setGate("success");
    setStatusTone("success");
    setStatus("Password updated. You can now log in with your new password.");
  }

  if (gate === "checking") {
    return (
      <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold text-white">Reset password</h1>
        <p className="mt-2 text-sm text-zinc-400">{gateMessage}</p>
        <p className="mt-3 text-xs text-zinc-500">
          Still verifying your secure link. This can take a few seconds on slow
          connections.
        </p>
      </section>
    );
  }

  if (gate === "invalid") {
    return (
      <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold text-white">Reset password</h1>
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          {gateMessage || INVALID_RECOVERY_LINK_MESSAGE}
        </div>
        <p className="mt-4 text-sm text-zinc-400">
          <Link href="/auth/forgot-password" className="text-[#9AD2FF] underline">
            Request a new reset link
          </Link>
          {" · "}
          <Link href="/auth/login" className="text-[#9AD2FF] underline">
            Back to login
          </Link>
        </p>
      </section>
    );
  }

  if (gate === "success") {
    return (
      <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold text-white">Password updated</h1>
        <div
          role="status"
          className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100"
        >
          {status}
        </div>
        <Link
          href="/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#3B9EFF] px-4 py-3 font-semibold text-zinc-950"
        >
          Go to login
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-2xl font-bold text-white">Choose a new password</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Enter a new password for your 444 ARENA account. You will sign in again
        after saving.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label
            htmlFor="reset-password"
            className="mb-2 block text-sm text-zinc-300"
          >
            New password
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="reset-password-confirm"
            className="mb-2 block text-sm text-zinc-300"
          >
            Confirm new password
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat password"
            value={confirmPassword}
            disabled={loading}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 disabled:opacity-60"
          />
        </div>

        {status ? (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              statusTone === "error"
                ? "border-red-500/40 bg-red-950/40 text-red-100"
                : statusTone === "success"
                  ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-100"
                  : "border-zinc-700 bg-zinc-950 text-zinc-300"
            }`}
          >
            {status}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-[#3B9EFF] px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ? "Saving..." : "Update password"}
        </button>
      </form>
    </section>
  );
}
