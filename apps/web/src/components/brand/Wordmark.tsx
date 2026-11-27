import {
  BRAND_NAME,
  BRAND_WORDMARK_ASPECT,
  BRAND_WORDMARK_SRC,
} from "./assets";

export type WordmarkProps = {
  /**
   * Authoritative rendered height in CSS pixels. Width is derived from the
   * intrinsic aspect ratio to avoid layout shift and stretching.
   * Prefer this prop (not CSS width/height in `className`) for sizing.
   * @default 28
   */
  height?: number;
  /**
   * Non-sizing styles only (e.g. margins, opacity). Do not use `className` to
   * override width/height — `height` is the sizing API.
   */
  className?: string;
  /**
   * When true, the image is treated as decorative (`alt=""` + `aria-hidden`).
   * Use when adjacent visible text already identifies the brand (e.g. a
   * nav link with "444 ARENA" text). When false, `alt` is the brand name.
   * @default false
   */
  decorative?: boolean;
  /** Optional priority hint for LCP-sensitive placements. */
  priority?: boolean;
};

/**
 * 444 ARENA wordmark — centralized SVG from `/brand/444-arena-wordmark.svg`.
 * Presentation-only. Swap the public brand file to update all consumers.
 */
export default function Wordmark({
  height = 28,
  className = "",
  decorative = false,
  priority = false,
}: WordmarkProps) {
  const width = Math.round(height * BRAND_WORDMARK_ASPECT);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG brand asset; next/image SVG support is limited
    <img
      src={BRAND_WORDMARK_SRC}
      width={width}
      height={height}
      alt={decorative ? "" : BRAND_NAME}
      aria-hidden={decorative || undefined}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      draggable={false}
      className={`inline-block max-w-full object-contain object-left ${className}`.trim()}
      style={{ width, height, aspectRatio: `${BRAND_WORDMARK_ASPECT}` }}
    />
  );
}
