import { useState } from 'react';
import './casino.css';
import { api, type Profile } from '../lib/api';

// Static sprite preview: crop the front-idle frame (col 1, row 0) from the
// 3x4 character sheet.
function avatarPreview(sheet: 'male' | 'female'): React.CSSProperties {
  const W = 130, H = 98; // cell aspect ~427:320
  return {
    width: W,
    height: H,
    backgroundImage: `url(/assets/characters/${sheet}.png)`,
    backgroundSize: `${W * 3}px ${H * 4}px`,
    backgroundPosition: `-${W}px 0px`,
    imageRendering: 'pixelated',
    margin: '0 auto',
  };
}

/** First-login profile setup: pick a username + sex (sets the avatar sprite). */
export function ProfileSetup({ onDone }: { onDone: (p: Profile) => void }) {
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (username.trim().length < 3) return setErr('Username must be at least 3 characters');
    if (!gender) return setErr('Choose your character');
    setBusy(true);
    try {
      const p = await api.setProfile(username.trim(), gender);
      onDone(p);
    } catch (e: any) {
      setErr(e.message ?? 'could not save profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cz-overlay" style={{ background: 'radial-gradient(circle at 50% 30%, #1a1a2e, #0b0b12)' }}>
      <div className="cz-frame" style={{ width: 460 }}>
        <div className="cz-title">Welcome</div>
        <p style={{ textAlign: 'center', color: '#e9cf8e', marginTop: 0 }}>Create your character to enter the casino.</p>

        <div style={{ fontSize: 12, letterSpacing: 2, color: '#e9cf8e', margin: '6px 0 4px' }}>USERNAME</div>
        <input className="cz-input" maxLength={20} placeholder="e.g. HighRoller" value={username} onChange={(e) => setUsername(e.target.value)} />

        <div style={{ fontSize: 12, letterSpacing: 2, color: '#e9cf8e', margin: '16px 0 8px' }}>CHARACTER</div>
        <div className="cz-row" style={{ gap: 16 }}>
          {(['MALE', 'FEMALE'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className="cz-felt"
              style={{
                cursor: 'pointer', padding: 12, border: 0,
                outline: gender === g ? '3px solid var(--gold-1)' : 'none',
                flex: 1,
              }}
            >
              <div style={avatarPreview(g === 'MALE' ? 'male' : 'female')} />
              <div style={{ color: '#fff', fontWeight: 700, marginTop: 6 }}>{g === 'MALE' ? 'Gentleman' : 'Lady'}</div>
            </button>
          ))}
        </div>

        <button className="cz-btn cz-btn--wide" style={{ marginTop: 18 }} disabled={busy} onClick={submit}>
          {busy ? '…' : 'Enter Casino'}
        </button>
        {err && <div className="cz-err">{err}</div>}
      </div>
    </div>
  );
}
