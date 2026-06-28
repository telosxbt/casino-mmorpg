import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, TxType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { SolanaService } from './solana.service';

const MAX_ATTEMPTS = 5;
const POLL_MS = 8000;

/**
 * Withdrawal / payout queue. Money safety lives here:
 *   - Withdrawals debit the ledger FIRST (inside one transaction with the
 *     PENDING WITHDRAW row), so a balance can never be spent twice.
 *   - A worker drains PENDING rows, signs the on-chain transfer, and records the
 *     signature. The Transaction row IS the queue entry — survives restarts.
 *   - Failures retry with backoff; after MAX_ATTEMPTS the row is marked FAILED
 *     and the amount is re-credited (dead-letter for ops review).
 *   - Per-tx and per-window caps bound blast radius if the bankroll key leaks.
 */
@Injectable()
export class PayoutService implements OnModuleInit {
  private readonly log = new Logger(PayoutService.name);
  private readonly maxPerTx = BigInt(process.env.PAYOUT_MAX_PER_TX ?? '1000000000000');
  private readonly maxPerWindow = BigInt(process.env.PAYOUT_MAX_PER_WINDOW ?? '5000000000000');
  private readonly windowMs = 60 * 60 * 1000;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly solana: SolanaService,
  ) {}

  onModuleInit() {
    setInterval(() => void this.drain(), POLL_MS).unref();
  }

  /** Player-initiated withdrawal of in-game balance to their wallet. */
  async requestWithdraw(userId: string, walletAddress: string, amount: bigint) {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');
    if (amount > this.maxPerTx) throw new BadRequestException('exceeds per-transaction cap');
    await this.assertWindowCap(amount);

    // Debit + enqueue atomically: the PENDING WITHDRAW row is the queue entry.
    const idempotencyKey = randomUUID();
    const txId = await this.prisma.$transaction(async (db) => {
      const res = await db.user.updateMany({
        where: { id: userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (res.count === 0) throw new BadRequestException('insufficient balance');
      const row = await db.transaction.create({
        data: {
          userId,
          type: TxType.WITHDRAW,
          status: 'PENDING',
          amount,
          idempotencyKey,
          meta: { walletAddress, attempts: 0 },
        },
      });
      return row.id;
    });

    void this.drain();
    return { id: txId, status: 'PENDING' as const };
  }

  private async assertWindowCap(extra: bigint) {
    const since = new Date(Date.now() - this.windowMs);
    const rows = await this.prisma.transaction.findMany({
      where: { type: TxType.WITHDRAW, status: { in: ['PENDING', 'CONFIRMED'] }, createdAt: { gte: since } },
      select: { amount: true },
    });
    const used = rows.reduce((a, r) => a + r.amount, 0n);
    if (used + extra > this.maxPerWindow) throw new BadRequestException('payout window cap reached, try later');
  }

  /** Process all pending withdrawals. Safe to call concurrently (guarded). */
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const pending = await this.prisma.transaction.findMany({
        where: { type: TxType.WITHDRAW, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
      for (const row of pending) await this.process(row.id);
    } finally {
      this.draining = false;
    }
  }

  private async process(txId: string) {
    const row = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!row || row.status !== 'PENDING') return;
    const meta = (row.meta as { walletAddress?: string; attempts?: number }) ?? {};
    const wallet = meta.walletAddress;
    if (!wallet) return;

    try {
      const sig = await this.solana.sendPayout(wallet, row.amount);
      await this.prisma.transaction.update({
        where: { id: txId },
        data: { status: 'CONFIRMED', onchainSig: sig, confirmedAt: new Date() },
      });
      this.log.log(`payout ${txId} sent: ${sig}`);
    } catch (e) {
      const attempts = (meta.attempts ?? 0) + 1;
      this.log.warn(`payout ${txId} attempt ${attempts} failed: ${(e as Error).message}`);
      if (attempts >= MAX_ATTEMPTS) {
        // Dead-letter: re-credit and mark FAILED for manual review.
        await this.ledger.credit(
          row.userId,
          row.amount,
          TxType.ADJUST,
          { reason: 'withdraw failed, re-credited', txId } as Prisma.InputJsonValue,
        );
        await this.prisma.transaction.update({
          where: { id: txId },
          data: { status: 'FAILED', meta: { ...meta, attempts } as Prisma.InputJsonValue },
        });
        this.log.error(`payout ${txId} dead-lettered after ${attempts} attempts`);
      } else {
        await this.prisma.transaction.update({
          where: { id: txId },
          data: { meta: { ...meta, attempts } as Prisma.InputJsonValue },
        });
      }
    }
  }
}
