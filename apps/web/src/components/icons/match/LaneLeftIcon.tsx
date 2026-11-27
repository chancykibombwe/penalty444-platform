import ArenaRasterIcon from "../ArenaRasterIcon";
import { LANE_ICON_SRC } from "./assets";

export type LaneLeftIconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D LEFT lane indicator (presentation-only). */
export default function LaneLeftIcon({
  size = 32,
  className = "",
  decorative = false,
}: LaneLeftIconProps) {
  return (
    <ArenaRasterIcon
      src={LANE_ICON_SRC.left}
      size={size}
      className={className}
      decorative={decorative}
      label="Left lane"
    />
  );
}
