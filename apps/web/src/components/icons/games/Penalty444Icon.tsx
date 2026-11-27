import ArenaRasterIcon from "../ArenaRasterIcon";
import { GAME_ICON_SRC } from "./assets";

export type Penalty444IconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D Penalty444 game icon (presentation-only). */
export default function Penalty444Icon({
  size = 32,
  className = "",
  decorative = false,
}: Penalty444IconProps) {
  return (
    <ArenaRasterIcon
      src={GAME_ICON_SRC.penalty444}
      size={size}
      className={className}
      decorative={decorative}
      label="Penalty444"
    />
  );
}
