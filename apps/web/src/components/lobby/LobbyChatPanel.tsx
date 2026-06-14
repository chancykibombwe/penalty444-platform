import EmptyState from "../ui/EmptyState";

/**
 * Provision for in-lobby player chat + direct challenges. Not implemented
 * yet — honest "Coming soon" placeholder so the lobby has a reserved spot
 * for this feature without claiming functionality that doesn't exist.
 */
export default function LobbyChatPanel() {
  return (
    <EmptyState
      icon="💬"
      title="Lobby chat — coming soon"
      subtitle="Message players and send direct challenges from here"
      compact
    />
  );
}
