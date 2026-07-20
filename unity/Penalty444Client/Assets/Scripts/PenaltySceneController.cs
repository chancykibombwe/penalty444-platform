// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// Owns ONLY visual scene state for the Penalty444Prototype scene. Every method
// here is presentation: it moves placeholders, tints lane markers, and updates
// debug/UI text. It holds no match logic, no timers that decide anything, no
// scores of record — the Node realtime server already resolved everything this
// controller is asked to display.

using UnityEngine;
using UnityEngine.UI;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Visual state machine for the prototype scene:
    /// Idle → Staging → Revealing → Result → (Ended | back to Staging).
    /// Driven purely by <see cref="UnityBridgeReceiver"/> events.
    /// </summary>
    public sealed class PenaltySceneController : MonoBehaviour
    {
        [Header("Actor placeholders")]
        [SerializeField] private Transform kickerPlaceholder;
        [SerializeField] private Transform keeperPlaceholder;
        [SerializeField] private Transform ballPlaceholder;

        [Header("Lane targets")]
        [SerializeField] private LaneTarget leftLaneTarget;
        [SerializeField] private LaneTarget centerLaneTarget;
        [SerializeField] private LaneTarget rightLaneTarget;

        [Header("UI (visual/debug only)")]
        [SerializeField] private Text scoreboardText;
        [SerializeField] private Text roundStatusText;
        [SerializeField] private Text resultBannerText;

        [Header("Animation")]
        [SerializeField] private ResultAnimator resultAnimator;

        /// <summary>Current visual state. Read-only outside this controller.</summary>
        public PenaltyVisualState State { get; private set; } = PenaltyVisualState.Idle;

        // Purely visual round counter for the debug scoreboard. NOT a score of
        // record — the authoritative scores live on the realtime server.
        private int visualRoundCounter;

        private void Start()
        {
            ResetScene();
        }

        /// <summary>Return every visual element to its idle baseline.</summary>
        public void ResetScene()
        {
            State = PenaltyVisualState.Idle;
            visualRoundCounter = 0;

            ResetAllLanes();
            resultAnimator?.PlayReset();

            SetText(scoreboardText, "— : —");
            SetText(roundStatusText, "Waiting…");
            SetText(resultBannerText, string.Empty);

            Debug.Log("[PenaltySceneController] Scene reset to Idle.");
        }

        /// <summary>Enter the pre-round staging look (players set, lanes idle).</summary>
        public void BeginStaging()
        {
            State = PenaltyVisualState.Staging;

            ResetAllLanes();
            // Restore the ball/keeper to their idle poses from the previous
            // round's result animation before the "Get ready…" pose is shown.
            // This does NOT call ResetScene() and does NOT reset the visual round
            // counter — only the actor poses are cleaned up. No timer, no logic.
            resultAnimator?.PlayReset();
            SetText(roundStatusText, "Get ready…");
            SetText(resultBannerText, string.Empty);

            Debug.Log("[PenaltySceneController] Staging.");
        }

        /// <summary>
        /// Animate an already-resolved round. The kicker lane, keeper lane, and
        /// result arrive fully decided by the server; this only visualizes them.
        /// </summary>
        public void ShowRoundResult(PenaltyLane kickerLane, PenaltyLane keeperLane, PenaltyVisualResult result)
        {
            State = PenaltyVisualState.Revealing;
            visualRoundCounter++;

            ResetAllLanes();
            GetLaneTarget(keeperLane)?.SetSelected();

            var kickerTarget = GetLaneTarget(kickerLane);
            if (result == PenaltyVisualResult.GOAL) kickerTarget?.SetSuccess();
            else kickerTarget?.SetFailed();

            switch (result)
            {
                case PenaltyVisualResult.GOAL:
                    resultAnimator?.PlayGoal();
                    SetText(roundStatusText, $"Round {visualRoundCounter}: GOAL!");
                    break;
                case PenaltyVisualResult.SAVE:
                    // Pass the keeper's dive lane as a display-only direction hint
                    // so the placeholder save leans toward the shot. Not authority.
                    resultAnimator?.PlaySave(LaneDirection(keeperLane));
                    SetText(roundStatusText, $"Round {visualRoundCounter}: SAVED!");
                    break;
                case PenaltyVisualResult.DRAW:
                    resultAnimator?.PlayDraw();
                    SetText(roundStatusText, $"Round {visualRoundCounter}: DRAW");
                    break;
            }

            State = PenaltyVisualState.Result;
            Debug.Log($"[PenaltySceneController] Round shown: kicker={kickerLane} keeper={keeperLane} result={result}");
        }

        // ── B6D2B: versioned Protocol v1 presentation (authoritative round) ──
        // These methods consume the already-resolved B6D1 Protocol v1 state. They
        // display ONLY what the server/React decided: the versioned round number,
        // the supplied result, and the authoritative numeric scores. Unity never
        // derives a result from the lanes, never computes or increments a score,
        // and never decides the round/phase/winner/sudden-death progression.

        /// <summary>
        /// B6D2B — animate an already-resolved round using the AUTHORITATIVE
        /// versioned <paramref name="round"/> from the Protocol v1 envelope (NOT
        /// the local visual counter). Presentation only; no score is touched.
        /// </summary>
        public void ShowRoundResultVersioned(
            long round,
            PenaltyLane kickerLane,
            PenaltyLane keeperLane,
            PenaltyVisualResult result,
            string statusMessage)
        {
            State = PenaltyVisualState.Revealing;

            ResetAllLanes();
            GetLaneTarget(keeperLane)?.SetSelected();

            var kickerTarget = GetLaneTarget(kickerLane);
            if (result == PenaltyVisualResult.GOAL) kickerTarget?.SetSuccess();
            else kickerTarget?.SetFailed();

            // Optional bounded presentation text takes precedence when supplied.
            bool hasStatus = !string.IsNullOrEmpty(statusMessage);

            switch (result)
            {
                case PenaltyVisualResult.GOAL:
                    resultAnimator?.PlayGoal();
                    SetText(roundStatusText, hasStatus ? statusMessage : $"Round {round}: GOAL!");
                    break;
                case PenaltyVisualResult.SAVE:
                    resultAnimator?.PlaySave(LaneDirection(keeperLane));
                    SetText(roundStatusText, hasStatus ? statusMessage : $"Round {round}: SAVED!");
                    break;
                case PenaltyVisualResult.DRAW:
                    resultAnimator?.PlayDraw();
                    SetText(roundStatusText, hasStatus ? statusMessage : $"Round {round}: DRAW");
                    break;
            }

            State = PenaltyVisualState.Result;
            Debug.Log($"[PenaltySceneController] Versioned round shown: round={round} result={result}");
        }

        /// <summary>
        /// B6D2B — apply an authoritative match_state_sync snapshot as
        /// presentation-only scoreboard/round/phase text. Copies the supplied
        /// state; updates <c>scoreboardText</c> and <c>roundStatusText</c>; plays
        /// NO result animation; alters NO React/server state; submits nothing.
        ///
        /// The scoreboard is intentionally IDENTITY-NEUTRAL: it shows the numeric
        /// score values in a deterministic order but never which visual side
        /// belongs to which player (a player-facing scoreboard is unauthorized
        /// until B6D3 review).
        /// </summary>
        public void ApplyMatchStateSyncVersioned(
            long[] scoreValuesOrdered,
            int playerCount,
            long round,
            long maxRounds,
            string phase,
            bool hasSuddenDeathRound,
            long suddenDeathRound)
        {
            // Copy the supplied values into a local buffer (never retain the caller
            // reference) — presentation state only.
            int count = scoreValuesOrdered != null ? scoreValuesOrdered.Length : 0;
            var localScores = new long[count];
            for (int i = 0; i < count; i++) localScores[i] = scoreValuesOrdered[i];

            var scoreSb = new System.Text.StringBuilder("Scores: ");
            for (int i = 0; i < localScores.Length; i++)
            {
                if (i > 0) scoreSb.Append(" / ");
                scoreSb.Append(localScores[i].ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
            SetText(scoreboardText, scoreSb.ToString());

            string roundLine = $"Round {round} / {maxRounds} \u00B7 {phase}";
            if (phase == "SUDDEN_DEATH" && hasSuddenDeathRound)
            {
                roundLine += $" (SD {suddenDeathRound})";
            }
            SetText(roundStatusText, roundLine);

            State = PenaltyVisualState.Staging;
            Debug.Log($"[PenaltySceneController] State sync applied: players={playerCount} round={round}/{maxRounds} phase={phase}");
        }

        /// <summary>Play the match-end presentation (banner text + reset lanes).</summary>
        public void ShowMatchEnd(bool isDraw)
        {
            State = PenaltyVisualState.Ended;

            ResetAllLanes();
            if (isDraw)
            {
                resultAnimator?.PlayDraw();
                SetText(resultBannerText, "MATCH DRAW");
            }
            else
            {
                resultAnimator?.PlayGoal();
                SetText(resultBannerText, "MATCH OVER");
            }
            SetText(roundStatusText, "Match ended");

            Debug.Log($"[PenaltySceneController] Match end shown (isDraw={isDraw}).");
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        private void ResetAllLanes()
        {
            leftLaneTarget?.SetIdle();
            centerLaneTarget?.SetIdle();
            rightLaneTarget?.SetIdle();
        }

        private LaneTarget GetLaneTarget(PenaltyLane lane)
        {
            switch (lane)
            {
                case PenaltyLane.LEFT: return leftLaneTarget;
                case PenaltyLane.CENTER: return centerLaneTarget;
                case PenaltyLane.RIGHT: return rightLaneTarget;
                default: return null;
            }
        }

        // Display-only horizontal hint for the save lean: LEFT = −1, CENTER = 0,
        // RIGHT = +1. Carries no authority; it only shapes the placeholder tween.
        private static float LaneDirection(PenaltyLane lane)
        {
            switch (lane)
            {
                case PenaltyLane.LEFT: return -1f;
                case PenaltyLane.RIGHT: return 1f;
                default: return 0f;
            }
        }

        private static void SetText(Text target, string value)
        {
            if (target != null) target.text = value;
        }
    }
}
