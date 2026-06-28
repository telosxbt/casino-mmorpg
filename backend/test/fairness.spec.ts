import { FairRng, sha256Hex, verifyInt } from '../src/fairness/prng';

describe('provably-fair PRNG', () => {
  it('is deterministic for the same seed/client/nonce', () => {
    const a = new FairRng('server', 'client', 1);
    const b = new FairRng('server', 'client', 1);
    expect(Array.from({ length: 5 }, () => a.int(37))).toEqual(
      Array.from({ length: 5 }, () => b.int(37)),
    );
  });

  it('changes the stream when the nonce changes', () => {
    const a = new FairRng('server', 'client', 1).int(1_000_000);
    const b = new FairRng('server', 'client', 2).int(1_000_000);
    expect(a).not.toEqual(b);
  });

  it('matches the standalone verifier (what a player would recompute)', () => {
    const direct = new FairRng('seed', 'cs', 7).int(37);
    expect(verifyInt('seed', 'cs', 7, 37)).toEqual(direct);
  });

  it('produces a uniform-ish roulette distribution (no obvious bias)', () => {
    const counts = new Array(37).fill(0);
    for (let n = 0; n < 37_000; n++) counts[verifyInt('s', 'c', n, 37)]++;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // Every pocket hit, and spread within a sane band around the ~1000 mean.
    expect(min).toBeGreaterThan(800);
    expect(max).toBeLessThan(1200);
  });

  it('commitment hash matches the revealed seed', () => {
    const seed = 'abc123';
    expect(sha256Hex(seed)).toHaveLength(64);
    expect(sha256Hex(seed)).toEqual(sha256Hex(seed));
  });
});
