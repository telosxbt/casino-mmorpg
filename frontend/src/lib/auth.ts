// Wallet-signature login flow against the backend.
// The wallet only proves ownership; the backend issues the JWT.
import bs58 from 'bs58';

const API = import.meta.env.VITE_API_URL as string;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  user: string;
}

type SignMessage = (msg: Uint8Array) => Promise<Uint8Array>;

export async function login(
  walletAddress: string,
  signMessage: SignMessage,
  username?: string,
): Promise<Tokens> {
  // 1. Ask backend for a nonce message.
  const nonceRes = await fetch(`${API}/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });
  if (!nonceRes.ok) throw new Error('failed to get nonce');
  const { message } = await nonceRes.json();

  // 2. Sign it with the wallet (Phantom).
  const sig = await signMessage(new TextEncoder().encode(message));

  // 3. Verify → receive JWT + refresh token.
  const verifyRes = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletAddress,
      signature: bs58.encode(sig),
      username,
    }),
  });
  if (!verifyRes.ok) throw new Error('signature verification failed');
  return verifyRes.json();
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error('refresh failed');
  return res.json();
}
