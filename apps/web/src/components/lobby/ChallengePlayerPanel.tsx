"use client";

/**
 * Challenge Player panel (v1).
 *
 * Shown at the top of the Lobby when a `?challenge=<username>` (or legacy
 * `?challengeUsername=`) context is present. It does NOT create the room
 * itself — it frames the existing Private Room flow below and provides a
 * clear/cancel control.
 *
 * Safety: Free Play only, no money / stakes / prizes. The challenged player
 * is NOT auto-notified (no notification system in v1), so the copy tells the
 * inviter to share the room code/link manually.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

type ChallengePlayerPanelProps = {
  /** Resolved target display name from the query param. */
  targetUsername: string;
};

export default function ChallengePlayerPanel({
  targetUsername,
}: ChallengePlayerPanelProps) {
  const router = useRouter();
  const [isSelf, setIsSelf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCurrentPlayerIdentity().then((identity) => {
      if (cancelled || !identity) return;
      const me = identity.username?.trim().toLowerCase() ?? "";
      setIsSelf(me.length > 0 && me === targetUsername.trim().toLowerCase());
    });
    return () => {
      cancelled = true;
    };
  }, [targetUsername]);

  function clearChallenge() {
    // Drop the query param; stay on the lobby.
    router.replace("/lobby");
  }

  return (
    <section
      className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-3 shadow-[0_0_20px_rgba(34,211,238,0.07)] sm:p-4"
      aria-label="Challenge a player"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-sm ring-1 ring-cyan-400/30"
            aria-hidden
          >
            ⚔
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300/70">
              Free Play Challenge
            </p>
            {isSelf ? (
              <p className="mt-0.5 text-sm font-bold text-cyan-100">
                That&apos;s you — pick another player to challenge.
              </p>
            ) : (
              <>
                <p className="mt-0.5 truncate text-sm font-bold text-white">
                  Challenging{" "}
                  <span className="text-cyan-200">{targetUsername}</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-cyan-100/70">
                  Create a private room below, then share the room code or
                  invite link with {targetUsername}. They aren&apos;t notified
                  automatically — send it to them to start the match. Free Play
                  only · no stakes.
                </p>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={clearChallenge}
          className="shrink-0 rounded-lg border border-cyan-500/30 bg-black/30 px-2.5 py-1 text-[11px] font-bold text-cyan-100/80 transition-colors hover:border-cyan-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
        >
          Clear
        </button>
      </div>
    </section>
  );
}
