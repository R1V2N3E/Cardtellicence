import { useEffect, useState } from 'react';
import type { Opportunity, OpportunityFile } from '../../lib/types';
import { loadOpportunities } from '../api';
import { CardLink, Header, Thumb } from '../components/ui';
import { ago, fmtEur, fmtJpy, fmtSigned, marginClass } from '../format';
import { opportunityMargin } from '../margin';
import { useSettings, useWatchlist } from '../state';

export function Watchlist() {
  const { list } = useWatchlist();
  const [settings] = useSettings();
  const [scan, setScan] = useState<{ file: OpportunityFile; byId: Map<string, Opportunity> } | null>(null);

  useEffect(() => {
    loadOpportunities()
      .then((file) => setScan({ file, byId: new Map(file.items.map((o) => [o.id, o])) }))
      .catch(() => {});
  }, []);

  return (
    <>
      <Header title="Watchlist" sub={`${list.length} cards · stored on this iPhone`} />
      {!list.length && <p className="empty">Tap ☆ on any card to track it here.</p>}
      <ul className="list">
        {list.map((w) => {
          // Prefer today's scan; fall back to the snapshot from the last time the card was opened.
          const o = scan?.byId.get(w.id);
          const m = o && scan ? opportunityMargin(o, settings, scan.file.fx.jpyToEur) : null;
          const buyJpy = m?.buy?.jpy ?? w.last?.buyJpy ?? null;
          const sell = m?.sellEur ?? w.last?.sellEur ?? null;
          const margin = m?.marginEur ?? w.last?.marginEur ?? null;
          const when = o ? `scan ${ago(scan!.file.generatedAt)}` : w.last ? `viewed ${ago(w.last.at)}` : 'open to load prices';
          return (
            <li key={w.id}>
              <CardLink id={w.id} className="deal">
                <Thumb id={w.id} image={w.image} fallback={w.fallbackImage} alt={w.nameJa} />
                <div className="deal-main">
                  <div className="deal-name">{w.nameEn ?? w.nameJa}</div>
                  <div className="deal-meta">
                    {w.setId} {w.number} · {when}
                  </div>
                  <div className="deal-prices">
                    <span className="jp">🇯🇵 {fmtJpy(buyJpy)}</span>
                    <span className="de">🇩🇪 {fmtEur(sell)}</span>
                  </div>
                </div>
                <div className={`deal-margin ${marginClass(margin)}`}>
                  <strong>{fmtSigned(margin)}</strong>
                </div>
              </CardLink>
            </li>
          );
        })}
      </ul>
    </>
  );
}
