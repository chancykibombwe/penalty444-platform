// Penalty444 — React → Unity mock event bridge (Phase B4).
//
// Authority rules (non-negotiable, see docs/unity-webgl-prototype-plan.md §2):
//   - The Node realtime server is the single source of truth for all match
//     logic and results. Everything this receiver handles is ALREADY resolved.
//   - This script opens NO sockets and makes NO network calls.
//   - It reads NO auth data, NO JWTs, NO tokens, NO env secrets, NO wallet data.
//   - It never computes official results, never compares lanes, never submits
//     picks, and never writes stats or match results.
//
// Two input paths, both presentation-only:
//   1. Editor: the [ContextMenu] mock methods (unchanged).
//   2. WebGL: the browser bridge (Penalty444WebBridge.jslib) validates the
//      postMessage origin/source, then calls OnWebMessage(json) with the full
//      PENALTY444_MATCH_EVENT envelope. We parse the presentation fields and
//      dispatch to the same public methods the mocks use.

using System;
using System.Runtime.InteropServices;
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

#if UNITY_WEBGL && !UNITY_EDITOR
        // Implemented in Assets/Plugins/WebGL/Penalty444WebBridge.jslib.
        [DllImport("__Internal")]
        private static extern void Penalty444RegisterWebBridge(string gameObjectName);

        [DllImport("__Internal")]
        private static extern void Penalty444UnregisterWebBridge();
#endif

        private void Start()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // Register the browser postMessage bridge. gameObject.name is passed
            // so the plugin targets THIS object via SendMessage without a
            // hard-coded name. The plugin validates origin/source, forwards
            // envelopes to OnWebMessage, then posts the "ready" event upward.
            try
            {
                Penalty444RegisterWebBridge(gameObject.name);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UnityBridgeReceiver] Web bridge registration failed: {e.Message}");
            }
#endif
        }

        private void OnDestroy()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // Remove the browser message listener the bridge registered, so a
            // scene reload / teardown does not leave a stale listener behind.
            try
            {
                Penalty444UnregisterWebBridge();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UnityBridgeReceiver] Web bridge unregister failed: {e.Message}");
            }
#endif
        }

        // ── WebGL entry point (called from Penalty444WebBridge.jslib) ────────
        // Receives the full, already-validated JSON envelope as a string. Parses
        // ONLY presentation fields, ignores everything else, and never derives a
        // result from the lanes. Malformed input is ignored with a warning and
        // must never crash the scene.
        public void OnWebMessage(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                Ignore("empty message");
                return;
            }

            Penalty444Envelope env;
            try
            {
                env = JsonUtility.FromJson<Penalty444Envelope>(json);
            }
            catch (Exception e)
            {
                Ignore($"envelope parse failed: {e.Message}");
                return;
            }

            if (env == null)
            {
                Ignore("null envelope");
                return;
            }

            if (env.type != "PENALTY444_MATCH_EVENT")
            {
                Ignore($"unexpected type '{env.type}'");
                return;
            }

            switch (env.@event)
            {
                case "staging_begin":
                    if (env.payload == null || env.payload.startsAt <= 0)
                    {
                        Ignore("staging_begin: missing or invalid payload");
                        break;
                    }
                    OnStagingBegin();
                    break;
                case "round_result":
                    DispatchRoundResult(env.payload);
                    break;
                case "match_end":
                    // Presentation uses only isDraw; winnerId is not authority
                    // here. A missing payload must NOT default to a valid
                    // match-over presentation — reject it.
                    if (env.payload == null)
                    {
                        Ignore("match_end: missing payload");
                        break;
                    }
                    OnMatchEnd(env.payload.isDraw);
                    break;
                case "reset":
                    OnReset();
                    break;
                default:
                    Ignore($"unknown event '{env.@event}'");
                    break;
            }
        }

        private void DispatchRoundResult(Penalty444Payload p)
        {
            if (p == null)
            {
                Ignore("round_result: missing payload");
                return;
            }
            if (!TryParseLane(p.kickerLane, out var kickerLane))
            {
                Ignore($"round_result: bad kickerLane '{p.kickerLane}'");
                return;
            }
            if (!TryParseLane(p.keeperLane, out var keeperLane))
            {
                Ignore($"round_result: bad keeperLane '{p.keeperLane}'");
                return;
            }
            if (!TryParseResult(p.result, out var result))
            {
                Ignore($"round_result: bad result '{p.result}'");
                return;
            }

            // Display the supplied result — do NOT derive it from the lanes.
            OnRoundResult(kickerLane, keeperLane, result);
        }

        private static bool TryParseLane(string value, out PenaltyLane lane)
        {
            switch (value)
            {
                case "LEFT": lane = PenaltyLane.LEFT; return true;
                case "CENTER": lane = PenaltyLane.CENTER; return true;
                case "RIGHT": lane = PenaltyLane.RIGHT; return true;
                default: lane = PenaltyLane.CENTER; return false;
            }
        }

        private static bool TryParseResult(string value, out PenaltyVisualResult result)
        {
            switch (value)
            {
                case "GOAL": result = PenaltyVisualResult.GOAL; return true;
                case "SAVE": result = PenaltyVisualResult.SAVE; return true;
                case "DRAW": result = PenaltyVisualResult.DRAW; return true;
                default: result = PenaltyVisualResult.DRAW; return false;
            }
        }

        private static void Ignore(string reason) =>
            Debug.LogWarning($"[UnityBridgeReceiver] Ignored web message — {reason}.");

        // ── Serializable inbound DTOs ────────────────────────────────────────
        // JsonUtility ignores JSON fields that are not represented here (e.g.
        // `scores`, `winnerId`), so unused presentation-irrelevant fields never
        // cause a parse failure. Only the presentation fields are declared.
        [Serializable]
        private sealed class Penalty444Envelope
        {
            public string type;
            public string @event;
            public Penalty444Payload payload;
        }

        [Serializable]
        private sealed class Penalty444Payload
        {
            // staging_begin
            public long startsAt;

            // round_result (presentation fields only)
            public string kickerLane;
            public string keeperLane;
            public string result;
            public int round;
            public int maxRounds;
            public string phase;

            // match_end
            public bool isDraw;
        }

        // ── Public dispatch methods (shared by editor mocks + WebGL bridge) ──
        // Each corresponds to one PENALTY444_MATCH_EVENT: staging_begin,
        // round_result, match_end, reset.

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
        // Right-click the component header in the Inspector to fire these. These
        // keep working in the Editor exactly as before (WebGL bridge is compiled
        // out under UNITY_EDITOR).

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
