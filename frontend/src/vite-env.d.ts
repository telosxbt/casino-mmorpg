/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SOCKET_URL: string;
  readonly VITE_SOLANA_RPC_URL: string;
  readonly VITE_TOKEN_MINT: string;
  readonly VITE_BANKROLL_WALLET: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
