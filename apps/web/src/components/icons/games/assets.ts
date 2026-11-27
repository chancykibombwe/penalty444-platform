/**
 * Stage 6O-D2c-a — centralized paths for approved 3D game PNG icons.
 * Swap the files under `apps/web/public/icons/games/` to replace artwork
 * without changing consumers. Intrinsic size: 512×512 RGBA.
 */

export const GAME_ICON_SRC = {
  penalty444: "/icons/games/penalty444.png",
  chess444: "/icons/games/chess444.png",
  draught444: "/icons/games/draught444.png",
  crush444: "/icons/games/crush444.png",
  card444: "/icons/games/card444.png",
} as const;

export type GameIconId = keyof typeof GAME_ICON_SRC;
