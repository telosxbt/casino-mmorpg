import { BadRequestException, Injectable } from '@nestjs/common';
import { GameType, TxType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../../wallet/ledger.service';
import { FairnessService } from '../../fairness/fairness.service';

// Weighted reel strip. Heavier symbols hit more often; 3-of-a-kind pays the
// multiplier. The house edge comes from the weights vs. payouts — all computed
// server-side from the provably-fair stream, never the client.
const SYMBOLS = [
  { s: '7', weight: 1, three: 50 },
  { s: 'BAR', weight: 3, three: 20 },
  { s: 'BELL', weight: 5, three: 12 },
  { s: 'PLUM', weight: 7, three: 6 },
  { s: 'ORANGE', weight: 9, three: 4 },
  { s: 'LEMON', weight: 11, three: 3 },
  { s: 'CHERRY', weight: 13, three: 2 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((a, x) => a + x.weight, 0);
const REELS = 3;

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fairness: FairnessService,
  ) {}

  private pick(roll: number) {
    let t = roll * TOTAL_WEIGHT;
    for (const sym of SYMBOLS) {
      t -= sym.weight;
      if (t < 0) return sym;
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  /**
   * Execute a spin. Stake is debited before the outcome; winnings are derived
   * from the committed seed and credited atomically. Returns the result plus
   * the revealed seed so the player can verify fairness immediately.
   */
  async spin(userId: string, machineId: string, betAmount: bigint) {
    if (betAmount <= 0n) throw new BadRequestException('bet must be positive');

    // Create the bet and lock the stake first.
    const bet = await this.prisma.bet.create({
      data: { userId, gameType: GameType.SLOTS, amount: betAmount, status: 'PLACED' },
    });
    await this.ledger.debit(userId, betAmount, TxType.BET_DEBIT, { machineId }, bet.id);

    // Commit → derive → reveal.
    const round = await this.fairness.create(GameType.SLOTS, machineId);
    const rng = await this.fairness.rng(round.id);
    const reels = Array.from({ length: REELS }, () => this.pick(rng.float()));
    const symbols = reels.map((r) => r.s);

    const allEqual = symbols.every((s) => s === symbols[0]);
    const multiplier = allEqual ? reels[0].three : symbols.filter((s) => s === 'CHERRY').length >= 2 ? 1 : 0;
    const payout = betAmount * BigInt(multiplier);

    await this.prisma.$transaction(async (db) => {
      await db.bet.update({
        where: { id: bet.id },
        data: { status: payout > 0n ? 'WON' : 'LOST', payout, settledAt: new Date(), gameRoundId: round.id },
      });
      await db.slotSpin.create({
        data: { userId, machineId, fairnessId: round.id, bet: betAmount, result: symbols, payout, multiplier },
      });
    });
    if (payout > 0n) await this.ledger.credit(userId, payout, TxType.BET_CREDIT, { machineId }, bet.id);

    const reveal = await this.fairness.reveal(round.id);
    const balance = await this.ledger.getBalance(userId);

    return {
      result: symbols,
      multiplier,
      payout: payout.toString(),
      balance: balance.toString(),
      fairness: reveal,
    };
  }
}
