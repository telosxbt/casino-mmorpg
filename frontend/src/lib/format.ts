// Token amounts travel as BigInt base-unit strings. These convert to/from the
// human-readable token amount using the mint's decimals. Never use floats for
// the on-wire value — only for display.

export function fromBase(base: string | bigint, decimals: number): string {
  const v = BigInt(base);
  if (decimals === 0) return v.toString();
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${whole}.${frac}` : whole);
}

export function toBase(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.trim().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole || '0') + (decimals ? fracPadded : ''));
}
