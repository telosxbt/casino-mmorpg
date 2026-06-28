import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The off-chain ledger — the single source of truth for balances. Every mutation
 * is an atomic DB transaction that (a) checks/changes User.balance and (b)
 * writes a Transaction row. Games and the wallet controller go through here;
 * nothing else may touch User.balance.
 *
 * Amounts are BigInt token base units, always positive.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<bigint> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    });
    return u.balance;
  }

  /**
   * Atomically remove `amount` from the user's balance. Throws if insufficient.
   * `tx` lets games compose this with bet creation in one transaction.
   */
  async debit(
    userId: string,
    amount: bigint,
    type: TxType,
    meta?: Prisma.InputJsonValue,
    betId?: string,
    client?: Prisma.TransactionClient,
  ): Promise<bigint> {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');
    const run = async (db: Prisma.TransactionClient) => {
      // Conditional update: only succeeds if balance is high enough → no race.
      const res = await db.user.updateMany({
        where: { id: userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (res.count === 0) throw new BadRequestException('insufficient balance');
      await db.transaction.create({
        data: { userId, type, status: 'CONFIRMED', amount, meta, betId, confirmedAt: new Date() },
      });
      const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
      return u.balance;
    };
    return client ? run(client) : this.prisma.$transaction(run);
  }

  /** Atomically add `amount` to the user's balance. */
  async credit(
    userId: string,
    amount: bigint,
    type: TxType,
    meta?: Prisma.InputJsonValue,
    betId?: string,
    client?: Prisma.TransactionClient,
  ): Promise<bigint> {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');
    const run = async (db: Prisma.TransactionClient) => {
      await db.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
      await db.transaction.create({
        data: { userId, type, status: 'CONFIRMED', amount, meta, betId, confirmedAt: new Date() },
      });
      const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
      return u.balance;
    };
    return client ? run(client) : this.prisma.$transaction(run);
  }

  /**
   * Credit a verified on-chain deposit. The unique constraint on
   * Transaction.onchainSig makes this idempotent: a replayed signature throws
   * P2002 and we treat it as already-credited.
   */
  async creditDeposit(userId: string, amount: bigint, onchainSig: string): Promise<bigint> {
    try {
      return await this.prisma.$transaction(async (db) => {
        await db.transaction.create({
          data: { userId, type: TxType.DEPOSIT, status: 'CONFIRMED', amount, onchainSig, confirmedAt: new Date() },
        });
        await db.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
        const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
        return u.balance;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('deposit already credited');
      }
      throw e;
    }
  }
}
