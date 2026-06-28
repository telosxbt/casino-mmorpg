import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GameType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FairRng, sha256Hex } from './prng';

/**
 * Persists provably-fair commitments. Flow per round:
 *   1. create()  -> generates serverSeed, stores it + published hash, returns id+hash
 *   2. rng()     -> deterministic stream for deriving the outcome (server-side)
 *   3. reveal()  -> exposes serverSeed after settlement so players can verify
 */
@Injectable()
export class FairnessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Open a round: commit to sha256(serverSeed) before any bet is accepted. */
  async create(gameType: GameType, clientSeed?: string, nonce = 0) {
    const serverSeed = randomBytes(32).toString('hex');
    const serverSeedHash = sha256Hex(serverSeed);
    const round = await this.prisma.fairnessRound.create({
      data: {
        gameType,
        serverSeed,
        serverSeedHash,
        clientSeed: clientSeed ?? null,
        nonce,
      },
    });
    return { id: round.id, serverSeedHash, clientSeed: round.clientSeed, nonce };
  }

  /** Server-only deterministic RNG for this round. */
  async rng(roundId: string): Promise<FairRng> {
    const r = await this.prisma.fairnessRound.findUniqueOrThrow({ where: { id: roundId } });
    return new FairRng(r.serverSeed, r.clientSeed ?? '', r.nonce);
  }

  /** Reveal the seed post-settlement; returns the public verification payload. */
  async reveal(roundId: string) {
    const r = await this.prisma.fairnessRound.update({
      where: { id: roundId },
      data: { revealedAt: new Date() },
    });
    return {
      serverSeed: r.serverSeed,
      serverSeedHash: r.serverSeedHash,
      clientSeed: r.clientSeed,
      nonce: r.nonce,
    };
  }

  /** Public commitment (no seed) — safe to show during play. */
  async commitment(roundId: string) {
    const r = await this.prisma.fairnessRound.findUniqueOrThrow({ where: { id: roundId } });
    return {
      serverSeedHash: r.serverSeedHash,
      clientSeed: r.clientSeed,
      nonce: r.nonce,
      revealed: !!r.revealedAt,
    };
  }
}
