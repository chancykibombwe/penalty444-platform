"use client";

/**
 * Lobby Chat / Arena Chat panel (v1).
 *
 * A compact, Supabase-backed global chat for logged-in testers. Fetches the
 * newest visible messages on mount, light-polls while the tab is visible, and
 * supports a manual Refresh. Sending is client-cooldown rate-limited.
 *
 * Safety:
 * - Message text is rendered as PLAIN TEXT (React escapes by default — no
 *   dangerouslySetInnerHTML), so no HTML/script injection is possible.
 * - Never renders user ids or emails; only resolved display names.
 * - No realtime-server, gameplay, wallet, or auth logic touched.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_SEND_COOLDOWN_MS,
  fetchLobbyMessages,
  sendLobbyMessage,
  type LobbyChatMessage,
} from "../../lib/chat/lobbyChat";

const POLL_INTERVAL_MS = 12_000;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LobbyChatPanel() {
  const inputId = useId();

  const [messages, setMessages] = useState<LobbyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const lastSentAtRef = useRef<number>(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cancelledRef = useRef(false);

  const loadMessages = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    const result = await fetchLobbyMessages();
    if (cancelledRef.current) return;

    if (result.ok) {
      setMessages(result.messages);
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, []);

  // Initial load + light polling while the tab is visible.
  useEffect(() => {
    cancelledRef.current = false;
    void loadMessages(true);

    let intervalId: number | null = null;

    function startPolling() {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void loadMessages(false);
        }
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void loadMessages(false);
        startPolling();
      } else {
        stopPolling();
      }
    }

    startPolling();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelledRef.current = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadMessages]);

  // Tick the cooldown countdown down to zero.
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timeoutId = window.setTimeout(() => {
      const elapsed = Date.now() - lastSentAtRef.current;
      const remaining = Math.max(0, CHAT_SEND_COOLDOWN_MS - elapsed);
      setCooldownRemaining(remaining);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [cooldownRemaining]);

  // Keep the newest message in view when the list grows.
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const trimmedLength = draft.trim().length;
  const onCooldown = cooldownRemaining > 0;
  const canSend = trimmedLength > 0 && !sending && !onCooldown;

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) return;

    setSending(true);
    setSendError("");

    const result = await sendLobbyMessage(draft);

    if (cancelledRef.current) return;

    if (result.ok) {
      setDraft("");
      lastSentAtRef.current = Date.now();
      setCooldownRemaining(CHAT_SEND_COOLDOWN_MS);
      await loadMessages(false);
    } else {
      setSendError(result.error);
    }
    setSending(false);
  }

  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40"
      aria-label="Arena Chat"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
            Arena Chat
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Free Play beta chat. Be respectful.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMessages(true)}
          disabled={loading}
          className="shrink-0 rounded-lg border border-zinc-700/70 bg-black/40 px-2.5 py-1 text-[11px] font-bold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div
        ref={listRef}
        className="max-h-64 space-y-2 overflow-y-auto px-3 py-2.5"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {loading && messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-600">
            Loading chat…
          </p>
        ) : loadError ? (
          <p className="py-6 text-center text-xs text-red-300/80">{loadError}</p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-600">
            No messages yet. Say hello 👋
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="text-[13px] leading-snug">
              <div className="flex items-baseline gap-2">
                <span
                  className={`truncate text-xs font-bold ${
                    msg.mine ? "text-cyan-300" : "text-zinc-300"
                  }`}
                >
                  {msg.username}
                  {msg.mine ? (
                    <span className="ml-1 text-[10px] font-semibold text-cyan-400/60">
                      you
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              {/* Plain text — React escapes content; no HTML is rendered. */}
              <p className="whitespace-pre-wrap break-words text-zinc-200">
                {msg.message}
              </p>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSend}
        className="space-y-2 border-t border-zinc-800/60 px-3 py-2.5"
      >
        <label htmlFor={inputId} className="sr-only">
          Send a message to Arena Chat
        </label>
        <textarea
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          rows={2}
          disabled={sending}
          placeholder="Message the arena…"
          className="w-full resize-none rounded-lg border border-zinc-800 bg-black/45 px-3 py-2 text-sm text-white placeholder:text-zinc-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
        />

        {sendError ? (
          <p role="alert" className="text-[11px] text-red-300/80">
            {sendError}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-zinc-600">
            Don&apos;t share private information.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-zinc-600">
              {draft.length}/{CHAT_MESSAGE_MAX_LENGTH}
            </span>
            <button
              type="submit"
              disabled={!canSend}
              className="rounded-lg bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-3.5 py-1.5 text-xs font-black text-white shadow-[0_0_14px_rgba(59,158,255,0.25)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {sending
                ? "Sending…"
                : onCooldown
                  ? `Wait ${cooldownSeconds}s`
                  : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
