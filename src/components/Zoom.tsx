import { useEffect, useRef, useState } from 'react';

// Full-screen picture viewer for every small image in the app. Opened from anywhere with
// openZoom(); App renders one <ZoomViewer />. Pinch or double-tap to zoom, drag to pan, swipe
// sideways for the next picture, swipe down or tap to close.

interface ZoomState {
  srcs: string[];
  index: number;
  alt: string;
}

const EVENT = 'ct-zoom';

export function openZoom(srcs: string[], index = 0, alt = '') {
  const list = [...new Set(srcs.filter(Boolean))];
  if (list.length) window.dispatchEvent(new CustomEvent<ZoomState>(EVENT, { detail: { srcs: list, index: Math.min(index, list.length - 1), alt } }));
}

/** Larger version of a known small image URL (TCGdex low → high, /api/img → size=high). */
export function hiRes(src: string): string {
  if (src.endsWith('/low.webp')) return src.replace('/low.webp', '/high.webp');
  if (src.startsWith('/api/img?id=') && !src.includes('size=high')) return `${src}&size=high`;
  return src;
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function ZoomViewer() {
  const [z, setZ] = useState<ZoomState | null>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState({ dx: 0, dy: 0, live: false });
  const [hiFailed, setHiFailed] = useState<Set<string>>(new Set());
  const g = useRef<{ start: Pt; pts: Map<number, Pt>; pinch?: { d: number; s: number; c: Pt; x: number; y: number }; pan?: { x: number; y: number }; lastTap: number; moved: boolean; axis?: 'x' | 'y' }>({
    start: { x: 0, y: 0 },
    pts: new Map(),
    lastTap: 0,
    moved: false,
  });

  useEffect(() => {
    const on = (e: Event) => {
      setZ((e as CustomEvent<ZoomState>).detail);
      setView({ s: 1, x: 0, y: 0 });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // Close with the back gesture / browser back instead of leaving the page.
  useEffect(() => {
    if (!z) return;
    history.pushState({ zoom: true }, '');
    const pop = () => setZ(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && history.back();
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', key);
    };
  }, [!!z]);

  if (!z) return null;
  const close = () => history.back();
  const go = (d: number) => {
    const i = z.index + d;
    if (i < 0 || i >= z.srcs.length) return;
    setZ({ ...z, index: i });
    setView({ s: 1, x: 0, y: 0 });
  };
  const clamp = (v: { s: number; x: number; y: number }) => {
    const s = Math.min(5, Math.max(1, v.s));
    if (s === 1) return { s, x: 0, y: 0 };
    const mx = (innerWidth * (s - 1)) / 2;
    const my = (innerHeight * (s - 1)) / 2;
    return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st = g.current;
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pts.size === 2) {
      const [a, b] = [...st.pts.values()];
      st.pinch = { d: dist(a, b), s: view.s, c: mid(a, b), x: view.x, y: view.y };
      st.moved = true;
    } else if (st.pts.size === 1) {
      st.start = { x: e.clientX, y: e.clientY };
      st.pan = { x: view.x, y: view.y };
      st.moved = false;
      st.axis = undefined;
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st.pts.has(e.pointerId)) return;
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pinch && st.pts.size >= 2) {
      const [a, b] = [...st.pts.values()];
      const s = st.pinch.s * (dist(a, b) / st.pinch.d);
      const c = mid(a, b);
      // keep the point between the fingers under the fingers
      const cx = st.pinch.c.x - innerWidth / 2;
      const cy = st.pinch.c.y - innerHeight / 2;
      const k = s / st.pinch.s;
      setView(clamp({ s, x: cx - (cx - st.pinch.x) * k + (c.x - st.pinch.c.x), y: cy - (cy - st.pinch.y) * k + (c.y - st.pinch.c.y) }));
      return;
    }
    const dx = e.clientX - st.start.x;
    const dy = e.clientY - st.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) st.moved = true;
    if (view.s > 1 && st.pan) {
      setView(clamp({ s: view.s, x: st.pan.x + dx, y: st.pan.y + dy }));
    } else if (st.moved) {
      st.axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      setDrag({ dx: st.axis === 'x' ? dx : 0, dy: st.axis === 'y' ? Math.max(0, dy) : 0, live: true });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const st = g.current;
    st.pts.delete(e.pointerId);
    if (st.pts.size === 1) {
      // one finger left after a pinch: continue as a pan from here
      const [p] = [...st.pts.values()];
      st.start = p;
      st.pan = { x: view.x, y: view.y };
      st.pinch = undefined;
      return;
    }
    if (st.pts.size) return;
    st.pinch = undefined;
    const wasDrag = drag.live;
    setDrag({ dx: 0, dy: 0, live: false });
    if (wasDrag) {
      if (drag.dy > 110) return close();
      if (drag.dx < -70) return go(1);
      if (drag.dx > 70) return go(-1);
      return;
    }
    if (st.moved) return;
    const now = Date.now();
    if (now - st.lastTap < 280) {
      // double tap: zoom into the tapped spot, or back out
      st.lastTap = 0;
      if (view.s > 1) setView({ s: 1, x: 0, y: 0 });
      else {
        const s = 2.5;
        setView(clamp({ s, x: -(e.clientX - innerWidth / 2) * (s - 1), y: -(e.clientY - innerHeight / 2) * (s - 1) }));
      }
      return;
    }
    st.lastTap = now;
    const at = now;
    setTimeout(() => {
      if (g.current.lastTap === at && view.s === 1) close();
    }, 290);
  };

  const src = z.srcs[z.index];
  const big = hiFailed.has(src) ? src : hiRes(src);
  const fade = drag.dy ? Math.max(0.3, 1 - drag.dy / 400) : 1;

  return (
    <div className="zoom" role="dialog" aria-label={z.alt || 'Bild'} style={{ background: `rgba(4, 6, 14, ${0.94 * fade})` }}>
      <div
        className="zoom-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: `translate(${view.x + drag.dx}px, ${view.y + drag.dy}px) scale(${view.s * (drag.dy ? fade * 0.3 + 0.7 : 1)})`,
          transition: drag.live || g.current.pts.size ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <img key={src} src={src} alt="" className="zoom-low" draggable={false} />
        <img
          key={big}
          src={big}
          alt={z.alt}
          className="zoom-hi"
          draggable={false}
          onLoad={(e) => e.currentTarget.classList.add('on')}
          onError={() => setHiFailed((f) => new Set(f).add(src))}
        />
      </div>
      <button className="zoom-close" onClick={close} aria-label="Schließen">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {z.srcs.length > 1 && (
        <div className="zoom-dots">
          {z.srcs.map((s, i) => (
            <i key={s} className={i === z.index ? 'on' : ''} />
          ))}
        </div>
      )}
      {view.s === 1 && <div className="zoom-hint">Zwei Finger oder Doppeltipp zum Zoomen · nach unten wischen schließt</div>}
    </div>
  );
}
