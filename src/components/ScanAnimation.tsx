import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardReading, IdentifyProgress } from '../../lib/identify';

type Stage = 'upload' | 'reading' | 'searching' | 'verifying' | 'done';

const STEPS: { key: Stage; label: string }[] = [
  { key: 'upload', label: 'Foto senden' },
  { key: 'reading', label: 'Name, Set & Nummer lesen' },
  { key: 'searching', label: 'Kartendatenbank durchsuchen' },
  { key: 'verifying', label: 'Artwork vergleichen' },
  { key: 'done', label: 'Treffer bestätigt' },
];
const ORDER: Stage[] = ['upload', 'reading', 'searching', 'verifying', 'done'];

/** Where the run is, from the server's progress events. */
function stageOf(events: IdentifyProgress[], finished: boolean): Stage {
  if (finished) return 'done';
  const last = events[events.length - 1]?.stage;
  if (!last) return 'upload';
  if (last === 'reading') return 'reading';
  if (last === 'read' || last === 'searching') return 'searching';
  if (last === 'candidates') return 'searching';
  if (last === 'verifying') return 'verifying';
  return 'reading';
}

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEFGHJKLMNPRSTUVWXYZ/';
const scramble = (n: number) => Array.from({ length: n }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join('');

/** Text that "decodes" from random glyphs into the real value. */
function Decode({ text, delay = 0 }: { text: string; delay?: number }) {
  const [shown, setShown] = useState(() => scramble(text.length));
  useEffect(() => {
    let frame = 0;
    const total = 14 + text.length * 2;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      frame++;
      const fixed = Math.floor((frame / total) * text.length);
      setShown(text.slice(0, fixed) + scramble(Math.max(0, text.length - fixed)));
      if (frame < total) t = setTimeout(tick, 32);
      else setShown(text);
    };
    t = setTimeout(tick, delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  return <>{shown}</>;
}

/** Placeholder line of cycling glyphs while nothing is known yet. */
function Noise({ n }: { n: number }) {
  const [s, setS] = useState(() => scramble(n));
  useEffect(() => {
    const id = setInterval(() => setS(scramble(n)), 70);
    return () => clearInterval(id);
  }, [n]);
  return <span className="sa-noise">{s}</span>;
}

/**
 * The card's motion, driven per frame without re-rendering React: a slow floating sway, a finger
 * drag that springs back, and on success one smooth full turn while the photo morphs into the
 * recognised card.
 */
function useCardMotion(finished: boolean) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, x0: 0, y0: 0, dx: 0, dy: 0, vx: 0, vy: 0 });
  const spinFrom = useRef<number | null>(null);
  useEffect(() => {
    if (finished && spinFrom.current == null) spinFrom.current = performance.now();
  }, [finished]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const d = drag.current;
      if (!d.active) {
        // Spring back to rest.
        d.vx = (d.vx - d.dx * 0.06) * 0.86;
        d.vy = (d.vy - d.dy * 0.06) * 0.86;
        d.dx += d.vx;
        d.dy += d.vy;
      }
      const spin = spinFrom.current == null ? 0 : ease(Math.min(1, (now - spinFrom.current) / 1800)) * 360;
      const calm = spinFrom.current == null ? 1 : Math.max(0, 1 - (now - spinFrom.current) / 900);
      const ry = Math.sin(t * 0.9) * 20 * calm + d.dx * 0.35 + spin;
      const rx = Math.sin(t * 0.7 + 1) * 8 * calm - d.dy * 0.3;
      const y = Math.sin(t * 1.3) * 9 * calm;
      if (el.current) {
        el.current.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
        // Light follows the angle: moves the holo foil and the glare.
        el.current.style.setProperty('--tilt', String(((ry % 360) + 360) % 360 / 360));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const d = drag.current;
      d.active = true;
      d.x0 = e.clientX - d.dx;
      d.y0 = e.clientY - d.dy;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d.active) return;
      d.dx = e.clientX - d.x0;
      d.dy = e.clientY - d.y0;
    },
    onPointerUp: () => {
      drag.current.active = false;
    },
  };
  return { el, handlers };
}

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  r: 150 + (i % 6) * 18,
  d: 5 + (i % 5) * 1.7,
  delay: -(i * 0.73),
  size: 2 + (i % 3),
  hue: [265, 190, 300, 170][i % 4],
}));

