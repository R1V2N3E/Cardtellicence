import { useId } from 'react';

/** The brand mark: two cards (Japan → Germany) with a rising line and a spark. */
export function Mark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="mark" width={size} height={size} viewBox="8 2 52 56" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B794FF" />
          <stop offset=".5" stopColor="#7C6CFF" />
          <stop offset="1" stopColor="#2ED8F0" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3BE3F5" />
          <stop offset="1" stopColor="#1B8FD0" />
        </linearGradient>
      </defs>
      <rect x="25" y="9" width="27" height="38" rx="6" transform="rotate(14 38.5 28)" fill={`url(#${id}b)`} opacity=".9" />
      <g transform="rotate(-8 26 34)">
        <rect x="12" y="14" width="28" height="40" rx="6.5" fill={`url(#${id}a)`} />
        <path d="M17.5 44 L23 37.5 L27.5 40.5 L34.5 29.5 M29.3 30.4 L35 28.5 L35.7 34.4" fill="none" stroke="#0B0A1F" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path className="mark-spark" d="M50 4.5 C50.9 10 52 11.1 57.5 12 C52 12.9 50.9 14 50 19.5 C49.1 14 48 12.9 42.5 12 C48 11.1 49.1 10 50 4.5Z" />
    </svg>
  );
}

export function Logo({ icon = true }: { icon?: boolean }) {
  return (
    <span className="logo">
      {icon && <Mark />}
      <span>
        <span className="logo-a">Card</span>
        <span className="logo-b">telligence</span>
      </span>
    </span>
  );
}
