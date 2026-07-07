// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// Placeholder animation controller. Plays simple transform-nudge "animations"
// (plus Debug.Log markers) for goal / save / draw / reset so the visual state
// machine can be exercised locally before real animations exist. It has no
// result authority — it is always TOLD which animation to play, from state the
// server already resolved.

using UnityEngine;

namespace Penalty444.Prototype
{
    /// <summary>
    /// Placeholder goal / save / draw / reset presentation. Real animation
    /// (Animator clips, tweens, VFX) replaces the transform nudges later.
    /// </summary>
    public sealed class ResultAnimator : MonoBehaviour
    {
        [Tooltip("Ball placeholder to nudge. Optional — logs only when unset.")]
        [SerializeField] private Transform ballPlaceholder;

        [Tooltip("Keeper placeholder to nudge. Optional — logs only when unset.")]
        [SerializeField] private Transform keeperPlaceholder;

        [Header("Placeholder nudge distances (local units)")]
        [SerializeField] private float goalBallForward = 2.0f;
        [SerializeField] private float saveKeeperSide = 1.0f;

        // Idle poses captured on load so PlayReset() can restore them.
        private Vector3 ballIdlePosition;
        private Vector3 keeperIdlePosition;
        private bool idlePosesCaptured;

        private void Awake()
        {
            CaptureIdlePoses();
        }

        /// <summary>Goal placeholder: ball nudged into the net.</summary>
        public void PlayGoal()
        {
            CaptureIdlePoses();
            if (ballPlaceholder != null)
            {
                ballPlaceholder.localPosition = ballIdlePosition + Vector3.forward * goalBallForward;
            }
            Debug.Log("[ResultAnimator] PlayGoal (placeholder).");
        }

        /// <summary>Save placeholder: keeper nudged sideways, ball stays out.</summary>
        public void PlaySave()
        {
            CaptureIdlePoses();
            if (keeperPlaceholder != null)
            {
                keeperPlaceholder.localPosition = keeperIdlePosition + Vector3.right * saveKeeperSide;
            }
            Debug.Log("[ResultAnimator] PlaySave (placeholder).");
        }

        /// <summary>Draw placeholder: no movement, log marker only for now.</summary>
        public void PlayDraw()
        {
            Debug.Log("[ResultAnimator] PlayDraw (placeholder).");
        }

        /// <summary>Restore all placeholders to their captured idle poses.</summary>
        public void PlayReset()
        {
            if (idlePosesCaptured)
            {
                if (ballPlaceholder != null) ballPlaceholder.localPosition = ballIdlePosition;
                if (keeperPlaceholder != null) keeperPlaceholder.localPosition = keeperIdlePosition;
            }
            Debug.Log("[ResultAnimator] PlayReset (placeholder).");
        }

        private void CaptureIdlePoses()
        {
            if (idlePosesCaptured) return;
            if (ballPlaceholder != null) ballIdlePosition = ballPlaceholder.localPosition;
            if (keeperPlaceholder != null) keeperIdlePosition = keeperPlaceholder.localPosition;
            idlePosesCaptured = true;
        }
    }
}
