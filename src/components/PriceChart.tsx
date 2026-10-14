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

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function PriceChart({ series, height = 220 }: { series: Series[]; height?: number }) {
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
          .map((s) => ({
            label: s.label,
            data: s.points.map((p) => ({ x: p.t, y: Math.round(p.v * 100) / 100 })),
            borderColor: s.color,
            backgroundColor: s.color,
            borderWidth: 2,
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
          x: { type: 'time', adapters: { date: { locale: de } }, time: { tooltipFormat: 'dd.MM.yyyy', displayFormats: { day: 'd. MMM', week: 'd. MMM', month: 'MMM yy' } }, grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 5 } },
          y: { grid: { color: grid }, ticks: { color: muted, callback: (v) => fmtEur(Number(v)), maxTicksLimit: 6 } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, boxHeight: 2, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, [series]);

  const empty = series.every((s) => !s.points.length);
  return (
    <div className="chart" style={{ height }}>
      {empty ? <div className="chart-empty">Keine Verkaufsdaten in diesem Zeitraum</div> : <canvas ref={canvas} />}
    </div>
  );
}
