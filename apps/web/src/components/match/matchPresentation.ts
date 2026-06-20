/**
 * Shared presentation primitives for the match UI.
 *
 * IMPORTANT: This file is presentation-only. It must NEVER contain gameplay
 * rules, scoring logic, socket calls, or tournament advancement decisions.
 *
 * The match room (`MatchRoomPanel`) and reusable overlays (`MatchStagingScreen`,
 * `MatchResultOverlay`, `RoundTransition`, `MatchScoreboard`,
 * `MatchAtmosphereLayer`) share these helpers so the cinematic vocabulary
 * stays consistent across casual, tournament, and (future) ranked modes.
 */

export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type Role = "KICKER" | "KEEPER";
export type ShotResult = "GOAL" | "SAVE" | "DRAW";
export type MatchPhase = "NORMAL" | "SUDDEN_DEATH";
export type RevealStage = "IDLE" | "LOCKED" | "REVEALING" | "REVEALED";

export const LANES: Lane[] = ["LEFT", "CENTER", "RIGHT"];

/**
 * Hotfix Sprint TASK 4: client-side defence-in-depth runtime check.
 *
 * The realtime server is the authoritative validator (see
 * `apps/realtime-server/src/security/validation.ts`); this client
 * helper exists so we can fail FAST in the UI rather than emit a
 * doomed `match:pick` and surface the rejection as a confusing UX
 * stall. Server is still the source of truth — bypassing this check
 * client-side gains nothing because the server rejects the same
 * invalid lane.
 */
export function isValidLane(value: unknown): value is Lane {
  if (typeof value !== "string") return false;
  return (LANES as readonly string[]).includes(value);
}

/**
 * Presentation accent. We default to a cyan/blue stadium theme and switch
 * to gold for tournament context. Final matches use a richer gold variant.
 */
export type PresentationAccent = "cyan" | "gold" | "gold-final";

/**
 * Pacing constants for the dramatic reveal flow. Server-side timing is
 * untouched — these only control how the client *presents* the result.
 *
 * Flow:
 *   pick → LOCKED (PICK LOCKED pill)
 *   → match:result arrives
 *   → REVEALING (3–2–1 tension window)  ← MATCH_TENSION_*_MS
 *   → REVEALED (result on screen)
 *   → next match:update is held         ← MATCH_REVEAL_HOLD_*_MS (both modes)
 *
 * The hold lets the REVEALED stage actually paint before the server's
 * next-round `match:update` arrives. Without it, casual REVEALED lasted
 * only the network round-trip because client tension (3000ms) and the
 * server's `RESULT_REVEAL_PAUSE_MS` (3000ms) completed on the same frame,
 * so the GOAL/SAVE/DRAW headline was barely visible. Tournament has
 * always had a longer hold for cinematic pacing.
 */
export const MATCH_TENSION_CASUAL_MS = 3000;
export const MATCH_TENSION_TOURNAMENT_MS = 1500;
/**
 * Minimum time the casual result stays on screen after the REVEALING
 * tension window completes. Targets ~1.5s of stable REVEALED state
 * before the next round resets local state. Kept conservative so the
 * combined "both locked → next round" feel stays under ~5s end-to-end.
 */
export const MATCH_REVEAL_HOLD_CASUAL_MS = 1_500;
export const MATCH_REVEAL_HOLD_TOURNAMENT_MS = 4_000;
export const MATCH_STAGING_SECONDS_TOURNAMENT = 5;
export const ROUND_TRANSITION_VISIBLE_MS = 1_400;
export const RESULT_OVERLAY_VISIBLE_MS = 1200;

const GOAL_MESSAGES = [
  "Clinical finish.",
  "Keeper went the wrong way.",
  "Buried with confidence.",
  "No chance for the keeper.",
] as const;

const SAVE_MESSAGES = [
  "Keeper read it.",
  "Big stop.",
  "Denied.",
  "Perfect guess.",
] as const;

const DRAW_MESSAGES = [
  "No advantage.",
  "Both froze.",
  "Reset and go again.",
  "Nothing separates them.",
] as const;

