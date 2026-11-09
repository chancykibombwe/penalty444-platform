/**
 * Password recovery helpers for Supabase Auth (browser client only).
 *
 * Recovery emails must redirect to `/auth/reset-password`. Landing on `/`
 * with a recovery session previously left users "logged in" without ever
 * choosing a new password — this module centralizes detection, redirect URL
 * construction, and validation so the UI can stay thin.
 */

export const PASSWORD_RECOVERY_FLAG_KEY = "penalty444:password-recovery";

export const PASSWORD_RECOVERY_PATH = "/auth/reset-password";
export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";

/** Matches signup minimum; Supabase default policy is also 6+. */
export const MIN_PASSWORD_LENGTH = 6;

export const GENERIC_RESET_EMAIL_SENT_MESSAGE =
  "If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.";

export type AuthCallbackParams = {
  type: string | null;
  hasAccessToken: boolean;
  hasCode: boolean;
  error: string | null;
  errorDescription: string | null;
};

/**
 * Build the redirectTo value for `resetPasswordForEmail`.
 * Always same-origin `/auth/reset-password` — never a hardcoded Production host.
 */
export function buildPasswordRecoveryRedirectTo(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Origin is required for password recovery redirect.");
  }
  return `${trimmed}${PASSWORD_RECOVERY_PATH}`;
}

/**
 * Parse Supabase auth callback params from query and/or hash.
 * Supports PKCE (`?code=`) and implicit (`#access_token&type=recovery`).
 */
export function parseAuthCallbackParams(
  search: string,
  hash: string
): AuthCallbackParams {
  const query = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  const fragment = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash
  );

  const type =
    fragment.get("type") ??
    query.get("type") ??
    fragment.get("token_type") ??
    null;

  const error =
    fragment.get("error") ??
    query.get("error") ??
    fragment.get("error_code") ??
    query.get("error_code");

  const errorDescription =
    fragment.get("error_description") ??
    query.get("error_description") ??
    null;

  return {
    type: type ? type.toLowerCase() : null,
    hasAccessToken: Boolean(
      fragment.get("access_token") || query.get("access_token")
    ),
    hasCode: Boolean(query.get("code") || fragment.get("code")),
    error: error ? error.toLowerCase() : null,
    errorDescription,
  };
}

export function isPasswordRecoveryCallback(
  params: AuthCallbackParams
): boolean {
  return params.type === "recovery";
}

export function hasAuthCallbackError(params: AuthCallbackParams): boolean {
  return Boolean(params.error);
}

/**
 * Whether the UI should keep the user on the reset-password form.
 */
export function shouldForcePasswordUpdate(input: {
  authEvent: string | null | undefined;
  recoveryFlagSet: boolean;
  callbackIsRecovery: boolean;
}): boolean {
  if (input.authEvent === "PASSWORD_RECOVERY") return true;
  if (input.recoveryFlagSet) return true;
  if (input.callbackIsRecovery) return true;
  return false;
}

export function validateNewPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (!password || !confirmPassword) {
    return "Enter and confirm your new password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  // Practical client-side check; server/Supabase is authoritative.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function readRecoveryFlag(
  storage: Pick<Storage, "getItem"> | null | undefined
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PASSWORD_RECOVERY_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeRecoveryFlag(
  storage: Pick<Storage, "setItem"> | null | undefined
): void {
  if (!storage) return;
  try {
    storage.setItem(PASSWORD_RECOVERY_FLAG_KEY, "1");
  } catch {
    // Ignore quota / private-mode failures — event detection still works.
  }
}

export function clearRecoveryFlag(
  storage: Pick<Storage, "removeItem"> | null | undefined
): void {
  if (!storage) return;
  try {
    storage.removeItem(PASSWORD_RECOVERY_FLAG_KEY);
  } catch {
    // ignore
  }
}
