// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// A LEFT / CENTER / RIGHT lane marker in the prototype scene. Pure visual
// highlight — it displays which lane an already-resolved event refers to.
// It has no gameplay authority: it never captures input as a pick, never
// decides outcomes, and never talks to the network.

using System.Collections;
using UnityEngine;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Visual lane marker. Tint states: idle, selected (keeper dive lane),
    /// success (goal lane), failed (saved/missed lane). An optional brief scale
    /// pulse on non-idle states makes the highlighted lane easier to read.
    /// Presentation only.
    /// </summary>
    public sealed class LaneTarget : MonoBehaviour
    {
        [Tooltip("Which lane this marker represents (presentation only).")]
        [SerializeField] private PenaltyLane lane = PenaltyLane.CENTER;

        [Tooltip("Renderer to tint. If unset, the first Renderer on this GameObject is used.")]
        [SerializeField] private Renderer targetRenderer;

        [Header("Placeholder tint colors")]
        [SerializeField] private Color idleColor = new Color(0.55f, 0.55f, 0.55f, 1f);
        [SerializeField] private Color selectedColor = new Color(1f, 0.85f, 0.2f, 1f);
        [SerializeField] private Color successColor = new Color(0.2f, 0.85f, 0.35f, 1f);
        [SerializeField] private Color failedColor = new Color(0.9f, 0.25f, 0.25f, 1f);

        [Header("Highlight pulse (visual only)")]
        [SerializeField] private bool enablePulse = true;
        [Range(1f, 1.6f)]
        [SerializeField] private float pulseScale = 1.15f;
        [SerializeField] private float pulseDuration = 0.22f;

        /// <summary>Which lane this marker represents.</summary>
        public PenaltyLane Lane => lane;

        private Vector3 idleScale;
        private bool idleScaleCaptured;
        private Coroutine pulse;

        private void Awake()
        {
            if (targetRenderer == null) targetRenderer = GetComponent<Renderer>();
            idleScale = transform.localScale;
            idleScaleCaptured = true;
        }

        public void SetIdle() => ApplyState(idleColor, "idle", pulseOnChange: false);

        /// <summary>Highlight as the keeper's chosen dive lane (already resolved).</summary>
        public void SetSelected() => ApplyState(selectedColor, "selected", pulseOnChange: true);

        /// <summary>Highlight as the lane where a goal was scored.</summary>
        public void SetSuccess() => ApplyState(successColor, "success", pulseOnChange: true);

        /// <summary>Highlight as the lane where the shot was saved/failed.</summary>
        public void SetFailed() => ApplyState(failedColor, "failed", pulseOnChange: true);

        private void ApplyState(Color color, string stateName, bool pulseOnChange)
        {
            if (targetRenderer != null && targetRenderer.material != null)
            {
                targetRenderer.material.color = color;
            }
            else
            {
                Debug.Log($"[LaneTarget:{lane}] {stateName} (no renderer assigned — log only).");
            }

            StopPulse();
            if (pulseOnChange && enablePulse && isActiveAndEnabled)
            {
                pulse = StartCoroutine(PulseRoutine());
            }
            else
            {
                RestoreIdleScale();
            }
        }

        private IEnumerator PulseRoutine()
        {
            if (!idleScaleCaptured) yield break;
            for (float t = 0f; t < 1f; t += (pulseDuration <= 0f ? 1f : Time.deltaTime / pulseDuration))
            {
                float s = Mathf.Lerp(1f, pulseScale, Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI));
                transform.localScale = idleScale * s;
                yield return null;
            }
            RestoreIdleScale();
            pulse = null;
        }

        private void StopPulse()
        {
            if (pulse != null)
            {
                StopCoroutine(pulse);
                pulse = null;
            }
        }

        private void RestoreIdleScale()
        {
            if (idleScaleCaptured) transform.localScale = idleScale;
        }
    }
}
