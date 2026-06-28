import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { GameType, RoundPhase, TxType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LedgerService } from '../../wallet/ledger.service';
import { FairnessService } from '../../fairness/fairness.service';
import { BetType, Selection, colorOf, isValidBet, settle } from './roulette.engine';

const BETTING_MS = 15_000;
const SPIN_MS = 6_000;
const LOCK_TTL = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const room = (id: string) => `roulette:${id}`;
const members = (id: string) => `lobby:p:${id}`; // shared with LobbyService

/**
 * Roulette engine, one round loop per ACTIVE LOBBY. Lobbies are created/destroyed
 * dynamically by LobbyService, which calls ensureRunning()/stop(). Seat
 * membership is owned by the lobby (Redis set `lobby:p:<id>`); this service only
 * drives the shared wheel/countdown and settles bets — all server-authoritative
 * and provably fair. Exactly one instance drives a given lobby (Redis lock);
 * broadcasts fan out to every instance via the socket.io Redis adapter.
 */
@Injectable()
export class RouletteService {
  private readonly log = new Logger(RouletteService.name);
  private readonly token = randomUUID();
  private readonly running = new Set<string>();
  private server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly fairness: FairnessService,
  ) {}

  bindServer(server: Server) {
    this.server = server;
  }

  ensureRunning(lobbyId: string) {
    if (this.running.has(lobbyId)) return;
    this.running.add(lobbyId);
    void this.loop(lobbyId);
  }

  stop(lobbyId: string) {
    this.running.delete(lobbyId);
  }

  async seatCount(lobbyId: string): Promise<number> {
    return this.redis.client.scard(members(lobbyId));
  }

  // ── Betting ──────────────────────────────────────────────────────────────

  async placeBet(userId: string, lobbyId: string, type: BetType, selection: Selection, amount: bigint) {
    if (amount <= 0n) throw new BadRequestException('bet must be positive');
    if (!isValidBet(type, selection)) throw new BadRequestException('invalid bet');
    if ((await this.redis.client.sismember(members(lobbyId), userId)) !== 1) {
      throw new BadRequestException('join the table first');
    }
    const game = await this.currentBettingGame(lobbyId);
    if (!game) throw new BadRequestException('betting is closed');

    const bet = await this.prisma.bet.create({
      data: { userId, gameType: GameType.ROULETTE, amount, status: 'PLACED', gameRoundId: game.id },
    });
    await this.ledger.debit(userId, amount, TxType.BET_DEBIT, { lobbyId, type }, bet.id);
    await this.prisma.rouletteBet.create({
      data: { gameId: game.id, userId, betType: type, selection: selection as object, amount },
    });

    this.server?.to(room(lobbyId)).emit('roulette:bet', { userId, type, selection, amount: amount.toString() });
    return { ok: true, gameId: game.id };
  }

  private async currentBettingGame(lobbyId: string) {
    const g = await this.prisma.rouletteGame.findFirst({
      where: { tableId: lobbyId, phase: RoundPhase.BETTING },
      orderBy: { createdAt: 'desc' },
    });
    if (!g || (g.bettingEndsAt && g.bettingEndsAt.getTime() < Date.now())) return null;
    return g;
  }

  // ── Round loop (leader only, while lobby is alive) ──────────────────────────

  private async loop(lobbyId: string) {
    while (this.running.has(lobbyId)) {
      try {
        if (!(await this.redis.acquireOrRenew(room(lobbyId), this.token, LOCK_TTL))) {
          await sleep(2000);
          continue;
        }
        await this.runRound(lobbyId);
      } catch (e) {
        this.log.error(`roulette ${lobbyId} round error: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
  }

  private async runRound(lobbyId: string) {
    const bettingEndsAt = new Date(Date.now() + BETTING_MS);
    const game = await this.prisma.rouletteGame.create({
      data: { tableId: lobbyId, phase: RoundPhase.BETTING, bettingEndsAt },
    });
    this.broadcast(lobbyId, 'roulette:state', {
      lobbyId,
      gameId: game.id,
      phase: 'BETTING',
      bettingEndsAt: bettingEndsAt.getTime(),
      seats: await this.seatCount(lobbyId),
    });
    await sleep(BETTING_MS);
    if (!this.running.has(lobbyId)) return;

    await this.redis.acquireOrRenew(room(lobbyId), this.token, LOCK_TTL);
    const round = await this.fairness.create(GameType.ROULETTE, lobbyId);
    const rng = await this.fairness.rng(round.id);
    const result = rng.int(37);
    const color = colorOf(result);
    await this.prisma.rouletteGame.update({
      where: { id: game.id },
      data: { phase: RoundPhase.SPINNING, resultNumber: result, resultColor: color, fairnessId: round.id },
    });
    this.broadcast(lobbyId, 'roulette:spin', { lobbyId, gameId: game.id, result, color, serverSeedHash: round.serverSeedHash });
    await sleep(SPIN_MS);

    await this.redis.acquireOrRenew(room(lobbyId), this.token, LOCK_TTL);
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
        await this.ledger.credit(b.userId, total, TxType.BET_CREDIT, { lobbyId, result }, b.id);
        payouts.push({ userId: b.userId, payout: total.toString() });
      }
    }
    const reveal = await this.fairness.reveal(round.id);
    await this.prisma.rouletteGame.update({ where: { id: game.id }, data: { phase: RoundPhase.SETTLED, settledAt: new Date() } });
    this.broadcast(lobbyId, 'roulette:result', { lobbyId, gameId: game.id, result, color, payouts, fairness: reveal });
    await sleep(2500);
  }

  private broadcast(lobbyId: string, event: string, payload: unknown) {
    this.server?.to(room(lobbyId)).emit(event, payload);
  }
}
