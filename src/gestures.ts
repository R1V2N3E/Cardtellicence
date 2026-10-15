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

/** Everything below the page's segmented tabs: what slides along with the finger. */
function swipeLayer(): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = document.querySelector('.seg-tabs')?.nextElementSibling as HTMLElement | null;
  while (el) {
    out.push(el);
    el = el.nextElementSibling as HTMLElement | null;
  }
  return out;
}

const IGNORE = '.row-scroll, .gallery, .match-alts, .chart, canvas, input, select, textarea, .sheet, .viewer, .sheet-backdrop';

/**
 * Horizontal swipe switches to the previous/next tab, like a native pager:
 * - the direction is decided after the first few pixels, so a curved thumb swipe still counts,
 * - while swiping sideways the page doesn't scroll and the content follows the finger,
 * - releasing past 60 px (or a quick flick) switches the tab; otherwise it springs back.
 * Swipes that start on something that scrolls sideways itself (chip rows, galleries, charts,
 * inputs) are left alone.
 */
export function useSwipeTabs<T extends string>(tabs: T[], current: T, setTab: (t: T) => void, enabled = true) {
  const state = useRef({ tabs, current, setTab });
  state.current = { tabs, current, setTab };

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let dx = 0;
    let layer: HTMLElement[] = [];

    const move = (x: number, animate: boolean) => {
      for (const el of layer) {
        el.style.transition = animate ? 'transform .22s cubic-bezier(.2,.9,.25,1), opacity .22s ease' : 'none';
        el.style.transform = x ? `translateX(${x}px)` : '';
        el.style.opacity = x ? String(Math.max(0.4, 1 - Math.abs(x) / 400)) : '';
      }
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      axis = null;
      dx = 0;
      if (e.touches.length !== 1 || (e.target as Element).closest(IGNORE)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const ddx = e.touches[0].clientX - start.x;
      const ddy = e.touches[0].clientY - start.y;
      if (!axis) {
        if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
        axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
        if (axis === 'x') layer = swipeLayer();
      }
      if (axis !== 'x') return;
      e.preventDefault(); // keep the page from scrolling while paging sideways
      dx = ddx;
      const { tabs: list, current: cur } = state.current;
      const i = list.indexOf(cur);
      const atEdge = (dx > 0 && i === 0) || (dx < 0 && i === list.length - 1);
      move(atEdge ? dx * 0.2 : dx * 0.6, false);
    };

    const onEnd = () => {
      if (!start || axis !== 'x') {
        start = null;
        return;
      }
      const fast = Date.now() - start.t < 300 && Math.abs(dx) > 30;
      start = null;
      const { tabs: list, current: cur, setTab: set } = state.current;
      const i = list.indexOf(cur);
      const next = Math.abs(dx) > 60 || fast ? (dx < 0 ? list[i + 1] : list[i - 1]) : undefined;
      if (!next) return move(0, true);
      // Slide the new tab in from the side the finger came from.
      set(next);
      const from = dx < 0 ? 60 : -60;
      requestAnimationFrame(() => {
        layer = swipeLayer();
        move(from, false);
        requestAnimationFrame(() => move(0, true));
      });
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      for (const el of swipeLayer()) {
        el.style.transform = '';
        el.style.opacity = '';
        el.style.transition = '';
      }
    };
  }, [enabled]);
}
