/**
 * Stage 6O-D2c-a — centralized paths for approved 3D match-lane PNG icons.
 * Swap the files under `apps/web/public/icons/match/` to replace artwork
 * without changing consumers. Intrinsic size: 512×512 RGBA.
 */

export const LANE_ICON_SRC = {
  left: "/icons/match/lane-left.png",
  center: "/icons/match/lane-center.png",
  right: "/icons/match/lane-right.png",
} as const;

export type LaneIconId = keyof typeof LANE_ICON_SRC;
