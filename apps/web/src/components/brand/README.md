# Arena brand foundation (Stage 6O-D2b)

Centralized, replaceable 444 ARENA logo assets and React components.

## Public assets

| File | Role |
| --- | --- |
| `/brand/444-arena-wordmark.svg` | Full wordmark (primary runtime) |
| `/brand/444-arena-mark.svg` | Icon-only mark (primary runtime) |
| `/brand/444-arena-wordmark-2480.png` | Wordmark PNG alternative / external export |
| `/brand/444-arena-mark-1024.png` | Mark PNG alternative / external export |
| `/brand/favicon.ico` | Source favicon (mirrored to App Router) |
| `/brand/apple-icon-180.png` | Source Apple touch icon (opaque `#0A0E14` bg; mirrored) |

The PNG files are **alternative / external-use exports**. Components render the
SVGs; there is no automatic PNG fallback path in the React components.

App Router mirrors (Next.js file conventions — do not duplicate elsewhere):

- `apps/web/src/app/favicon.ico`
- `apps/web/src/app/icon.svg` (mark)
- `apps/web/src/app/apple-icon.png`

## Components

```tsx
import { Wordmark, LogoMark } from "@/components/brand";

<Wordmark height={28} />
<LogoMark size={28} decorative /> // adjacent text already says 444 ARENA
```

### Sizing

- `Wordmark` — `height` is authoritative; width follows the intrinsic aspect ratio.
- `LogoMark` — `size` is authoritative (square).
- Use `className` for non-sizing styles (margin, opacity, etc.). Do **not** use
  `className` to override width/height.

## Future logo replacement

1. Replace files under `apps/web/public/brand/` with the new approved assets
   (keep the same filenames when possible).
2. Copy the new favicon / Apple icon into:
   - `apps/web/src/app/favicon.ico`
   - `apps/web/src/app/apple-icon.png` (keep Apple icon opaque on `#0A0E14` unless PM changes the rule)
   - `apps/web/src/app/icon.svg` (if the mark SVG changed)
3. If intrinsic aspect ratios change, update constants in `assets.ts`.
4. Path constants in `assets.ts` should stay stable so consumers need no edits.
5. Do **not** paste brand artwork into Navbar, match, auth, or page files.

## Scope note

D2b ships foundation only. Navigation / page wiring is a later controlled slice.
