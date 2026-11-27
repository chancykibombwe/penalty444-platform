import ArenaRasterIcon from "../ArenaRasterIcon";
import { GAME_ICON_SRC } from "./assets";

export type Card444IconProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
};

/** Approved 3D Card444 game icon (presentation-only; Coming Soon). */
export default function Card444Icon({
  size = 32,
  className = "",
  decorative = false,
}: Card444IconProps) {
  return (
    <ArenaRasterIcon
      src={GAME_ICON_SRC.card444}
      size={size}
      className={className}
      decorative={decorative}
      label="Card444"
    />
  );
}
