import { usePullToRefresh } from '../gestures';
import { refreshLive, useLive } from '../live';
import { RefreshIcon } from './RefreshIcon';

/** Pull down to re-read the live prices (shared with all pages). */
export function LivePull({ enabled = true }: { enabled?: boolean }) {
  const { pull, ready } = usePullToRefresh(() => void refreshLive(), enabled);
  return (
    <div className="pull" style={{ height: pull }} aria-hidden={!pull}>
      {pull > 10 && (
        <span className={ready ? 'ready' : ''}>
          <svg viewBox="0 0 24 24" style={{ transform: `rotate(${pull * 3}deg)` }}>
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
          </svg>
          {ready ? 'Loslassen für Live-Preise' : 'Ziehen für Live-Preise'}
        </span>
      )}
    </div>
  );
}

export function LiveRefreshButton() {
  const live = useLive();
  return (
    <button className="icon-btn refresh-btn" aria-busy={live.busy} onClick={() => !live.busy && void refreshLive()} aria-label="Live-Preise laden">
      <RefreshIcon active={live.busy} />
    </button>
  );
}

/** Thin progress bar while the live prices load. */
export function LiveProgress() {
  const live = useLive();
  if (!live.busy || !live.total) return null;
  return (
    <div className="live-progress" role="progressbar" aria-valuenow={live.done} aria-valuemax={live.total}>
      <i style={{ width: `${(live.done / live.total) * 100}%` }} />
    </div>
  );
}
