"use client";

/**
 * Self-aware Challenge button for leaderboard / search rows.
 *
 * Renders a link to `/lobby?challenge=<username>` — EXCEPT when the row
 * belongs to the currently logged-in user, in which case it renders nothing
 * (you can't challenge yourself). When logged out it still renders; the
 * lobby's RequireAuth wrapper sends the user to login on click.
 *
 * Route + display only: no sockets, gameplay, wallet, or auth mutations.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { buildChallengeHref } from "../../lib/challenge/challengeLinks";

type ChallengeRowButtonProps = {
  /** Target row's auth user id — compared to the viewer to hide self. */
  targetUserId: string;
  /** Target display name — used for the link + label. Never an email/id. */
  targetUsername: string;
  className?: string;
};

export default function ChallengeRowButton({
  targetUserId,
  targetUsername,
  className,
}: ChallengeRowButtonProps) {
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setViewerId(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide for self only once we positively know the viewer is this player.
  if (viewerId !== null && viewerId === targetUserId) {
    return null;
  }

  return (
    <Link
      href={buildChallengeHref(targetUsername)}
      aria-label={`Challenge ${targetUsername}`}
      className={
        className ??
        "shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50"
      }
      style={{
        background: "rgba(8,40,50,0.90)",
        border: "1px solid rgba(34,211,238,0.38)",
        color: "#67e8f9",
      }}
    >
      Challenge
    </Link>
  );
}
