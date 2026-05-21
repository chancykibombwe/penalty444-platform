"use client";

import { useEffect, useState } from "react";
import type { PromotionEvent } from "../../lib/player/promotion";

/**
 * Display-only promotion toast.
 *
 * Mount once near the top of an identity surface (account page, home, etc.)
 * and pass a `PromotionEvent` whenever one is detected. The toast slides in,
 * auto-dismisses after `visibleMs`, and can be dismissed by tapping it.
 *
 * Presentation-only — never fires unless the parent feeds a real event.
 */
type Props = {
  event: PromotionEvent | null;
  visibleMs?: number;
};

export default function PromotionToast({ event, visibleMs = 5_000 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), visibleMs);
    return () => window.clearTimeout(t);
  }, [event, visibleMs]);

  if (!event || !visible) return null;

  const isChampion = event.to.id === "champion";

  return (
    <button
      type="button"
      onClick={() => setVisible(false)}
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex max-w-md cursor-pointer items-center gap-4 rounded-2xl border-2 px-5 py-4 shadow-2xl backdrop-blur-sm transition-opacity"
      style={{
        animation: "p444PromotionSlide 360ms cubic-bezier(0.22, 1, 0.36, 1)",
        background:
          "linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(15,15,18,0.85) 100%)",
        borderColor: isChampion ? "rgba(234,179,8,0.7)" : "rgba(56,189,248,0.6)",
        boxShadow: isChampion
          ? "0 0 48px rgba(234,179,8,0.35)"
          : "0 0 38px rgba(56,189,248,0.3)",
      }}
      aria-label={`Promoted to ${event.to.label}`}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes p444PromotionSlide{0%{opacity:0;transform:translateY(24px) scale(0.96)}60%{opacity:1;transform:translateY(0) scale(1.02)}100%{opacity:1;transform:translateY(0) scale(1)}}`,
        }}
      />
      <span
        aria-hidden
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl ${event.to.borderClass} border-2 ${event.to.bgClass} ${event.to.textClass}`}
      >
        {event.to.icon}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p
          className={`text-[10px] font-black uppercase tracking-[0.3em] ${
            isChampion ? "text-yellow-300" : "text-cyan-300"
          }`}
        >
          {isChampion ? "Champion reached" : "Promoted"}
        </p>
        <p className={`mt-0.5 text-xl font-black ${event.to.gradientText}`}>
          {event.to.label}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-zinc-400">
          Previously {event.from.label} · Tap to dismiss
        </p>
      </div>
    </button>
  );
}
