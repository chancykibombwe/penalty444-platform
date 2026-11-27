import ArenaRasterIcon from "../ArenaRasterIcon";
import { GAME_ICON_SRC } from "./assets";

export type Chess444IconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D Chess444 game icon (presentation-only; Coming Soon). */
export default function Chess444Icon({
  size = 32,
  className = "",
  decorative = false,
}: Chess444IconProps) {
  return (
    <ArenaRasterIcon
      src={GAME_ICON_SRC.chess444}
      size={size}
      className={className}
      decorative={decorative}
      label="Chess444"
    />
  );
}
