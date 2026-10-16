import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IdentifyProgress, IdentifyResult } from '../../lib/identify';
import { ScanAnimation } from '../components/ScanAnimation';
import type { CardSummary } from '../../lib/types';
import { api, ApiError, type LivePrice } from '../api';
import { AddSheet } from '../components/AddSheet';
import { Logo } from '../components/Logo';
import { Spinner, Thumb } from '../components/ui';
import { cardImg, fmtEur } from '../format';

const CARD_RATIO = 88 / 63; // height / width of a trading card
const MAX_EDGE = 1280; // enough for the small print (set code, number) once cropped to the card; smaller uploads faster

type Phase =
  | { kind: 'camera' }
  | { kind: 'working'; photo: string; events: IdentifyProgress[]; finished: boolean; resultImage?: string | null }
  | { kind: 'result'; photo: string; result: IdentifyResult }
  | { kind: 'manual'; photo: string | null; reason: string }
  | { kind: 'error'; photo: string | null; message: string };

/** Downscale a drawable to at most MAX_EDGE px and return a JPEG data URL. */
function toJpeg(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxEdge = MAX_EDGE): string {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function Scan() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [added, setAdded] = useState(0);

  const cameraInput = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start the rear camera. iOS home-screen apps sometimes refuse the first request (app not yet
  // in the foreground, camera busy) even when access was granted, so this can be retried by tap,
  // and a simpler request is tried when the detailed one fails.
  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) return setCameraError('Live-Kamera nicht verfügbar – der Auslöser öffnet die iPhone-Kamera.');
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ];
    let last: Error | null = null;
    for (const c of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(c);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        setStream(s);
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        return;
      } catch (e) {
        last = e as Error;
        if (last.name === 'NotAllowedError') break; // a refusal won't change with other settings
      }
    }
    setCameraError(
      last?.name === 'NotAllowedError'
        ? 'Live-Kamera wurde nicht freigegeben. Tippe auf „Erneut versuchen“ – oder einfach auf den Auslöser, der öffnet die iPhone-Kamera.'
        : 'Live-Kamera nicht verfügbar – der Auslöser öffnet die iPhone-Kamera.',
    );
  };

  useEffect(() => {
    void startCamera();
    // Coming back to the app: the system stops the camera, so start it again.
    const onVisible = () => document.visibilityState === 'visible' && !streamRef.current?.active && void startCamera();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      video.current.play().catch(() => {});
    }
  }, [stream, phase.kind]);

  const toggleTorch = async () => {
    const track = stream?.getVideoTracks()[0];
    if (!track || torch === null) return;
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch(!torch);
  };

  const identify = async (photo: string) => {
    setPhase({ kind: 'working', photo, events: [], finished: false });
    try {
      const result = await api.identify(photo, (e) => setPhase((p) => (p.kind === 'working' ? { ...p, events: [...p.events, e] } : p)));
      // Finish: the photo morphs into the recognised card. Load its picture first (briefly).
      const m = result.matches[0];
      const resultImage = m ? (cardImg(m.image, 'high') ?? m.externalImage ?? `/api/img?id=${encodeURIComponent(m.id)}&size=high`) : null;
      if (resultImage)
        await new Promise<void>((done) => {
          const img = new Image();
          img.onload = img.onerror = () => done();
          img.src = resultImage;
          setTimeout(done, 1500);
        });
      setPhase((p) => (p.kind === 'working' ? { ...p, finished: true, resultImage } : p));
      await new Promise((r) => setTimeout(r, resultImage ? 2400 : 800));
      if (!result.matches.length) {
        const read = [result.reading.set_code, result.reading.number, result.reading.name].filter(Boolean).join(' · ');
        return setPhase({ kind: 'manual', photo, reason: `${read ? `Gelesen: ${read}. ` : ''}${result.note ?? 'Keine passende Karte gefunden.'}` });
      }
      setPhase({ kind: 'result', photo, result });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_configured')
        return setPhase({ kind: 'manual', photo, reason: 'Automatische Erkennung ist noch nicht eingerichtet (ANTHROPIC_API_KEY in Vercel fehlt).' });
      if (e instanceof ApiError && e.code === 'access_code')
        return setPhase({ kind: 'error', photo, message: 'Zugangscode fehlt oder ist falsch. Bitte in den Einstellungen eintragen.' });
      setPhase({ kind: 'error', photo, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const capture = () => {
    const v = video.current;
    const f = frame.current;
    if (!v || !f || !v.videoWidth) return;
    // Map the on-screen frame (video uses object-fit: cover) to video pixels, with a little margin.
    const box = v.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
    const ox = (box.width - v.videoWidth * scale) / 2;
    const oy = (box.height - v.videoHeight * scale) / 2;
    const m = 0.06;
    const sx = Math.max(0, (fr.left - box.left - ox) / scale - (fr.width / scale) * m);
    const sy = Math.max(0, (fr.top - box.top - oy) / scale - (fr.height / scale) * m);
    const sw = Math.min(v.videoWidth - sx, (fr.width / scale) * (1 + 2 * m));
    const sh = Math.min(v.videoHeight - sy, (fr.height / scale) * (1 + 2 * m));
    identify(toJpeg(v, sx, sy, sw, sh));
  };

  const fromLibrary = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Library and system-camera photos are not cropped to the card: keep more pixels.
      identify(toJpeg(img, 0, 0, img.naturalWidth, img.naturalHeight, 1800));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="scan">
      <header className="scan-top">
        <button className="icon-btn ghost" onClick={() => navigate(-1)} aria-label="Zurück">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <Logo />
        <button className="icon-btn ghost" onClick={() => navigate('/search')} aria-label="Suchen">
          <svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" /></svg>
        </button>
      </header>

      <div className="scan-stage">
        {stream && <video ref={video} className="scan-video" playsInline muted autoPlay />}
        {cameraError && (
          <div className="scan-camera-error">
            {cameraError}
            <button className="link-btn" onClick={() => void startCamera()}>
              Erneut versuchen
            </button>
          </div>
        )}
        <div ref={frame} className="scan-frame" style={{ aspectRatio: `${1 / CARD_RATIO}` }}>
          {torch !== null && (
            <button className={`scan-torch ${torch ? 'on' : ''}`} onClick={toggleTorch} aria-label="Licht">
              <svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" /></svg>
            </button>
          )}
        </div>
        <div className="scan-hint">
          {added > 0 ? <span className="pro">+{added}</span> : <span className="pro">Tipp</span>}
          {added > 0 ? ` ${added === 1 ? 'Karte' : 'Karten'} hinzugefügt. Weiter scannen!` : ' Karte gerade im Rahmen, ohne Spiegelung – Nummer unten links muss lesbar sein.'}
        </div>
      </div>

      <div className="scan-controls">
        <p>{stream?.active ? 'Scanne die Vorderseite der Karte, um zu beginnen.' : 'Tippe auf den Auslöser, um die Karte zu fotografieren.'}</p>
        <div className="scan-buttons">
          <button className="round-btn" onClick={() => fileInput.current?.click()} aria-label="Foto aus Mediathek">
            <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4" /><circle cx="15.5" cy="8.5" r="1.5" /></svg>
          </button>
          <button className="shutter" onClick={() => (stream?.active ? capture() : cameraInput.current?.click())} aria-label="Foto aufnehmen" />
          <button className="round-btn" onClick={() => navigate('/portfolio')} aria-label="Sammlung">
            <svg viewBox="0 0 24 24"><path d="M7 4h11a1 1 0 0 1 1 1v13M4 7h11a1 1 0 0 1 1 1v12H5a1 1 0 0 1-1-1z" /></svg>
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => (fromLibrary(e.target.files?.[0]), (e.target.value = ''))} />
        {/* The iPhone's own camera: works even when the live preview isn't allowed. */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (fromLibrary(e.target.files?.[0]), (e.target.value = ''))} />
      </div>

      {phase.kind === 'working' && <ScanAnimation photo={phase.photo} events={phase.events} finished={phase.finished} resultImage={phase.resultImage} />}
      {phase.kind === 'result' && (
        <ResultSheet
          photo={phase.photo}
          result={phase.result}
          onClose={() => setPhase({ kind: 'camera' })}
          onAdded={() => setAdded((n) => n + 1)}
        />
      )}
      {(phase.kind === 'manual' || phase.kind === 'error') && (
        <ManualSheet
          photo={phase.photo}
          reason={phase.kind === 'manual' ? phase.reason : phase.message}
          onClose={() => setPhase({ kind: 'camera' })}
          onAdded={() => setAdded((n) => n + 1)}
        />
      )}
    </div>
  );
}

function usePrice(id: string | undefined) {
  const [price, setPrice] = useState<LivePrice | null>(null);
  useEffect(() => {
    setPrice(null);
    if (id) api.prices([id]).then((r) => setPrice(r.prices[id] ?? null)).catch(() => {});
  }, [id]);
  return price;
}

const CONFIDENCE = {
  high: { cls: 'ok', text: '✓ Sicher erkannt' },
  medium: { cls: 'warn', text: '⚠ Bitte prüfen' },
  low: { cls: 'bad', text: 'Nicht sicher – bitte richtige Karte wählen' },
} as const;

function ResultSheet({ photo, result, onClose, onAdded }: { photo: string; result: IdentifyResult; onClose: () => void; onAdded: () => void }) {
  const navigate = useNavigate();
  // Only a certain match is preselected; otherwise the user has to tap the right card.
  const [pick, setPick] = useState<number | null>(result.confidence === 'low' ? null : 0);
  const [adding, setAdding] = useState(false);
  const card = pick != null ? result.matches[pick] : null;
  const price = usePrice(card?.id);
  const r = result.reading;
  const conf = CONFIDENCE[result.confidence];
  const c = result.checks;
  const check = (label: string, v: boolean | null | undefined) =>
    v == null ? null : <span className={v ? 'check ok' : 'check bad'}>{v ? '✓' : '✗'} {label}</span>;

  if (adding && card) return <AddSheet card={card} priceEur={price?.trend} photo={photo} onClose={onClose} onAdded={onAdded} />;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className={`confidence ${conf.cls}`}>{conf.text}</div>
        <div className="match-head">
          <img className="match-photo" src={photo} alt="Dein Foto" />
          <div className="match-arrow">→</div>
          {card ? (
            <Thumb id={card.id} image={card.image} fallback={card.externalImage} alt={card.nameJa} size="high" />
          ) : (
            <div className="thumb ph match-ph">?</div>
          )}
        </div>
        {card && (
          <div className="match-info">
            <div className="deal-name big">{card.nameEn ?? card.nameJa}</div>
            <div className="deal-meta">
              {card.nameEn && `${card.nameJa} · `}
              {card.setId} {card.number} {card.rarity && `· ${card.rarity}`}
            </div>
            {card.setName && <div className="deal-meta">{card.setName}</div>}
            <div className="sheet-price">
              {price === null ? '–' : price ? fmtEur(price.trend) : '…'}{' '}
              <small>{price?.source === 'japan' ? 'Japan-Marktpreis (umgerechnet)' : 'Cardmarket Trend'}</small>
            </div>
          </div>
        )}
        <div className="read-box">
          <div>
            <b>Auf der Karte gelesen:</b> {[r.set_code, r.number, r.rarity, r.name, r.hp != null ? `${r.hp} KP` : null].filter(Boolean).join(' · ') || '–'}
          </div>
          {pick === 0 && c && (
            <div className="checks">
              {check('Name', c.name)}
              {check('Nummer', c.number)}
              {check('Set', c.set)}
              {check('KP', c.hp)}
              {check('Bildvergleich', c.visual)}
            </div>
          )}
          {result.note && <div className="note">{result.note}</div>}
        </div>
        {(result.matches.length > 1 || pick == null) && (
          <>
            <div className="hint">{pick == null ? 'Tippe auf die richtige Karte:' : 'Andere Versionen dieser Karte'}</div>
            <div className="match-alts">
              {result.matches.slice(0, 12).map((m, i) => (
                <button key={m.id} className={i === pick ? 'alt on' : 'alt'} onClick={() => setPick(i)}>
                  <Thumb id={m.id} image={m.image} fallback={m.externalImage} alt={m.nameJa} zoom={false} />
                  <span>
                    {m.setId} {m.number.split('/')[0]}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <button className="primary-btn" disabled={!card} onClick={() => setAdding(true)}>
          {card ? 'Zur Sammlung hinzufügen' : 'Erst Karte auswählen'}
        </button>
        <div className="sheet-actions">
          {card && (
            <button className="link-btn" onClick={() => navigate(`/card/${encodeURIComponent(card.id)}`)}>
              Details & Preise
            </button>
          )}
          <button className="link-btn" onClick={onClose}>
            Neu scannen
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fallback when recognition is unavailable or found nothing: search by number or name. */
function ManualSheet({ photo, reason, onClose, onAdded }: { photo: string | null; reason: string; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CardSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<CardSummary | null>(null);
  const price = usePrice(chosen?.id);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setResults(await api.search(q).catch(() => []));
    setLoading(false);
  };

  if (chosen) return <AddSheet card={chosen} priceEur={price?.trend} photo={photo} onClose={onClose} onAdded={onAdded} />;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="manual-head">
          {photo && <img className="match-photo" src={photo} alt="Dein Foto" />}
          <p className="hint">{reason} Gib die Nummer unten links auf der Karte ein (z. B. 116/80 oder M2 116) oder den Namen.</p>
        </div>
        <div className="cost-input">
          <input className="input" autoFocus placeholder="116/80, SV2a 201, Glurak…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
          <button className="chip on" onClick={run}>
            Suchen
          </button>
        </div>
        {loading && <Spinner label="Suche…" />}
        {results && !results.length && <p className="hint">Keine Karte gefunden.</p>}
        <div className="match-alts wrap">
          {results?.slice(0, 24).map((c) => (
            <button key={c.id} className="alt" onClick={() => setChosen(c)}>
              <Thumb id={c.id} image={c.image} fallback={c.externalImage} alt={c.nameJa} zoom={false} />
              <span>
                {c.setId} {c.number}
              </span>
            </button>
          ))}
        </div>
        <button className="link-btn" onClick={onClose}>
          Neu scannen
        </button>
      </div>
    </div>
  );
}
