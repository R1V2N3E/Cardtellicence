import { useEffect, useRef } from 'react';

/**
 * Refresh arrow that turns while `active`: eases in, spins evenly, and when loading ends it
 * finishes the current turn and eases out to rest instead of snapping back. The arc is centred
 * on the icon, so the turn doesn't wobble.
 */
// One turn per 850 ms while loading. The ease-in and ease-out curves are chosen so the speed
// matches exactly where they meet the steady spin — no jolt at either transition.
const TURN_MS = 850;
const START_MS = 1100;
// ease-in: starts at rest, ends with slope START_MS / TURN_MS (= steady speed)
const EASE_IN = `cubic-bezier(0.5, 0, 0.75, ${(1 - 0.25 * (START_MS / TURN_MS)).toFixed(3)})`;
// ease-out: starts with slope 2 (= steady speed for the chosen duration), ends at rest
const EASE_OUT = 'cubic-bezier(0.25, 0.5, 0.5, 1)';

export function RefreshIcon({ active }: { active: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const spin = useRef<Animation | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    if (active) {
      if (spin.current) return;
      const start = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: START_MS, easing: EASE_IN });
      spin.current = start;
      start.onfinish = () => {
        if (spin.current !== start) return;
        spin.current = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: TURN_MS, iterations: Infinity });
      };
      return;
    }
    const cur = spin.current;
    if (!cur) return;
    spin.current = null;
    // Exactly where the arrow is right now → turn on to the next full rotation, slowing down.
    const m = new DOMMatrix(getComputedStyle(el).transform);
    const from = ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
    // Never stop with a tiny jerk: if almost round, take one more turn.
    const to = 360 - from < 45 ? 720 : 360;
    cur.cancel();
    el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], {
      // Average speed of the ease-out is half the steady speed.
      duration: (2 * (to - from) * TURN_MS) / 360,
      easing: EASE_OUT,
    });
  }, [active]);

  return (
    <svg ref={ref} viewBox="0 0 24 24" className="refresh-icon" aria-hidden="true">
      <path d="M19.55 14.67a8 8 0 1 1-1.89-8.32L21.78 10.22" />
      <path d="M21.78 4.89v5.33h-5.34" />
    </svg>
  );
}
