"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { supabase } from "../../../lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("");

    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      setStatus("Complete all fields.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setStatus("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    // No emailRedirectTo — Supabase uses the Site URL configured in the
    // Supabase Dashboard (Authentication → URL Configuration). Ensure the
    // Dashboard Site URL points to the production domain before beta launch,
    // or confirmation emails will link back to localhost.
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("Signup successful. You can now log in.");
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-2xl font-bold text-white">Sign Up</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Create your Penalty444 account.
      </p>

      <form onSubmit={handleSignup} className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-sm text-zinc-300">Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-zinc-300">Password</label>
          <input
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-zinc-300">
            Confirm Password
          </label>
          <input
            type="password"
            placeholder="Repeat password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none"
          />
        </div>

        {status ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
            {status}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-white underline">
          Login
        </Link>
      </p>
    </section>
  );
}