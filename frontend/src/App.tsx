import { useState } from 'react';
import { login } from './lib/auth';
import { useSession } from './store';

// Minimal Phase-1 shell: connect Phantom + wallet-signature login.
// Phase 2 mounts the Phaser world canvas here once authenticated.
export function App() {
  const { tokens, walletAddress, setSession, clear } = useSession();
  const [error, setError] = useState<string | null>(null);

  async function connectAndLogin() {
    setError(null);
    const provider = (window as any).solana;
    if (!provider?.isPhantom) {
      setError('Phantom wallet not found');
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
    }
  }

  return (
    <div style={{ padding: 32 }}>
      <h1>🎰 Casino MMORPG</h1>
      {tokens ? (
        <>
          <p>Signed in as {walletAddress}</p>
          <button onClick={clear}>Disconnect</button>
          {/* Phase 2: <GameCanvas token={tokens.accessToken} /> */}
        </>
      ) : (
        <button onClick={connectAndLogin}>Connect Phantom</button>
      )}
      {error && <p style={{ color: '#f55' }}>{error}</p>}
    </div>
  );
}
