// Penalty444 — B6D2B Unity Protocol v1 validation runner (EDITOR-ONLY).
//
// Deterministic, self-contained validation for the presentation-only Protocol v1
// parser, the instance/sequence gate, legacy compatibility, and the sanitized
// applied/rejected acknowledgement JSON. It adds/modifies NO Unity packages,
// touches NO scene or project settings, and leaves NO tracked generated asset.
//
// Entry point (batchmode):
//   Penalty444.Editor.Penalty444PresentationProtocolValidation.RunFromCommandLine
//
// It logs a single concise PASS summary and THROWS (failing the Unity process)
// on the first assertion failure so CI/batch runs surface a non-zero exit code.

#if UNITY_EDITOR
using System;
using System.Reflection;
using UnityEngine;
using Penalty444.Prototype;

namespace Penalty444.Editor
{
    public static class Penalty444PresentationProtocolValidation
    {
        private static int _passed;

        // ── Deterministic entry point ────────────────────────────────────────
        public static void RunFromCommandLine()
        {
            _passed = 0;
            try
            {
                RunAll();
            }
            catch (Exception e)
            {
                Debug.LogError($"[B6D2B validation] FAILED after {_passed} passing checks: {e.Message}");
                // Fail the batch process with a non-zero exit code.
                if (Application.isBatchMode)
                {
                    UnityEditor.EditorApplication.Exit(1);
                }
                throw;
            }

            Debug.Log($"[B6D2B validation] PASS — all {_passed}/{_passed} presentation-protocol checks passed.");
            if (Application.isBatchMode)
            {
                UnityEditor.EditorApplication.Exit(0);
            }
        }

        private static void RunAll()
        {
            RunParserCases();   // 1–18
            RunGateCases();     // 19–32
            RunLegacyCases();   // 33–37
            RunAckCases();      // 38–41
        }

        // ════════════════════════════════ PARSER (1–18) ══════════════════════
        private static void RunParserCases()
        {
            // 1. valid round_result
            {
                var r = UnityPresentationProtocolV1.Parse(ValidRoundResult());
                Check(r.IsVersioned && r.Ok && r.Envelope.Event == PresentationEventKind.RoundResult,
                    "01 valid round_result parses");
                Check(r.Envelope.RoundResult.Round == 3 && r.Envelope.RoundResult.Result == PenaltyVisualResult.GOAL,
                    "01 round_result fields");
            }

            // 2. valid match_state_sync
            {
                var r = UnityPresentationProtocolV1.Parse(ValidStateSync("ABCD12:1", "1"));
                Check(r.IsVersioned && r.Ok && r.Envelope.Event == PresentationEventKind.MatchStateSync,
                    "02 valid match_state_sync parses");
                Check(r.Envelope.StateSync.PlayerCount == 2 &&
                      r.Envelope.StateSync.ScoreValuesOrdered.Length == 2,
                    "02 state sync score values");
            }

            // 3. unsupported protocolVersion
            {
                var json = "{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":2,\"matchInstanceId\":\"ABCD12:1\",\"sequence\":1,\"event\":\"match_state_sync\",\"payload\":{\"scores\":{\"p1\":0,\"p2\":0},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}}";
                var r = UnityPresentationProtocolV1.Parse(json);
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.UnsupportedVersion,
                    "03 unsupported protocolVersion rejected");
            }

            // 4. missing/invalid type
            {
                var json = "{\"type\":\"WRONG\",\"protocolVersion\":1,\"matchInstanceId\":\"ABCD12:1\",\"sequence\":1,\"event\":\"match_state_sync\",\"payload\":{\"scores\":{\"p1\":0},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}}";
                var r = UnityPresentationProtocolV1.Parse(json);
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "04 invalid type rejected");
            }

