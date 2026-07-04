import QuickActionCard from "./QuickActionCard";

/**
 * HomeQuickActions — the Quick Actions row below the Home hero.
 *
 * Locked mobile direction (docs/home-ui-implementation-brief.md §2): the
 * approved Home Mobile 390/360 V1 structure lists exactly two cards here —
 * Quick Match and Create Room. Join Room and Practice are desktop-only
 * items (brief §3) reserved for the later Home Desktop Layout PR, and are
 * intentionally NOT added here:
 *   - Join Room already has its own existing entry point on the Lobby page
 *     (JoinRoomPanel) — it isn't part of the locked mobile quick-actions row.
 *   - Practice has no real destination in the app yet; per the brief, a
 *     fake/broken route must never be invented, so it is omitted rather
 *     than linked or faked.
 *
 * Both cards route to the existing `/lobby` page (Quick Match uses the
 * lobby's matchmaking/public-offer flow; Create Room uses the existing
 * private-room panel already on that page) — no new routes, no invented
 * destinations. Free Play only; no stakes/rewards wording.
 */
export default function HomeQuickActions() {
  return (
    <section
      className="grid grid-cols-2 gap-2 sm:gap-3"
      aria-label="Quick actions"
    >
      <QuickActionCard
        title="QUICK MATCH"
        subtitle="Jump into a live 1v1 battle."
        cta="PLAY FREE"
        href="/lobby"
        tone="cyan"
        icon="⚡"
      />
      <QuickActionCard
        title="CREATE ROOM"
        subtitle="Invite a friend and settle it."
        cta="CREATE"
        href="/lobby"
        tone="purple"
        icon="🔒"
      />
    </section>
  );
}
