"use client";

/**
 * Admin Beta Monitoring dashboard (v1).
 *
 * Renders the data returned by /api/admin/beta-dashboard. The only mutation
 * available is feedback STATUS triage (open/triaged/resolved/wont_fix) via the
 * admin-gated PATCH /api/admin/beta-feedback/status route — no delete, no edit,
 * no chat/match moderation. The server route enforces admin authorization
 * before any update.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { FEEDBACK_CATEGORIES } from "../../lib/feedback/betaFeedback";
import type {
  AdminBetaDashboardResponse,
  AdminFeedbackRow,
  AdminChatRow,
  AdminChatSummary,
  AdminMatchRow,
  AdminAuditRow,
  BetaFeedbackSummary,
} from "../../app/api/admin/beta-dashboard/route";

const CATEGORY_LABEL: Map<string, string> = new Map(
  FEEDBACK_CATEGORIES.map((c) => [c.value, c.label])
);

function categoryLabel(key: string): string {
  return CATEGORY_LABEL.get(key) ?? key.replace(/_/g, " ");
}

// Triage statuses — must match the beta_feedback_status_valid CHECK and the
// PATCH /api/admin/beta-feedback/status route.
const FEEDBACK_STATUSES = [
  { value: "open", label: "Open" },
  { value: "triaged", label: "Triaged" },
  { value: "resolved", label: "Resolved" },
  { value: "wont_fix", label: "Won't fix" },
] as const;
type FeedbackStatusValue = (typeof FEEDBACK_STATUSES)[number]["value"];

function summaryKey(status: string): keyof BetaFeedbackSummary | null {
  switch (status) {
    case "open":
      return "open";
    case "triaged":
      return "triaged";
    case "resolved":
      return "resolved";
    case "wont_fix":
      return "wontFix";
    default:
      return null;
  }
}

/** Move one feedback row's count from oldStatus → newStatus (total unchanged). */
function adjustSummary(
  summary: BetaFeedbackSummary,
  oldStatus: string,
  newStatus: string
): BetaFeedbackSummary {
  const next = { ...summary };
  const oldKey = summaryKey(oldStatus);
  const newKey = summaryKey(newStatus);
  if (oldKey) next[oldKey] = Math.max(0, next[oldKey] - 1);
  if (newKey) next[newKey] = next[newKey] + 1;
  return next;
}

// Chat moderation statuses — must match the lobby_chat_messages_status_valid
// CHECK and the PATCH /api/admin/lobby-chat/status route.
const CHAT_STATUSES = [
  { value: "visible", label: "Visible" },
  { value: "flagged", label: "Flagged" },
  { value: "hidden", label: "Hidden" },
] as const;
type ChatStatusValue = (typeof CHAT_STATUSES)[number]["value"];

// ── Filter option lists (display only) ────────────────────────────────────
const ALL_OPTION = { value: "all", label: "All" };

const FEEDBACK_STATUS_OPTIONS = [
  ALL_OPTION,
  ...FEEDBACK_STATUSES.map((s) => ({ value: s.value, label: s.label })),
];

