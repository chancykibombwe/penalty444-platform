// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// FUTURE React→Unity message entry point (mock/local-only in B2).
//
// Authority rules (non-negotiable, see docs/unity-webgl-prototype-plan.md §2):
//   - The Node realtime server is the single source of truth for all match
//     logic and results. Everything this receiver handles is ALREADY resolved.
//   - This script opens NO sockets and makes NO network calls.
//   - It reads NO auth data, NO JWTs, NO tokens, NO env secrets, NO wallet data.
//   - It never computes official results, never submits picks, never writes
//     stats or match results.
//
// In B2 the only callers are local/dev mock methods (invoked manually from the
// Unity Editor via context menus, or by a future dev harness). The real
// React→Unity postMessage wiring is a later phase and will call the same
// public methods with server-resolved payloads.

using UnityEngine;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Receives (mock) match presentation events and dispatches them to the
    /// <see cref="PenaltySceneController"/>. Presentation only — no authority.
    /// </summary>
    public sealed class UnityBridgeReceiver : MonoBehaviour
    {
        [Tooltip("Scene controller that owns all visual state. Required.")]
        [SerializeField] private PenaltySceneController sceneController;

        // ── Public bridge methods (future React→Unity entry points) ─────────
        // Each method corresponds to one PENALTY444_MATCH_EVENT from the plan
        // (§3): staging_begin, round_result, match_end, reset. Payload fields
        // are passed as plain values here; JSON parsing/validation of real
        // postMessage payloads is a later phase.

        /// <summary>Mirror of the "staging_begin" event — pre-round staging.</summary>
        public void OnStagingBegin()
        {
            if (!HasController("staging_begin")) return;
            sceneController.BeginStaging();
        }

        /// <summary>
        /// Mirror of the "round_result" event — animate an already-resolved
        /// round. The lanes and result arrive fully decided; Unity only shows them.
        /// </summary>
        public void OnRoundResult(PenaltyLane kickerLane, PenaltyLane keeperLane, PenaltyVisualResult result)
        {
            if (!HasController("round_result")) return;
            sceneController.ShowRoundResult(kickerLane, keeperLane, result);
        }

        /// <summary>Mirror of the "match_end" event — play the end sequence.</summary>
        public void OnMatchEnd(bool isDraw)
        {
            if (!HasController("match_end")) return;
            sceneController.ShowMatchEnd(isDraw);
        }

        /// <summary>Mirror of the "reset" event — return the scene to idle.</summary>
        public void OnReset()
        {
            if (!HasController("reset")) return;
            sceneController.ResetScene();
        }

        // ── Editor-only mock triggers (local testing without any web app) ────
        // Right-click the component header in the Inspector to fire these.

        [ContextMenu("Mock/staging_begin")]
        private void MockStagingBegin() => OnStagingBegin();

        [ContextMenu("Mock/round_result — LEFT vs RIGHT → GOAL")]
        private void MockRoundResultGoal() =>
            OnRoundResult(PenaltyLane.LEFT, PenaltyLane.RIGHT, PenaltyVisualResult.GOAL);

        [ContextMenu("Mock/round_result — CENTER vs CENTER → SAVE")]
        private void MockRoundResultSave() =>
            OnRoundResult(PenaltyLane.CENTER, PenaltyLane.CENTER, PenaltyVisualResult.SAVE);

        [ContextMenu("Mock/round_result — LEFT vs LEFT → SAVE (directional)")]
        private void MockRoundResultSaveLeft() =>
            OnRoundResult(PenaltyLane.LEFT, PenaltyLane.LEFT, PenaltyVisualResult.SAVE);

        [ContextMenu("Mock/round_result — RIGHT vs RIGHT → SAVE (directional)")]
        private void MockRoundResultSaveRight() =>
            OnRoundResult(PenaltyLane.RIGHT, PenaltyLane.RIGHT, PenaltyVisualResult.SAVE);

        [ContextMenu("Mock/round_result — CENTER vs CENTER → DRAW")]
        private void MockRoundResultDraw() =>
            OnRoundResult(PenaltyLane.CENTER, PenaltyLane.CENTER, PenaltyVisualResult.DRAW);

        [ContextMenu("Mock/match_end — winner")]
        private void MockMatchEndWinner() => OnMatchEnd(isDraw: false);

        [ContextMenu("Mock/match_end — draw")]
        private void MockMatchEndDraw() => OnMatchEnd(isDraw: true);

        [ContextMenu("Mock/reset")]
        private void MockReset() => OnReset();

        private bool HasController(string eventName)
        {
            if (sceneController != null) return true;
            Debug.LogWarning($"[UnityBridgeReceiver] Ignoring '{eventName}' — no PenaltySceneController assigned.");
            return false;
        }
    }
}
