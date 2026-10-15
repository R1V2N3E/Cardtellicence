import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { de } from 'date-fns/locale';
import { useEffect, useRef } from 'react';
import type { ChartPoint } from '../../lib/types';
import { fmtEur } from '../format';

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Legend, Filler);

export interface Series {
  label: string;
  points: ChartPoint[]; // values in EUR
  color: string;
  dashed?: boolean;
  stepped?: boolean;
}

// '#rrggbb' + alpha → rgba()
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function PriceChart({ series, height = 220, intraday = false }: { series: Series[]; height?: number; intraday?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    const grid = css('--grid');
    const muted = css('--muted');
    chart.current?.destroy();
    chart.current = new Chart(canvas.current, {
      type: 'line',
      data: {
        datasets: series
          .filter((s) => s.points.length)
          .map((s, i) => ({
            label: s.label,
            data: s.points.map((p) => ({ x: p.t, y: Math.round(p.v * 100) / 100 })),
            borderColor: s.color,
            // The main line gets a soft glow fill down to the axis.
            backgroundColor: (c: { chart: Chart }) => {
              const area = c.chart.chartArea;
              if (i > 0 || s.dashed || !area) return s.color;
              const g = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, alpha(s.color, 0.32));
              g.addColorStop(1, alpha(s.color, 0));
              return g;
            },
            fill: i === 0 && !s.dashed ? 'start' : false,
            borderWidth: i === 0 ? 2.5 : 2,
            pointBackgroundColor: s.color,
            borderDash: s.dashed ? [5, 4] : undefined,
            stepped: s.stepped,
            pointRadius: s.points.length > 40 ? 0 : 2.5,
            pointHitRadius: 10,
            tension: 0.25,
          })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'time', adapters: { date: { locale: de } }, time: { tooltipFormat: intraday ? 'dd.MM. HH:mm' : 'dd.MM.yyyy', displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'd. MMM', week: 'd. MMM', month: 'MMM yy' } }, grid: { display: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5 } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: (v) => fmtEur(Number(v)), maxTicksLimit: 6 } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, boxHeight: 2, font: { size: 11 }, generateLabels: (c) => Chart.defaults.plugins.legend.labels.generateLabels(c).map((l) => ({ ...l, fillStyle: l.strokeStyle })) } },
          tooltip: { backgroundColor: css('--surface-3'), titleColor: css('--text'), bodyColor: css('--text'), borderColor: css('--border-strong'), borderWidth: 1, cornerRadius: 10, padding: 10, callbacks: { label: (c) => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, [series, intraday]);

  const empty = series.every((s) => !s.points.length);
  return (
    <div className="chart" style={{ height }}>
      {empty ? <div className="chart-empty">Keine Verkaufsdaten in diesem Zeitraum</div> : <canvas ref={canvas} />}
    </div>
  );
}
