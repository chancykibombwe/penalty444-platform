import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Admin email gate (server-only) ──────────────────────────────────────────
// Set ADMIN_EMAILS=email1@example.com,email2@example.com on the server.
// Never use NEXT_PUBLIC_ADMIN_EMAILS — that would expose the list to all clients.
// Mirrors the gate in /api/admin/data/route.ts.

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const MESSAGE_PREVIEW_MAX = 160;

function preview(text: string | null): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= MESSAGE_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, MESSAGE_PREVIEW_MAX)}…`;
}

// ─── Response types (shared with the page) ───────────────────────────────────

export type BetaFeedbackSummary = {
  total: number;
  open: number;
  triaged: number;
  resolved: number;
  wontFix: number;
};

export type AdminFeedbackRow = {
  id: string;
  createdAt: string;
  category: string;
  messagePreview: string;
  route: string | null;
  roomCode: string | null;
  status: string;
  /** Resolved display name; never an email or raw id. */
  username: string;
};

export type AdminMatchSummary = {
  total: number;
  last24h: number;
  publicMatches: number;
  privateMatches: number;
  tournamentMatches: number;
};

export type AdminMatchRow = {
  roomCode: string;
  matchType: string | null;
  playerOneUsername: string;
  playerTwoUsername: string;
  playerOneScore: number;
  playerTwoScore: number;
  winnerUsername: string | null;
  isDraw: boolean;
  createdAt: string;
};

export type AdminChatSummary = {
  total: number;
  visible: number;
  flagged: number;
  hidden: number;
};

export type AdminChatRow = {
  id: string;
  createdAt: string;
  username: string;
  messagePreview: string;
  status: string;
};

export type AdminSafetyStatus = {
  freePlayOnly: boolean;
  walletStatus: string;
  realMoney: boolean;
  deposits: boolean;
  withdrawals: boolean;
  cashPrizes: boolean;
  /** Read from server env only (never a secret). */
  economyMode: string;
};

export type AdminBetaDashboardResponse = {
  feedbackSummary: BetaFeedbackSummary;
  recentFeedback: AdminFeedbackRow[];
  matchSummary: AdminMatchSummary;
  recentMatches: AdminMatchRow[];
  chatSummary: AdminChatSummary;
  recentChat: AdminChatRow[];
  safety: AdminSafetyStatus;
  generatedAt: string;
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 1. Extract Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 2. Build admin client (service role — server-only, never sent to client)
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error: "admin_client_unavailable",
        detail: "SUPABASE_SERVICE_ROLE_KEY not configured",
      },
      { status: 503 }
    );
  }

  // 3. Verify token — getUser validates the JWT cryptographically
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !user || !user.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 4. Check admin allowlist (server-side only). Authorization is confirmed
  //    BEFORE any protected data is queried.
  const adminEmails = getAdminEmails();
  if (
    adminEmails.length === 0 ||
    !adminEmails.includes(user.email.toLowerCase())
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 5. Fetch data — all via service role (bypasses RLS safely on the server).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const headCount = (table: string) =>
    admin.from(table).select("*", { count: "exact", head: true });

  const [
    feedbackTotal,
    feedbackOpen,
    feedbackTriaged,
    feedbackResolved,
    feedbackWontFix,
    recentFeedbackResult,
    matchTotal,
    match24h,
    matchPublic,
    matchPrivate,
    matchTournament,
    recentMatchesResult,
    chatTotal,
    chatVisible,
    chatFlagged,
    chatHidden,
    recentChatResult,
  ] = await Promise.all([
    headCount("beta_feedback"),
    headCount("beta_feedback").eq("status", "open"),
    headCount("beta_feedback").eq("status", "triaged"),
    headCount("beta_feedback").eq("status", "resolved"),
    headCount("beta_feedback").eq("status", "wont_fix"),
    admin
      .from("beta_feedback")
      .select("id, created_at, user_id, category, message, route, room_code, status")
      .order("created_at", { ascending: false })
      .limit(20),
    headCount("match_results"),
    headCount("match_results").gte("created_at", since24h),
    headCount("match_results").eq("match_type", "public"),
    headCount("match_results").eq("match_type", "private"),
    headCount("match_results").eq("match_type", "tournament"),
    admin
      .from("match_results")
      .select(
        "room_code, match_type, player_one_id, player_two_id, player_one_username, player_two_username, player_one_score, player_two_score, winner_id, is_draw, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(20),
    headCount("lobby_chat_messages"),
    headCount("lobby_chat_messages").eq("status", "visible"),
    headCount("lobby_chat_messages").eq("status", "flagged"),
    headCount("lobby_chat_messages").eq("status", "hidden"),
    // Admin moderation view: latest messages across ALL statuses (visible /
    // flagged / hidden). Public lobby chat is unchanged and still only reads
    // status = 'visible' via its own RLS-scoped query.
    admin
      .from("lobby_chat_messages")
      .select("id, created_at, user_id, message, status")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // 6. Resolve usernames for feedback + chat rows in one batched profiles read.
  const feedbackRows = (recentFeedbackResult.data ?? []) as {
    id: string;
    created_at: string;
    user_id: string | null;
    category: string;
    message: string;
    route: string | null;
    room_code: string | null;
    status: string;
  }[];
  const chatRows = (recentChatResult.data ?? []) as {
    id: string;
    created_at: string;
    user_id: string | null;
    message: string;
    status: string;
  }[];

  const userIds = Array.from(
    new Set(
      [...feedbackRows, ...chatRows]
        .map((r) => r.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  const usernameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    for (const p of (profiles ?? []) as { id: string; username: string | null }[]) {
      const name = (p.username ?? "").trim();
      if (name.length > 0) usernameById.set(p.id, name);
    }
  }

  const resolveName = (userId: string | null): string =>
    userId ? usernameById.get(userId) ?? "Player" : "Unknown";

  // 7. Shape response — no emails, no raw user ids, no secrets.
  const recentMatches: AdminMatchRow[] = (recentMatchesResult.data ?? []).map(
    (m) => {
      let winnerUsername: string | null = null;
      if (m.is_draw) {
        winnerUsername = "Draw";
      } else if (m.winner_id && m.winner_id === m.player_one_id) {
        winnerUsername = m.player_one_username;
      } else if (m.winner_id && m.winner_id === m.player_two_id) {
        winnerUsername = m.player_two_username;
      }
      return {
        roomCode: m.room_code,
        matchType: m.match_type ?? null,
        playerOneUsername: m.player_one_username,
        playerTwoUsername: m.player_two_username,
        playerOneScore: m.player_one_score ?? 0,
        playerTwoScore: m.player_two_score ?? 0,
        winnerUsername,
        isDraw: m.is_draw ?? false,
        createdAt: m.created_at,
      };
    }
  );

  const response: AdminBetaDashboardResponse = {
    feedbackSummary: {
      total: feedbackTotal.count ?? 0,
      open: feedbackOpen.count ?? 0,
      triaged: feedbackTriaged.count ?? 0,
      resolved: feedbackResolved.count ?? 0,
      wontFix: feedbackWontFix.count ?? 0,
    },
    recentFeedback: feedbackRows.map((f) => ({
      id: f.id,
      createdAt: f.created_at,
      category: f.category,
      messagePreview: preview(f.message),
      route: f.route,
      roomCode: f.room_code,
      status: f.status,
      username: resolveName(f.user_id),
    })),
    matchSummary: {
      total: matchTotal.count ?? 0,
      last24h: match24h.count ?? 0,
      publicMatches: matchPublic.count ?? 0,
      privateMatches: matchPrivate.count ?? 0,
      tournamentMatches: matchTournament.count ?? 0,
    },
    recentMatches,
    chatSummary: {
      total: chatTotal.count ?? 0,
      visible: chatVisible.count ?? 0,
      flagged: chatFlagged.count ?? 0,
      hidden: chatHidden.count ?? 0,
    },
    recentChat: chatRows.map((c) => ({
      id: c.id,
      createdAt: c.created_at,
      username: resolveName(c.user_id),
      messagePreview: preview(c.message),
      status: c.status,
    })),
    safety: {
      freePlayOnly: true,
      walletStatus: "Coming Soon / read-only",
      realMoney: false,
      deposits: false,
      withdrawals: false,
      cashPrizes: false,
      economyMode: process.env.NEXT_PUBLIC_ECONOMY_MODE ?? "not_set",
    },
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
