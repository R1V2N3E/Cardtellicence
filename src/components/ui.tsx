import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { prefetchCard, type CardPreview } from '../cardCache';
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
 * Card picture with a fallback chain: TCGdex artwork → known shop photo → /api/img (server picks
 * the best remaining source). Shows a shimmer until loaded, fades in, and moves on to the next
 * source on error or when a source hangs.
 */
export function Thumb({
  id,
  image,
  fallback,
  alt,
  size = 'low',
  eager = false,
  className = 'thumb',
  timeout = 6000,
  placeholder,
}: {
  id: string;
  image: string | null;
  fallback?: string | null;
  alt: string;
  size?: 'low' | 'high';
  eager?: boolean;
  className?: string;
  /** How long a source may take before the next one is tried. */
  timeout?: number;
  /** Shown when no picture could be loaded (instead of a question mark). */
  placeholder?: ReactNode;
}) {
  const sources = [...new Set([cardImg(image, size), fallback, `/api/img?id=${encodeURIComponent(id)}${size === 'high' ? '&size=high' : ''}`])].filter(Boolean) as string[];
  const key = sources.join('|');
  const [state, setState] = useState({ key, i: 0, loaded: false });
  const cur = state.key === key ? state : { key, i: 0, loaded: false };
  const next = () => setState({ key, i: cur.i + 1, loaded: false });

  // A source that hasn't delivered after a few seconds is skipped (the last one is kept).
  useEffect(() => {
    if (cur.loaded || cur.i >= sources.length - 1) return;
    const t = setTimeout(next, timeout);
    return () => clearTimeout(t);
  }, [key, cur.i, cur.loaded]);

  if (cur.i >= sources.length)
    return (
      <div className={`${className} ph`} aria-label={alt}>
        {placeholder ?? '?'}
      </div>
    );
  return (
    <span className={`${className} img-wrap ${cur.loaded ? 'loaded' : 'loading'}`}>
      <img
        src={sources[cur.i]}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setState({ key, i: cur.i, loaded: true })}
        onError={next}
      />
    </span>
  );
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

/** Link to a card page: hands over what the list already knows and starts loading on touch. */
export function CardLink({ id, children, className, preview }: { id: string; children: ReactNode; className?: string; preview?: CardPreview }) {
  return (
    <Link
      to={`/card/${encodeURIComponent(id)}`}
      state={preview ? { preview } : undefined}
      className={className}
      onPointerDown={() => prefetchCard(id)}
    >
      {children}
    </Link>
  );
}
