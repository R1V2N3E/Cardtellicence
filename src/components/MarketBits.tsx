import { pct } from '../market';

/** A change with sign and arrow, so it never relies on color alone. */
export function Change({ v, label }: { v: number | null | undefined; label?: string }) {
  const cls = v == null ? 'flat' : v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '●';
  return (
    <span className={`chg ${cls}`}>
      {label && <small>{label}</small>}
      {arrow} {pct(v)}
    </span>
  );
}

/** Small trend line for list rows (only drawn when there are at least two days). */
export function Spark({ points, width = 84, height = 28 }: { points: { t: number; v: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (width - 4) + 2);
  const y = (v: number) => (max === min ? height / 2 : height - 3 - ((v - min) / (max - min)) * (height - 6));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const up = vs[vs.length - 1] >= vs[0];
  return (
    <svg className={`spark ${up ? 'up' : 'down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} />
      <circle cx={x(points[points.length - 1].t)} cy={y(vs[vs.length - 1])} r="2.5" />
    </svg>
  );
}

/** Share of a whole, as a thin bar (one hue: it encodes magnitude only). */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="share-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(1.5, Math.min(100, share * 100))}%` }} />
    </span>
  );
}