export function pickResultFlavorMessage(result: ShotResult): string {
  const pool =
    result === "GOAL"
      ? GOAL_MESSAGES
      : result === "SAVE"
        ? SAVE_MESSAGES
        : DRAW_MESSAGES;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

export function laneEmoji(lane: Lane): string {
  if (lane === "LEFT") return "↙";
  if (lane === "CENTER") return "⬆";
  return "↘";
}

export function resultLabel(result?: ShotResult | null): string {
  if (result === "GOAL") return "GOAL!";
  if (result === "SAVE") return "SAVED!";
  if (result === "DRAW") return "DRAW";
  return "Waiting for result";
}

export function resultSubheadline(result?: ShotResult | null): string {
  if (result === "GOAL") return "Net found — kicker wins the round.";
  if (result === "SAVE") return "Keeper read it — no goal.";
  if (result === "DRAW") return "Even round — no advantage.";
  return "";
}

export function resultEmoji(result?: ShotResult | null): string {
  if (result === "GOAL") return "⚽";
  if (result === "SAVE") return "🧤";
  if (result === "DRAW") return "·";
  return "";
}

export function resultBackgroundClass(result?: ShotResult | null): string {
  if (result === "GOAL") {
    return "border-emerald-400/80 bg-emerald-500/15 text-emerald-100 shadow-[0_0_36px_rgba(52,211,153,0.22)]";
  }
  if (result === "SAVE") {
    return "border-sky-400/80 bg-sky-500/15 text-sky-100 shadow-[0_0_36px_rgba(56,189,248,0.22)]";
  }
  if (result === "DRAW") {
    return "border-yellow-400/80 bg-yellow-500/15 text-yellow-100 shadow-[0_0_32px_rgba(250,204,21,0.18)]";
  }
  return "border-zinc-800 bg-zinc-900 text-white";
}

export function resultHeadlineClass(
  result?: ShotResult | null,
  revealStage?: RevealStage
): string {
  if (revealStage === "REVEALING") {
    return "match-result-reveal-active text-white";
  }
  if (result === "GOAL") return "match-result-headline-goal text-emerald-100";
  if (result === "SAVE") return "match-result-headline-save text-sky-100";
  if (result === "DRAW") return "match-result-headline-draw text-yellow-100";
  return "text-white";
}

export function accentForContext(options: {
  isTournament: boolean;
  isFinal: boolean;
}): PresentationAccent {
  if (options.isFinal) return "gold-final";
  if (options.isTournament) return "gold";
  return "cyan";
}

/**
 * Centralized keyframes / utility classes. Mount this once at the top of
 * `MatchRoomPanel` (or wherever a match-style screen renders) so every
 * cinematic component can rely on the same animation vocabulary.
 *
 * Kept inline as a string so we don't introduce a stylesheet build step
 * and so the animations only ship when a match screen mounts.
 */
export const MATCH_PRESENTATION_CSS = `
@keyframes p444StagingBackdrop{from{opacity:0}to{opacity:1}}
@keyframes p444StagingCard{0%{opacity:0;transform:translateY(14px) scale(0.96)}60%{opacity:1;transform:translateY(0) scale(1.005)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes p444StagingCount{0%{opacity:0;transform:scale(0.55)}25%{opacity:1;transform:scale(1.08)}70%{opacity:1;transform:scale(1)}100%{opacity:0.7;transform:scale(0.9)}}
@keyframes p444StagingVs{0%{opacity:0;transform:scale(0.9)}40%{opacity:1;transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}
@keyframes p444StagingGlow{0%,100%{opacity:0.55}50%{opacity:1}}
@keyframes p444TournamentIntroSlide{0%{opacity:0;transform:translateY(-6px)}15%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
@keyframes p444RoundTransitionIn{0%{opacity:0;transform:translateY(-12px) scale(0.94)}25%{opacity:1;transform:translateY(0) scale(1.02)}75%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(6px) scale(0.98)}}
@keyframes p444ResultBurst{0%{opacity:0;transform:scale(0.6)}30%{opacity:1;transform:scale(1.08)}70%{opacity:0.85;transform:scale(1)}100%{opacity:0;transform:scale(1.04)}}
@keyframes p444ScreenShake{0%,100%{transform:translate3d(0,0,0)}15%{transform:translate3d(-10px,0,0)}30%{transform:translate3d(10px,0,0)}45%{transform:translate3d(-8px,0,0)}60%{transform:translate3d(8px,0,0)}75%{transform:translate3d(-4px,0,0)}90%{transform:translate3d(4px,0,0)}}
@keyframes p444TimerUrgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.45),0 0 24px rgba(248,113,113,0.18)}50%{box-shadow:0 0 0 10px rgba(248,113,113,0),0 0 36px rgba(248,113,113,0.42)}}
@keyframes p444TimerUrgentScale{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes p444TimerAlmostDonePulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.65),0 0 28px rgba(239,68,68,0.28)}50%{box-shadow:0 0 0 12px rgba(239,68,68,0),0 0 44px rgba(239,68,68,0.55)}}
@keyframes p444TensionDigit{0%{opacity:0;transform:scale(0.55) translateY(10px)}70%{opacity:1;transform:scale(1.08) translateY(0)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes p444SuddenDeathTimerGlow{0%,100%{box-shadow:0 0 18px rgba(250,204,21,0.18),inset 0 0 18px rgba(250,204,21,0.08)}50%{box-shadow:0 0 30px rgba(250,204,21,0.34),inset 0 0 24px rgba(250,204,21,0.12)}}
@keyframes p444GoalFlash{0%{box-shadow:0 0 0 0 rgba(52,211,153,0.55)}100%{box-shadow:0 0 0 18px rgba(52,211,153,0)}}
@keyframes p444SaveFlash{0%{box-shadow:0 0 0 0 rgba(56,189,248,0.55)}100%{box-shadow:0 0 0 16px rgba(56,189,248,0)}}
@keyframes p444DrawFlash{0%{box-shadow:0 0 0 0 rgba(212,212,216,0.45)}100%{box-shadow:0 0 0 14px rgba(212,212,216,0)}}
@keyframes p444ResultReveal{0%{opacity:0.45;transform:translateY(10px) scale(0.98)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes p444ScorePulse{0%{transform:scale(1)}35%{transform:scale(1.3)}100%{transform:scale(1)}}
@keyframes p444WaitingDot{0%,80%,100%{opacity:0.25;transform:scale(0.85)}40%{opacity:1;transform:scale(1.05)}}
@keyframes p444PickLockedPulse{0%,100%{opacity:0.85;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
@keyframes p444KickerBadgePulse{0%,100%{box-shadow:0 0 0 0 rgba(56,189,248,0.0)}50%{box-shadow:0 0 0 6px rgba(56,189,248,0.18)}}
@keyframes p444AtmosphereSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}

.p444-staging-overlay{animation:p444StagingBackdrop 0.22s ease-out forwards}
.p444-staging-card{animation:p444StagingCard 0.4s cubic-bezier(0.22,1,0.36,1) forwards}
.p444-staging-count{animation:p444StagingCount 1s ease-out forwards}
.p444-staging-vs{animation:p444StagingVs 0.6s cubic-bezier(0.22,1,0.36,1) forwards}
.p444-staging-glow{animation:p444StagingGlow 2.4s ease-in-out infinite}
.p444-tournament-intro-pill{animation:p444TournamentIntroSlide 3s ease-out forwards}
.p444-round-transition{animation:p444RoundTransitionIn ${ROUND_TRANSITION_VISIBLE_MS}ms ease-out forwards}
.p444-result-burst{animation:p444ResultBurst ${RESULT_OVERLAY_VISIBLE_MS}ms ease-out forwards}
.p444-pick-locked-pulse{animation:p444PickLockedPulse 1.5s ease-in-out infinite}
.p444-kicker-badge-pulse{animation:p444KickerBadgePulse 2s ease-in-out infinite}
.match-timer-urgent{animation:p444TimerUrgentPulse 1s ease-in-out infinite,p444TimerUrgentScale 1s ease-in-out infinite}
.match-timer-almost-done{animation:p444TimerAlmostDonePulse 0.45s ease-in-out infinite,p444TimerUrgentScale 0.45s ease-in-out infinite}
.p444-tension-digit{animation:p444TensionDigit 0.28s cubic-bezier(0.34,1.56,0.64,1) both}
.match-timer-sudden-death{animation:p444SuddenDeathTimerGlow 1.4s ease-in-out infinite}
.goal-flash{animation:p444GoalFlash 0.6s ease-out}
.save-flash{animation:p444SaveFlash 0.6s ease-out}
.draw-flash{animation:p444DrawFlash 0.5s ease-out}
.match-screen-shake{animation:p444ScreenShake 0.6s ease-in-out}
.match-result-reveal-active{animation:p444ResultReveal 0.9s ease-out infinite alternate}
.match-result-reveal-done{animation:p444ResultReveal 0.45s ease-out}
.match-result-headline-goal{text-shadow:0 0 24px rgba(52,211,153,0.45)}
.match-result-headline-save{text-shadow:0 0 24px rgba(56,189,248,0.42)}
.match-result-headline-draw{text-shadow:0 0 22px rgba(250,204,21,0.34)}
.match-score-pulse{animation:p444ScorePulse 0.45s cubic-bezier(0.22,1,0.36,1)}
.match-waiting-dots{display:inline-flex;align-items:center;gap:3px}
.match-waiting-dot{display:inline-block;width:5px;height:5px;border-radius:9999px;background:currentColor;animation:p444WaitingDot 1.2s ease-in-out infinite}
.match-waiting-dot:nth-child(2){animation-delay:0.18s}
.match-waiting-dot:nth-child(3){animation-delay:0.36s}
.match-lane-ready{transition:transform 180ms ease,box-shadow 180ms ease,background-color 180ms ease,border-color 180ms ease,color 180ms ease}
.p444-atmosphere-orb{animation:p444AtmosphereSpin 60s linear infinite}
`;

/**
 * Returns the round transition kind for the new round, or `null` if no
 * transition should be shown.
 *
 * - Round 1 of normal play: ROUND_1
 * - The last "regular" round (== maxRounds * 2): FINAL_SHOT
 * - First sudden-death round: SUDDEN_DEATH
 * - Any other round change: ROUND_X (subtle)
 */
export function classifyRoundTransition(options: {
  newRound: number;
  prevRound: number | null;
  maxRounds: number;
  phase: MatchPhase;
  prevPhase: MatchPhase;
}): { kind: "ROUND_1" | "ROUND_X" | "FINAL_SHOT" | "SUDDEN_DEATH"; label: string; sublabel?: string } | null {
  const { newRound, prevRound, maxRounds, phase, prevPhase } = options;

  if (prevRound === newRound) return null;

  if (phase === "SUDDEN_DEATH" && prevPhase !== "SUDDEN_DEATH") {
    return {
      kind: "SUDDEN_DEATH",
      label: "SUDDEN DEATH",
      sublabel: "One mistake decides it.",
    };
  }

  const normalTurns = maxRounds * 2;

  if (newRound === 1 && (prevRound === null || prevRound > newRound)) {
    return { kind: "ROUND_1", label: "Round 1" };
  }

  if (phase === "NORMAL" && newRound === normalTurns) {
    return {
      kind: "FINAL_SHOT",
      label: "Final Shot",
      sublabel: "Last chance to swing it.",
    };
  }

  if (phase === "SUDDEN_DEATH") {
    return null;
  }

  if (newRound > 1 && newRound <= normalTurns) {
    return {
      kind: "ROUND_X",
      label: `Round ${Math.ceil(newRound / 2)}`,
    };
  }

  return null;
}

export type MatchEndOutcome = "victory" | "defeat" | "draw";

export function getPostMatchPresentation(options: {
  outcome: MatchEndOutcome;
  isTournament: boolean;
  isFinal: boolean;
  opponentName: string;
  roundLabel?: string | null;
}): { eyebrow: string; headline: string; subline: string; progression?: string } {
  const { outcome, isTournament, isFinal, opponentName, roundLabel } = options;

  if (isTournament) {
    if (outcome === "victory") {
      if (isFinal) {
        return {
          eyebrow: "Tournament complete",
          headline: "CHAMPION",
          subline: `You beat ${opponentName} to win the title.`,
          progression: "Crown secured.",
        };
      }
      const progression =
        roundLabel && /semi/i.test(roundLabel)
          ? "ADVANCING TO THE FINAL"
          : roundLabel
            ? `ADVANCING — ${roundLabel.toUpperCase()} COMPLETE`
            : "ADVANCING TO THE NEXT ROUND";
      return {
        eyebrow: "Tournament result",
        headline: "VICTORY",
        subline: `You beat ${opponentName}.`,
        progression,
      };
    }
    if (outcome === "defeat") {
      return {
        eyebrow: "Tournament result",
        headline: "ELIMINATED",
        subline: isFinal
          ? `${opponentName} took the final. Great run.`
          : `${opponentName} ended your run.`,
        progression: "YOU WERE ELIMINATED",
      };
    }
    return {
      eyebrow: "Tournament result",
      headline: "DRAW",
      subline: "Match split. Returning to tournament.",
    };
  }

  if (outcome === "victory") {
    return {
      eyebrow: "Match complete",
      headline: "VICTORY",
      subline: `You outscored ${opponentName}.`,
    };
  }
  if (outcome === "defeat") {
    return {
      eyebrow: "Match complete",
      headline: "DEFEAT",
      subline: `${opponentName} took this one.`,
    };
  }
  return {
    eyebrow: "Match complete",
    headline: "DRAW",
    subline: "Nothing separated both players.",
  };
}
