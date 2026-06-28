import { create } from 'zustand';
import type { Tokens } from './lib/auth';

interface SessionState {
  tokens: Tokens | null;
  walletAddress: string | null;
  setSession: (tokens: Tokens, walletAddress: string) => void;
  setTokensOnly: (tokens: Tokens) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  tokens: null,
  walletAddress: null,
  setSession: (tokens, walletAddress) => set({ tokens, walletAddress }),
  setTokensOnly: (tokens) => set({ tokens }),
  clear: () => set({ tokens: null, walletAddress: null }),
}));

// ── Game UI state ────────────────────────────────────────────────────────────

export interface ChatLine {
  id: string;
  userId: string;
  username: string;
  body: string;
  createdAt: string;
}

export interface Interactable {
  id: string;
  type: 'ROULETTE' | 'BLACKJACK' | 'SLOTS';
  label: string;
  x: number;
  y: number;
}

export type ActiveModal =
  | null
  | { kind: 'SLOTS'; machine: Interactable }
  | { kind: 'ROULETTE'; table: Interactable }
  | { kind: 'BLACKJACK'; table: Interactable }
  | { kind: 'WALLET' };

interface GameState {
  balance: string;
  decimals: number;
  depositAddress: string;
  setBalance: (b: string) => void;
  setWallet: (info: { balance: string; decimals: number; depositAddress: string }) => void;

  chat: ChatLine[];
  pushChat: (line: ChatLine) => void;
  setChat: (lines: ChatLine[]) => void;

  // The interactable the player is currently standing next to (for the prompt).
  nearby: Interactable | null;
  setNearby: (i: Interactable | null) => void;

  modal: ActiveModal;
  openModal: (m: ActiveModal) => void;
  closeModal: () => void;

  toast: string | null;
  setToast: (t: string | null) => void;
}

export const useGame = create<GameState>((set) => ({
  balance: '0',
  decimals: 0,
  depositAddress: '',
  setBalance: (balance) => set({ balance }),
  setWallet: ({ balance, decimals, depositAddress }) => set({ balance, decimals, depositAddress }),

  chat: [],
  pushChat: (line) => set((s) => ({ chat: [...s.chat.slice(-99), line] })),
  setChat: (chat) => set({ chat }),

  nearby: null,
  setNearby: (nearby) => set({ nearby }),

  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  toast: null,
  setToast: (toast) => set({ toast }),
}));
