import { useState } from 'react';
import { login } from './lib/auth';
import { useSession } from './store';
import { PhaserGame } from './game/PhaserGame';
import { Hud } from './ui/Hud';

/**
 * Connect Phantom + wallet-signature login, then mount the live casino world
 * (Phaser canvas) with the React HUD (balance, chat, game modals) on top.
 */
export function App() {
  const { tokens, setSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const t = await login(address, (msg) =>
        provider.signMessage(msg, 'utf8').then((r: any) => r.signature),
      );
      setSession(t, address);
    } catch (e: any) {
      setError(e?.message ?? 'login failed');
    } finally {
      setBusy(false);
    }
  }

  if (tokens) {
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
  justifyContent: 'center', gap: 18, background: 'radial-gradient(circle at 50% 30%, #1a1a2e, #0b0b12)',
};
const cta: React.CSSProperties = {
  background: '#e0c84b', color: '#111', border: 0, padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
};