            // 5. invalid matchInstanceId (lowercase room code)
            {
                var r = UnityPresentationProtocolV1.Parse(ValidStateSync("abcd12:1", "1"));
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "05 invalid matchInstanceId rejected");
            }

            // 6. invalid sequence (zero)
            {
                var r = UnityPresentationProtocolV1.Parse(ValidStateSync("ABCD12:1", "0"));
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "06 invalid sequence rejected");
            }

            // 7. malformed JSON
            {
                var r = UnityPresentationProtocolV1.Parse("{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":1,");
                Check(!r.Ok, "07 malformed JSON rejected");
            }

            // 8. excessive input length
            {
                var big = new string('a', UnityPresentationProtocolV1.MaxInputLength + 10);
                var r = UnityPresentationProtocolV1.Parse(big);
                Check(!r.Ok, "08 excessive input length rejected");
            }

            // 9. excessive nesting (>8 deep)
            {
                var r = UnityPresentationProtocolV1.Parse("{\"protocolVersion\":1,\"a\":[[[[[[[[[[1]]]]]]]]]]}");
                Check(!r.Ok, "09 excessive nesting rejected");
            }

            // 10. invalid lane
            {
                var payload = "{\"round\":1,\"kickerLane\":\"UP\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}";
                var r = UnityPresentationProtocolV1.Parse(RoundResultWith("ABCD12:1", "2", payload));
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "10 invalid lane rejected");
            }

            // 11. invalid result
            {
                var payload = "{\"round\":1,\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"WIN\"}";
                var r = UnityPresentationProtocolV1.Parse(RoundResultWith("ABCD12:1", "2", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "11 invalid result rejected");
            }

            // 12. invalid phase
            {
                var payload = "{\"scores\":{\"p1\":0},\"round\":1,\"maxRounds\":5,\"phase\":\"OVERTIME\"}";
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "12 invalid phase rejected");
            }

            // 13. fractional score
            {
                var payload = "{\"scores\":{\"p1\":1.5},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}";
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "13 fractional score rejected");
            }

            // 14. negative score
            {
                var payload = "{\"scores\":{\"p1\":-1},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}";
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "14 negative score rejected");
            }

            // 15. dangerous score key
            {
                var payload = "{\"scores\":{\"__proto__\":0},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}";
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "15 dangerous score key rejected");
            }

            // 16. whitespace score key
            {
                var payload = "{\"scores\":{\" \":0},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}";
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", payload));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "16 whitespace score key rejected");
            }

            // 17. too many score entries (17 > 16)
            {
                var sb = new System.Text.StringBuilder("{\"scores\":{");
                for (int i = 0; i < 17; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append("\"p").Append(i).Append("\":0");
                }
                sb.Append("},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}");
                var r = UnityPresentationProtocolV1.Parse(StateSyncWith("ABCD12:1", "1", sb.ToString()));
                Check(!r.Ok && r.Reason == PresentationRejectReasons.InvalidEnvelope,
                    "17 too many score entries rejected");
            }

            // 18. unknown sensitive fields ignored and never returned
            {
                var json = "{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":1,\"matchInstanceId\":\"ABCD12:1\",\"sequence\":1,\"authToken\":\"SECRET\",\"wallet\":{\"balance\":5},\"event\":\"match_state_sync\",\"payload\":{\"scores\":{\"p1\":0,\"p2\":1},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\",\"email\":\"a@b.c\"}}";
                var r = UnityPresentationProtocolV1.Parse(json);
                Check(r.IsVersioned && r.Ok, "18 unknown sensitive fields tolerated");
                string ack = UnityPresentationProtocolV1.BuildAppliedAckJson(r.Envelope);
                Check(NoProhibited(ack), "18 unknown sensitive fields never surface in ack");
            }
        }

        // ════════════════════════════════ GATE (19–32) ═══════════════════════
        private static void RunGateCases()
        {
            // 19. round_result before state rejected
            {
                var g = new PresentationInstanceGate();
                var rr = MustParse(ValidRoundResult());
                var d = g.Evaluate(rr);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.NoActiveInstance,
                    "19 round_result before state rejected");
            }

            // 20. first state sync sequence 1 accepted
            {
                var g = new PresentationInstanceGate();
                var ss = MustParse(ValidStateSync("ABCD12:1", "1"));
                var d = g.Evaluate(ss);
                Check(d.Accepted && d.ResetScene, "20 first state sync seq 1 accepted");
                g.Commit(ss);
                Check(g.LastSequence == 1 && g.ActiveMatchInstanceId == "ABCD12:1",
                    "20 commit sets active instance");
            }

            // 21. fresh receiver state sync sequence > 1 accepted (reload bootstrap)
            {
                var g = new PresentationInstanceGate();
                var ss = MustParse(ValidStateSync("ABCD12:1", "7"));
                var d = g.Evaluate(ss);
                Check(d.Accepted && d.ResetScene, "21 fresh state sync seq>1 accepted");
            }

            // 22. duplicate sequence rejected
            {
                var g = ActiveGate("ABCD12:1", 5);
                var dup = MustParse(ValidStateSync("ABCD12:1", "5"));
                var d = g.Evaluate(dup);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.StaleOrDuplicate,
                    "22 duplicate sequence rejected");
            }

            // 23. lower sequence rejected
            {
                var g = ActiveGate("ABCD12:1", 5);
                var lower = MustParse(ValidStateSync("ABCD12:1", "3"));
                var d = g.Evaluate(lower);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.StaleOrDuplicate,
                    "23 lower sequence rejected");
            }

            // 24. same-instance higher sequence accepted
            {
                var g = ActiveGate("ABCD12:1", 5);
                var higher = MustParse(ValidStateSync("ABCD12:1", "6"));
                var d = g.Evaluate(higher);
                Check(d.Accepted && !d.ResetScene, "24 same-instance higher sequence accepted");
            }

            // 25. foreign round_result rejected
            {
                var g = ActiveGate("ABCD12:2", 5);
                var payload = "{\"round\":1,\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}";
                var foreign = MustParse(RoundResultWith("ABCD12:1", "6", payload));
                var d = g.Evaluate(foreign);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.ForeignInstance,
                    "25 foreign round_result rejected");
            }

            // 26. same-room higher instance state sequence 1 accepted (reset)
            {
                var g = ActiveGate("ABCD12:1", 9);
                var next = MustParse(ValidStateSync("ABCD12:2", "1"));
                var d = g.Evaluate(next);
                Check(d.Accepted && d.ResetScene, "26 same-room higher instance seq1 accepted");
            }

            // 27. new-instance state sequence > 1 rejected
            {
                var g = ActiveGate("ABCD12:1", 9);
                var bad = MustParse(ValidStateSync("ABCD12:2", "2"));
                var d = g.Evaluate(bad);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.InvalidInstanceTransition,
                    "27 new-instance state seq>1 rejected");
            }

            // 28. lower instance rejected
            {
                var g = ActiveGate("ABCD12:2", 4);
                var lower = MustParse(ValidStateSync("ABCD12:1", "1"));
                var d = g.Evaluate(lower);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.ForeignInstance,
                    "28 lower instance rejected");
            }

            // 29. different room code rejected
            {
                var g = ActiveGate("ABCD12:1", 4);
                var other = MustParse(ValidStateSync("WXYZ99:2", "1"));
                var d = g.Evaluate(other);
                Check(!d.Accepted && d.Reason == PresentationRejectReasons.ForeignInstance,
                    "29 different room code rejected");
            }

            // 30. rejection leaves prior instance/sequence unchanged
            {
                var g = ActiveGate("ABCD12:1", 5);
                var stale = MustParse(ValidStateSync("ABCD12:1", "2"));
                var d = g.Evaluate(stale);
                Check(!d.Accepted, "30 stale rejected");
                Check(g.ActiveMatchInstanceId == "ABCD12:1" && g.LastSequence == 5,
                    "30 rejection leaves state unchanged");
            }

            // 31. failed application does not commit the sequence
            {
                var g = ActiveGate("ABCD12:1", 5);
                var higher = MustParse(ValidStateSync("ABCD12:1", "6"));
                var d = g.Evaluate(higher);
                Check(d.Accepted, "31 evaluate accepts");
                // Simulate a failed apply: do NOT call Commit.
                Check(g.LastSequence == 5, "31 failed application does not commit sequence");
            }

            // 32. reload bootstrap restores scoreboard without replaying a result
            {
                // A brand-new gate models a fresh receiver after iframe reload.
                var g = new PresentationInstanceGate();
                var roundBefore = MustParse(RoundResultWith("ABCD12:1", "9",
                    "{\"round\":1,\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}"));
                var rDenied = g.Evaluate(roundBefore);
                Check(!rDenied.Accepted && rDenied.Reason == PresentationRejectReasons.NoActiveInstance,
                    "32 no result replay before bootstrap");
                var bootstrap = MustParse(ValidStateSync("ABCD12:1", "9"));
                var rBoot = g.Evaluate(bootstrap);
                Check(rBoot.Accepted && rBoot.ResetScene &&
                      bootstrap.Event == PresentationEventKind.MatchStateSync,
                    "32 reload bootstrap state accepted");
            }
        }

        // ════════════════════════════════ LEGACY (33–37) ═════════════════════
        private static void RunLegacyCases()
        {
            // 33–36: legacy envelopes have NO protocolVersion → routed to legacy
            // path (IsVersioned == false) and applied without a versioned ack.
            CheckLegacyAccepted("staging_begin",
                "{\"type\":\"PENALTY444_MATCH_EVENT\",\"event\":\"staging_begin\",\"payload\":{\"startsAt\":123}}",
                "33 legacy staging_begin accepted");

            CheckLegacyAccepted("round_result",
                "{\"type\":\"PENALTY444_MATCH_EVENT\",\"event\":\"round_result\",\"payload\":{\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}}",
                "34 legacy round_result accepted");

            CheckLegacyAccepted("match_end",
                "{\"type\":\"PENALTY444_MATCH_EVENT\",\"event\":\"match_end\",\"payload\":{\"winnerId\":\"x\",\"isDraw\":false}}",
                "35 legacy match_end accepted");

            CheckLegacyAccepted("reset",
                "{\"type\":\"PENALTY444_MATCH_EVENT\",\"event\":\"reset\",\"payload\":null}",
                "36 legacy reset accepted");

            // 37. unsupported version never falls back to legacy
            {
                var json = "{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":9,\"matchInstanceId\":\"ABCD12:1\",\"sequence\":1,\"event\":\"reset\",\"payload\":null}";
                var r = UnityPresentationProtocolV1.Parse(json);
                Check(r.IsVersioned && !r.Ok && r.Reason == PresentationRejectReasons.UnsupportedVersion,
                    "37 unsupported version never falls back to legacy");

                var receiver = NewReceiver();
                receiver.OnWebMessage(json);
                string ack = receiver.LastPostedUnityEventJson;
                Check(ack != null && ack.Contains("presentation_rejected") && ack.Contains("unsupported_version"),
                    "37 unsupported version posts rejected ack (not legacy)");
                DestroyReceiver(receiver);
            }
        }

        // ════════════════════════════════ ACK (38–41) ════════════════════════
        private static void RunAckCases()
        {
            // 38. applied state ack contains numeric scores but no player IDs
            {
                var receiver = NewReceiver();
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "1"));
                string ack = receiver.LastPostedUnityEventJson;
                Check(ack != null && ack.Contains("presentation_applied") &&
                      ack.Contains("\"scoreValues\":") && ack.Contains("\"playerCount\":"),
                    "38 applied state ack has numeric scores");
                Check(NoProhibited(ack), "38 applied state ack has no player IDs / sensitive fields");
                DestroyReceiver(receiver);
            }

            // 39. applied result ack contains no score
            {
                var receiver = NewReceiver();
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "1")); // establish instance
                var payload = "{\"round\":2,\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}";
                receiver.OnWebMessage(RoundResultWith("ABCD12:1", "2", payload));
                string ack = receiver.LastPostedUnityEventJson;
                Check(ack != null && ack.Contains("presentation_applied") &&
                      ack.Contains("\"appliedEvent\":\"round_result\"") &&
                      ack.Contains("\"result\":\"GOAL\""),
                    "39 applied result ack has result");
                Check(!ack.Contains("scoreValues") && !ack.Contains("\"scores\""),
                    "39 applied result ack has no score");
                DestroyReceiver(receiver);
            }

            // 40. rejected ack uses only an allowlisted reason
            {
                var receiver = NewReceiver();
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "5")); // active seq 5
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "5")); // duplicate
                string ack = receiver.LastPostedUnityEventJson;
                Check(ack != null && ack.Contains("presentation_rejected") &&
                      ack.Contains("stale_or_duplicate"),
                    "40 rejected ack uses allowlisted reason");
                Check(AckReasonAllowlisted(ack), "40 rejected reason is allowlisted");
                DestroyReceiver(receiver);
            }

            // 41. ack JSON contains no prohibited field names
            {
                var receiver = NewReceiver();
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "1"));
                Check(NoProhibited(receiver.LastPostedUnityEventJson), "41 applied ack has no prohibited fields");
                receiver.OnWebMessage(ValidStateSync("ABCD12:1", "1")); // duplicate → rejected
                Check(NoProhibited(receiver.LastPostedUnityEventJson), "41 rejected ack has no prohibited fields");
                DestroyReceiver(receiver);
            }
        }

        // ── JSON builders ────────────────────────────────────────────────────
        private static string ValidRoundResult()
        {
            // Requires an active instance before a gate accepts it; used for parser
            // + gate tests with round 3, sequence 3.
            return RoundResultWith("ABCD12:1", "3",
                "{\"round\":3,\"kickerLane\":\"LEFT\",\"keeperLane\":\"RIGHT\",\"result\":\"GOAL\"}");
        }

        private static string ValidStateSync(string instanceId, string sequenceToken)
        {
            return StateSyncWith(instanceId, sequenceToken,
                "{\"scores\":{\"p1\":0,\"p2\":0},\"round\":1,\"maxRounds\":5,\"phase\":\"NORMAL\"}");
        }

        private static string RoundResultWith(string instanceId, string sequenceToken, string payload)
        {
            return "{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":1,\"matchInstanceId\":\"" +
                   instanceId + "\",\"sequence\":" + sequenceToken +
                   ",\"event\":\"round_result\",\"payload\":" + payload + "}";
        }

        private static string StateSyncWith(string instanceId, string sequenceToken, string payload)
        {
            return "{\"type\":\"PENALTY444_MATCH_EVENT\",\"protocolVersion\":1,\"matchInstanceId\":\"" +
                   instanceId + "\",\"sequence\":" + sequenceToken +
                   ",\"event\":\"match_state_sync\",\"payload\":" + payload + "}";
        }

        // ── Gate helpers ─────────────────────────────────────────────────────
        private static PresentationEnvelopeV1 MustParse(string json)
        {
            var r = UnityPresentationProtocolV1.Parse(json);
            if (!r.Ok) throw new Exception($"expected a valid envelope, got reason '{r.Reason}' for: {Truncate(json)}");
            return r.Envelope;
        }

        private static PresentationInstanceGate ActiveGate(string instanceId, long lastSequence)
        {
            var g = new PresentationInstanceGate();
            var boot = MustParse(ValidStateSync(instanceId, lastSequence.ToString()));
            var d = g.Evaluate(boot);
            if (!d.Accepted) throw new Exception("ActiveGate bootstrap unexpectedly rejected.");
            g.Commit(boot);
            return g;
        }

        // ── Receiver helpers (legacy + ack integration) ──────────────────────
        private static UnityBridgeReceiver NewReceiver()
        {
            var go = new GameObject("B6D2BValidationReceiver");
            var receiver = go.AddComponent<UnityBridgeReceiver>();
            var scene = go.AddComponent<PenaltySceneController>();

            // Wire the private [SerializeField] sceneController reference so apply
            // succeeds (all UI/animator refs remain null and are null-safe).
            var field = typeof(UnityBridgeReceiver).GetField(
                "sceneController", BindingFlags.NonPublic | BindingFlags.Instance);
            if (field == null) throw new Exception("UnityBridgeReceiver.sceneController field not found.");
            field.SetValue(receiver, scene);
            return receiver;
        }

        private static void DestroyReceiver(UnityBridgeReceiver receiver)
        {
            if (receiver != null) UnityEngine.Object.DestroyImmediate(receiver.gameObject);
        }

        private static void CheckLegacyAccepted(string eventName, string json, string label)
        {
            var parsed = UnityPresentationProtocolV1.Parse(json);
            Check(!parsed.IsVersioned, label + " (routed to legacy path)");

            var receiver = NewReceiver();
            receiver.OnWebMessage(json);
            // Legacy path never posts a versioned ack.
            Check(receiver.LastPostedUnityEventJson == null, label + " (no versioned ack)");
            DestroyReceiver(receiver);
        }

        // ── Assertion + sanitization helpers ─────────────────────────────────
        private static readonly string[] Prohibited =
        {
            "authToken", "wallet", "email", "token", "session", "socket",
            "username", "userId", "playerId", "\"p1\"", "\"p2\"", "__proto__",
            "balance", "jwt", "cookie",
        };

        private static bool NoProhibited(string ack)
        {
            if (ack == null) return false;
            foreach (var bad in Prohibited)
            {
                if (ack.Contains(bad)) return false;
            }
            return true;
        }

        private static bool AckReasonAllowlisted(string ack)
        {
            // Extract the reason value and confirm it is allowlisted.
            const string marker = "\"reason\":\"";
            int idx = ack.IndexOf(marker, StringComparison.Ordinal);
            if (idx < 0) return false;
            int start = idx + marker.Length;
            int end = ack.IndexOf('"', start);
            if (end < 0) return false;
            string reason = ack.Substring(start, end - start);
            return PresentationRejectReasons.IsAllowed(reason);
        }

        private static void Check(bool condition, string label)
        {
            if (!condition) throw new Exception($"assertion failed: {label}");
            _passed++;
            Debug.Log($"[B6D2B validation] ok: {label}");
        }

        private static string Truncate(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            return s.Length <= 120 ? s : s.Substring(0, 120) + "...";
        }
    }
}
#endif