export function ScanAnimation({
  photo,
  events,
  finished,
  resultImage,
}: {
  photo: string;
  events: IdentifyProgress[];
  finished: boolean;
  /** Artwork of the recognised card: the photo morphs into it at the end. */
  resultImage?: string | null;
}) {
  const { el, handlers } = useCardMotion(finished);
  const stage = stageOf(events, finished);
  const reading = useMemo(() => (events.find((e) => e.stage === 'read') as { reading: CardReading } | undefined)?.reading ?? null, [events]);
  const candidates = useMemo(
    () => (events.find((e) => e.stage === 'candidates') as Extract<IdentifyProgress, { stage: 'candidates' }> | undefined)?.candidates ?? [],
    [events],
  );
  const skipVerify = finished && !events.some((e) => e.stage === 'verifying');
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, []);

  // Progress ring: each stage owns a slice and creeps forward inside it, so it never stands still.
  const idx = ORDER.indexOf(stage);
  const slice = [0, 0.12, 0.45, 0.72, 1][idx];
  const next = [0.12, 0.45, 0.72, 0.97, 1][idx];
  const [creep, setCreep] = useState(0);
  useEffect(() => setCreep(0), [stage]);
  useEffect(() => {
    const id = setInterval(() => setCreep((c) => c + (1 - c) * 0.05), 120);
    return () => clearInterval(id);
  }, []);
  const progress = stage === 'done' ? 1 : slice + (next - slice) * creep;
  const C = 2 * Math.PI * 44;

  const hint =
    stage === 'upload'
      ? 'Bild wird übertragen…'
      : stage === 'reading'
        ? elapsed > 8
          ? 'Kleingedrucktes wird entziffert…'
          : 'KI liest die Karte…'
        : stage === 'searching'
          ? 'Abgleich mit allen japanischen Sets…'
          : stage === 'verifying'
            ? 'Illustrationen werden verglichen…'
            : 'Gefunden!';

  return (
    <div className={`scan-anim ${finished ? 'is-done' : ''}`} role="status" aria-live="polite">
      <div className="sa-aurora" />
      <div className="sa-grid-floor" />

      <div className="sa-stage">
        <div className="sa-orbit" aria-hidden="true">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="sa-particle"
              style={{ ['--r' as string]: `${p.r}px`, ['--d' as string]: `${p.d}s`, ['--delay' as string]: `${p.delay}s`, ['--s' as string]: `${p.size}px`, ['--h' as string]: p.hue }}
            />
          ))}
        </div>
        <div className="sa-ring3d" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="sa-card-wrap" {...handlers}>
          <div className="sa-card3d" ref={el}>
            <div className="sa-face front">
              <img className="sa-photo" src={photo} alt="" />
              {resultImage && <img className="sa-result" src={resultImage} alt="" />}
              {resultImage && <span className="sa-morph-ring" />}
              <div className="sa-holo" />
              <div className="sa-glare" />
              <div className="sa-mesh" />
              <div className="sa-laser" />
              <div className="sa-scanned" />
              {['tl', 'tr', 'bl', 'br'].map((c) => (
                <span key={c} className={`sa-corner ${c}`} />
              ))}
              {reading && !finished && (
                <>
                  <span className="sa-tag sa-tag-name">NAME</span>
                  <span className="sa-tag sa-tag-num">
                    {reading.set_code ?? 'SET'} · {reading.number ?? 'NR'}
                  </span>
                </>
              )}
            </div>
            <div className="sa-edge" />
            <div className="sa-face back">
              {resultImage ? <img src={resultImage} alt="" /> : <div className="sa-back-pattern" />}
            </div>
          </div>
          <div className="sa-shadow" />
        </div>
        <div className="sa-flash" />
      </div>

      <div className="sa-panel">
        <div className="sa-readout">
          <div className="sa-line big">
            <small>Name</small>
            {reading?.name ? <Decode text={reading.name} /> : <Noise n={8} />}
          </div>
          <div className="sa-chips">
            <span className="sa-chip">
              <small>Set</small>
              {reading ? <Decode text={reading.set_code ?? '–'} delay={150} /> : <Noise n={4} />}
            </span>
            <span className="sa-chip">
              <small>Nr.</small>
              {reading ? <Decode text={reading.number ?? '–'} delay={300} /> : <Noise n={7} />}
            </span>
            <span className="sa-chip">
              <small>Rarität</small>
              {reading ? <Decode text={reading.rarity ?? '–'} delay={450} /> : <Noise n={3} />}
            </span>
            <span className="sa-chip">
              <small>KP</small>
              {reading ? <Decode text={reading.hp != null ? String(reading.hp) : '–'} delay={600} /> : <Noise n={3} />}
            </span>
          </div>
        </div>

        {candidates.length > 0 && (
          <div className={`sa-cands ${stage === 'verifying' ? 'verifying' : ''}`}>
            {candidates.slice(0, 5).map((c, i) => (
              <div key={`${c.setId}-${c.number}-${i}`} className={`sa-cand ${i === 0 ? 'lead' : ''}`} style={{ ['--i' as string]: i }}>
                {c.image ? <img src={c.image} alt="" /> : <span>{c.setId}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="sa-progress">
          <svg viewBox="0 0 100 100" className="sa-ring" aria-hidden="true">
            <defs>
              <linearGradient id="saRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#b794ff" />
                <stop offset="0.5" stopColor="#7c6cff" />
                <stop offset="1" stopColor="#2ed8f0" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44" className="sa-ring-bg" />
            <circle cx="50" cy="50" r="44" className="sa-ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
            <text x="50" y="47" className="sa-ring-pct">
              {Math.round(progress * 100)}%
            </text>
            <text x="50" y="63" className="sa-ring-time">
              {elapsed.toFixed(1)} s
            </text>
          </svg>
          <ol className="sa-steps">
            {STEPS.map((s) => {
              const i = ORDER.indexOf(s.key);
              const skipped = s.key === 'verifying' && skipVerify;
              const state = i < idx || stage === 'done' ? 'done' : i === idx ? 'active' : 'todo';
              return (
                <li key={s.key} className={`sa-step ${state} ${skipped ? 'skipped' : ''}`}>
                  <span className="dot" />
                  {skipped ? 'Eindeutig – Vergleich übersprungen' : s.label}
                </li>
              );
            })}
          </ol>
        </div>
        <p className="sa-hint">{hint}</p>
      </div>
    </div>
  );
}
