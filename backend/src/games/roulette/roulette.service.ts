import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { GameType, RoundPhase, TxType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LedgerService } from '../../wallet/ledger.service';
import { FairnessService } from '../../fairness/fairness.service';
import { MapService } from '../../world/map.service';
import { BetType, Selection, colorOf, isValidBet, settle } from './roulette.engine';

const BETTING_MS = 15_000;
const SPIN_MS = 6_000;
const LOCK_TTL = 30_000;
const MAX_SEATS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const room = (tableId: string) => `roulette:${tableId}`;
const seatsKey = (tableId: string) => `roulette:seats:${tableId}`;

/**
 * Roulette table orchestration. Each table is a socket room with a shared
 * wheel, countdown, and result. Exactly one backend instance drives a table's
 * round loop (Redis leader lock); broadcasts reach all instances via the
 * socket.io Redis adapter. All money + outcomes are server-authoritative and
 * provably fair.
 */
@Injectable()
export class RouletteService {
  private readonly log = new Logger(RouletteService.name);
  private readonly token = randomUUID();
  private server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly fairness: FairnessService,
    private readonly map: MapService,
  ) {}

  bindServer(server: Server) {
    this.server = server;
    for (const t of this.map.interactables.filter((i) => i.type === 'ROULETTE')) {
      void this.loop(t.id);
    }
  }

  // ── Seating ──────────────────────────────────────────────────────────────

  async takeSeat(tableId: string, userId: string): Promise<boolean> {
    const occupied = await this.redis.client.sismember(seatsKey(tableId), userId);
    if (occupied) return true;
    if ((await this.redis.client.scard(seatsKey(tableId))) >= MAX_SEATS) return false;
    await this.redis.client.sadd(seatsKey(tableId), userId);
    return true;
  }

  async leaveSeat(tableId: string, userId: string) {
    await this.redis.client.srem(seatsKey(tableId), userId);
  }

  async seatCount(tableId: string): Promise<number> {
    return this.redis.client.scard(seatsKey(tableId));
  }

  // ── Betting ──────────────────────────────────────────────────────────────

  async placeBet(
    userId: string,
    tableId: string,
    type: BetType,
    selection: Selection,
    amount: bigint,
  ) {
    if (amount <= 0n) throw new BadRequestException('bet must be positive');
    if (!isValidBet(type, selection)) throw new BadRequestException('invalid bet');
    if (!(await this.redis.client.sismember(seatsKey(tableId), userId))) {
      throw new BadRequestException('join the table first');
    }

    const game = await this.currentBettingGame(tableId);
    if (!game) throw new BadRequestException('betting is closed');

    const bet = await this.prisma.bet.create({
      data: { userId, gameType: GameType.ROULETTE, amount, status: 'PLACED', gameRoundId: game.id },
    });
    await this.ledger.debit(userId, amount, TxType.BET_DEBIT, { tableId, type }, bet.id);
    await this.prisma.rouletteBet.create({
      data: { gameId: game.id, userId, betType: type, selection: selection as object, amount },
    });

    this.server?.to(room(tableId)).emit('roulette:bet', { userId, type, selection, amount: amount.toString() });
    return { ok: true, gameId: game.id };
  }

  private async currentBettingGame(tableId: string) {
    const g = await this.prisma.rouletteGame.findFirst({
      where: { tableId, phase: RoundPhase.BETTING },
      orderBy: { createdAt: 'desc' },
    });
    if (!g || (g.bettingEndsAt && g.bettingEndsAt.getTime() < Date.now())) return null;
    return g;
  }

  // ── Round loop (leader only) ───────────────────────────────────────────────

  private async loop(tableId: string) {
    for (;;) {
      try {
        if (!(await this.redis.acquireOrRenew(room(tableId), this.token, LOCK_TTL))) {
          await sleep(2000);
          continue;
        }
        await this.runRound(tableId);
      } catch (e) {
        this.log.error(`roulette ${tableId} round error: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
  }

  private async runRound(tableId: string) {
    // Open betting.
    const bettingEndsAt = new Date(Date.now() + BETTING_MS);
    const game = await this.prisma.rouletteGame.create({
      data: { tableId, phase: RoundPhase.BETTING, bettingEndsAt },
    });
    this.broadcast(tableId, 'roulette:state', {
      tableId,
      gameId: game.id,
      phase: 'BETTING',
      bettingEndsAt: bettingEndsAt.getTime(),
      seats: await this.seatCount(tableId),
      maxSeats: MAX_SEATS,
    });
    await sleep(BETTING_MS);

    // Spin: derive the number from a fresh commitment.
    await this.redis.acquireOrRenew(room(tableId), this.token, LOCK_TTL);
    const round = await this.fairness.create(GameType.ROULETTE, tableId);
    const rng = await this.fairness.rng(round.id);
    const result = rng.int(37);
    const color = colorOf(result);
    await this.prisma.rouletteGame.update({
      where: { id: game.id },
      data: { phase: RoundPhase.SPINNING, resultNumber: result, resultColor: color, fairnessId: round.id },
    });
    this.broadcast(tableId, 'roulette:spin', {
      tableId,
      gameId: game.id,
      result,
      color,
      serverSeedHash: round.serverSeedHash,
    });
    await sleep(SPIN_MS);

    // Settle every bet on this round.
    await this.redis.acquireOrRenew(room(tableId), this.token, LOCK_TTL);
    const bets = await this.prisma.rouletteBet.findMany({ where: { gameId: game.id } });
    const payouts: { userId: string; payout: string }[] = [];
    for (const b of bets) {
      const total = settle(b.betType as BetType, b.selection as Selection, b.amount, result);
      const won = total > 0n;
      await this.prisma.rouletteBet.update({ where: { id: b.id }, data: { won, payout: total } });
      await this.prisma.bet.updateMany({
        where: { userId: b.userId, gameRoundId: game.id, gameType: GameType.ROULETTE },
        data: { status: won ? 'WON' : 'LOST', payout: total, settledAt: new Date() },
      });
      if (won) {
        await this.ledger.credit(b.userId, total, TxType.BET_CREDIT, { tableId, result }, b.id);
        payouts.push({ userId: b.userId, payout: total.toString() });
      }
    }
    const reveal = await this.fairness.reveal(round.id);
    await this.prisma.rouletteGame.update({
      where: { id: game.id },
      data: { phase: RoundPhase.SETTLED, settledAt: new Date() },
    });
    this.broadcast(tableId, 'roulette:result', { tableId, gameId: game.id, result, color, payouts, fairness: reveal });
    await sleep(2500); // brief intermission
  }

  private broadcast(tableId: string, event: string, payload: unknown) {
    this.server?.to(room(tableId)).emit(event, payload);
  }
}
