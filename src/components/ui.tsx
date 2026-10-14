import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cardImg } from '../format';

export function Header({ title, sub, right, back }: { title: string; sub?: ReactNode; right?: ReactNode; back?: boolean }) {
  return (
    <header className="header">
      {back && (
        <button className="icon-btn" onClick={() => history.back()} aria-label="Zurück">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      )}
      <div className="header-text">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </header>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'chip on' : 'chip'} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Card thumbnail with a fallback chain: TCGdex artwork → shop photo → /api/img (server picks
 * the best remaining source). Advances on load errors and restarts when the sources change.
 */
export function Thumb({ id, image, fallback, alt, size = 'low' }: { id: string; image: string | null; fallback?: string | null; alt: string; size?: 'low' | 'high' }) {
  const sources = [...new Set([cardImg(image, size), fallback, `/api/img?id=${encodeURIComponent(id)}${size === 'high' ? '&size=high' : ''}`])].filter(Boolean) as string[];
  const key = sources.join('|');
  const [state, setState] = useState({ key, i: 0 });
  const i = state.key === key ? state.i : 0;
  if (i >= sources.length) return <div className="thumb ph" aria-label={alt}>?</div>;
  return <img className="thumb" src={sources[i]} alt={alt} loading="lazy" decoding="async" onError={() => setState({ key, i: i + 1 })} />;
}

export function Spinner({ label = 'Lädt…' }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error-box">⚠︎ {message}</div>;
}

export function CardLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <Link to={`/card/${encodeURIComponent(id)}`} className={className}>
      {children}
    </Link>
  );
}
