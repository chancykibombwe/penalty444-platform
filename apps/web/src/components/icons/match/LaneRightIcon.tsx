import ArenaRasterIcon from "../ArenaRasterIcon";
import { LANE_ICON_SRC } from "./assets";

export type LaneRightIconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D RIGHT lane indicator (presentation-only). */
export default function LaneRightIcon({
  size = 32,
  className = "",
  decorative = false,
}: LaneRightIconProps) {
  return (
    <ArenaRasterIcon
      src={LANE_ICON_SRC.right}
      size={size}
      className={className}
      decorative={decorative}
      label="Right lane"
    />
  );
}
