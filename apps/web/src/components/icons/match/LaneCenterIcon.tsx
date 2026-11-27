import ArenaRasterIcon from "../ArenaRasterIcon";
import { LANE_ICON_SRC } from "./assets";

export type LaneCenterIconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D CENTER lane indicator (presentation-only). */
export default function LaneCenterIcon({
  size = 32,
  className = "",
  decorative = false,
}: LaneCenterIconProps) {
  return (
    <ArenaRasterIcon
      src={LANE_ICON_SRC.center}
      size={size}
      className={className}
      decorative={decorative}
      label="Center lane"
    />
  );
}
