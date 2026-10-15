// Touch gestures for the home-screen app (iOS has no native pull-to-refresh in web apps):
// - pull down at the top of the page to refresh
// - swipe left/right to switch between the page's tabs
import { useEffect, useRef, useState } from 'react';

const PULL_TRIGGER = 70; // px of pull needed to refresh
const PULL_MAX = 110;

/** Returns the current pull distance (for the indicator); calls onRefresh when released past the trigger. */
export function usePullToRefresh(onRefresh: () => void, enabled = true) {
  const [pull, setPull] = useState(0);
  const start = useRef<{ y: number; x: number } | null>(null);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    let current = 0;
    const onStart = (e: TouchEvent) => {
      // Only from the very top, and not inside sheets/dialogs.
      if (window.scrollY > 0 || (e.target as Element).closest('.sheet, .viewer')) return;
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy <= 0 || dx > dy) {
        current = 0;
        setPull(0);
        return;
      }
      current = Math.min(PULL_MAX, dy * 0.5);
      setPull(current);
    };
    const onEnd = () => {
      if (start.current && current >= PULL_TRIGGER) cb.current();
      start.current = null;
      current = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  return { pull, ready: pull >= PULL_TRIGGER, trigger: PULL_TRIGGER };
}

/**
 * Horizontal swipe switches to the previous/next tab. Swipes that start on something that
 * scrolls sideways itself (chip rows, galleries, charts, inputs) are ignored.
 */
export function useSwipeTabs<T extends string>(tabs: T[], current: T, setTab: (t: T) => void, enabled = true) {
  const state = useRef({ tabs, current, setTab });
  state.current = { tabs, current, setTab };

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const el = e.target as Element;
      if (el.closest('.row-scroll, .gallery, .match-alts, .chart, canvas, input, select, textarea, .sheet, .viewer')) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.t < 600;
      start = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const { tabs: list, current: cur, setTab: set } = state.current;
      const i = list.indexOf(cur);
      const next = dx < 0 ? list[i + 1] : list[i - 1];
      if (next) set(next);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [enabled]);
}
