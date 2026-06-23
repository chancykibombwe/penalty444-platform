// Players with fewer than this many matches appear as "Provisional" on the
// leaderboard and are excluded from official rank positions and the podium.
// The global UNRANKED_MATCHES_THRESHOLD (10) still governs placement → rated
// tier promotion; this is a leaderboard-display-only floor.
export const LEADERBOARD_QUALIFICATION_THRESHOLD = 20;

export type RankBy = "rating" | "win_rate";
