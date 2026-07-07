// Penalty444 — Unity Phase B2 local prototype scaffold.
//
// PRESENTATION-ONLY TYPES. These enums exist purely so the Unity prototype can
// animate already-resolved match state that React forwards from the Node
// realtime server (the single source of truth). They do NOT replace, mirror
// authority for, or feed back into the server/web types (`Lane`, `ShotResult`,
// `MatchPhase` in apps/web). Unity never computes official results, never
// submits picks, and never writes stats or match results.

namespace Penalty444.Prototype
{
    /// <summary>
    /// Visual lane marker identity (LEFT / CENTER / RIGHT). Presentation only —
    /// mirrors the web `Lane` vocabulary for display, carries no authority.
    /// </summary>
    public enum PenaltyLane
    {
        LEFT,
        CENTER,
        RIGHT,
    }

    /// <summary>
    /// Visual outcome of an already-resolved round or match, used only to pick
    /// which placeholder animation to play. The server decided the real result
    /// long before Unity ever sees it.
    /// </summary>
    public enum PenaltyVisualResult
    {
        GOAL,
        SAVE,
        DRAW,
    }

    /// <summary>
    /// Scene-level visual state machine for the prototype. Purely presentation
    /// pacing — no relation to server match phases or timers.
    /// </summary>
    public enum PenaltyVisualState
    {
        Idle,
        Staging,
        Revealing,
        Result,
        Ended,
    }
}
