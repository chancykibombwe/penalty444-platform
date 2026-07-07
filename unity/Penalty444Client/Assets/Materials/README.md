# Materials — Penalty444 3D prototype

Small solid-color Standard-shader materials for the `Penalty444Prototype`
scene (PR #190): `ArenaFloor`, `GoalFrame`, `KickerPlaceholder`,
`KeeperPlaceholder`, `Ball`, `LaneIdle`. No textures, no external asset packs.

Lane selected/success/failed states are runtime tints applied by
`LaneTarget.cs` on top of `LaneIdle` — they don't need separate material
assets.
