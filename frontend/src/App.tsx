import { useEffect, useState } from 'react';
import { login } from './lib/auth';
import { useSession } from './store';
import { api, setTokens, type Profile } from './lib/api';
import { PhaserGame } from './game/PhaserGame';
import { Hud } from './ui/Hud';
import { ProfileSetup } from './ui/ProfileSetup';

/**
 * Flow: connect Phantom + wallet-signature login → first-time profile setup
 * (username + sex) → live casino world (Phaser) with the React HUD on top.
 */
export function App() {
  const { tokens, setSession, setTokensOnly } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined = loading, null = not loaded yet / failed
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    if (!tokens) {
      setProfile(undefined);
      return;
    }
    setTokens(tokens, (t) => setTokensOnly(t));
    api.me().then(setProfile).catch(() => setProfile(null));
  }, [tokens, setTokensOnly]);

  async function connectAndLogin() {
    setError(null);
    setBusy(true);
    const provider = (window as any).solana;
    if (!provider?.isPhantom) {
      setError('Phantom wallet not found — install it to play.');
      setBusy(false);
      return;
    }
    try {
      const resp = await provider.connect();
      const address = resp.publicKey.toString();
      const t = await login(address, (msg) => provider.signMessage(msg, 'utf8').then((r: any) => r.signature));
      setSession(t, address);
    } catch (e: any) {
      setError(e?.message ?? 'login failed');
    } finally {
      setBusy(false);
    }
  }

  if (tokens) {
    if (profile === undefined) return <div style={landing}><h2>Loading…</h2></div>;
    if (!profile || !profile.profileComplete) return <ProfileSetup onDone={setProfile} />;
    return (
      <>
        <PhaserGame />
        <Hud />
      </>
    );
  }

  return (
    <div style={landing}>
      <h1 style={{ fontSize: 48, margin: 0 }}>🎰 Casino MMORPG</h1>
      <p style={{ color: '#99a', maxWidth: 420, textAlign: 'center' }}>
        A persistent multiplayer casino on Solana. Connect your wallet, walk the floor,
        and play provably-fair roulette, blackjack, and slots with our token.
      </p>
      <button style={cta} disabled={busy} onClick={connectAndLogin}>
        {busy ? 'Connecting…' : 'Connect Phantom'}
      </button>
      {error && <p style={{ color: '#f55' }}>{error}</p>}
    </div>
  );
}

const landing: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 18, background: 'radial-gradient(circle at 50% 30%, #1a1a2e, #0b0b12)', color: '#eee',
};
const cta: React.CSSProperties = {
  background: '#e0c84b', color: '#111', border: 0, padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
};
