// Authenticated HTTP against the backend. Holds the access token, refreshes it
// transparently on 401, and surfaces typed helpers for the money + slots routes.
import type { Tokens } from './auth';
import { refresh } from './auth';

const API = import.meta.env.VITE_API_URL as string;

let tokens: Tokens | null = null;
let onTokens: ((t: Tokens) => void) | null = null;

export function setTokens(t: Tokens | null, cb?: (t: Tokens) => void) {
  tokens = t;
  if (cb) onTokens = cb;
}

export function accessToken(): string | null {
  return tokens?.accessToken ?? null;
}

async function authedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && retry && tokens?.refreshToken) {
    const fresh = await refresh(tokens.refreshToken);
    tokens = fresh;
    onTokens?.(fresh);
    return authedFetch(path, init, false);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
  return res.json();
}

export interface Balance {
  balance: string;
  depositAddress: string;
  mint: string;
  decimals: number;
}

export interface Profile {
  username: string;
  avatar: string;
  gender: 'MALE' | 'FEMALE' | null;
  profileComplete: boolean;
  skinTone: string;
  hairColor: string;
  suitColor: string;
}

export const api = {
  me: () => authedFetch('/auth/me').then((r) => json<Profile>(r)),
  setProfile: (
    username: string,
    gender: 'MALE' | 'FEMALE',
    look?: { skinTone: string; hairColor: string; suitColor: string },
  ) =>
    authedFetch('/auth/profile', { method: 'POST', body: JSON.stringify({ username, gender, ...look }) }).then((r) =>
      json<Profile>(r),
    ),
  balance: () => authedFetch('/wallet/balance').then((r) => json<Balance>(r)),
  deposit: (signature: string) =>
    authedFetch('/wallet/deposit', { method: 'POST', body: JSON.stringify({ signature }) }).then((r) =>
      json<{ credited: string; balance: string }>(r),
    ),
  withdraw: (amount: string) =>
    authedFetch('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount }) }).then((r) =>
      json<{ id: string; status: string }>(r),
    ),
  transactions: () => authedFetch('/wallet/transactions').then((r) => json<any[]>(r)),
  slotsSpin: (machineId: string, bet: string) =>
    authedFetch('/slots/spin', { method: 'POST', body: JSON.stringify({ machineId, bet }) }).then((r) =>
      json<{ result: string[]; multiplier: number; payout: string; balance: string; fairness: any }>(r),
    ),
};
