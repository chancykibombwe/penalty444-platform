"use client";

/**
 * Beta Feedback / Bug Report panel.
 *
 * A small, self-contained, collapsible form for logged-in beta testers to
 * report bugs or confusing screens from inside the app. Inserts a single row
 * into `public.beta_feedback` (RLS: insert-own only).
 *
 * Intentionally NOT a support desk: copy never implies live support, instant
 * replies, agents, or ticket SLAs. No fake ticket numbers are shown.
 */

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  submitBetaFeedback,
  type FeedbackCategory,
} from "../../lib/feedback/betaFeedback";

type BetaFeedbackPanelProps = {
  /** Optional active room code when rendered on a match page. */
  roomCode?: string | null;
  /** Start expanded (defaults to collapsed to stay unobtrusive). */
  defaultOpen?: boolean;
};

type Status = "idle" | "submitting" | "success" | "error";

export default function BetaFeedbackPanel({
  roomCode = null,
  defaultOpen = false,
}: BetaFeedbackPanelProps) {
  const pathname = usePathname();
  const categoryId = useId();
  const messageId = useId();

  const [open, setOpen] = useState(defaultOpen);
  const [category, setCategory] = useState<FeedbackCategory>(
    FEEDBACK_CATEGORIES[0].value
  );
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const trimmedLength = message.trim().length;
  const canSubmit = trimmedLength > 0 && status !== "submitting";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus("submitting");
    setErrorMessage("");

    const result = await submitBetaFeedback({
      category,
      message,
      route: pathname ?? null,
      roomCode,
    });

    if (result.ok) {
      setStatus("success");
      setMessage("");
      return;
    }

    setStatus("error");
    setErrorMessage(result.error);
  }

  function resetToForm() {
    setStatus("idle");
    setErrorMessage("");
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      aria-label="Beta feedback"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#1B2433] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-widest text-white">
            Help Us Improve the Beta
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Report a bug or a confusing screen.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="shrink-0 rounded-lg border border-[#1B2433] bg-black/40 px-3 py-1.5 text-xs font-bold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
        >
          {open ? "Close" : "Report Issue"}
        </button>
      </div>

      {open ? (
        <div className="p-4">
          {status === "success" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3">
                <p className="text-sm font-bold text-emerald-200">
                  Thanks — your feedback was sent.
                </p>
                <p className="mt-1 text-xs text-emerald-200/70">
                  We review beta reports as we keep building. This is not a
                  live support channel, so we can&apos;t reply directly.
                </p>
              </div>
              <button
                type="button"
                onClick={resetToForm}
                className="rounded-lg border border-[#1B2433] bg-black/40 px-3 py-1.5 text-xs font-bold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
              >
                Send another report
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor={categoryId}
                  className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400"
                >
                  Category
                </label>
                <select
                  id={categoryId}
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as FeedbackCategory)
                  }
                  disabled={status === "submitting"}
                  className="w-full rounded-lg border border-[#1B2433] bg-black/45 px-3 py-2 text-sm text-white [color-scheme:dark] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
                >
                  {FEEDBACK_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={messageId}
                  className="mb-1 block text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400"
                >
                  What happened?
                </label>
                <p className="mb-1.5 text-[11px] leading-relaxed text-zinc-500">
                  Please include what happened, what you expected, the page or
                  match room, and your device/browser if possible. A match room
                  code or screenshot helps when relevant.
                </p>
                <textarea
                  id={messageId}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                  rows={5}
                  required
                  disabled={status === "submitting"}
                  placeholder="Describe the bug or confusing screen. Include what you expected and what happened."
                  className="w-full resize-y rounded-lg border border-[#1B2433] bg-black/45 px-3 py-2 text-sm text-white placeholder:text-zinc-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:opacity-50"
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[11px] text-zinc-600">
                    Free Play Beta · for testing feedback only
                  </p>
                  <p className="text-[11px] tabular-nums text-zinc-600">
                    {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
                  </p>
                </div>
              </div>

              {status === "error" ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200"
                >
                  {errorMessage || "Could not send feedback. Please try again."}
                </div>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-xl bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] px-5 py-2.5 text-sm font-black text-white shadow-[0_0_18px_rgba(59,158,255,0.28)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/75 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {status === "submitting" ? "Sending…" : "Send Feedback"}
                </button>
                {trimmedLength === 0 ? (
                  <span className="text-[11px] text-zinc-600">
                    A message is required.
                  </span>
                ) : null}
              </div>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
