/**
 * Password recovery helpers for Supabase Auth (browser client only).
 *
 * Recovery emails must redirect to `/auth/reset-password`. Landing on `/`
 * with a recovery session previously left users "logged in" without ever
 * choosing a new password — this module centralizes detection, redirect URL
 * construction, validation, and the bootstrap state machine so UI stays thin
 * and behavior is unit-testable without a live Supabase project.
 */

export const PASSWORD_RECOVERY_FLAG_KEY = "penalty444:password-recovery";

export const PASSWORD_RECOVERY_PATH = "/auth/reset-password";
export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";

/** Matches signup minimum; Supabase default policy is also 6+. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Absolute fail-safe while a recovery exchange is in flight.
 * Must be long enough for slow mobile networks; must not be the happy path.
 */
export const RECOVERY_EXCHANGE_TIMEOUT_MS = 20_000;

/**
 * Soft wait when the user opens `/auth/reset-password` with no recovery
 * markers at all (manual navigation). Not used while a code/token exchange
 * may still be completing.
 */
export const RECOVERY_EMPTY_VISIT_TIMEOUT_MS = 4_000;

export const GENERIC_RESET_EMAIL_SENT_MESSAGE =
  "If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.";

export const INVALID_RECOVERY_LINK_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one.";

export type AuthCallbackParams = {
  type: string | null;
  hasAccessToken: boolean;
  hasCode: boolean;
  error: string | null;
  errorDescription: string | null;
};

export type RecoveryGateStatus = "checking" | "ready" | "invalid";

export type RecoveryGateState = {
  status: RecoveryGateStatus;
  message: string;
};

export type RecoveryGateAction =
  | { type: "CALLBACK_ERROR" }
  | { type: "PASSWORD_RECOVERY_EVENT" }
  | { type: "SESSION_READY_FOR_UPDATE" }
  | { type: "EXCHANGE_TIMEOUT" }
  | { type: "EMPTY_VISIT_TIMEOUT" };

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

  const type = fragment.get("type") ?? query.get("type") ?? null;

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

/** Explicit `type=recovery` in hash/query (classic implicit recovery links). */
export function isPasswordRecoveryCallback(
  params: AuthCallbackParams
): boolean {
  return params.type === "recovery";
}

/**
 * PKCE recovery often lands on `/auth/reset-password?code=...` without
 * `type=recovery`. Because that path is dedicated to password reset in this
 * app, a bare `code` on this path is treated as a recovery candidate.
 *
 * ASSUMPTION (staging must verify): Supabase recovery emails use our
 * `redirectTo=/auth/reset-password` and do not share that path with unrelated
 * OAuth providers. Ordinary login does not use this path.
 */
export function isPkceRecoveryCandidate(
  params: AuthCallbackParams,
  onResetPasswordPath: boolean
): boolean {
  if (!onResetPasswordPath) return false;
  if (hasAuthCallbackError(params)) return false;
  if (isPasswordRecoveryCallback(params)) return true;
  return params.hasCode && params.type !== "signup" && params.type !== "invite";
}

export function hasAuthCallbackError(params: AuthCallbackParams): boolean {
  return Boolean(params.error);
}

export function hasPendingAuthExchange(params: AuthCallbackParams): boolean {
  return (
    !hasAuthCallbackError(params) &&
    (params.hasCode || params.hasAccessToken || isPasswordRecoveryCallback(params))
  );
}

/**
 * Whether the UI should keep the user on the reset-password form.
 */
export function shouldForcePasswordUpdate(input: {
  authEvent: string | null | undefined;
  recoveryFlagSet: boolean;
  callbackIsRecovery: boolean;
  pkceRecoveryCandidate?: boolean;
}): boolean {
  if (input.authEvent === "PASSWORD_RECOVERY") return true;
  if (input.recoveryFlagSet) return true;
  if (input.callbackIsRecovery) return true;
  if (input.pkceRecoveryCandidate) return true;
  return false;
}

/**
 * Clear abandoned recovery markers on ordinary auth transitions so a later
 * normal sign-in does not reopen the password-update form.
 *
 * Never clear while the user is already on `/auth/reset-password` — that path
 * owns the marker until a successful update + sign-out (or explicit invalid).
 */
export function shouldClearStaleRecoveryFlag(input: {
  authEvent: string;
  onResetPasswordPath: boolean;
  callbackIsRecovery: boolean;
  pkceRecoveryCandidate: boolean;
}): boolean {
  if (input.authEvent === "PASSWORD_RECOVERY") return false;
  if (input.onResetPasswordPath) return false;

  // callback / pkce args reserved for callers that need richer context;
  // off-path clearing does not depend on them.
  void input.callbackIsRecovery;
  void input.pkceRecoveryCandidate;

  return (
    input.authEvent === "SIGNED_IN" ||
    input.authEvent === "SIGNED_OUT" ||
    input.authEvent === "INITIAL_SESSION" ||
    input.authEvent === "TOKEN_REFRESHED" ||
    input.authEvent === "USER_UPDATED"
  );
}

export function initialRecoveryGateState(): RecoveryGateState {
  return {
    status: "checking",
    message: "Checking your reset link...",
  };
}

/**
 * Pure reducer for reset-password bootstrap. Timeouts never fire while the
 * caller still considers an exchange pending — the page wires that policy.
 */
