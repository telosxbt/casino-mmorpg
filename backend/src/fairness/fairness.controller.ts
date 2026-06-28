import { Controller, Get, Param } from '@nestjs/common';
import { FairnessService } from './fairness.service';
import { sha256Hex } from './prng';

/**
 * Public fairness verification. Anyone can fetch a round's commitment (and,
 * after reveal, the seed) and confirm that sha256(serverSeed) matches the hash
 * that was published before play.
 */
@Controller('fairness')
export class FairnessController {
  constructor(private readonly fairness: FairnessService) {}

  @Get(':roundId')
  async round(@Param('roundId') roundId: string) {
    const c = await this.fairness.commitment(roundId);
    if (!c.revealed) return c;
    const reveal = await this.fairness.reveal(roundId);
    return {
      ...c,
      ...reveal,
      hashMatches: sha256Hex(reveal.serverSeed) === reveal.serverSeedHash,
    };
  }
}
