"use client";

import { useEffect, useState } from "react";
import type { PresentationAccent } from "./matchPresentation";

export type MatchWaitingPhase =
  | "waiting"
  | "opponent-joined"
  | "countdown"
  | "waiting-for-return";

/**
 * Cinematic pre-match overlay for casual / private rooms.
 *
 * Presentation-only. Parent owns the state machine and timers — this
 * component only renders the room code, copy/share affordances, the
 * "Opponent joined" beat, and the 3 / 2 / 1 countdown.
 *
 * MUST NOT be used for tournament rooms — those have their own
 * `MatchStagingScreen` with bracket-aware intro.
 *
 * Style notes:
 * - Fixed full-screen, z-40, captures pointer events so lane buttons
 *   underneath cannot be clicked while the overlay is visible.
 * - Uses keyframes from `MATCH_PRESENTATION_CSS` (mounted once at the
 *   top of `MatchRoomPanel`) so no extra stylesheet ships.
 * - Accent matches the rest of the match UI (cyan for casual; the
 *   gold/tournament variants are not expected here but supported).
 */
export default function MatchWaitingOverlay({
  visible,
  phase,
  roomCode,
  countdownSeconds,
  accent,
  myName,
  opponentName,
  onCancel,
  returnSecondsRemaining,
  absentPlayerName,
}: {
  visible: boolean;
  phase: MatchWaitingPhase;
  roomCode: string;
  countdownSeconds: number | null;
  accent: PresentationAccent;
  myName?: string;
  opponentName?: string;
  onCancel?: () => void;
  /**
   * Seconds left on the server's `match:waitingForReturn` deadline.
   * Used only in `waiting-for-return` phase. Pass `null` when unknown
   * (will display "any moment now").
   */
  returnSecondsRemaining?: number | null;
  /**
   * Name of the player the present user is waiting on. Displayed in
   * `waiting-for-return` phase. Pass undefined for "Opponent".
   */
  absentPlayerName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Hydrate share capability on the client only — navigator is unavailable
  // during SSR and on older browsers without the Web Share API.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time client-only hydration probe */
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setCanShare(typeof (navigator as Navigator).share === "function");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!visible) return null;

  const accentRing =
    accent === "gold" || accent === "gold-final"
      ? "border-amber-300/55 shadow-[0_0_38px_rgba(251,191,36,0.22)]"
      : "border-cyan-400/55 shadow-[0_0_38px_rgba(56,189,248,0.22)]";

  const accentGlow =
    accent === "gold" || accent === "gold-final"
      ? "bg-amber-400/15 text-amber-100"
      : "bg-cyan-400/15 text-cyan-100";

  const accentEyebrow =
    accent === "gold" || accent === "gold-final"
      ? "text-amber-300/90"
      : "text-cyan-300/90";

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(roomCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        return;
      }
      // Fallback: select-and-copy via a hidden textarea. Old Safari and
      // some embedded webviews still lack `navigator.clipboard`.
      const textarea = document.createElement("textarea");
      textarea.value = roomCode;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort; clipboard failures are silent.
    }
  }

  async function handleShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      return;
    }
    try {
      await navigator.share({
        title: "444 Arena · Penalty room",
        text: `Join my penalty match. Room code: ${roomCode}`,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      });
    } catch {
      // User cancelled or share rejected — no-op.
    }
  }

  const showCountdown = phase === "countdown" && countdownSeconds !== null;
  const showOpponentJoined = phase === "opponent-joined";
  const showWaitingForReturn = phase === "waiting-for-return";

  return (
    <div
      className="p444-waiting-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4 py-8 backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-label={
        showCountdown
          ? `Match starting in ${countdownSeconds}`
          : showOpponentJoined
            ? "Opponent joined"
            : showWaitingForReturn
              ? `Waiting for ${absentPlayerName ?? "opponent"} to return`
              : "Waiting for opponent"
      }
    >
      {showCountdown ? (
        <CountdownStage
          seconds={countdownSeconds}
          accent={accent}
          myName={myName}
          opponentName={opponentName}
        />
      ) : showOpponentJoined ? (
        <OpponentJoinedStage
          accent={accent}
          myName={myName}
          opponentName={opponentName}
        />
      ) : showWaitingForReturn ? (
        <WaitingForReturnStage
          accent={accent}
          absentPlayerName={absentPlayerName}
          secondsRemaining={returnSecondsRemaining ?? null}
        />
      ) : (
        <div
          className={`p444-waiting-card w-full max-w-lg rounded-3xl border bg-zinc-950/90 px-6 py-8 text-center shadow-2xl sm:px-8 sm:py-10 ${accentRing}`}
        >
          <span
            className={`p444-waiting-ring inline-flex h-3 w-3 rounded-full ${
              accent === "gold" || accent === "gold-final"
                ? "bg-amber-300"
                : "bg-cyan-300"
            }`}
            aria-hidden
          />
          <p
            className={`mt-4 text-[11px] font-black uppercase tracking-[0.32em] ${accentEyebrow}`}
          >
            Private Match
          </p>
          <h2 className="mt-2 break-words text-3xl font-black text-white sm:text-4xl">
            Waiting for opponent
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            Share the code below. Your gameplay timer will only start once
            the second player joins.
          </p>

          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-zinc-500">
              Room code
            </p>
            <div
              className={`p444-waiting-code inline-flex items-center justify-center rounded-2xl border px-7 py-4 text-4xl font-black tracking-[0.32em] text-white sm:text-5xl ${accentRing}`}
            >
              {roomCode}
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={handleCopy}
              className={`rounded-2xl border px-5 py-3 text-sm font-black uppercase tracking-[0.18em] transition-colors ${
                accent === "gold" || accent === "gold-final"
                  ? "border-amber-300/70 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                  : "border-cyan-400/70 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
              }`}
            >
              {copied ? "Copied ✓" : "Copy code"}
            </button>
            {canShare ? (
              <button
                type="button"
                onClick={handleShare}
                className="rounded-2xl border border-white/30 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
              >
                Share
              </button>
            ) : null}
          </div>

          <div
            className={`mt-7 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] ${accentGlow}`}
            aria-hidden
          >
            <span
              className={`p444-waiting-ring inline-flex h-2 w-2 rounded-full ${
                accent === "gold" || accent === "gold-final"
                  ? "bg-amber-300"
                  : "bg-cyan-300"
              }`}
            />
            Listening for opponent
          </div>

          {onCancel ? (
            <div className="mt-6">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Cancel and return to lobby
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function OpponentJoinedStage({
  accent,
  myName,
  opponentName,
}: {
  accent: PresentationAccent;
  myName?: string;
  opponentName?: string;
}) {
  const accentClass =
    accent === "gold" || accent === "gold-final"
      ? "text-amber-200 drop-shadow-[0_0_24px_rgba(251,191,36,0.45)]"
      : "text-cyan-200 drop-shadow-[0_0_24px_rgba(56,189,248,0.45)]";

  return (
    <div className="p444-opponent-joined w-full max-w-lg text-center">
      <p className="text-[11px] font-black uppercase tracking-[0.36em] text-white/70">
        Match found
      </p>
      <h2
        className={`mt-3 break-words text-4xl font-black uppercase tracking-tight sm:text-5xl md:text-6xl ${accentClass}`}
      >
        Opponent joined
      </h2>
      {myName || opponentName ? (
        <p className="mt-3 text-sm font-bold text-zinc-300 sm:text-base">
          {(myName ?? "You")}
          <span className="mx-2 text-zinc-600">vs</span>
          {opponentName ?? "Opponent"}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Waiting for opponent to return" — shown to the PRESENT player when
 * the server has armed a `match:waitingForReturn` window because the
 * opponent is currently absent (not on the match page).
 *
 * Mirrors the cinematic style of the other stages but never displays
 * the room code (this player already passed the share step) and shows
 * the live server-driven countdown.
 */
function WaitingForReturnStage({
  accent,
  absentPlayerName,
  secondsRemaining,
}: {
  accent: PresentationAccent;
  absentPlayerName?: string;
  secondsRemaining: number | null;
}) {
  const accentRing =
    accent === "gold" || accent === "gold-final"
      ? "border-amber-300/55 shadow-[0_0_38px_rgba(251,191,36,0.22)]"
      : "border-cyan-400/55 shadow-[0_0_38px_rgba(56,189,248,0.22)]";

  const accentEyebrow =
    accent === "gold" || accent === "gold-final"
      ? "text-amber-300/90"
      : "text-cyan-300/90";

  const accentNumber =
    accent === "gold" || accent === "gold-final"
      ? "text-amber-200 drop-shadow-[0_0_24px_rgba(251,191,36,0.45)]"
      : "text-cyan-200 drop-shadow-[0_0_24px_rgba(56,189,248,0.45)]";

  const display = secondsRemaining === null ? null : Math.max(0, secondsRemaining);
  const opponentLabel = absentPlayerName ?? "Opponent";

  return (
    <div
      className={`p444-waiting-card w-full max-w-lg rounded-3xl border bg-zinc-950/90 px-6 py-8 text-center shadow-2xl sm:px-8 sm:py-10 ${accentRing}`}
    >
      <span
        className={`p444-waiting-ring inline-flex h-3 w-3 rounded-full ${
          accent === "gold" || accent === "gold-final" ? "bg-amber-300" : "bg-cyan-300"
        }`}
        aria-hidden
      />
      <p
        className={`mt-4 text-[11px] font-black uppercase tracking-[0.32em] ${accentEyebrow}`}
      >
        Opponent stepped away
      </p>
      <h2 className="mt-2 break-words text-2xl font-black text-white sm:text-3xl">
        Waiting for {opponentLabel} to return
      </h2>
      <p className="mt-3 text-sm text-zinc-400 sm:text-base">
        Your gameplay timer is paused. We've alerted them to come back.
      </p>

      {display !== null ? (
        <div className="mt-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-zinc-500">
            Auto-cancels in
          </p>
          <p
            key={display}
            className={`p444-countdown-digit mt-2 text-[5rem] font-black tabular-nums leading-none sm:text-[6rem] ${accentNumber}`}
            aria-live="assertive"
          >
            {display}s
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            If they don't return in time, the match is cancelled with no penalty.
          </p>
        </div>
      ) : (
        <p className="mt-7 text-sm text-zinc-400">Any moment now…</p>
      )}
    </div>
  );
}

function CountdownStage({
  seconds,
  accent,
  myName,
  opponentName,
}: {
  seconds: number;
  accent: PresentationAccent;
  myName?: string;
  opponentName?: string;
}) {
  const accentClass =
    accent === "gold" || accent === "gold-final"
      ? "text-amber-200 drop-shadow-[0_0_36px_rgba(251,191,36,0.55)]"
      : "text-cyan-100 drop-shadow-[0_0_36px_rgba(56,189,248,0.55)]";

  return (
    <div className="w-full max-w-lg text-center">
      <p className="text-[11px] font-black uppercase tracking-[0.36em] text-white/70">
        Match starting in
      </p>
      <p
        key={seconds}
        className={`p444-countdown-digit mt-2 text-[8rem] font-black tabular-nums leading-none sm:text-[10rem] md:text-[12rem] ${accentClass}`}
        aria-live="assertive"
      >
        {seconds}
      </p>
      {myName || opponentName ? (
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.22em] text-zinc-300">
          {(myName ?? "You")}
          <span className="mx-2 text-zinc-600">vs</span>
          {opponentName ?? "Opponent"}
        </p>
      ) : null}
    </div>
  );
}
