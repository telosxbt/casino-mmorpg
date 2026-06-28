import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { GameType, TxType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LedgerService } from '../../wallet/ledger.service';
import { FairnessService } from '../../fairness/fairness.service';
import {
  Card,
  buildShoe,
  dealerShouldHit,
  handValue,
  isBust,
  isBlackjack,
  outcome,
  payoutFor,
} from './blackjack.engine';

const BETTING_MS = 12_000;
const TURN_MS = 20_000;
const LOCK_TTL = 60_000;
const RESHUFFLE_AT = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const room = (id: string) => `blackjack:${id}`;
const members = (id: string) => `lobby:p:${id}`;

interface Seat {
  userId: string;
  username: string;
  bet: bigint;
  betId?: string;
  cards: Card[];
  doubled: boolean;
  standing: boolean;
  done: boolean;
}

interface Table {
  lobbyId: string;
  state: 'WAITING' | 'DEALING' | 'PLAYER_TURNS' | 'DEALER_TURN' | 'SETTLED';
  shoe: Card[];
  dealer: Card[];
  seats: Seat[];
  fairnessId?: string;
  pending: Map<string, { username: string; bet: bigint; betId: string }>;
  turnUserId?: string;
  resolveTurn?: () => void;
  turnTimer?: NodeJS.Timeout;
}

/**
 * Blackjack engine, one table per ACTIVE LOBBY. LobbyService creates/destroys
 * lobbies and calls ensureRunning()/stop(). Membership (≤5) is owned by the
 * lobby (`lobby:p:<id>`); the dealer + shoe are server-only. The lock-holding
 * instance drives the table; broadcasts fan out via the socket.io adapter.
 */
