/**
 * Stage 6O-D2a — shared Lucide icon foundation for 444 ARENA / Penalty444.
 *
 * Public application API: Arena-prefixed named exports only.
 * No custom SVG duplicates, logo marks, favicons, or game-specific art
 * (those require separate asset approval).
 *
 * Accessibility conventions:
 * - Lucide icons use `stroke="currentColor"` by default; pass `className` with
 *   text color utilities (or rely on parent `color`) so icons inherit theme.
 * - Decorative icons (next to visible text) MUST set `aria-hidden` on the icon
 *   (or `aria-hidden={true}`). Prefer the parent control for the accessible name.
 * - Interactive icon-only controls MUST provide an accessible name on the
 *   parent (`aria-label`, `aria-labelledby`, or visible text). Do not rely on
 *   the SVG alone for the name.
 * - Meaning-bearing icons should meet applicable non-text contrast (normally ≥3:1).
 * - Do not animate these icons in this module; call-site motion must respect
 *   `prefers-reduced-motion`.
 *
 * D2a does not wire these into Navbar / DesktopSidebar / BottomMobileNav.
 * Consumers should import Arena-prefixed icons from this module.
 */

export {
  House as ArenaHomeIcon,
  Target as ArenaLobbyIcon,
  Swords as ArenaMatchesIcon,
  ChartColumn as ArenaLeaderboardIcon,
  User as ArenaAccountIcon,
  Wallet as ArenaWalletIcon,
  Bell as ArenaNotificationsIcon,
  Ellipsis as ArenaMoreIcon,
  Settings as ArenaSettingsIcon,
  Search as ArenaSearchIcon,
  Share2 as ArenaShareIcon,
  ChevronDown as ArenaChevronDownIcon,
  ChevronUp as ArenaChevronUpIcon,
  ChevronLeft as ArenaChevronLeftIcon,
  ChevronRight as ArenaChevronRightIcon,
  Check as ArenaCheckIcon,
  Lock as ArenaLockIcon,
  Zap as ArenaZapIcon,
} from "lucide-react";

export type { LucideIcon, LucideProps } from "lucide-react";
