"use client";

/**
 * Beta feedback / bug report client helper.
 *
 * Thin, safe wrapper over a single INSERT into `public.beta_feedback`.
 * - No money, gameplay, auth, or realtime logic here.
 * - The table's RLS only allows an authenticated user to insert their OWN
 *   row (user_id = auth.uid()); there is no client read path.
 * - We never chain `.select()` after insert because there is intentionally
 *   no SELECT policy for testers, so no real row id is returned and we never
 *   fabricate a ticket number.
 */

import { supabase } from "../supabase/client";

/** Stable category ids — must match the `beta_feedback_category_valid` CHECK. */
export const FEEDBACK_CATEGORIES = [
  { value: "match", label: "Match Issue" },
  { value: "auth", label: "Login / Signup Issue" },
  { value: "mobile", label: "Mobile Issue" },
  { value: "tournament", label: "Tournament Issue" },
  { value: "leaderboard", label: "Leaderboard / Stats Issue" },
  { value: "confusing_ui", label: "Confusing UI" },
  { value: "wallet_safety", label: "Wallet / Safety Concern" },
  { value: "other", label: "Other" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["value"];

export const FEEDBACK_MESSAGE_MAX_LENGTH = 1000;

const VALID_CATEGORIES = new Set<string>(
  FEEDBACK_CATEGORIES.map((c) => c.value)
);

export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return VALID_CATEGORIES.has(value);
}

export type SubmitBetaFeedbackInput = {
  category: FeedbackCategory;
  message: string;
  /** Optional context — current route/page path. */
  route?: string | null;
  /** Optional context — active room code when on a match page. */
  roomCode?: string | null;
};

export type SubmitBetaFeedbackResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Insert one feedback row for the currently logged-in user.
 *
 * Returns a friendly error result (never throws) so the form can render an
 * inline error state. The caller must be logged in; if there is no session
 * the RLS insert is rejected and we surface a sign-in hint.
 */
export async function submitBetaFeedback(
  input: SubmitBetaFeedbackInput
): Promise<SubmitBetaFeedbackResult> {
  const message = input.message.trim();

  if (message.length === 0) {
    return { ok: false, error: "Please describe the issue before sending." };
  }
  if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Please keep your message under ${FEEDBACK_MESSAGE_MAX_LENGTH} characters.`,
    };
  }
  if (!isFeedbackCategory(input.category)) {
    return { ok: false, error: "Please choose a category." };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      ok: false,
      error: "Please sign in to send beta feedback.",
    };
  }

  // user_agent is read defensively; it is a simple, non-sensitive string.
  const userAgent =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent.slice(0, 500)
      : null;

  const { error } = await supabase.from("beta_feedback").insert({
    user_id: session.user.id,
    category: input.category,
    message,
    route: input.route ?? null,
    room_code: input.roomCode ?? null,
    user_agent: userAgent,
  });

  if (error) {
    return {
      ok: false,
      error: "Could not send feedback right now. Please try again later.",
    };
  }

  return { ok: true };
}
