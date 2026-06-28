/**
 * Profanity filter hook. Intentionally a small, swappable seed list — the
 * architecture point is that ALL outbound chat passes through clean() so a
 * stronger provider (or a managed wordlist/ML service) can be dropped in here
 * without touching the gateway.
 */
const BLOCKLIST = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'faggot',
  'retard',
];

const pattern = new RegExp(`\\b(${BLOCKLIST.join('|')})\\b`, 'gi');

export function clean(text: string): string {
  return text.replace(pattern, (m) => m[0] + '*'.repeat(Math.max(1, m.length - 1)));
}