@Injectable()
export class BlackjackService {
  private readonly log = new Logger(BlackjackService.name);
  private readonly token = randomUUID();
  private readonly running = new Set<string>();
  private readonly tables = new Map<string, Table>();
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
    if (!this.tables.has(lobbyId)) this.tables.set(lobbyId, this.fresh(lobbyId));
    void this.loop(lobbyId);
  }

  stop(lobbyId: string) {
    this.running.delete(lobbyId);
    const t = this.tables.get(lobbyId);
    if (t?.turnTimer) clearTimeout(t.turnTimer);
    this.tables.delete(lobbyId);
  }

  async seatCount(lobbyId: string): Promise<number> {
    return this.redis.client.scard(members(lobbyId));
  }

  private fresh(lobbyId: string): Table {
    return { lobbyId, state: 'WAITING', shoe: [], dealer: [], seats: [], pending: new Map() };
  }

  private isLeader(lobbyId: string) {
    return this.redis.acquireOrRenew(room(lobbyId), this.token, LOCK_TTL);
  }

  // ── Betting (during WAITING) ───────────────────────────────────────────────

  async placeBet(lobbyId: string, userId: string, username: string, amount: bigint) {
    if (amount <= 0n) throw new BadRequestException('bet must be positive');
    if (!(await this.isLeader(lobbyId))) throw new BadRequestException('table busy, retry');
    const t = this.tables.get(lobbyId);
    if (!t) throw new BadRequestException('table not running');
    if (t.state !== 'WAITING') throw new BadRequestException('betting is closed');
    if (t.pending.has(userId)) throw new BadRequestException('already bet this round');

    const bet = await this.prisma.bet.create({
      data: { userId, gameType: GameType.BLACKJACK, amount, status: 'PLACED' },
    });
    await this.ledger.debit(userId, amount, TxType.BET_DEBIT, { lobbyId }, bet.id);
    t.pending.set(userId, { username, bet: amount, betId: bet.id });
    this.broadcast(lobbyId, 'blackjack:bet', { userId, username, amount: amount.toString() });
  }

  // ── Player actions ──────────────────────────────────────────────────────────

  async hit(lobbyId: string, userId: string) {
    const t = this.requireTurn(lobbyId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    seat.cards.push(this.draw(t));
    this.broadcast(lobbyId, 'blackjack:hand', this.seatView(seat));
    if (isBust(seat.cards)) {
      seat.done = true;
      this.endTurn(t);
    } else {
      this.armTurnTimer(t);
    }
  }

  async stand(lobbyId: string, userId: string) {
    const t = this.requireTurn(lobbyId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    seat.standing = true;
    seat.done = true;
    this.endTurn(t);
  }

  async double(lobbyId: string, userId: string) {
    const t = this.requireTurn(lobbyId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    if (seat.cards.length !== 2 || seat.doubled) throw new BadRequestException('cannot double now');
    await this.ledger.debit(userId, seat.bet, TxType.BET_DEBIT, { lobbyId, double: true }, seat.betId);
    seat.doubled = true;
    seat.bet *= 2n;
    seat.cards.push(this.draw(t));
    seat.done = true;
    this.broadcast(lobbyId, 'blackjack:hand', this.seatView(seat));
    this.endTurn(t);
  }

  private requireTurn(lobbyId: string, userId: string): Table {
    const t = this.tables.get(lobbyId);
    if (!t) throw new BadRequestException('table not running');
    if (t.state !== 'PLAYER_TURNS' || t.turnUserId !== userId) throw new BadRequestException('not your turn');
    return t;
  }

  private endTurn(t: Table) {
    if (t.turnTimer) clearTimeout(t.turnTimer);
    t.turnTimer = undefined;
    const r = t.resolveTurn;
    t.resolveTurn = undefined;
    r?.();
  }

  private armTurnTimer(t: Table) {
    if (t.turnTimer) clearTimeout(t.turnTimer);
    t.turnTimer = setTimeout(() => {
      const seat = t.seats.find((s) => s.userId === t.turnUserId);
      if (seat) {
        seat.standing = true;
        seat.done = true;
      }
      this.endTurn(t);
    }, TURN_MS);
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
        this.log.error(`blackjack ${lobbyId} error: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
  }

  private async runRound(lobbyId: string) {
    const t = this.tables.get(lobbyId);
    if (!t) return;
    t.state = 'WAITING';
    t.dealer = [];
    t.seats = [];
    t.pending.clear();
    const bettingEndsAt = Date.now() + BETTING_MS;
    this.broadcast(lobbyId, 'blackjack:state', {
      lobbyId,
      state: 'WAITING',
      bettingEndsAt,
      seats: await this.seatCount(lobbyId),
    });
    await sleep(BETTING_MS);
    if (!this.running.has(lobbyId)) return;
    await this.redis.acquireOrRenew(room(lobbyId), this.token, LOCK_TTL);

    if (t.pending.size === 0) {
      await sleep(1500);
      return;
    }

    const round = await this.fairness.create(GameType.BLACKJACK, lobbyId);
    t.fairnessId = round.id;
    if (t.shoe.length < RESHUFFLE_AT) {
      const rng = await this.fairness.rng(round.id);
      t.shoe = rng.shuffle(buildShoe(6));
    }

    t.state = 'DEALING';
    t.seats = [...t.pending.entries()].map(([userId, p]) => ({
      userId, username: p.username, bet: p.bet, betId: p.betId, cards: [], doubled: false, standing: false, done: false,
    }));
    for (let i = 0; i < 2; i++) {
      for (const s of t.seats) s.cards.push(this.draw(t));
      t.dealer.push(this.draw(t));
    }
    const game = await this.prisma.blackjackGame.create({
      data: { tableId: lobbyId, state: 'DEALING', fairnessId: round.id, shoe: [], dealerHand: [] },
    });
    for (const s of t.seats) {
      await this.prisma.blackjackHand.create({
        data: { gameId: game.id, userId: s.userId, seat: t.seats.indexOf(s), bet: s.bet, cards: s.cards as object },
      });
    }
    this.broadcast(lobbyId, 'blackjack:deal', {
      lobbyId, gameId: game.id, dealerUp: t.dealer[0], seats: t.seats.map((s) => this.seatView(s)),
    });

    t.state = 'PLAYER_TURNS';
    for (const seat of t.seats) {
      if (!this.running.has(lobbyId)) break;
      if (isBlackjack(seat.cards)) {
        seat.standing = true;
        seat.done = true;
        continue;
      }
      await this.playSeat(t, seat);
    }
    t.turnUserId = undefined;

    t.state = 'DEALER_TURN';
    const anyLive = t.seats.some((s) => !isBust(s.cards));
    if (anyLive) while (dealerShouldHit(t.dealer)) t.dealer.push(this.draw(t));
    this.broadcast(lobbyId, 'blackjack:dealer', { lobbyId, dealer: t.dealer, value: handValue(t.dealer).total });

    t.state = 'SETTLED';
    const results: { userId: string; result: string; payout: string }[] = [];
    for (const seat of t.seats) {
      const kind = outcome(seat.cards, t.dealer);
      const payout = payoutFor(kind, seat.bet);
      const handResult =
        kind === 'BLACKJACK' ? 'BLACKJACK' : kind === 'WIN' ? 'WIN' : kind === 'PUSH' ? 'PUSH' : isBust(seat.cards) ? 'BUST' : 'LOSE';
      await this.prisma.blackjackHand.updateMany({
        where: { gameId: game.id, userId: seat.userId },
        data: { cards: seat.cards as object, payout, result: handResult as any, isStanding: seat.standing, isDoubled: seat.doubled },
      });
      await this.prisma.bet.updateMany({
        where: { id: seat.betId },
        data: { status: payout > seat.bet ? 'WON' : payout === seat.bet ? 'PUSH' : 'LOST', payout, settledAt: new Date(), gameRoundId: game.id },
      });
      if (payout > 0n) await this.ledger.credit(seat.userId, payout, TxType.BET_CREDIT, { lobbyId, kind }, seat.betId);
      results.push({ userId: seat.userId, result: kind, payout: payout.toString() });
    }
    const reveal = await this.fairness.reveal(round.id);
    await this.prisma.blackjackGame.update({ where: { id: game.id }, data: { state: 'SETTLED', dealerHand: t.dealer as object, settledAt: new Date() } });
    this.broadcast(lobbyId, 'blackjack:result', { lobbyId, gameId: game.id, dealer: t.dealer, results, fairness: reveal });
    await sleep(4000);
  }

  private playSeat(t: Table, seat: Seat): Promise<void> {
    t.turnUserId = seat.userId;
    return new Promise<void>((resolve) => {
      t.resolveTurn = resolve;
      this.broadcast(t.lobbyId, 'blackjack:turn', { lobbyId: t.lobbyId, userId: seat.userId, turnEndsAt: Date.now() + TURN_MS });
      this.armTurnTimer(t);
    });
  }

  private draw(t: Table): Card {
    if (t.shoe.length === 0) t.shoe = buildShoe(1);
    return t.shoe.pop()!;
  }

  private seatView(s: Seat) {
    return {
      userId: s.userId, username: s.username, bet: s.bet.toString(),
      cards: s.cards, value: handValue(s.cards).total, doubled: s.doubled, done: s.done,
    };
  }

  private broadcast(lobbyId: string, event: string, payload: unknown) {
    this.server?.to(room(lobbyId)).emit(event, payload);
  }
}
