"use client";

/**
 * B6D3B PR-2 — arena presentation viewport.
 *
 * A thin layering wrapper so `MatchRoomPanel` needs only a single additive hunk in
 * its arena section. It owns nothing but paint order:
 *
 *   - it holds ONLY the decorative arena artwork (`children`);
 *   - it sits on a NEGATIVE z-index inside the arena's isolated stacking context,
 *     so every lane button, header, timer, scoreboard, status, overlay and
 *     accessibility element in normal flow paints ABOVE it;
 *   - it is `pointer-events-none`, so the presentation layer can never capture a
 *     pick, a tap or keyboard focus;
 *   - it is `aria-hidden`, so the decorative layer never owns accessibility
 *     content.
 *
 * When the player-facing path is inactive it renders the decorative artwork
 * exactly as before, so the default (flag-off) experience is unchanged.
 */

import UnityPresentationHost from "./UnityPresentationHost";
import type { SentSummary } from "./unityPresentationShadow";
import type { PresentationEnvelope } from "./unityPresentationProtocol";
import type { ViewerIdentityContext } from "./unityPresentationIdentity";
import type { CorrelationSummary } from "./unityPresentationCorrelation";

export interface MatchArenaViewportProps {
  /** True only when every flag, the cohort gate, identity and instance agree. */
  playerFacingActive: boolean;
  matchInstanceId: string | null;
  messages: ReadonlyArray<{ id: string; message: PresentationEnvelope }>;
  identity: ViewerIdentityContext | null;
  correlation: CorrelationSummary | null;
  onReady: () => void;
  onError: (reason: string) => void;
  onMessageSent: (summary: SentSummary) => void;
  /** Decorative arena artwork only — never controls or status. */
  children: React.ReactNode;
}

export default function MatchArenaViewport({
  playerFacingActive,
  matchInstanceId,
  messages,
  identity,
  correlation,
  onReady,
  onError,
  onMessageSent,
  children,
}: MatchArenaViewportProps) {
  return (
    <div
      data-arena-viewport=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      // Negative z-index inside the arena's isolated stacking context: paints
      // above the arena background but below all in-flow controls and status.
      style={{ zIndex: -10 }}
    >
      {playerFacingActive ? (
        <UnityPresentationHost
          playerFacingAuthorized
          matchInstanceId={matchInstanceId}
          messages={messages}
          identity={identity}
          correlation={correlation}
          onReady={onReady}
          onError={onError}
          onMessageSent={onMessageSent}
        >
          {children}
        </UnityPresentationHost>
      ) : (
        children
      )}
    </div>
  );
}
