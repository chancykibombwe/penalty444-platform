"use client";

/**
 * Shared keyframe + utility styles for the Home dashboard sections.
 *
 * Rendered ONCE at the top of `app/page.tsx` so child components stay
 * className-only. All animations are subtle by design (slow pulse, soft glow,
 * minimal motion) to match the "minimal premium competitive" target.
 */
export default function HomeShared() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@keyframes homeHeroGlow {
  0%, 100% { opacity: 0.55; transform: translate3d(-2%, -2%, 0) scale(1); }
  50% { opacity: 0.85; transform: translate3d(2%, 1%, 0) scale(1.04); }
}
.home-hero-glow {
  animation: homeHeroGlow 7s ease-in-out infinite;
}
@keyframes homeLivePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.45), 0 0 24px rgba(34, 211, 238, 0.18); }
  50% { box-shadow: 0 0 0 10px rgba(34, 211, 238, 0), 0 0 32px rgba(34, 211, 238, 0.30); }
}
.home-live-pulse {
  animation: homeLivePulse 2s ease-in-out infinite;
}
@keyframes homeDot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1.1); }
}
.home-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
  margin-right: 3px;
  animation: homeDot 1.2s ease-in-out infinite;
}
.home-dot:nth-child(2) { animation-delay: 0.18s; }
.home-dot:nth-child(3) { animation-delay: 0.36s; }
.home-game-scroll {
  scrollbar-width: none;
}
.home-game-scroll::-webkit-scrollbar { display: none; }
@keyframes homeFeedFade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
.home-feed-item { animation: homeFeedFade 0.4s ease-out forwards; }
`,
      }}
    />
  );
}
