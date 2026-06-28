import { createHash, createHmac } from 'crypto';

/**
 * Provably-fair primitives. A round commits to sha256(serverSeed) BEFORE any
 * bets. Outcomes are derived deterministically from
 * HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`), so once the
 * serverSeed is revealed anyone can recompute and verify every result.
 *
 * These functions are pure — the same (serverSeed, clientSeed, nonce) always
 * yields the same stream. No Math.random anywhere in the outcome path.
 */

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Raw HMAC bytes for a given cursor block. */
function hmacBytes(serverSeed: string, clientSeed: string, nonce: number, cursor: number): Buffer {
  return createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest();
}

/**
 * Deterministic float stream in [0, 1). Each draw consumes 4 bytes of an
 * HMAC block; blocks roll over as needed. This is the canonical
 * "bytes → float" construction used by provably-fair casinos.
 */
export class FairRng {
  private cursor = 0;
  private block: Buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number,
  ) {}

  private nextByte(): number {
    if (this.offset >= this.block.length) {
      this.block = hmacBytes(this.serverSeed, this.clientSeed, this.nonce, this.cursor++);
      this.offset = 0;
    }
    return this.block[this.offset++];
  }

  /** Uniform float in [0, 1) from 4 fresh bytes. */
  float(): number {
    const b0 = this.nextByte();
    const b1 = this.nextByte();
    const b2 = this.nextByte();
    const b3 = this.nextByte();
    return ((b0 * 2 ** 24 + b1 * 2 ** 16 + b2 * 2 ** 8 + b3) >>> 0) / 2 ** 32;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.float() * maxExclusive);
  }

  /** Fisher–Yates shuffle driven by this stream (in place). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Recompute a single integer outcome — mirrors what a verifier would run. */
export function verifyInt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  maxExclusive: number,
): number {
  return new FairRng(serverSeed, clientSeed, nonce).int(maxExclusive);
}