const FEEDBACK_CATEGORY_OPTIONS = [
  ALL_OPTION,
  ...FEEDBACK_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

const CHAT_STATUS_OPTIONS = [
  ALL_OPTION,
  ...CHAT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
];

const AUDIT_ACTION_OPTIONS = [
  ALL_OPTION,
  { value: "feedback_status_update", label: "Feedback status updates" },
  { value: "chat_status_update", label: "Chat status updates" },
];

function chatSummaryKey(status: string): keyof AdminChatSummary | null {
  switch (status) {
    case "visible":
      return "visible";
    case "flagged":
      return "flagged";
    case "hidden":
      return "hidden";
    default:
      return null;
  }
}

/** Move one chat row's count from oldStatus → newStatus (total unchanged). */
function adjustChatSummary(
  summary: AdminChatSummary,
  oldStatus: string,
  newStatus: string
): AdminChatSummary {
  const next = { ...summary };
  const oldKey = chatSummaryKey(oldStatus);
  const newKey = chatSummaryKey(newStatus);
  if (oldKey) next[oldKey] = Math.max(0, next[oldKey] - 1);
  if (newKey) next[newKey] = next[newKey] + 1;
  return next;
}

function statusTone(status: string): string {
  switch (status) {
    case "open":
    case "visible":
      return "border-emerald-500/40 bg-emerald-950/40 text-emerald-200";
    case "triaged":
      return "border-blue-500/40 bg-blue-950/40 text-blue-200";
    case "resolved":
      return "border-zinc-500/40 bg-zinc-900/60 text-zinc-300";
    case "wont_fix":
      return "border-red-500/40 bg-red-950/40 text-red-200";
    case "hidden":
    case "flagged":
      return "border-amber-500/40 bg-amber-950/40 text-amber-200";
    default:
      return "border-zinc-700 bg-zinc-900/60 text-zinc-300";
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matchTypeLabel(type: string | null): string {
  switch ((type ?? "").toLowerCase()) {
    case "public":
      return "Public";
    case "private":
      return "Private";
    case "ranked":
      return "Ranked";
    case "tournament":
      return "Tournament";
    default:
      return "Match";
  }
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[#1B2433] bg-[#0D1420] px-3 py-3">
      <p className="text-2xl font-black tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  filters,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Optional compact filter row rendered below the subtitle. */
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="border-b border-[#1B2433] px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-white">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</p>
        ) : null}
        {filters ? <div className="mt-2">{filters}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ─── Filter helpers / primitives (client-side only) ──────────────────────────

/** Case-insensitive substring match; null/undefined never matches a non-empty query. */
function includesText(value: string | null | undefined, query: string): boolean {
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

const FILTER_SELECT_CLASS =
  "rounded-lg border border-zinc-800 bg-black/45 px-2 py-1 text-[11px] text-zinc-200 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black";

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FILTER_SELECT_CLASS}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black/45 px-2.5 py-1 text-[12px] text-white placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${statusTone(status)}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function FeedbackRow({
  row,
  onUpdateStatus,
}: {
  row: AdminFeedbackRow;
  onUpdateStatus: (id: string, status: FeedbackStatusValue) => Promise<boolean>;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);

  async function setStatus(status: FeedbackStatusValue) {
    if (updating || status === row.status) return;
    setUpdating(true);
    setError(false);
    const ok = await onUpdateStatus(row.id, status);
    if (!ok) setError(true);
    setUpdating(false);
  }

  return (
    <li className="border-t border-[#1B2433] px-4 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-cyan-200">
          {categoryLabel(row.category)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={row.status} />
          <span className="text-[10px] text-zinc-600">
            {formatDateTime(row.createdAt)}
          </span>
        </div>
      </div>
      <p className="mt-1 break-words text-sm text-zinc-200">
        {row.messagePreview}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-600">
        <span>by {row.username}</span>
        {row.route ? <span>route: {row.route}</span> : null}
        {row.roomCode ? <span>room: {row.roomCode}</span> : null}
      </div>

      {/* Triage actions — status only. No delete / edit. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {FEEDBACK_STATUSES.map((s) => {
          const active = row.status === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => void setStatus(s.value)}
              disabled={updating || active}
              aria-pressed={active}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
                active
                  ? "border-[#3B9EFF]/55 bg-[#3B9EFF]/15 text-[#9AD2FF]"
                  : "border-zinc-700 bg-black/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              } disabled:opacity-50`}
            >
              {s.label}
            </button>
          );
        })}
        {updating ? (
          <span className="text-[10px] text-zinc-500">Updating…</span>
        ) : null}
        {error ? (
          <span className="text-[10px] text-red-300/80" role="alert">
            Could not update feedback status.
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ChatRow({
  row,
  onUpdateStatus,
}: {
  row: AdminChatRow;
  onUpdateStatus: (id: string, status: ChatStatusValue) => Promise<boolean>;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);

  async function setStatus(status: ChatStatusValue) {
    if (updating || status === row.status) return;
    setUpdating(true);
    setError(false);
    const ok = await onUpdateStatus(row.id, status);
    if (!ok) setError(true);
    setUpdating(false);
  }

  return (
    <li className="border-t border-[#1B2433] px-4 py-2.5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-zinc-300">
          {row.username}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={row.status} />
          <span className="text-[10px] text-zinc-600">
            {formatDateTime(row.createdAt)}
          </span>
        </div>
      </div>
      <p className="mt-0.5 break-words text-[13px] text-zinc-200">
        {row.messagePreview}
      </p>

      {/* Moderation actions — status only. No delete / edit / ban. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {CHAT_STATUSES.map((s) => {
          const active = row.status === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => void setStatus(s.value)}
              disabled={updating || active}
              aria-pressed={active}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
                active
                  ? "border-[#3B9EFF]/55 bg-[#3B9EFF]/15 text-[#9AD2FF]"
                  : "border-zinc-700 bg-black/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              } disabled:opacity-50`}
            >
              {s.label}
            </button>
          );
        })}
        {updating ? (
          <span className="text-[10px] text-zinc-500">Updating…</span>
        ) : null}
        {error ? (
          <span className="text-[10px] text-red-300/80" role="alert">
            Could not update chat status.
          </span>
        ) : null}
      </div>
    </li>
  );
}

function auditActionLabel(action: string): string {
  switch (action) {
    case "feedback_status_update":
      return "feedback status";
    case "chat_status_update":
      return "chat status";
    default:
      return action.replace(/_/g, " ");
  }
}

function auditTargetLabel(targetTable: string): string {
  switch (targetTable) {
    case "beta_feedback":
      return "Feedback";
    case "lobby_chat_messages":
      return "Chat";
    default:
      return targetTable;
  }
}

function AuditRow({ row }: { row: AdminAuditRow }) {
  return (
    <li className="border-t border-[#1B2433] px-4 py-2.5 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[13px] text-zinc-200">
          <span className="font-bold text-cyan-200">{row.adminUsername}</span>{" "}
          changed {auditActionLabel(row.action)}:{" "}
          <span className="font-semibold text-zinc-300">
            {row.oldStatus ?? "—"}
          </span>{" "}
          <span className="text-zinc-500" aria-hidden>
            →
          </span>{" "}
          <span className="font-semibold text-white">
            {row.newStatus ?? "—"}
          </span>
        </p>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded border border-zinc-700/70 bg-black/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">
            {auditTargetLabel(row.targetTable)}
          </span>
          <span className="text-[10px] text-zinc-600">
            {formatDateTime(row.createdAt)}
          </span>
        </div>
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-600">
        target #{row.targetIdShort}
      </p>
    </li>
  );
}

function MatchRow({ row }: { row: AdminMatchRow }) {
  return (
    <li className="flex items-center gap-3 border-t border-[#1B2433] px-4 py-2.5 first:border-t-0">
      <span className="shrink-0 rounded border border-zinc-700/70 bg-black/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">
        {matchTypeLabel(row.matchType)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          <span className="font-semibold">{row.playerOneUsername}</span>
          <span className="text-zinc-500"> vs </span>
          <span className="font-semibold">{row.playerTwoUsername}</span>
        </p>
        <p className="text-[10px] text-zinc-600">
          {formatDateTime(row.createdAt)} · room {row.roomCode}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-black tabular-nums text-zinc-200">
          {row.playerOneScore}–{row.playerTwoScore}
        </p>
        <p className="text-[10px] text-zinc-500">
          {row.isDraw ? "Draw" : row.winnerUsername ?? "—"}
        </p>
      </div>
    </li>
  );
}

function SafetyRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#1B2433] px-4 py-2.5 first:border-t-0">
      <span className="text-xs text-zinc-400">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-bold ${
          ok ? "text-emerald-300" : "text-zinc-300"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-500"}`}
          aria-hidden
        />
        {value}
      </span>
    </div>
  );
}

export default function AdminBetaDashboard({
  data,
}: {
  data: AdminBetaDashboardResponse;
}) {
  // Full dashboard payload in local state so manual / auto refresh can replace
  // it without a browser reload. Sections derive from dashboardData; the
  // matches / audit / safety / generatedAt all read from here.
  const [dashboardData, setDashboardData] =
    useState<AdminBetaDashboardResponse>(data);
  const { matchSummary, safety } = dashboardData;

  // Feedback rows + summary are local state so a successful triage update
  // reflects immediately without a full refetch.
  const [feedback, setFeedback] = useState<AdminFeedbackRow[]>(
    data.recentFeedback
  );
  const [feedbackSummary, setFeedbackSummary] = useState<BetaFeedbackSummary>(
    data.feedbackSummary
  );

  // Chat rows + summary are local state for the same reason.
  const [chat, setChat] = useState<AdminChatRow[]>(data.recentChat);
  const [chatSummary, setChatSummary] = useState<AdminChatSummary>(
    data.chatSummary
  );

  // Refresh / live-update state.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(
    data.generatedAt
  );
  // Guard against overlapping refreshes (e.g. auto + manual) without making the
  // refresh callback depend on the `refreshing` state value.
  const refreshingRef = useRef(false);

  // ── Client-side filter state (display only — never mutates data) ──────────
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState("all");
  const [feedbackCategoryFilter, setFeedbackCategoryFilter] = useState("all");
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [chatStatusFilter, setChatStatusFilter] = useState("all");
  const [chatSearch, setChatSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");

  // Re-fetch the dashboard via the existing admin-gated route. Replaces the
  // data without a browser reload; filter selections are React state and are
  // left untouched, so they persist across refreshes. Fails closed.
  async function refreshDashboard(): Promise<boolean> {
    if (refreshingRef.current) return false; // no overlapping refreshes
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setRefreshError("Could not refresh dashboard.");
        return false;
      }

      const res = await fetch("/api/admin/beta-dashboard", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        setRefreshError("Could not refresh dashboard.");
        return false;
      }

      const json = (await res.json()) as AdminBetaDashboardResponse;
      setDashboardData(json);
      setFeedback(json.recentFeedback);
      setFeedbackSummary(json.feedbackSummary);
      setChat(json.recentChat);
      setChatSummary(json.chatSummary);
      setLastRefreshedAt(json.generatedAt);
      return true;
    } catch {
      setRefreshError("Could not refresh dashboard.");
      return false;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  // Auto-refresh: poll every 30s while enabled and the tab is visible. No
  // Socket.IO / SSE / realtime subscriptions. Cleared on toggle-off / unmount.
  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (refreshingRef.current) return;
      void refreshDashboard();
    }, 30_000);

    return () => window.clearInterval(intervalId);
    // refreshDashboard only reads refs/setters (stable); safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const filteredFeedback = feedback.filter((row) => {
    if (feedbackStatusFilter !== "all" && row.status !== feedbackStatusFilter)
      return false;
    if (
      feedbackCategoryFilter !== "all" &&
      row.category !== feedbackCategoryFilter
    )
      return false;
    const q = feedbackSearch.trim();
    if (q.length === 0) return true;
    return (
      includesText(row.messagePreview, q) ||
      includesText(row.username, q) ||
      includesText(row.route, q) ||
      includesText(row.roomCode, q)
    );
  });

  const filteredChat = chat.filter((row) => {
    if (chatStatusFilter !== "all" && row.status !== chatStatusFilter)
      return false;
    const q = chatSearch.trim();
    if (q.length === 0) return true;
    return includesText(row.messagePreview, q) || includesText(row.username, q);
  });

  const filteredAuditLog = dashboardData.recentAuditLog.filter((row) => {
    if (auditActionFilter !== "all" && row.action !== auditActionFilter)
      return false;
    const q = auditSearch.trim();
    if (q.length === 0) return true;
    return (
      includesText(row.adminUsername, q) ||
      includesText(row.targetIdShort, q) ||
      includesText(row.oldStatus, q) ||
      includesText(row.newStatus, q)
    );
  });

  async function handleUpdateStatus(
    id: string,
    status: FeedbackStatusValue
  ): Promise<boolean> {
    const previous = feedback.find((row) => row.id === id);
    if (!previous || previous.status === status) return true;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return false;

      const res = await fetch("/api/admin/beta-feedback/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ feedbackId: id, status }),
      });

      if (!res.ok) return false;

      setFeedback((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status } : row))
      );
      setFeedbackSummary((prev) =>
        adjustSummary(prev, previous.status, status)
      );
      return true;
    } catch {
      return false;
    }
  }

  async function handleUpdateChatStatus(
    id: string,
    status: ChatStatusValue
  ): Promise<boolean> {
    const previous = chat.find((row) => row.id === id);
    if (!previous || previous.status === status) return true;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return false;

      const res = await fetch("/api/admin/lobby-chat/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messageId: id, status }),
      });

      if (!res.ok) return false;

      setChat((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status } : row))
      );
      setChatSummary((prev) =>
        adjustChatSummary(prev, previous.status, status)
      );
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-24">
      {/* Header */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400/70">
          444 Arena · Free Play Beta
        </p>
        <h1 className="text-2xl font-black text-white">Admin Beta Monitoring</h1>
        <p className="mt-0.5 text-sm text-zinc-400">
          Beta operations dashboard with admin-only feedback triage and chat
          moderation.
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Monitoring only. No player funds, prizes, or real-money features are
          active. · Generated {formatDateTime(dashboardData.generatedAt)}
        </p>
      </div>

      {/* Refresh / live-update controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#1B2433] bg-[#0D1420] px-4 py-2.5">
        <button
          type="button"
          onClick={() => void refreshDashboard()}
          disabled={refreshing}
          className="rounded-lg border border-[#3B9EFF]/45 bg-[#3B9EFF]/10 px-3 py-1.5 text-xs font-bold text-[#9AD2FF] transition-colors hover:border-[#3B9EFF]/70 hover:bg-[#3B9EFF]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>

        <button
          type="button"
          onClick={() => setAutoRefresh((v) => !v)}
          aria-pressed={autoRefresh}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
            autoRefresh
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
              : "border-zinc-700 bg-black/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          Auto-refresh: {autoRefresh ? "ON" : "OFF"}
        </button>

        <span className="text-[11px] text-zinc-500">
          Last updated: {formatDateTime(lastRefreshedAt)}
        </span>

        {autoRefresh ? (
          <span className="text-[11px] text-zinc-600">· every 30s</span>
        ) : null}

        {refreshError ? (
          <span className="text-[11px] text-red-300/80" role="alert">
            {refreshError}
          </span>
        ) : null}
      </div>

      {/* Activity counts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total matches" value={matchSummary.total} />
        <StatCard label="Last 24h" value={matchSummary.last24h} />
        <StatCard label="Public" value={matchSummary.publicMatches} />
        <StatCard label="Private" value={matchSummary.privateMatches} />
        <StatCard label="Tournament" value={matchSummary.tournamentMatches} />
        <StatCard label="Chat messages" value={chatSummary.total} />
      </div>

      {/* Feedback summary counts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatCard label="Feedback total" value={feedbackSummary.total} />
        <StatCard label="Open" value={feedbackSummary.open} />
        <StatCard label="Triaged" value={feedbackSummary.triaged} />
        <StatCard label="Resolved" value={feedbackSummary.resolved} />
        <StatCard label="Won't fix" value={feedbackSummary.wontFix} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent feedback */}
        <SectionCard
          title="Recent Beta Feedback"
          subtitle={`Showing ${filteredFeedback.length} of ${feedback.length}`}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label="Status"
                value={feedbackStatusFilter}
                onChange={setFeedbackStatusFilter}
                options={FEEDBACK_STATUS_OPTIONS}
              />
              <FilterSelect
                label="Category"
                value={feedbackCategoryFilter}
                onChange={setFeedbackCategoryFilter}
                options={FEEDBACK_CATEGORY_OPTIONS}
              />
              <FilterSearch
                value={feedbackSearch}
                onChange={setFeedbackSearch}
                placeholder="Search message, user, route, room…"
              />
            </div>
          }
        >
          {feedback.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No feedback submitted yet.
            </p>
          ) : filteredFeedback.length > 0 ? (
            <ul>
              {filteredFeedback.map((row) => (
                <FeedbackRow
                  key={row.id}
                  row={row}
                  onUpdateStatus={handleUpdateStatus}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No records match these filters.
            </p>
          )}
        </SectionCard>

        {/* Recent chat */}
        <SectionCard
          title="Recent Lobby Chat"
          subtitle={`Showing ${filteredChat.length} of ${chat.length} · ${chatSummary.flagged} flagged · ${chatSummary.hidden} hidden`}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label="Status"
                value={chatStatusFilter}
                onChange={setChatStatusFilter}
                options={CHAT_STATUS_OPTIONS}
              />
              <FilterSearch
                value={chatSearch}
                onChange={setChatSearch}
                placeholder="Search message or user…"
              />
            </div>
          }
        >
          {chat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No chat messages yet.
            </p>
          ) : filteredChat.length > 0 ? (
            <ul>
              {filteredChat.map((row) => (
                <ChatRow
                  key={row.id}
                  row={row}
                  onUpdateStatus={handleUpdateChatStatus}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No records match these filters.
            </p>
          )}
        </SectionCard>
      </div>

      {/* Recent matches */}
      <SectionCard
        title="Recent Matches"
        subtitle={`Latest ${dashboardData.recentMatches.length}`}
      >
        {dashboardData.recentMatches.length > 0 ? (
          <ul>
            {dashboardData.recentMatches.map((row, i) => (
              <MatchRow key={`${row.roomCode}-${i}`} row={row} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No matches recorded yet.
          </p>
        )}
      </SectionCard>

      {/* Recent admin audit log */}
      <SectionCard
        title="Recent Admin Audit Log"
        subtitle={`Showing ${filteredAuditLog.length} of ${dashboardData.recentAuditLog.length} admin actions`}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Action"
              value={auditActionFilter}
              onChange={setAuditActionFilter}
              options={AUDIT_ACTION_OPTIONS}
            />
            <FilterSearch
              value={auditSearch}
              onChange={setAuditSearch}
              placeholder="Search admin, target, status…"
            />
          </div>
        }
      >
        {dashboardData.recentAuditLog.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No admin actions recorded yet.
          </p>
        ) : filteredAuditLog.length > 0 ? (
          <ul>
            {filteredAuditLog.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No records match these filters.
          </p>
        )}
      </SectionCard>

      {/* Safety status */}
      <SectionCard
        title="Safety Status"
        subtitle="Beta policy — read-only labels"
      >
        <SafetyRow label="Free Play only" value="ON" ok={safety.freePlayOnly} />
        <SafetyRow label="Wallet" value={safety.walletStatus} ok={false} />
        <SafetyRow label="Real money" value="OFF" ok={false} />
        <SafetyRow label="Deposits" value="OFF" ok={false} />
        <SafetyRow label="Withdrawals" value="OFF" ok={false} />
        <SafetyRow label="Cash prizes" value="OFF" ok={false} />
        <SafetyRow
          label="Economy mode (server flag)"
          value={safety.economyMode}
          ok={safety.economyMode === "off" || safety.economyMode === "not_set"}
        />
      </SectionCard>
    </div>
  );
}
