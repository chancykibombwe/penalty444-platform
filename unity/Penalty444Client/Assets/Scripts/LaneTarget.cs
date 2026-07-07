// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// A LEFT / CENTER / RIGHT lane marker in the prototype scene. Pure visual
// highlight — it displays which lane an already-resolved event refers to.
// It has no gameplay authority: it never captures input as a pick, never
// decides outcomes, and never talks to the network.

using UnityEngine;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Visual lane marker. Tint states: idle, selected (keeper dive lane),
    /// success (goal lane), failed (saved/missed lane).
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

        /// <summary>Which lane this marker represents.</summary>
        public PenaltyLane Lane => lane;

        private void Awake()
        {
            if (targetRenderer == null) targetRenderer = GetComponent<Renderer>();
        }

        public void SetIdle() => ApplyColor(idleColor, "idle");

        /// <summary>Highlight as the keeper's chosen dive lane (already resolved).</summary>
        public void SetSelected() => ApplyColor(selectedColor, "selected");

        /// <summary>Highlight as the lane where a goal was scored.</summary>
        public void SetSuccess() => ApplyColor(successColor, "success");

        /// <summary>Highlight as the lane where the shot was saved/failed.</summary>
        public void SetFailed() => ApplyColor(failedColor, "failed");

        private void ApplyColor(Color color, string stateName)
        {
            if (targetRenderer != null && targetRenderer.material != null)
            {
                targetRenderer.material.color = color;
            }
            else
            {
                Debug.Log($"[LaneTarget:{lane}] {stateName} (no renderer assigned — log only).");
            }
        }
    }
}
