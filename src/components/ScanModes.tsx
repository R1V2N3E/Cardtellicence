import { useNavigate } from 'react-router-dom';

const MODES = [
  ['card', 'Karte', '/scan'],
  ['bulk', 'Mehrere', '/scan?mode=bulk'],
  ['shop', 'Vitrine', '/scan?mode=shop'],
  ['condition', 'Zustand', '/scan?mode=condition'],
] as const;

/** Switch between the camera tools: recognise a card, rate a shop showcase, grade a card. */
export function ScanModes({ mode }: { mode: 'card' | 'bulk' | 'shop' | 'condition' }) {
  const navigate = useNavigate();
  return (
    <div className="scan-modes" role="tablist">
      {MODES.map(([k, label, to]) => (
        <button key={k} role="tab" aria-selected={k === mode} className={k === mode ? 'on' : ''} onClick={() => k !== mode && navigate(to, { replace: true })}>
          {label}
        </button>
      ))}
    </div>
  );
}
