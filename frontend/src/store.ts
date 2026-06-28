import { create } from 'zustand';
import type { Tokens } from './lib/auth';

interface SessionState {
  tokens: Tokens | null;
  walletAddress: string | null;
  setSession: (tokens: Tokens, walletAddress: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  tokens: null,
  walletAddress: null,
  setSession: (tokens, walletAddress) => set({ tokens, walletAddress }),
  clear: () => set({ tokens: null, walletAddress: null }),
}));
