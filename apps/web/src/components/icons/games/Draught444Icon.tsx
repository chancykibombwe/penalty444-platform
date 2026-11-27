import ArenaRasterIcon from "../ArenaRasterIcon";
import { GAME_ICON_SRC } from "./assets";

export type Draught444IconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D Draught444 game icon (presentation-only; Coming Soon). */
export default function Draught444Icon({
  size = 32,
  className = "",
  decorative = false,
}: Draught444IconProps) {
  return (
    <ArenaRasterIcon
      src={GAME_ICON_SRC.draught444}
      size={size}
      className={className}
      decorative={decorative}
      label="Draught444"
    />
  );
}
