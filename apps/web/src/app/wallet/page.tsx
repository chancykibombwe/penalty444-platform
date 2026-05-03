"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/client";

type Wallet = {
  id: string;
  user_id: string;
  username: string;
  balance: number;
  locked_balance: number;
  total_winnings: number;
  currency: string;
};

export default function WalletPage() {
  const router = useRouter();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading wallet...");

  async function loadWallet() {
    setLoading(true);
    setMessage("Loading wallet...");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/auth/login");
      return;
    }

    const userId = session.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();

    const username = profile?.username || "Player";

    const { data: existingWallet, error: walletError } = await supabase
      .from("wallets")
      .select(
        "id, user_id, username, balance, locked_balance, total_winnings, currency"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (walletError) {
      setMessage(walletError.message);
      setLoading(false);
      return;
    }

    if (existingWallet) {
      setWallet(existingWallet);
      setMessage("");
      setLoading(false);
      return;
    }

    const { data: newWallet, error: createError } = await supabase
      .from("wallets")
      .insert({
        user_id: userId,
        username,
        balance: 1000,
        locked_balance: 0,
        total_winnings: 0,
        currency: "COINS",
      })
      .select(
        "id, user_id, username, balance, locked_balance, total_winnings, currency"
      )
      .single();

    if (createError) {
      setMessage(createError.message);
      setLoading(false);
      return;
    }

    setWallet(newWallet);
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    loadWallet();
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Wallet</h1>
          <p className="mt-2 text-zinc-400">
            Test wallet for Penalty444 coins. Real money comes later.
          </p>
        </div>

        <button
          onClick={loadWallet}
          className="rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white hover:border-zinc-500"
        >
          Refresh Wallet
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-300">
          {message}
        </div>
      ) : null}

      {!loading && message ? (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 p-6 text-red-200">
          {message}
        </div>
      ) : null}

      {wallet ? (
        <>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-sm text-zinc-400">Player</p>
            <p className="mt-2 text-2xl font-bold text-white">
              {wallet.username}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-400">Available Balance</p>
              <p className="mt-2 text-3xl font-bold text-white">
                {wallet.balance} {wallet.currency}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-400">Locked in Matches</p>
              <p className="mt-2 text-3xl font-bold text-white">
                {wallet.locked_balance} {wallet.currency}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-400">Total Winnings</p>
              <p className="mt-2 text-3xl font-bold text-white">
                {wallet.total_winnings} {wallet.currency}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-semibold text-white">Wallet Status</h2>
            <p className="mt-2 text-zinc-400">
              Stakes are now connected to public match offers. Use Refresh
              Wallet after creating, joining, or completing a staked match.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}