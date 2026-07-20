// Penalty444 — B6D2B Unity Protocol v1 consumption (PRESENTATION-ONLY).
//
// This file teaches the Unity prototype to validate and consume the already
// merged B6D1 "Protocol v1" presentation envelopes. It is strictly
// presentation-only, exactly like the rest of the prototype:
//
//   - It opens NO network connection and makes NO HTTP/Socket.IO/WebSocket call.
//   - It reads NO auth data, JWTs, tokens, cookies, localStorage, wallet, or
//     economy data.
//   - It NEVER computes an official result, NEVER compares lanes to derive a
//     result, NEVER calculates or increments a score, NEVER decides a winner,
//     the next round, whether the match ended, or sudden-death progression.
//
// The React app + Node realtime server remain the single source of truth. Unity
// only displays the numbers/strings it is explicitly told to display.
//
// Because Unity's JsonUtility cannot safely deserialize an arbitrary
// Record<string, number> "scores" map, this file implements a small, bounded,
// exception-safe structural JSON reader (no regex for nested JSON, no external
// package, WebGL/IL2CPP-safe) plus strict Protocol v1 validation, an
// instance/sequence gate, and sanitized applied/rejected acknowledgement JSON.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Penalty444.Prototype
{
    /// <summary>Versioned event kinds that Unity consumes (round_result / match_state_sync).</summary>
    public enum PresentationEventKind
    {
        RoundResult,
        MatchStateSync,
    }

    // ── Allowlisted rejection reasons (§9). Kept as constants so the receiver,
    // the ack builder, and the editor validator all use the exact same strings.
    public static class PresentationRejectReasons
    {
        public const string InvalidEnvelope = "invalid_envelope";
        public const string UnsupportedVersion = "unsupported_version";
        public const string NoActiveInstance = "no_active_instance";
        public const string StaleOrDuplicate = "stale_or_duplicate";
        public const string ForeignInstance = "foreign_instance";
        public const string InvalidInstanceTransition = "invalid_instance_transition";
        public const string ApplyFailed = "apply_failed";

        public static bool IsAllowed(string reason)
        {
            switch (reason)
            {
                case InvalidEnvelope:
                case UnsupportedVersion:
                case NoActiveInstance:
                case StaleOrDuplicate:
                case ForeignInstance:
                case InvalidInstanceTransition:
                case ApplyFailed:
                    return true;
                default:
                    return false;
            }
        }
    }

    /// <summary>Validated, presentation-only round_result payload.</summary>
    public sealed class RoundResultData
    {
        public long Round;
        public PenaltyLane KickerLane;
        public PenaltyLane KeeperLane;
        public PenaltyVisualResult Result;
        public bool HasStatusMessage;
        public string StatusMessage; // bounded presentation text or null
    }

    /// <summary>
    /// Validated, presentation-only match_state_sync payload. Only ordered numeric
    /// score VALUES are retained — player-id keys are used solely to compute a
    /// deterministic order and are then discarded (never stored, never displayed).
    /// </summary>
    public sealed class MatchStateSyncData
    {
        public long[] ScoreValuesOrdered; // ordered by sanitized key (ordinal); values only
        public int PlayerCount;
        public long Round;
        public long MaxRounds;
        public string Phase; // "NORMAL" | "SUDDEN_DEATH"
        public bool HasSuddenDeathRound;
        public long SuddenDeathRound;
    }

    /// <summary>A fully validated Protocol v1 envelope (presentation-only).</summary>
    public sealed class PresentationEnvelopeV1
    {
        public string MatchInstanceId; // "<ROOMCODE>:<INSTANCE>"
        public string RoomCode;        // uppercase alphanumeric prefix
        public long InstanceNumber;    // positive suffix
        public long Sequence;
        public bool HasEmittedAt;
        public long EmittedAt;
        public PresentationEventKind Event;
        public RoundResultData RoundResult;  // set when Event == RoundResult
        public MatchStateSyncData StateSync; // set when Event == MatchStateSync
    }

    /// <summary>Outcome of parsing a raw inbound message.</summary>
    public struct PresentationParseResult
    {
        /// <summary>True when the message declared a top-level protocolVersion (strict path).</summary>
        public bool IsVersioned;

        /// <summary>True when a valid Protocol v1 envelope was produced.</summary>
        public bool Ok;

        /// <summary>Allowlisted rejection reason when <see cref="Ok"/> is false.</summary>
        public string Reason;

        /// <summary>The validated envelope when <see cref="Ok"/> is true.</summary>
        public PresentationEnvelopeV1 Envelope;
    }

    /// <summary>
    /// Bounded, exception-safe Protocol v1 parser + validation + sanitized ack
    /// building. Pure/deterministic. No Unity, network, auth, or scene state.
    /// </summary>
    public static class UnityPresentationProtocolV1
    {
        public const string EnvelopeType = "PENALTY444_MATCH_EVENT";
        public const string UnityEventType = "PENALTY444_UNITY_EVENT";
        public const long ProtocolVersion = 1;

        // Safety limits (§4).
        public const int MaxInputLength = 16 * 1024; // 16 KiB (chars)
        public const int MaxDepth = 8;
        public const int MaxStringLength = 512;
        public const int MaxScoreEntries = 16;

        // ────────────────────────────────────────────────────────────────────
        // Public entry point
        // ────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Parse + validate a raw inbound JSON message. Never throws. When the
        /// message declares a top-level <c>protocolVersion</c> it is handled on the
        /// strict versioned path (Ok/Reason populated). When it does not, the
        /// result reports <see cref="PresentationParseResult.IsVersioned"/> = false
        /// so the caller can route it to the legacy bridge instead.
        /// </summary>
        public static PresentationParseResult Parse(string json)
        {
            var result = new PresentationParseResult
            {
                IsVersioned = false,
                Ok = false,
                Reason = PresentationRejectReasons.InvalidEnvelope,
                Envelope = null,
            };

            try
            {
                if (string.IsNullOrEmpty(json)) return result;
                if (json.Length > MaxInputLength) return result;

                JsonValue root;
                if (!JsonReader.TryParse(json, out root)) return result;
                if (root == null || root.Kind != JsonKind.Object) return result;

                // Routing key: a top-level protocolVersion means "versioned".
                JsonValue versionValue;
                bool hasVersion = root.TryGet("protocolVersion", out versionValue);
                if (!hasVersion)
                {
                    // Not versioned — leave IsVersioned=false so the caller uses the
                    // legacy path. (Legacy envelopes never carry protocolVersion.)
                    return result;
                }

                result.IsVersioned = true;

                if (root.HadDuplicateKey)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                // type must be exactly the match-event type.
                JsonValue typeValue;
                if (!root.TryGet("type", out typeValue) ||
                    typeValue.Kind != JsonKind.String ||
                    typeValue.Str != EnvelopeType)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                // protocolVersion must be an integer; if it is a valid number but
                // not exactly 1 it is an UNSUPPORTED version (never legacy).
                long version;
                if (!TryReadInteger(versionValue, out version))
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }
                if (version != ProtocolVersion)
                {
                    result.Reason = PresentationRejectReasons.UnsupportedVersion;
                    return result;
                }

                // matchInstanceId
                JsonValue instanceValue;
                string roomCode;
                long instanceNumber;
                if (!root.TryGet("matchInstanceId", out instanceValue) ||
                    instanceValue.Kind != JsonKind.String ||
                    !TryParseMatchInstanceId(instanceValue.Str, out roomCode, out instanceNumber))
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                // sequence (positive integer)
                JsonValue sequenceValue;
                long sequence;
                if (!root.TryGet("sequence", out sequenceValue) ||
                    !TryReadInteger(sequenceValue, out sequence) ||
                    sequence <= 0)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                // emittedAt (optional; non-negative integer)
                bool hasEmittedAt = false;
                long emittedAt = 0;
                JsonValue emittedValue;
                if (root.TryGet("emittedAt", out emittedValue))
                {
                    if (!TryReadInteger(emittedValue, out emittedAt) || emittedAt < 0)
                    {
                        result.Reason = PresentationRejectReasons.InvalidEnvelope;
                        return result;
                    }
                    hasEmittedAt = true;
                }

                // event
                JsonValue eventValue;
                if (!root.TryGet("event", out eventValue) || eventValue.Kind != JsonKind.String)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                JsonValue payloadValue;
                if (!root.TryGet("payload", out payloadValue) || payloadValue.Kind != JsonKind.Object)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }
                if (payloadValue.HadDuplicateKey)
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                var envelope = new PresentationEnvelopeV1
                {
                    MatchInstanceId = roomCode + ":" + instanceNumber.ToString(CultureInfo.InvariantCulture),
                    RoomCode = roomCode,
                    InstanceNumber = instanceNumber,
                    Sequence = sequence,
                    HasEmittedAt = hasEmittedAt,
                    EmittedAt = emittedAt,
                };

                if (eventValue.Str == "round_result")
                {
                    RoundResultData rr;
                    if (!TryValidateRoundResult(payloadValue, out rr))
                    {
                        result.Reason = PresentationRejectReasons.InvalidEnvelope;
                        return result;
                    }
                    envelope.Event = PresentationEventKind.RoundResult;
                    envelope.RoundResult = rr;
                }
                else if (eventValue.Str == "match_state_sync")
                {
                    MatchStateSyncData ss;
                    if (!TryValidateMatchStateSync(payloadValue, out ss))
                    {
                        result.Reason = PresentationRejectReasons.InvalidEnvelope;
                        return result;
                    }
                    envelope.Event = PresentationEventKind.MatchStateSync;
                    envelope.StateSync = ss;
                }
                else
                {
                    // staging_begin / match_end / reset are legacy-only; when they
                    // appear WITH a protocolVersion they are rejected, never
                    // reinterpreted as legacy.
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                    return result;
                }

                result.Ok = true;
                result.Reason = null;
                result.Envelope = envelope;
                return result;
            }
            catch
            {
                // Any unexpected failure is a rejection, never a crash.
                result.Ok = false;
                result.Envelope = null;
                if (result.IsVersioned && result.Reason == PresentationRejectReasons.UnsupportedVersion)
                {
                    // preserve unsupported_version if we already decided it
                }
                else
                {
                    result.Reason = PresentationRejectReasons.InvalidEnvelope;
                }
                return result;
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // Payload validation
        // ────────────────────────────────────────────────────────────────────

        private static bool TryValidateRoundResult(JsonValue payload, out RoundResultData data)
        {
            data = null;

            JsonValue roundValue;
            long round;
            if (!payload.TryGet("round", out roundValue) ||
                !TryReadInteger(roundValue, out round) ||
                round <= 0)
            {
                return false;
            }

            JsonValue kickerValue;
            PenaltyLane kickerLane;
            if (!payload.TryGet("kickerLane", out kickerValue) ||
                kickerValue.Kind != JsonKind.String ||
                !TryParseLane(kickerValue.Str, out kickerLane))
            {
                return false;
            }

            JsonValue keeperValue;
            PenaltyLane keeperLane;
            if (!payload.TryGet("keeperLane", out keeperValue) ||
                keeperValue.Kind != JsonKind.String ||
                !TryParseLane(keeperValue.Str, out keeperLane))
            {
                return false;
            }

            JsonValue resultValue;
            PenaltyVisualResult result;
            if (!payload.TryGet("result", out resultValue) ||
                resultValue.Kind != JsonKind.String ||
                !TryParseResult(resultValue.Str, out result))
            {
                return false;
            }

            data = new RoundResultData
            {
                Round = round,
                KickerLane = kickerLane,
                KeeperLane = keeperLane,
                Result = result,
                HasStatusMessage = false,
                StatusMessage = null,
            };

            // statusMessage is optional bounded presentation text.
            JsonValue statusValue;
            if (payload.TryGet("statusMessage", out statusValue) && statusValue.Kind == JsonKind.String)
            {
                string normalized = NormalizeStatusMessage(statusValue.Str);
                if (normalized != null)
                {
                    data.HasStatusMessage = true;
                    data.StatusMessage = normalized;
                }
            }

            return true;
        }

        private static bool TryValidateMatchStateSync(JsonValue payload, out MatchStateSyncData data)
        {
            data = null;

            JsonValue scoresValue;
            if (!payload.TryGet("scores", out scoresValue) || scoresValue.Kind != JsonKind.Object)
            {
                return false;
            }

            long[] scoreValuesOrdered;
            int playerCount;
            if (!TrySanitizeScores(scoresValue, out scoreValuesOrdered, out playerCount))
            {
                return false;
            }

            JsonValue roundValue;
            long round;
            if (!payload.TryGet("round", out roundValue) ||
                !TryReadInteger(roundValue, out round) ||
                round <= 0)
            {
                return false;
            }

            JsonValue maxRoundsValue;
            long maxRounds;
            if (!payload.TryGet("maxRounds", out maxRoundsValue) ||
                !TryReadInteger(maxRoundsValue, out maxRounds) ||
                maxRounds <= 0)
            {
                return false;
            }

            JsonValue phaseValue;
            if (!payload.TryGet("phase", out phaseValue) ||
                phaseValue.Kind != JsonKind.String ||
                (phaseValue.Str != "NORMAL" && phaseValue.Str != "SUDDEN_DEATH"))
            {
                return false;
            }

            data = new MatchStateSyncData
            {
                ScoreValuesOrdered = scoreValuesOrdered,
                PlayerCount = playerCount,
                Round = round,
                MaxRounds = maxRounds,
                Phase = phaseValue.Str,
                HasSuddenDeathRound = false,
                SuddenDeathRound = 0,
            };

            JsonValue sdValue;
            if (payload.TryGet("suddenDeathRound", out sdValue))
            {
                long sd;
                if (!TryReadInteger(sdValue, out sd) || sd < 0)
                {
                    data = null;
                    return false;
                }
                data.HasSuddenDeathRound = true;
                data.SuddenDeathRound = sd;
            }

            return true;
        }

        // Sanitize the scores object into an ordered numeric-values-only array.
        // Keys are validated (non-empty, no whitespace padding, not dangerous) and
        // used ONLY to sort deterministically; they are never returned/stored.
        private static bool TrySanitizeScores(JsonValue scores, out long[] valuesOrdered, out int count)
        {
            valuesOrdered = null;
            count = 0;

            if (scores.HadDuplicateKey) return false;
            if (scores.Members == null || scores.Members.Count == 0) return false; // non-empty required
            if (scores.Members.Count > MaxScoreEntries) return false;

            var pairs = new List<KeyValuePair<string, long>>(scores.Members.Count);
            for (int i = 0; i < scores.Members.Count; i++)
            {
                string key = scores.Members[i].Key;
                JsonValue val = scores.Members[i].Value;

                if (string.IsNullOrEmpty(key)) return false;
                if (key.Trim().Length == 0) return false;      // whitespace-only
                if (key != key.Trim()) return false;           // whitespace-padded
                if (IsDangerousKey(key)) return false;         // prototype pollution guard

                long v;
                if (!TryReadNonNegativeIntegerScore(val, out v)) return false;

                pairs.Add(new KeyValuePair<string, long>(key, v));
            }

            // Deterministic order: by sanitized key using ordinal comparison.
            pairs.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));

            var outValues = new long[pairs.Count];
            for (int i = 0; i < pairs.Count; i++) outValues[i] = pairs[i].Value;

            valuesOrdered = outValues;
            count = pairs.Count;
            return true;
        }

        private static bool IsDangerousKey(string key)
        {
            return key == "__proto__" || key == "prototype" || key == "constructor";
        }

        // ────────────────────────────────────────────────────────────────────
        // Field helpers
        // ────────────────────────────────────────────────────────────────────

        // A JSON number counts as an integer only when its raw token has no
        // fraction/exponent, no leading '+', and fits in a long.
        private static bool TryReadInteger(JsonValue value, out long result)
        {
            result = 0;
            if (value == null || value.Kind != JsonKind.Number) return false;
            return TryParseIntegerToken(value.NumRaw, out result);
        }

        private static bool TryReadNonNegativeIntegerScore(JsonValue value, out long result)
        {
            result = 0;
            if (value == null || value.Kind != JsonKind.Number) return false;
            long v;
            if (!TryParseIntegerToken(value.NumRaw, out v)) return false; // rejects fractional/exponent/overflow
            if (v < 0) return false;                                      // rejects negative
            result = v;
            return true;
        }

        private static bool TryParseIntegerToken(string raw, out long result)
        {
            result = 0;
            if (string.IsNullOrEmpty(raw)) return false;
            // Reject fractional / exponent / any non digit-or-leading-minus content.
            for (int i = 0; i < raw.Length; i++)
            {
                char c = raw[i];
                if (c == '-')
                {
                    if (i != 0) return false;
                    continue;
                }
                if (c < '0' || c > '9') return false; // '.', 'e', 'E', '+' all rejected
            }
            // long.TryParse rejects overflow (non-finite cannot appear here).
            return long.TryParse(raw, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out result);
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

        /// <summary>
        /// matchInstanceId is
        /// <c>&lt;UPPERCASE_ALPHANUMERIC_ROOM_CODE&gt;:&lt;POSITIVE_INSTANCE_NUMBER&gt;</c>.
        /// </summary>
        public static bool TryParseMatchInstanceId(string value, out string roomCode, out long instanceNumber)
        {
            roomCode = null;
            instanceNumber = 0;
            if (string.IsNullOrEmpty(value)) return false;
            if (value.Length > MaxStringLength) return false;

            int colon = value.IndexOf(':');
            if (colon <= 0 || colon >= value.Length - 1) return false;
            // exactly one ':' delimiter
            if (value.IndexOf(':', colon + 1) != -1) return false;

            string prefix = value.Substring(0, colon);
            string suffix = value.Substring(colon + 1);

            for (int i = 0; i < prefix.Length; i++)
            {
                char c = prefix[i];
                bool ok = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
                if (!ok) return false; // uppercase alphanumeric only
            }

            long parsed;
            if (!TryParseIntegerToken(suffix, out parsed)) return false;
            if (parsed <= 0) return false;

            roomCode = prefix;
            instanceNumber = parsed;
            return true;
        }

        /// <summary>Trim, replace control chars with spaces, cap length; null when empty.</summary>
        public static string NormalizeStatusMessage(string value)
        {
            if (value == null) return null;
            var sb = new StringBuilder(value.Length);
            foreach (char ch in value)
            {
                sb.Append(ch < 0x20 || ch == 0x7f ? ' ' : ch);
            }
            string cleaned = sb.ToString().Trim();
            if (cleaned.Length == 0) return null;
            if (cleaned.Length > 200) cleaned = cleaned.Substring(0, 200);
            return cleaned;
        }

        // ────────────────────────────────────────────────────────────────────
        // Sanitized acknowledgement JSON (§9). Deterministic; numeric scores only;
        // NEVER any player-id key, username, raw payload, auth/session/token,
        // socket, wallet, or economy field.
        // ────────────────────────────────────────────────────────────────────

        public static string BuildAppliedAckJson(PresentationEnvelopeV1 env)
        {
            var sb = new StringBuilder(256);
            sb.Append('{');
            AppendKey(sb, "type"); AppendString(sb, UnityEventType); sb.Append(',');
            AppendKey(sb, "event"); AppendString(sb, "presentation_applied"); sb.Append(',');
            AppendKey(sb, "payload");
            sb.Append('{');
            AppendKey(sb, "protocolVersion"); sb.Append(ProtocolVersion.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
            AppendKey(sb, "matchInstanceId"); AppendString(sb, env.MatchInstanceId); sb.Append(',');
            AppendKey(sb, "sequence"); sb.Append(env.Sequence.ToString(CultureInfo.InvariantCulture)); sb.Append(',');

            if (env.Event == PresentationEventKind.RoundResult)
            {
                AppendKey(sb, "appliedEvent"); AppendString(sb, "round_result"); sb.Append(',');
                AppendKey(sb, "round"); sb.Append(env.RoundResult.Round.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
                AppendKey(sb, "result"); AppendString(sb, ResultToString(env.RoundResult.Result));
                // No score fields on a result ack.
            }
            else
            {
                MatchStateSyncData s = env.StateSync;
                AppendKey(sb, "appliedEvent"); AppendString(sb, "match_state_sync"); sb.Append(',');
                AppendKey(sb, "round"); sb.Append(s.Round.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
                AppendKey(sb, "phase"); AppendString(sb, s.Phase); sb.Append(',');
                if (s.HasSuddenDeathRound)
                {
                    AppendKey(sb, "suddenDeathRound"); sb.Append(s.SuddenDeathRound.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
                }
                AppendKey(sb, "scoreValues");
                sb.Append('[');
                for (int i = 0; i < s.ScoreValuesOrdered.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(s.ScoreValuesOrdered[i].ToString(CultureInfo.InvariantCulture));
                }
                sb.Append(']');
                sb.Append(',');
                AppendKey(sb, "playerCount"); sb.Append(s.PlayerCount.ToString(CultureInfo.InvariantCulture));
            }

            sb.Append('}');
            sb.Append('}');
            return sb.ToString();
        }

        public static string BuildRejectedAckJson(
            string reason,
            string matchInstanceId,
            bool hasSequence,
            long sequence,
            string rejectedEvent)
        {
            if (!PresentationRejectReasons.IsAllowed(reason))
            {
                reason = PresentationRejectReasons.InvalidEnvelope;
            }

            var sb = new StringBuilder(192);
            sb.Append('{');
            AppendKey(sb, "type"); AppendString(sb, UnityEventType); sb.Append(',');
            AppendKey(sb, "event"); AppendString(sb, "presentation_rejected"); sb.Append(',');
            AppendKey(sb, "payload");
            sb.Append('{');
            AppendKey(sb, "protocolVersion"); sb.Append(ProtocolVersion.ToString(CultureInfo.InvariantCulture)); sb.Append(',');

            if (!string.IsNullOrEmpty(matchInstanceId))
            {
                AppendKey(sb, "matchInstanceId"); AppendString(sb, matchInstanceId); sb.Append(',');
            }
            if (hasSequence)
            {
                AppendKey(sb, "sequence"); sb.Append(sequence.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
            }
            if (!string.IsNullOrEmpty(rejectedEvent))
            {
                AppendKey(sb, "rejectedEvent"); AppendString(sb, rejectedEvent); sb.Append(',');
            }
            AppendKey(sb, "reason"); AppendString(sb, reason);

            sb.Append('}');
            sb.Append('}');
            return sb.ToString();
        }

        public static string ResultToString(PenaltyVisualResult result)
        {
            switch (result)
            {
                case PenaltyVisualResult.GOAL: return "GOAL";
                case PenaltyVisualResult.SAVE: return "SAVE";
                default: return "DRAW";
            }
        }

        public static string EventKindToString(PresentationEventKind kind)
        {
            return kind == PresentationEventKind.RoundResult ? "round_result" : "match_state_sync";
        }

        private static void AppendKey(StringBuilder sb, string key)
        {
            AppendString(sb, key);
            sb.Append(':');
        }

        private static void AppendString(StringBuilder sb, string value)
        {
            sb.Append('"');
            if (value != null)
            {
                foreach (char c in value)
                {
                    switch (c)
                    {
                        case '"': sb.Append("\\\""); break;
                        case '\\': sb.Append("\\\\"); break;
                        case '\b': sb.Append("\\b"); break;
                        case '\f': sb.Append("\\f"); break;
                        case '\n': sb.Append("\\n"); break;
                        case '\r': sb.Append("\\r"); break;
                        case '\t': sb.Append("\\t"); break;
                        default:
                            if (c < 0x20)
                            {
                                sb.Append("\\u");
                                sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                            }
                            else
                            {
                                sb.Append(c);
                            }
                            break;
                    }
                }
            }
            sb.Append('"');
        }
    }

    /// <summary>
    /// Receiver-side presentation gate enforcing match-instance and sequence
    /// protection (§7). Pure/deterministic and independent of any Unity scene so
    /// it can be unit-validated. <see cref="Evaluate"/> NEVER mutates state; the
    /// caller must call <see cref="Commit"/> only after the scene application
    /// succeeds so malformed/rejected/failed messages never consume a sequence or
    /// change the active instance.
    /// </summary>
    public sealed class PresentationInstanceGate
    {
        public string ActiveMatchInstanceId { get; private set; }
        public string ActiveRoomCode { get; private set; }
        public long ActiveInstanceNumber { get; private set; }
        public long LastSequence { get; private set; }
        public bool HasActive { get { return ActiveMatchInstanceId != null; } }

        public struct GateResult
        {
            public bool Accepted;
            public bool ResetScene; // true when a fresh/new instance requires a scene reset
            public string Reason;   // allowlisted reason when rejected
        }

        private static GateResult Accept(bool resetScene)
        {
            return new GateResult { Accepted = true, ResetScene = resetScene, Reason = null };
        }

        private static GateResult Reject(string reason)
        {
            return new GateResult { Accepted = false, ResetScene = false, Reason = reason };
        }

        /// <summary>Evaluate whether a validated envelope may be applied. No mutation.</summary>
        public GateResult Evaluate(PresentationEnvelopeV1 env)
        {
            if (env == null) return Reject(PresentationRejectReasons.InvalidEnvelope);

            if (env.Event == PresentationEventKind.RoundResult)
            {
                // C. round_result: rejected before an active state; must match the
                // active instance; must have a higher sequence.
                if (!HasActive) return Reject(PresentationRejectReasons.NoActiveInstance);
                if (env.MatchInstanceId != ActiveMatchInstanceId)
                    return Reject(PresentationRejectReasons.ForeignInstance);
                if (env.Sequence <= LastSequence)
                    return Reject(PresentationRejectReasons.StaleOrDuplicate);
                return Accept(false);
            }

            // match_state_sync
            if (!HasActive)
            {
                // A. Fresh receiver/bootstrap: first accepted message must be a
                // complete match_state_sync, with any positive sequence.
                return Accept(true);
            }

            if (env.MatchInstanceId == ActiveMatchInstanceId)
            {
                // B. Same instance: require strictly increasing sequence.
                if (env.Sequence <= LastSequence)
                    return Reject(PresentationRejectReasons.StaleOrDuplicate);
                return Accept(false);
            }

            // D. Different instance id — only a same-room, strictly higher instance
            // number, with sequence exactly 1, may replace the active instance.
            if (env.RoomCode != ActiveRoomCode)
                return Reject(PresentationRejectReasons.ForeignInstance);
            if (env.InstanceNumber <= ActiveInstanceNumber)
                return Reject(PresentationRejectReasons.ForeignInstance);
            if (env.Sequence != 1)
                return Reject(PresentationRejectReasons.InvalidInstanceTransition);
            return Accept(true);
        }

        /// <summary>Commit the active instance + sequence AFTER a successful apply.</summary>
        public void Commit(PresentationEnvelopeV1 env)
        {
            if (env == null) return;
            ActiveMatchInstanceId = env.MatchInstanceId;
            ActiveRoomCode = env.RoomCode;
            ActiveInstanceNumber = env.InstanceNumber;
            LastSequence = env.Sequence;
        }

        /// <summary>Clear all gate state (e.g. teardown).</summary>
        public void Clear()
        {
            ActiveMatchInstanceId = null;
            ActiveRoomCode = null;
            ActiveInstanceNumber = 0;
            LastSequence = 0;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Bounded, exception-safe structural JSON reader (no regex for nested JSON,
    // no external package, WebGL/IL2CPP-safe). Produces a small immutable tree
    // and preserves each number's raw token so integer/fraction/overflow rules
    // can be enforced by the protocol validator. Object members are stored in
    // parse order and duplicate keys are flagged (never silently merged).
    // ════════════════════════════════════════════════════════════════════════

    internal enum JsonKind
    {
        Object,
        Array,
        String,
        Number,
        Bool,
        Null,
    }

    internal sealed class JsonValue
    {
        public JsonKind Kind;
        public string Str;      // String value
        public string NumRaw;   // Number raw token (Number only)
        public bool Bool;       // Bool value
        public List<KeyValuePair<string, JsonValue>> Members; // Object (ordered)
        public List<JsonValue> Items; // Array
        public bool HadDuplicateKey;  // Object had a repeated key

        public bool TryGet(string key, out JsonValue value)
        {
            value = null;
            if (Members == null) return false;
            for (int i = 0; i < Members.Count; i++)
            {
                if (Members[i].Key == key)
                {
                    value = Members[i].Value;
                    return true;
                }
            }
            return false;
        }
    }

    internal static class JsonReader
    {
        // Parse a complete JSON document. Returns false on any malformed input,
        // limit violation, or trailing content. Never throws.
        public static bool TryParse(string text, out JsonValue result)
        {
            result = null;
            if (text == null) return false;
            if (text.Length > UnityPresentationProtocolV1.MaxInputLength) return false;

            try
            {
                int pos = 0;
                SkipWhitespace(text, ref pos);
                JsonValue value;
                if (!ParseValue(text, ref pos, 1, out value)) return false;
                SkipWhitespace(text, ref pos);
                if (pos != text.Length) return false; // trailing content
                result = value;
                return true;
            }
            catch
            {
                result = null;
                return false;
            }
        }

        private static bool ParseValue(string s, ref int pos, int depth, out JsonValue value)
        {
            value = null;
            if (depth > UnityPresentationProtocolV1.MaxDepth) return false;
            SkipWhitespace(s, ref pos);
            if (pos >= s.Length) return false;

            char c = s[pos];
            switch (c)
            {
                case '{': return ParseObject(s, ref pos, depth, out value);
                case '[': return ParseArray(s, ref pos, depth, out value);
                case '"':
                    {
                        string str;
                        if (!ParseString(s, ref pos, out str)) return false;
                        value = new JsonValue { Kind = JsonKind.String, Str = str };
                        return true;
                    }
                case 't':
                case 'f':
                    return ParseBool(s, ref pos, out value);
                case 'n':
                    return ParseNull(s, ref pos, out value);
                default:
                    return ParseNumber(s, ref pos, out value);
            }
        }

        private static bool ParseObject(string s, ref int pos, int depth, out JsonValue value)
        {
            value = null;
            var obj = new JsonValue
            {
                Kind = JsonKind.Object,
                Members = new List<KeyValuePair<string, JsonValue>>(),
                HadDuplicateKey = false,
            };
            pos++; // consume '{'
            SkipWhitespace(s, ref pos);
            if (pos < s.Length && s[pos] == '}') { pos++; value = obj; return true; }

            while (true)
            {
                SkipWhitespace(s, ref pos);
                if (pos >= s.Length || s[pos] != '"') return false;
                string key;
                if (!ParseString(s, ref pos, out key)) return false;
                SkipWhitespace(s, ref pos);
                if (pos >= s.Length || s[pos] != ':') return false;
                pos++; // consume ':'
                JsonValue child;
                if (!ParseValue(s, ref pos, depth + 1, out child)) return false;

                for (int i = 0; i < obj.Members.Count; i++)
                {
                    if (obj.Members[i].Key == key) { obj.HadDuplicateKey = true; break; }
                }
                obj.Members.Add(new KeyValuePair<string, JsonValue>(key, child));

                SkipWhitespace(s, ref pos);
                if (pos >= s.Length) return false;
                if (s[pos] == ',') { pos++; continue; }
                if (s[pos] == '}') { pos++; value = obj; return true; }
                return false;
            }
        }

        private static bool ParseArray(string s, ref int pos, int depth, out JsonValue value)
        {
            value = null;
            var arr = new JsonValue { Kind = JsonKind.Array, Items = new List<JsonValue>() };
            pos++; // consume '['
            SkipWhitespace(s, ref pos);
            if (pos < s.Length && s[pos] == ']') { pos++; value = arr; return true; }

            while (true)
            {
                JsonValue child;
                if (!ParseValue(s, ref pos, depth + 1, out child)) return false;
                arr.Items.Add(child);
                SkipWhitespace(s, ref pos);
                if (pos >= s.Length) return false;
                if (s[pos] == ',') { pos++; continue; }
                if (s[pos] == ']') { pos++; value = arr; return true; }
                return false;
            }
        }

        private static bool ParseString(string s, ref int pos, out string result)
        {
            result = null;
            if (pos >= s.Length || s[pos] != '"') return false;
            pos++; // consume opening quote
            var sb = new StringBuilder();
            while (pos < s.Length)
            {
                char c = s[pos++];
                if (c == '"')
                {
                    if (sb.Length > UnityPresentationProtocolV1.MaxStringLength) return false;
                    result = sb.ToString();
                    return true;
                }
                if (c == '\\')
                {
                    if (pos >= s.Length) return false;
                    char esc = s[pos++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            {
                                if (pos + 4 > s.Length) return false;
                                int code = 0;
                                for (int i = 0; i < 4; i++)
                                {
                                    char h = s[pos++];
                                    int d;
                                    if (h >= '0' && h <= '9') d = h - '0';
                                    else if (h >= 'a' && h <= 'f') d = 10 + (h - 'a');
                                    else if (h >= 'A' && h <= 'F') d = 10 + (h - 'A');
                                    else return false;
                                    code = (code << 4) | d;
                                }
                                sb.Append((char)code);
                                break;
                            }
                        default:
                            return false;
                    }
                }
                else if (c < 0x20)
                {
                    return false; // raw control char in string
                }
                else
                {
                    sb.Append(c);
                }

                if (sb.Length > UnityPresentationProtocolV1.MaxStringLength) return false;
            }
            return false; // unterminated string
        }

        private static bool ParseNumber(string s, ref int pos, out JsonValue value)
        {
            value = null;
            int start = pos;
            if (pos < s.Length && s[pos] == '-') pos++;
            bool anyDigit = false;
            while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') { pos++; anyDigit = true; }
            if (pos < s.Length && s[pos] == '.')
            {
                pos++;
                while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') { pos++; anyDigit = true; }
            }
            if (pos < s.Length && (s[pos] == 'e' || s[pos] == 'E'))
            {
                pos++;
                if (pos < s.Length && (s[pos] == '+' || s[pos] == '-')) pos++;
                bool expDigit = false;
                while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') { pos++; expDigit = true; }
                if (!expDigit) return false;
            }
            if (!anyDigit) return false;
            value = new JsonValue { Kind = JsonKind.Number, NumRaw = s.Substring(start, pos - start) };
            return true;
        }

        private static bool ParseBool(string s, ref int pos, out JsonValue value)
        {
            value = null;
            if (Matches(s, pos, "true")) { pos += 4; value = new JsonValue { Kind = JsonKind.Bool, Bool = true }; return true; }
            if (Matches(s, pos, "false")) { pos += 5; value = new JsonValue { Kind = JsonKind.Bool, Bool = false }; return true; }
            return false;
        }

        private static bool ParseNull(string s, ref int pos, out JsonValue value)
        {
            value = null;
            if (Matches(s, pos, "null")) { pos += 4; value = new JsonValue { Kind = JsonKind.Null }; return true; }
            return false;
        }

        private static bool Matches(string s, int pos, string literal)
        {
            if (pos + literal.Length > s.Length) return false;
            for (int i = 0; i < literal.Length; i++)
            {
                if (s[pos + i] != literal[i]) return false;
            }
            return true;
        }

        private static void SkipWhitespace(string s, ref int pos)
        {
            while (pos < s.Length)
            {
                char c = s[pos];
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }
    }
}
