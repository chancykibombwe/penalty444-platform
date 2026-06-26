"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { supabase } from "../../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("");

    if (!email.trim() || !password.trim()) {
      setStatus("Enter your email and password.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoading(false);
      setStatus(error.message);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      setStatus("Session not found. Please try logging in again.");
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle();

    setLoading(false);

    if (profileError) {
      setStatus(profileError.message);
      return;
    }

    if (profile?.username) {
      router.push("/lobby");
    } else {
      router.push("/auth/username");
    }

    router.refresh();
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-2xl font-bold text-white">Login</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Log in or create a free account to play Penalty444.
      </p>

      <form onSubmit={handleLogin} className="mt-6 space-y-4">
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
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link href="/auth/signup" className="text-white underline">
          Sign up
        </Link>
      </p>
    </section>
  );
}