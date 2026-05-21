"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * NotificationBell — display-only foundation for Phase 7.
 *
 * Renders a navbar bell with a dropdown list of recent personal events:
 * match results, tournament outcomes, promotions. NO backend writes,
 * NO push notifications, NO reads against an unread-counter table. The
 * notifications come from the same client-side signals already used by
 * the platform (match-results inserts, promotion detection on the account
 * page). This is purely a UI shell ready to be wired up later.
 *
 * Events can be dispatched globally by anywhere in the app:
 *
 *   window.dispatchEvent(new CustomEvent("penalty444:notification", {
 *     detail: { kind: "match", message: "You won 4–2", tone: "win" },
 *   }));
 */
export type NotificationKind =
  | "match"
  | "tournament"
  | "promotion"
  | "system";

export type NotificationTone = "win" | "loss" | "info" | "champion" | "promotion";

export type ClientNotification = {
  id: string;
  kind: NotificationKind;
  message: string;
  context?: string;
  tone: NotificationTone;
  createdAt: string;
  href?: string;
  read?: boolean;
};

const STORAGE_KEY = "penalty444:notifications:v1";
const MAX_NOTIFICATIONS = 12;
const EVENT_NAME = "penalty444:notification";

const TONE_BORDER: Record<NotificationTone, string> = {
  win: "border-emerald-400/40 bg-emerald-500/8",
  loss: "border-rose-400/40 bg-rose-500/8",
  info: "border-zinc-800 bg-zinc-900/60",
  champion: "border-yellow-300/55 bg-yellow-500/8",
  promotion: "border-violet-400/45 bg-violet-500/10",
};

const TONE_DOT: Record<NotificationTone, string> = {
  win: "bg-emerald-300",
  loss: "bg-rose-300",
  info: "bg-zinc-400",
  champion: "bg-yellow-300",
  promotion: "bg-violet-300",
};

function readStorage(): ClientNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClientNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function writeStorage(items: ClientNotification[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_NOTIFICATIONS))
    );
  } catch {
    // Quota / private mode: silently drop.
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 45) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.round(diffHr / 24)}d`;
}

/**
 * Imperatively push a notification from anywhere in the app. Safe to call
 * before the bell has mounted — items are persisted in localStorage.
 */
export function pushNotification(
  notification: Omit<ClientNotification, "id" | "createdAt" | "read"> &
    Partial<Pick<ClientNotification, "id" | "createdAt">>
): void {
  if (typeof window === "undefined") return;
  const item: ClientNotification = {
    id:
      notification.id ??
      `${notification.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: notification.createdAt ?? new Date().toISOString(),
    kind: notification.kind,
    message: notification.message,
    context: notification.context,
    tone: notification.tone,
    href: notification.href,
    read: false,
  };
  const current = readStorage();
  const next = [item, ...current.filter((n) => n.id !== item.id)].slice(
    0,
    MAX_NOTIFICATIONS
  );
  writeStorage(next);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: item }));
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ClientNotification[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setItems(readStorage());

    function onUpdate() {
      setItems(readStorage());
    }
    window.addEventListener(EVENT_NAME, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(EVENT_NAME, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  function markAllRead() {
    const next = items.map((n) => ({ ...n, read: true }));
    setItems(next);
    writeStorage(next);
  }

  function clearAll() {
    setItems([]);
    writeStorage([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications"
        }
        aria-expanded={open}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
          open
            ? "border-cyan-400/55 bg-cyan-500/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
            : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-100"
        }`}
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-500 px-1 text-[9px] font-black text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]"
            aria-hidden
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">
                Notifications
              </span>
              {unread > 0 ? (
                <span className="rounded-full border border-rose-400/45 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-100">
                  {unread} new
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:text-cyan-100"
                >
                  Mark read
                </button>
              ) : null}
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs font-semibold text-zinc-400">
              Preparing live arena activity…
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-zinc-900 overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <div className="flex items-start gap-3 px-3 py-3">
                    <span
                      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[n.tone]} ${n.read ? "opacity-50" : ""}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-bold ${n.read ? "text-zinc-300" : "text-white"}`}
                      >
                        {n.message}
                      </p>
                      {n.context ? (
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {n.context}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      {formatRelative(n.createdAt)}
                    </span>
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className={`${TONE_BORDER[n.tone]} ${n.read ? "" : "ring-1 ring-inset ring-cyan-400/10"}`}
                  >
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        className="block hover:bg-white/3"
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-zinc-800/80 bg-black/40 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Display-only · Live signals
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
