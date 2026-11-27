# 444 ARENA — Stage 6O-D2c 3D icon assets

Owner-approved **3D PNG** icons for games and match lanes.
Flat SVG / Lucide / emoji substitutes were **rejected** for this slice.

## Provenance

- Pack: `444-ARENA-D2c-3D-icons` (owner-supplied)
- Format: RGBA PNG, **512×512**, approximate transparency from the approved 3D sheet
- Not editable 3D source files; raster only
- Pack README: review transparency halos on dark and light backgrounds
- Claude independent review: **CONDITIONAL PASS** (no P0)

## Image optimization (lossless)

- Tool: **oxipng 10.2.1** (`-o 6 --strip safe`) — system tool, not an npm dependency
- Gate: optimized files accepted only when **decoded RGBA pixels are byte-identical** to the approved originals, dimensions remain **512×512**, and alpha (PNG colorType 6) is preserved
- Result: **all 8** PNGs replaced with pixel-identical smaller encodings
- Original total: **1,795,160** bytes
- Final total: **1,681,710** bytes
- Reduction: **113,450** bytes (**6.32%**)
- No lossy quantization, no resize, no background flatten, no SVG/Lucide substitution

### Per-file sizes (original → final)

| File | Original | Final | Saved |
| --- | ---: | ---: | ---: |
| `games/penalty444.png` | 275,131 | 259,391 | 15,740 |
| `games/chess444.png` | 242,595 | 226,831 | 15,764 |
| `games/draught444.png` | 244,919 | 233,417 | 11,502 |
| `games/crush444.png` | 226,352 | 215,265 | 11,087 |
| `games/card444.png` | 232,866 | 219,304 | 13,562 |
| `match/lane-left.png` | 194,456 | 180,780 | 13,676 |
| `match/lane-center.png` | 177,791 | 160,293 | 17,498 |
| `match/lane-right.png` | 201,050 | 186,429 | 14,621 |

## Inventory and SHA-256 (final encoded bytes)

| File | Role | SHA-256 |
| --- | --- | --- |
| `games/penalty444.png` | Penalty444 (live) | `5ea3267228a86235134233ff5b16d6d32d6edbbae133a9679b52e904bb0c4f2e` |
| `games/chess444.png` | Chess444 (Coming Soon) | `3e7016a163656619afaf79dbd22ac6febee429bc26a3aa33936c6a87849463fe` |
| `games/draught444.png` | Draught444 (Coming Soon) | `541e4766000e57a098599ff0d26a0d1cc2e283ebe7c868a149e5b7ac18175aa5` |
| `games/crush444.png` | Crush444 (Coming Soon) | `6363eafa617cf609917eed76b5a9b9bd60d4d87da16069a69ebe0b6fc40527a6` |
| `games/card444.png` | Card444 (Coming Soon) | `8dfc334dd2e277dfbcdf75e23a075ab575b82c13fda06d39dd7c316f7ae183f1` |
| `match/lane-left.png` | LEFT lane (↙) | `2b27e336e58905070e7f96cadce32a889d076d2bf61b426586eec64f4a86ad3e` |
| `match/lane-center.png` | CENTER lane (↑) | `6909c23eac14d8bb3d4f184a5aab05b0bc9b0be636265f973486a46cd964482e` |
| `match/lane-right.png` | RIGHT lane (↘) | `3125bad1d7340cc8c4f44d72a16778f0070b8da7bd6933750b03948d0de44dbd` |

Decoded artwork matches the owner pack (`MANIFEST.json` source hashes) pixel-for-pixel; file SHA-256 values above are the **post-oxipng** encodings.

## Lane meanings (do not flip in this foundation)

- LEFT → ↙
- CENTER → ↑
- RIGHT → ↘

Presentation / orientation semantics are deferred to D2c-c review.

## Replacement

1. Replace the PNG under the same path (keep filename).
2. Re-check SHA-256 and update this table.
3. Consumers import React wrappers from `components/icons/games` or `components/icons/match` — no path edits required if filenames stay stable.

## Deferred (D2c-b / D2c-c UI wiring)

- Use appropriate responsive image delivery (e.g. Next.js `Image`) when wiring UI consumers.
- Assess loading and mobile payload before merge of consumer PRs.
- Do **not** resize these foundation source assets to 128×128 in this slice.

## Scope

D2c-a is foundation only. Do not wire into GameCard, Home, or MatchRoomPanel in this slice.
Coming Soon games must remain non-interactive when later wired.
