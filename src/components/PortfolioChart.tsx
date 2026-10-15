import { useEffect, useMemo, useState } from "react";
import type { HistoryFile } from "../../lib/types";
import { api, type LivePrice } from "../api";
import { fmtSigned } from "../format";
import type { CollectionItem } from "../state";
import { PriceChart, type Series } from "./PriceChart";
import { Chips } from "./ui";

type Range = "1" | "7" | "30" | "all";
const DAY = 86400_000;

/**
 * Value of the collection over time.
 * - "Tageswerte": exact daily values — the daily scan's Cardmarket trend per card (history files)
 *   plus the totals this device recorded; cards without a value that day count at today's price.
 * - "Rückblick": Cardmarket's own 30- and 7-day averages for each card, plotted at the middle of
 *   their window, so there is a curve from day one (the 1-day average is too noisy to use).
 * - "Live": every value this device saw while the app was open (1T and 7T ranges).
 */
export function PortfolioChart({
  items,
  prices,
  factor,
  snapshots,
  ticks,
}: {
  items: CollectionItem[];
  prices: Record<string, LivePrice | null>;
  factor: (i: CollectionItem) => number;
  snapshots: [string, number][];
  ticks: [number, number][];
}) {
  const [range, setRange] = useState<Range>("30");
  const [histories, setHistories] = useState<Record<string, HistoryFile>>({});
  const setIds = useMemo(
    () => [...new Set(items.map((i) => i.setId))].sort().join(","),
    [items],
  );

  useEffect(() => {
    let alive = true;
    Promise.all(
      setIds
        .split(",")
        .filter(Boolean)
        .map(async (s) => [s, await api.history(s)] as const),
    ).then((entries) => alive && setHistories(Object.fromEntries(entries)));
    return () => {
      alive = false;
    };
  }, [setIds]);

  const { series, delta7, delta24 } = useMemo(() => {
    const now = Date.now();
    const value = (pick: (p: LivePrice) => number | null) =>
      items.reduce((sum, i) => {
        const p = prices[i.cardId];
        const v = p ? (pick(p) ?? p.trend) : null;
        return sum + (v ?? 0) * factor(i) * i.qty;
      }, 0);
    const today = value((p) => p.trend);

    const lookback = [
      { t: now - 15 * DAY, v: value((p) => p.avg30) },
      { t: now - 3.5 * DAY, v: value((p) => p.avg7) },
      { t: now, v: today },
    ];

    // Exact daily values from the scan history (Cardmarket trend per card and day).
    const byDate = new Map<string, number>();
    const dates = new Set<string>();
    for (const i of items)
      for (const [d] of histories[i.setId]?.[i.cardId] ?? []) dates.add(d);
    for (const d of dates) {
      let sum = 0;
      for (const i of items) {
        const row = histories[i.setId]?.[i.cardId]?.find(([day]) => day === d);
        const v = row?.[1] ?? prices[i.cardId]?.trend ?? null;
        sum += (v ?? 0) * factor(i) * i.qty;
      }
      byDate.set(d, sum);
    }
    for (const [d, v] of snapshots) byDate.set(d, v); // what this device actually recorded
    byDate.set(new Date(now).toISOString().slice(0, 10), today);
    const daily = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ t: Date.parse(d), v }));

    const from = range === "all" ? 0 : now - Number(range) * DAY;
    const inRange = (pts: { t: number; v: number }[]) =>
      pts.filter((p) => p.t >= from);

    // Intraday: the live values recorded on this device, starting from the last known value
    // before the window so the line always spans it.
    const live = ticks
      .map(([t, v]) => ({ t, v }))
      .filter((p) => p.t < now - 60_000);
    const before = [...daily, ...live]
      .filter((p) => p.t < from)
      .sort((a, b) => a.t - b.t)
      .pop();
    const intraday = [
      ...(before ? [{ t: from, v: before.v }] : []),
      ...inRange(live),
      { t: now, v: today },
    ];
    const base24 = [...daily, ...live]
      .filter((p) => p.t <= now - DAY)
      .sort((a, b) => a.t - b.t)
      .pop();

    const out: Series[] =
      range === "1" || range === "7"
        ? [
            {
              label: "Live-Werte",
              color: "#8b7cff",
              points: intraday,
              stepped: true,
            },
            ...(range === "7"
              ? [
                  {
                    label: "Rückblick (Cardmarket-Ø)",
                    color: "#2ed8f0",
                    dashed: true,
                    points: inRange(lookback),
                  },
                ]
              : []),
          ]
        : [
            { label: "Tageswerte", color: "#8b7cff", points: inRange(daily) },
            {
              label: "Rückblick (Cardmarket-Ø)",
              color: "#2ed8f0",
              dashed: true,
              points: inRange(lookback),
            },
          ];
    return {
      series: out,
      delta7: today - lookback[1].v,
      delta24: base24 ? today - base24.v : null,
    };
  }, [items, prices, histories, snapshots, ticks, range, factor]);

  if (!items.length) return null;
  return (
    <section className="panel pf-chart">
      <div className="pf-chart-head">
        <h2>Wertentwicklung</h2>
        <Chips<Range>
          value={range}
          onChange={setRange}
          options={[
            ["1", "1T"],
            ["7", "7T"],
            ["30", "30T"],
            ["all", "Alle"],
          ]}
        />
      </div>
      <PriceChart
        height={190}
        series={series}
        intraday={range === "1" || range === "7"}
      />
      {range === "1" ? (
        <p className="hint">
          Letzte 24 Std.:{" "}
          {delta24 != null ? (
            <b className={delta24 >= 0 ? "up" : "down"}>{fmtSigned(delta24)}</b>
          ) : (
            "noch keine Werte von gestern"
          )}
          . Live-Werte werden alle paar Minuten aufgezeichnet, solange die App
          offen ist. Cardmarket aktualisiert seine Preise einmal täglich (ca. 3
          Uhr); Karten ohne Cardmarket-Preis folgen live dem japanischen Markt.
        </p>
      ) : (
        <p className="hint">
          Heute vs. 7-Tage-Durchschnitt:{" "}
          <b className={delta7 >= 0 ? "up" : "down"}>{fmtSigned(delta7)}</b>.
          Rückblick aus Cardmarkets 30- und 7-Tage-Durchschnitten; Tageswerte
          kommen mit jedem täglichen Scan dazu.
        </p>
      )}
    </section>
  );
}