export function reduceRecoveryGate(
  state: RecoveryGateState,
  action: RecoveryGateAction
): RecoveryGateState {
  if (state.status === "ready" || state.status === "invalid") {
    return state;
  }

  switch (action.type) {
    case "CALLBACK_ERROR":
      return { status: "invalid", message: INVALID_RECOVERY_LINK_MESSAGE };
    case "PASSWORD_RECOVERY_EVENT":
    case "SESSION_READY_FOR_UPDATE":
      return { status: "ready", message: "" };
    case "EXCHANGE_TIMEOUT":
    case "EMPTY_VISIT_TIMEOUT":
      return { status: "invalid", message: INVALID_RECOVERY_LINK_MESSAGE };
    default:
      return state;
  }
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

/**
 * Controller used by the reset-password page and behavioral tests.
 * Encapsulates subscription-shaped callbacks without importing React.
 */
export type RecoveryBootstrapDeps = {
  getSearch: () => string;
  getHash: () => string;
  onResetPasswordPath: boolean;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  getSession: () => Promise<{ session: { user?: { id?: string } } | null }>;
  onAuthStateChange: (
    cb: (
      event: string,
      session: { user?: { id?: string } } | null
    ) => void
  ) => { unsubscribe: () => void };
  /** Browser `window.setTimeout` returns a number; Node returns a Timeout object. */
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  onState: (state: RecoveryGateState) => void;
};

export function startRecoveryBootstrap(
  deps: RecoveryBootstrapDeps
): { stop: () => void } {
  let cancelled = false;
  let state = initialRecoveryGateState();
  let emptyTimer: unknown = null;
  let exchangeTimer: unknown = null;

  function emit(next: RecoveryGateState) {
    if (cancelled) return;
    if (state.status !== "checking") return;
    state = next;
    deps.onState(state);
    if (state.status !== "checking") {
      clearTimers();
    }
  }

  function clearTimers() {
    if (emptyTimer !== null) {
      deps.clearTimeout(emptyTimer);
      emptyTimer = null;
    }
    if (exchangeTimer !== null) {
      deps.clearTimeout(exchangeTimer);
      exchangeTimer = null;
    }
  }

  function dispatch(action: RecoveryGateAction) {
    emit(reduceRecoveryGate(state, action));
  }

  const params = parseAuthCallbackParams(deps.getSearch(), deps.getHash());
  const callbackIsRecovery = isPasswordRecoveryCallback(params);
  const pkceCandidate = isPkceRecoveryCandidate(
    params,
    deps.onResetPasswordPath
  );
  const pendingExchange = hasPendingAuthExchange(params) || pkceCandidate;

  // Surface the initial checking state so callers/tests observe it.
  deps.onState(state);

  if (hasAuthCallbackError(params)) {
    clearRecoveryFlag(deps.storage);
    dispatch({ type: "CALLBACK_ERROR" });
    return {
      stop: () => {
        cancelled = true;
        clearTimers();
      },
    };
  }

  if (callbackIsRecovery || pkceCandidate) {
    writeRecoveryFlag(deps.storage);
  }

  const subscription = deps.onAuthStateChange((event, session) => {
    if (cancelled) return;

    if (event === "PASSWORD_RECOVERY") {
      writeRecoveryFlag(deps.storage);
      dispatch({ type: "PASSWORD_RECOVERY_EVENT" });
      return;
    }

    // Only open the password-update form on the dedicated reset path.
    // Off-path ordinary sessions must clear abandoned markers instead.
    if (
      deps.onResetPasswordPath &&
      session &&
      shouldForcePasswordUpdate({
        authEvent: event,
        recoveryFlagSet: readRecoveryFlag(deps.storage),
        callbackIsRecovery,
        pkceRecoveryCandidate: pkceCandidate,
      })
    ) {
      dispatch({ type: "SESSION_READY_FOR_UPDATE" });
      return;
    }

    if (
      shouldClearStaleRecoveryFlag({
        authEvent: event,
        onResetPasswordPath: deps.onResetPasswordPath,
        callbackIsRecovery,
        pkceRecoveryCandidate: pkceCandidate,
      })
    ) {
      clearRecoveryFlag(deps.storage);
    }
  });

  void (async () => {
    const { session } = await deps.getSession();
    if (cancelled || state.status !== "checking") return;

    const force = shouldForcePasswordUpdate({
      authEvent: null,
      recoveryFlagSet: readRecoveryFlag(deps.storage),
      callbackIsRecovery,
      pkceRecoveryCandidate: pkceCandidate,
    });

    if (deps.onResetPasswordPath && session && force) {
      dispatch({ type: "SESSION_READY_FOR_UPDATE" });
      return;
    }

    if (deps.onResetPasswordPath && (pendingExchange || force)) {
      // Wait for PASSWORD_RECOVERY / session — do NOT use a short deadline.
      exchangeTimer = deps.setTimeout(() => {
        if (cancelled || state.status !== "checking") return;
        dispatch({ type: "EXCHANGE_TIMEOUT" });
      }, RECOVERY_EXCHANGE_TIMEOUT_MS);
      return;
    }

    if (!deps.onResetPasswordPath) {
      // Bootstrap is only mounted on reset-password in production; off-path
      // use (tests / shared listener) just waits for stale-flag clearing.
      return;
    }

    // Cold visit with no recovery markers: brief check then invalid.
    emptyTimer = deps.setTimeout(() => {
      if (cancelled || state.status !== "checking") return;
      dispatch({ type: "EMPTY_VISIT_TIMEOUT" });
    }, RECOVERY_EMPTY_VISIT_TIMEOUT_MS);
  })();

  return {
    stop: () => {
      cancelled = true;
      clearTimers();
      subscription.unsubscribe();
    },
  };
}
