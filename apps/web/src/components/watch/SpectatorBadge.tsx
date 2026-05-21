"use client";

/**
 * Spectator badge — always-visible "Spectating · LIVE" / "Spectating · FINAL"
 * pill that anchors the watch view as read-only.
 *
 * The badge is intentionally separate from `LivePulseBadge` because it
 * carries a stronger semantic — "you are observing, not playing" — and
 * pairs an eye icon with the live state.
 */
type Tone = "live" | "ready" | "ended" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  live: "border-cyan-400/50 bg-cyan-500/12 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.22)]",
  ready:
    "border-amber-300/50 bg-amber-500/10 text-amber-100 shadow-[0_0_18px_rgba(250,204,21,0.18)]",
  ended:
    "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 shadow-[0_0_18px_rgba(250,204,21,0.20)]",
  neutral: "border-zinc-700 bg-zinc-900/70 text-zinc-200",
};

const DOT_CLASS: Record<Tone, string> = {
  live: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.85)]",
  ready: "bg-amber-300 shadow-[0_0_8px_rgba(250,204,21,0.65)]",
  ended: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.85)]",
  neutral: "bg-zinc-400",
};

type Props = {
  /** Status label to render after "Spectating ·". */
  statusLabel: string;
  tone?: Tone;
  className?: string;
};

export default function SpectatorBadge({
  statusLabel,
  tone = "live",
  className,
}: Props) {
  const pulse = tone === "live" || tone === "ready";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${TONE_CLASS[tone]} ${className ?? ""}`}
      aria-label={`Spectating · ${statusLabel}`}
    >
      <EyeIcon className="h-3.5 w-3.5" />
      <span>Spectating</span>
      <span aria-hidden className="opacity-50">
        ·
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]} ${pulse ? "animate-pulse" : ""}`}
        />
        {statusLabel}
      </span>
    </span>
  );
}

function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
