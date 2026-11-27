/**
 * Stage 6O-D2b — centralized brand asset paths.
 *
 * Future logo replacement: update the files under `apps/web/public/brand/`
 * (and mirror favicon / apple-icon into `apps/web/src/app/` per README).
 * Keep these path constants stable so consumers do not need code changes.
 */

/** Full 444 ARENA wordmark (transparent SVG). Intrinsic 1240×400. */
export const BRAND_WORDMARK_SRC = "/brand/444-arena-wordmark.svg" as const;

/**
 * High-resolution wordmark PNG (transparent). Intrinsic 2480×800.
 * Alternative / external-use export — not an automatic runtime fallback.
 */
export const BRAND_WORDMARK_PNG_SRC =
  "/brand/444-arena-wordmark-2480.png" as const;

/** Standalone mark / shield (transparent SVG). Intrinsic 512×512. */
export const BRAND_MARK_SRC = "/brand/444-arena-mark.svg" as const;

/**
 * High-resolution mark PNG (transparent). Intrinsic 1024×1024.
 * Alternative / external-use export — not an automatic runtime fallback.
 */
export const BRAND_MARK_PNG_SRC = "/brand/444-arena-mark-1024.png" as const;

/** Accessible brand name used when the image is meaningful. */
export const BRAND_NAME = "444 ARENA" as const;

/** Wordmark aspect ratio (width / height) from the SVG viewBox 1240×400. */
export const BRAND_WORDMARK_ASPECT = 1240 / 400;

/** Mark aspect ratio (square). */
export const BRAND_MARK_ASPECT = 1;
