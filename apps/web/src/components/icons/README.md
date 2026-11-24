# Arena icons (Stage 6O-D2a)

Shared **Lucide React** foundation for 444 ARENA. The public application API is
the **Arena-prefixed** exports from `components/icons`.

Dependency: **lucide-react@1.78.0** (independently reviewed). Future upgrades of
`lucide-react` must revalidate that every Arena alias still resolves.

## Usage

```tsx
import { ArenaHomeIcon, ArenaZapIcon } from "@/components/icons";

// Decorative (visible text nearby)
<span className="inline-flex items-center gap-2 text-arena-primary">
  <ArenaHomeIcon className="h-4 w-4" aria-hidden />
  Home
</span>

// Icon-only control — name the button/parent
<button type="button" aria-label="Notifications">
  <ArenaNotificationsIcon className="h-5 w-5" aria-hidden />
</button>
```

Prefer Arena-prefixed imports from this module. Avoid direct `lucide-react`
imports in future application consumers unless separately approved.

## Conventions

- Icons inherit `currentColor` via Lucide defaults; color with text utilities.
- Decorative icons: set `aria-hidden` on the SVG.
- Icon-only buttons: accessible name on the **button** (or other parent), not the SVG.
- Meaning-bearing icons must meet applicable non-text contrast (normally ≥ 3:1).
- Icons must remain compatible with `prefers-reduced-motion` (no motion in this module).
- Directional chevrons use explicit names: `ArenaChevronDownIcon`,
  `ArenaChevronUpIcon`, `ArenaChevronLeftIcon`, `ArenaChevronRightIcon`.
- D2a does **not** replace existing inline nav SVGs yet.

## Public exports

`ArenaHomeIcon`, `ArenaLobbyIcon`, `ArenaMatchesIcon`, `ArenaLeaderboardIcon`,
`ArenaAccountIcon`, `ArenaWalletIcon`, `ArenaNotificationsIcon`, `ArenaMoreIcon`,
`ArenaSettingsIcon`, `ArenaSearchIcon`, `ArenaShareIcon`,
`ArenaChevronDownIcon`, `ArenaChevronUpIcon`, `ArenaChevronLeftIcon`,
`ArenaChevronRightIcon`, `ArenaCheckIcon`, `ArenaLockIcon`, `ArenaZapIcon`,
plus types `LucideIcon` / `LucideProps`.

## Not in this module

Logo marks, favicons, game icons, and match lane art require approved assets and later slices.
