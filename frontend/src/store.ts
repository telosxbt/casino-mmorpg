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

export interface Zone {
  id: string;
  type: 'ROULETTE' | 'BLACKJACK';
  label: string;
  maxSeats: number;
  rects: [number, number, number, number][];
}

export interface Lobby {
  id: string;
  type: 'ROULETTE' | 'BLACKJACK';
  name: string;
  host: string;
  players: number;
  max: number;
  createdAt: number;
}

export type ActiveModal =
  | null
  | { kind: 'SLOTS'; machine: Interactable }
  | { kind: 'LOBBY'; zone: Zone }
  | { kind: 'ROULETTE'; lobbyId: string; name: string }
  | { kind: 'BLACKJACK'; lobbyId: string; name: string }
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

  // Interactable (slot machine) the player is standing next to.
  nearby: Interactable | null;
  setNearby: (i: Interactable | null) => void;

  // Interaction zone (blackjack/roulette area) the player is currently inside.
  nearbyZone: Zone | null;
  setNearbyZone: (z: Zone | null) => void;

  // Live lobby list (kept in sync via the lobby socket).
  lobbies: Record<string, Lobby>;
  upsertLobby: (l: Lobby) => void;
  removeLobby: (id: string) => void;
  setLobbies: (ls: Lobby[]) => void;

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

  nearbyZone: null,
  setNearbyZone: (nearbyZone) => set({ nearbyZone }),

  lobbies: {},
  upsertLobby: (l) => set((s) => ({ lobbies: { ...s.lobbies, [l.id]: l } })),
  removeLobby: (id) =>
    set((s) => {
      const next = { ...s.lobbies };
      delete next[id];
      return { lobbies: next };
    }),
  setLobbies: (ls) => set({ lobbies: Object.fromEntries(ls.map((l) => [l.id, l])) }),

  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  toast: null,
  setToast: (toast) => set({ toast }),
}));
