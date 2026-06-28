import { useEffect, useRef, useState } from 'react';
import './casino.css';
import { api, type Profile } from '../lib/api';
import { SKIN, HAIR, SUIT, SWATCH, recolorSheet, FRAME, type Look } from '../lib/looks';

const CHAR_W = FRAME.w, CHAR_H = FRAME.h;
const swatchCss = (rgb: [number, number, number]) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

/** First-login profile setup: username, sex, and cosmetic recolor presets. */
export function ProfileSetup({ onDone }: { onDone: (p: Profile) => void }) {
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [look, setLook] = useState<Look>({ skin: 'default', hair: 'default', suit: 'default' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<Record<string, HTMLImageElement>>({});

  // Live preview: recolor the front-idle frame whenever look/gender changes.
  useEffect(() => {
    const sheet = gender === 'MALE' ? 'male' : 'female';
    const draw = (img: HTMLImageElement) => {
      const recol = recolorSheet(img as any, look);
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      // front idle = col 1, row 0
      ctx.drawImage(recol, CHAR_W, 0, CHAR_W, CHAR_H, 0, 0, c.width, c.height);
    };
    const cached = sheetRef.current[sheet];
    if (cached) return draw(cached);
    const img = new Image();
    img.onload = () => { sheetRef.current[sheet] = img; draw(img); };
    img.src = `/assets/characters/${sheet}.png`;
  }, [gender, look]);

  async function submit() {
    setErr(null);
    if (username.trim().length < 3) return setErr('Username must be at least 3 characters');
    setBusy(true);
    try {
      const p = await api.setProfile(username.trim(), gender, {
        skinTone: look.skin,
        hairColor: look.hair,
        suitColor: look.suit,
      });
      onDone(p);
    } catch (e: any) {
      setErr(e.message ?? 'could not save profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cz-overlay" style={{ background: 'radial-gradient(circle at 50% 30%, #1a1a2e, #0b0b12)' }}>
      <div className="cz-frame" style={{ width: 540 }}>
        <div className="cz-title">Create Character</div>

        <div style={{ display: 'flex', gap: 18 }}>
          <div className="cz-felt" style={{ padding: 12, display: 'grid', placeItems: 'center' }}>
            <canvas ref={canvasRef} width={150} height={119} style={{ imageRendering: 'pixelated' }} />
            <div className="cz-row" style={{ marginTop: 8, gap: 6 }}>
              {(['MALE', 'FEMALE'] as const).map((g) => (
                <button key={g} className={g === gender ? 'cz-btn' : 'cz-btn cz-btn--dark'} style={{ padding: '6px 12px' }} onClick={() => setGender(g)}>
                  {g === 'MALE' ? 'M' : 'F'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <Field label="USERNAME">
              <input className="cz-input" maxLength={20} placeholder="HighRoller" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Swatches label="SKIN" region="skin" keys={Object.keys(SKIN)} value={look.skin} onPick={(k) => setLook((l) => ({ ...l, skin: k }))} />
            <Swatches label="HAIR" region="hair" keys={Object.keys(HAIR)} value={look.hair} onPick={(k) => setLook((l) => ({ ...l, hair: k }))} />
            <Swatches label="OUTFIT" region="suit" keys={Object.keys(SUIT)} value={look.suit} onPick={(k) => setLook((l) => ({ ...l, suit: k }))} />
          </div>
        </div>

        <button className="cz-btn cz-btn--wide" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
          {busy ? '…' : 'Enter Casino'}
        </button>
        {err && <div className="cz-err">{err}</div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: '#e9cf8e', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Swatches({ label, region, keys, value, onPick }: { label: string; region: string; keys: string[]; value: string; onPick: (k: string) => void }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {keys.map((k) => {
          const rgb = SWATCH[`${region}:${k}`] ?? [120, 120, 120];
          return (
            <button
              key={k}
              title={k}
              onClick={() => onPick(k)}
              style={{
                width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                background: swatchCss(rgb), border: 0,
                boxShadow: value === k ? '0 0 0 3px var(--gold-1)' : '0 0 0 2px #0006',
              }}
            />
          );
        })}
      </div>
    </Field>
  );
}
