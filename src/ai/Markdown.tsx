// Small Markdown renderer for assistant replies: paragraphs, headings, lists, tables, bold,
// italics, code and links. Builds React elements (no raw HTML), so model output can't inject markup.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const CARD_LINK = /^\/card\/[A-Za-z0-9.-]+$/;

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] ?? m[3]) out.push(<strong key={k}>{inline(m[2] ?? m[3], k)}</strong>);
    else if (m[4]) out.push(<em key={k}>{inline(m[4], k)}</em>);
    else if (m[5]) out.push(<code key={k}>{m[5]}</code>);
    else if (m[6] && m[7]) {
      const href = m[7];
      if (CARD_LINK.test(href)) out.push(<Link key={k} to={href}>{m[6]}</Link>);
      else if (/^https?:\/\//.test(href))
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[6]}
          </a>,
        );
      else out.push(m[6]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(h[1].length <= 2 ? <h3 key={key}>{inline(h[2], key)}</h3> : <h4 key={key}>{inline(h[2], key)}</h4>);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="md-table" key={key}>
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && bullet.test(lines[i])) {
        let item = lines[i].replace(bullet, '');
        i++;
        // continuation lines (indented, not a new item)
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !bullet.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(<li key={items.length}>{inline(item, `${key}l${items.length}`)}</li>);
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !bullet.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key}>
        {para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, `${key}p${j}`)] : inline(p, `${key}p${j}`)))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
