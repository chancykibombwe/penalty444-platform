import ArenaRasterIcon from "../ArenaRasterIcon";
import { GAME_ICON_SRC } from "./assets";

export type Crush444IconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D Crush444 game icon (presentation-only; Coming Soon). */
export default function Crush444Icon({
  size = 32,
  className = "",
  decorative = false,
}: Crush444IconProps) {
  return (
    <ArenaRasterIcon
      src={GAME_ICON_SRC.crush444}
      size={size}
      className={className}
      decorative={decorative}
      label="Crush444"
    />
  );
}
