import { BRAND_MARK_ASPECT, BRAND_MARK_SRC, BRAND_NAME } from "./assets";

export type LogoMarkProps = {
  /**
   * Authoritative rendered size (square) in CSS pixels.
   * Prefer this prop (not CSS width/height in `className`) for sizing.
   * @default 28
   */
  size?: number;
  /**
   * Non-sizing styles only (e.g. margins, opacity). Do not use `className` to
   * override width/height — `size` is the sizing API.
   */
  className?: string;
  /**
   * When true, the image is treated as decorative (`alt=""` + `aria-hidden`).
   * Use when adjacent visible text already identifies the brand.
   * When false, `alt` is the brand name.
   * @default false
   */
  decorative?: boolean;
  /** Optional priority hint for LCP-sensitive placements. */
  priority?: boolean;
};

/**
 * 444 ARENA logo mark — centralized SVG from `/brand/444-arena-mark.svg`.
 * Presentation-only. Swap the public brand file to update all consumers.
 */
export default function LogoMark({
  size = 28,
  className = "",
  decorative = false,
  priority = false,
}: LogoMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG brand asset; next/image SVG support is limited
    <img
      src={BRAND_MARK_SRC}
      width={size}
      height={size}
      alt={decorative ? "" : BRAND_NAME}
      aria-hidden={decorative || undefined}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      draggable={false}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      style={{ width: size, height: size, aspectRatio: `${BRAND_MARK_ASPECT}` }}
    />
  );
}
