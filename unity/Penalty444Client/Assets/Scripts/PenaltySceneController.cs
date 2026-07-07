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
                    resultAnimator?.PlaySave();
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

        private static void SetText(Text target, string value)
        {
            if (target != null) target.text = value;
        }
    }
}
