import Link from "next/link";

export default function AuthPage() {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h1 className="text-3xl font-bold text-white">
        Penalty444 Account
      </h1>

      <p className="mt-3 text-zinc-400">
        Login or create an account to access live multiplayer.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-semibold text-white">Login</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Access your account and enter the lobby.
          </p>

          <Link
            href="/auth/login"
            className="mt-6 inline-block rounded-xl bg-white px-5 py-3 font-semibold text-black"
          >
            Go to Login
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black p-5">
          <h2 className="text-xl font-semibold text-white">Sign Up</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Create a new account for live multiplayer.
          </p>

          <Link
            href="/auth/signup"
            className="mt-6 inline-block rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-white"
          >
            Go to Sign Up
          </Link>
        </div>
      </div>
    </section>
  );
}