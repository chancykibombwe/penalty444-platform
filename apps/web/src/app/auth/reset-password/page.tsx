"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import {
  clearRecoveryFlag,
  hasAuthCallbackError,
  isPasswordRecoveryCallback,
  parseAuthCallbackParams,
  readRecoveryFlag,
  shouldForcePasswordUpdate,
  validateNewPassword,
  writeRecoveryFlag,
} from "../../../lib/auth/passwordRecovery";

type GateState = "checking" | "ready" | "invalid" | "success";

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
    let cancelled = false;
    let settled = false;

    function markReady() {
      if (cancelled || settled) return;
      settled = true;
      writeRecoveryFlag(window.sessionStorage);
      setGate("ready");
      setGateMessage("");
    }

    function markInvalid(message: string) {
      if (cancelled || settled) return;
      settled = true;
      clearRecoveryFlag(window.sessionStorage);
      setGate("invalid");
      setGateMessage(message);
    }

    const params = parseAuthCallbackParams(
      window.location.search,
      window.location.hash
    );

    if (hasAuthCallbackError(params)) {
      markInvalid(
        "This password reset link is invalid or has expired. Request a new one."
      );
      return () => {
        cancelled = true;
      };
    }

    if (isPasswordRecoveryCallback(params)) {
      writeRecoveryFlag(window.sessionStorage);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === "PASSWORD_RECOVERY") {
        markReady();
        return;
      }

      if (
        session &&
        shouldForcePasswordUpdate({
          authEvent: event,
          recoveryFlagSet: readRecoveryFlag(window.sessionStorage),
          callbackIsRecovery: isPasswordRecoveryCallback(params),
        })
      ) {
        markReady();
      }
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled || settled) return;

      const force = shouldForcePasswordUpdate({
        authEvent: null,
        recoveryFlagSet: readRecoveryFlag(window.sessionStorage),
        callbackIsRecovery: isPasswordRecoveryCallback(params),
      });

      if (session && force) {
        markReady();
        return;
      }

      // Give the auth client a moment to finish hash/PKCE exchange.
      window.setTimeout(() => {
        if (cancelled || settled) return;
        void supabase.auth.getSession().then(({ data: { session: s } }) => {
          if (cancelled || settled) return;
          const stillForce = shouldForcePasswordUpdate({
            authEvent: null,
            recoveryFlagSet: readRecoveryFlag(window.sessionStorage),
            callbackIsRecovery: isPasswordRecoveryCallback(params),
          });
          if (s && stillForce) {
            markReady();
            return;
          }
          markInvalid(
            "This password reset link is invalid or has expired. Request a new one."
          );
        });
      }, 1500);
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
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
      setStatusTone("error");
      setStatus(
        error.message.toLowerCase().includes("expired") ||
          error.message.toLowerCase().includes("session")
          ? "This password reset link is invalid or has expired. Request a new one."
          : "Unable to update your password. Try again or request a new reset link."
      );
      return;
    }

    clearRecoveryFlag(window.sessionStorage);
    // Force a clean login with the new password.
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
          {gateMessage}
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
