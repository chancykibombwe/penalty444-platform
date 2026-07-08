// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// Placeholder animation controller. Plays simple, deterministic, time-based
// transform animations (plus Debug.Log markers) for goal / save / draw / reset
// so the visual state machine can be exercised locally before real animation
// clips exist. It has NO result authority — it is always TOLD which animation
// to play, from state the Node realtime server already resolved. No physics is
// used as gameplay authority; no networking; no score/result calculation.

using System.Collections;
using UnityEngine;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Placeholder goal / save / draw / reset presentation. Real animation
    /// (Animator clips, tweens, VFX) replaces these transform tweens later.
    /// Every routine tweens from the captured idle pose, so repeated events
    /// never accumulate drift, and <see cref="PlayReset"/> always restores a
    /// clean baseline.
    /// </summary>
    public sealed class ResultAnimator : MonoBehaviour
    {
        [Tooltip("Ball placeholder to animate. Optional — logs only when unset.")]
        [SerializeField] private Transform ballPlaceholder;

        [Tooltip("Keeper placeholder to animate. Optional — logs only when unset.")]
        [SerializeField] private Transform keeperPlaceholder;

        [Header("Placeholder move distances (local units)")]
        [SerializeField] private float goalBallForward = 2.4f;
        [SerializeField] private float keeperLeanSide = 1.1f;
        [SerializeField] private float keeperLungeForward = 0.35f;
        [SerializeField] private float saveBallRecoil = 0.7f;
        [SerializeField] private float drawShakeAmount = 0.18f;

        [Header("Timings (seconds) & emphasis")]
        [SerializeField] private float goalDuration = 0.45f;
        [SerializeField] private float saveDuration = 0.40f;
        [SerializeField] private float drawDuration = 0.55f;
        [Range(1f, 1.6f)]
        [SerializeField] private float ballPulseScale = 1.18f;

        // Idle poses captured on load so animations tween from — and PlayReset()
        // restores to — a stable baseline.
        private Vector3 ballIdlePosition;
        private Vector3 ballIdleScale;
        private Vector3 keeperIdlePosition;
        private bool idlePosesCaptured;

        private Coroutine active;

        private void Awake() => CaptureIdlePoses();

        /// <summary>Goal: ball travels forward into the net with a scale pulse.</summary>
        public void PlayGoal()
        {
            CaptureIdlePoses();
            Restart(GoalRoutine());
            Debug.Log("[ResultAnimator] PlayGoal (placeholder).");
        }

        /// <summary>Save: keeper leans toward the shot; ball recoils and settles.</summary>
        public void PlaySave() => PlaySave(0f);

        /// <summary>
        /// Save with a horizontal direction hint in [-1, 1] (−1 = keeper leans
        /// left, 0 = center, +1 = right) so the dive reads toward the shot lane.
        /// Presentation only — the direction is a display hint, not authority.
        /// </summary>
        public void PlaySave(float keeperDir)
        {
            CaptureIdlePoses();
            Restart(SaveRoutine(Mathf.Clamp(keeperDir, -1f, 1f)));
            Debug.Log($"[ResultAnimator] PlaySave (placeholder) dir={keeperDir:0.##}.");
        }

        /// <summary>Draw: a small neutral shake + subtle pulse, no winner emphasis.</summary>
        public void PlayDraw()
        {
            CaptureIdlePoses();
            Restart(DrawRoutine());
            Debug.Log("[ResultAnimator] PlayDraw (placeholder).");
        }

        /// <summary>Restore all placeholders to their captured idle poses.</summary>
        public void PlayReset()
        {
            StopActive();
            ApplyIdlePose();
            Debug.Log("[ResultAnimator] PlayReset (placeholder).");
        }

        // ── Routines ─────────────────────────────────────────────────────────

        private IEnumerator GoalRoutine()
        {
            ApplyIdlePose();
            var from = ballIdlePosition;
            var to = ballIdlePosition + Vector3.forward * goalBallForward;

            for (float t = 0f; t < 1f; t += DeltaOver(goalDuration))
            {
                float e = Mathf.SmoothStep(0f, 1f, t);
                if (ballPlaceholder != null)
                {
                    ballPlaceholder.localPosition = Vector3.Lerp(from, to, e);
                    ballPlaceholder.localScale = ballIdleScale * PulseCurve(t);
                }
                yield return null;
            }

            if (ballPlaceholder != null)
            {
                ballPlaceholder.localPosition = to;      // leave ball in the net
                ballPlaceholder.localScale = ballIdleScale;
            }
            active = null;
        }

        private IEnumerator SaveRoutine(float keeperDir)
        {
            ApplyIdlePose();
            var keeperFrom = keeperIdlePosition;
            var keeperTo = keeperIdlePosition
                + Vector3.right * (keeperLeanSide * keeperDir)
                + Vector3.forward * keeperLungeForward;

            var ballFrom = ballIdlePosition;
            var ballRecoil = ballIdlePosition - Vector3.forward * saveBallRecoil;

            for (float t = 0f; t < 1f; t += DeltaOver(saveDuration))
            {
                float e = Mathf.SmoothStep(0f, 1f, t);
                if (keeperPlaceholder != null)
                    keeperPlaceholder.localPosition = Vector3.Lerp(keeperFrom, keeperTo, e);
                if (ballPlaceholder != null)
                {
                    // Ball darts out to the recoil point, then eases back to idle.
                    float ballE = Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI); // 0→1→0
                    ballPlaceholder.localPosition = Vector3.Lerp(ballFrom, ballRecoil, ballE);
                }
                yield return null;
            }

            // Keeper holds the save pose (reset restores it); ball returns to idle.
            if (keeperPlaceholder != null) keeperPlaceholder.localPosition = keeperTo;
            if (ballPlaceholder != null) ballPlaceholder.localPosition = ballIdlePosition;
            active = null;
        }

        private IEnumerator DrawRoutine()
        {
            ApplyIdlePose();
            for (float t = 0f; t < 1f; t += DeltaOver(drawDuration))
            {
                // Deterministic decaying left-right jitter (no Random, so mock
                // runs are repeatable). Amplitude fades as t → 1.
                float decay = 1f - Mathf.Clamp01(t);
                float shake = Mathf.Sin(t * Mathf.PI * 6f) * drawShakeAmount * decay;
                if (ballPlaceholder != null)
                {
                    ballPlaceholder.localPosition = ballIdlePosition + Vector3.right * shake;
                    ballPlaceholder.localScale = ballIdleScale * Mathf.Lerp(1f, 1.06f, decay * 0.5f);
                }
                yield return null;
            }
            ApplyIdlePose();
            active = null;
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        // Scale pulse that rises then falls over the tween (peaks at t≈0.5).
        private float PulseCurve(float t) =>
            Mathf.Lerp(1f, ballPulseScale, Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI));

        private static float DeltaOver(float duration) =>
            duration <= 0f ? 1f : Time.deltaTime / duration;

        private void Restart(IEnumerator routine)
        {
            StopActive();
            if (isActiveAndEnabled)
            {
                active = StartCoroutine(routine);
            }
        }

        private void StopActive()
        {
            if (active != null)
            {
                StopCoroutine(active);
                active = null;
            }
        }

        private void ApplyIdlePose()
        {
            if (!idlePosesCaptured) return;
            if (ballPlaceholder != null)
            {
                ballPlaceholder.localPosition = ballIdlePosition;
                ballPlaceholder.localScale = ballIdleScale;
            }
            if (keeperPlaceholder != null)
            {
                keeperPlaceholder.localPosition = keeperIdlePosition;
            }
        }

        private void CaptureIdlePoses()
        {
            if (idlePosesCaptured) return;
            if (ballPlaceholder != null)
            {
                ballIdlePosition = ballPlaceholder.localPosition;
                ballIdleScale = ballPlaceholder.localScale;
            }
            else
            {
                ballIdleScale = Vector3.one;
            }
            if (keeperPlaceholder != null) keeperIdlePosition = keeperPlaceholder.localPosition;
            idlePosesCaptured = true;
        }
    }
}
