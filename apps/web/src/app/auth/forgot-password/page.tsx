"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../../lib/supabase/client";
import {
  GENERIC_RESET_EMAIL_SENT_MESSAGE,
  buildPasswordRecoveryRedirectTo,
  isValidEmail,
} from "../../../lib/auth/passwordRecovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setStatusTone("neutral");

    if (submitted || loading) return;

    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setStatusTone("error");
      setStatus("Enter a valid email address.");
      return;
    }

    setLoading(true);

    let redirectTo: string;
    try {
      redirectTo = buildPasswordRecoveryRedirectTo(window.location.origin);
    } catch {
      setLoading(false);
      setStatusTone("error");
      setStatus("Unable to start password reset from this page. Try again later.");
      return;
    }

    // Always show the same confirmation — do not reveal whether the email exists.
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo,
    });

    setLoading(false);

    if (error) {
      // Network / rate-limit style failures can be shown generically.
      setStatusTone("error");
      setStatus(
        "Unable to send a reset email right now. Please wait a moment and try again."
      );
      return;
    }

    setSubmitted(true);
    setStatusTone("neutral");
    setStatus(GENERIC_RESET_EMAIL_SENT_MESSAGE);
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-2xl font-bold text-white">Forgot password</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Enter the email for your 444 ARENA account. We&apos;ll send a reset link
        if an account exists.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className="mb-2 block text-sm text-zinc-300">
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={loading || submitted}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 disabled:opacity-60"
          />
        </div>

        {status ? (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              statusTone === "error"
                ? "border-red-500/40 bg-red-950/40 text-red-100"
                : "border-zinc-700 bg-zinc-950 text-zinc-300"
            }`}
          >
            {status}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || submitted}
          className="w-full rounded-xl bg-[#3B9EFF] px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ? "Sending..." : submitted ? "Email sent" : "Send reset link"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        Remembered your password?{" "}
        <Link href="/auth/login" className="text-[#9AD2FF] underline">
          Back to login
        </Link>
      </p>
    </section>
  );
}
