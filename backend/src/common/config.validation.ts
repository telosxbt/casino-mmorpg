// Fail fast at boot if required env is missing/invalid. No silent defaults for
// anything security-sensitive (JWT secrets, bankroll key, mint).

const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SOLANA_RPC_URL',
  'TOKEN_MINT',
  'BANKROLL_WALLET',
  'BANKROLL_PRIVATE_KEY',
];

export function configValidationSchema(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((k) => !config[k] || `${config[k]}`.trim() === '');
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  // Sanity: bankroll key must never be a placeholder or committed value.
  if (`${config.BANKROLL_PRIVATE_KEY}`.includes('REPLACE_ME')) {
    throw new Error('BANKROLL_PRIVATE_KEY is still a placeholder');
  }
  return config;
}
