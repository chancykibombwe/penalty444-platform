/**
 * Shared raster `<img>` wrapper for Stage 6O-D2c approved 3D PNG icons.
 * Presentation-only. Not part of the D2a Lucide public API.
 */

export type ArenaRasterIconProps = {
  /** Public URL under `/icons/...`. */
  src: string;
  /**
   * Authoritative rendered size in CSS pixels (square).
   * Prefer this over CSS width/height in `className`.
   * @default 32
   */
  size?: number;
  /**
   * Non-sizing styles only (margin, opacity, etc.).
   * Do not use `className` to override width/height.
   */
  className?: string;
  /**
   * When true: decorative (`alt=""` + `aria-hidden`).
   * When false: `alt` / accessible name comes from `label`.
   * @default false
   */
  decorative?: boolean;
  /** Accessible name when not decorative. */
  label: string;
};

export default function ArenaRasterIcon({
  src,
  size = 32,
  className = "",
  decorative = false,
  label,
}: ArenaRasterIconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- approved 3D PNG brand/game art; next/image not required for foundation
    <img
      src={src}
      width={size}
      height={size}
      alt={decorative ? "" : label}
      aria-hidden={decorative || undefined}
      decoding="async"
      draggable={false}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      style={{ width: size, height: size, aspectRatio: "1 / 1" }}
    />
  );
}
