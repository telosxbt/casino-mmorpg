import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { GameType, TxType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { LedgerService } from '../../wallet/ledger.service';
import { FairnessService } from '../../fairness/fairness.service';
import { MapService } from '../../world/map.service';
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

const MAX_SEATS = 5;
const BETTING_MS = 12_000;
const TURN_MS = 20_000;
const LOCK_TTL = 60_000;
const RESHUFFLE_AT = 60; // cards left before a fresh shoe

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const room = (t: string) => `blackjack:${t}`;

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
  tableId: string;
  state: 'WAITING' | 'DEALING' | 'PLAYER_TURNS' | 'DEALER_TURN' | 'SETTLED';
  shoe: Card[];
  dealer: Card[];
  seats: Seat[];
  fairnessId?: string;
  // Pending bets collected during WAITING (userId -> {bet}).
  pending: Map<string, { username: string; bet: bigint; betId: string }>;
  members: Map<string, string>; // userId -> username (seated/spectating in room)
  turnUserId?: string;
  resolveTurn?: () => void;
  turnTimer?: NodeJS.Timeout;
}

/**
 * Blackjack: 5-seat shared table, dealer + shoe controlled by the backend,
 * turn order with timers (auto-stand on timeout). The lock-holding instance
 * owns live table state; all cards/shoe stay server-side until reveal.
 */
@Injectable()
export class BlackjackService {
  private readonly log = new Logger(BlackjackService.name);
  private readonly token = randomUUID();
  private server!: Server;
  private readonly tables = new Map<string, Table>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly fairness: FairnessService,
    private readonly map: MapService,
  ) {}

  bindServer(server: Server) {
    this.server = server;
    for (const t of this.map.interactables.filter((i) => i.type === 'BLACKJACK')) {
      this.tables.set(t.id, this.fresh(t.id));
      void this.loop(t.id);
    }
  }

  private fresh(tableId: string): Table {
    return {
      tableId,
      state: 'WAITING',
      shoe: [],
      dealer: [],
      seats: [],
      pending: new Map(),
      members: new Map(),
    };
  }

  private isLeader(tableId: string) {
    // The loop renews the lock; placeBet/actions only run on the leader instance.
    return this.redis.acquireOrRenew(room(tableId), this.token, LOCK_TTL);
  }

  // ── Membership ─────────────────────────────────────────────────────────────

  async join(tableId: string, userId: string, username: string): Promise<'ok' | 'full'> {
    const t = this.tables.get(tableId);
    if (!t) throw new BadRequestException('unknown table');
    if (t.members.has(userId)) return 'ok';
    if (t.members.size >= MAX_SEATS) return 'full';
    t.members.set(userId, username);
    return 'ok';
  }

  leave(tableId: string, userId: string) {
    this.tables.get(tableId)?.members.delete(userId);
  }

  // ── Betting (during WAITING) ───────────────────────────────────────────────

  async placeBet(tableId: string, userId: string, username: string, amount: bigint) {
    if (amount <= 0n) throw new BadRequestException('bet must be positive');
    if (!(await this.isLeader(tableId))) throw new BadRequestException('table busy, retry');
    const t = this.tables.get(tableId);
    if (!t) throw new BadRequestException('unknown table');
    if (t.state !== 'WAITING') throw new BadRequestException('betting is closed');
    if (!t.members.has(userId) && t.members.size >= MAX_SEATS) throw new BadRequestException('table full');
    if (t.pending.has(userId)) throw new BadRequestException('already bet this round');

    const bet = await this.prisma.bet.create({
      data: { userId, gameType: GameType.BLACKJACK, amount, status: 'PLACED' },
    });
    await this.ledger.debit(userId, amount, TxType.BET_DEBIT, { tableId }, bet.id);
    t.members.set(userId, username);
    t.pending.set(userId, { username, bet: amount, betId: bet.id });
    this.broadcast(tableId, 'blackjack:bet', { userId, username, amount: amount.toString() });
  }

  // ── Player actions (during PLAYER_TURNS) ────────────────────────────────────

  async hit(tableId: string, userId: string) {
    const t = this.requireTurn(tableId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    seat.cards.push(this.draw(t));
    this.broadcast(tableId, 'blackjack:hand', this.seatView(seat));
    if (isBust(seat.cards)) {
      seat.done = true;
      this.endTurn(t);
    } else {
      this.armTurnTimer(t); // reset the clock after a valid action
    }
  }

  async stand(tableId: string, userId: string) {
    const t = this.requireTurn(tableId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    seat.standing = true;
    seat.done = true;
    this.endTurn(t);
  }

  async double(tableId: string, userId: string) {
    const t = this.requireTurn(tableId, userId);
    const seat = t.seats.find((s) => s.userId === userId)!;
    if (seat.cards.length !== 2 || seat.doubled) throw new BadRequestException('cannot double now');
    // Debit the extra stake equal to the original bet.
    await this.ledger.debit(userId, seat.bet, TxType.BET_DEBIT, { tableId, double: true }, seat.betId);
    seat.doubled = true;
    seat.bet *= 2n;
    seat.cards.push(this.draw(t));
    seat.done = true;
    this.broadcast(tableId, 'blackjack:hand', this.seatView(seat));
    this.endTurn(t);
  }

  private requireTurn(tableId: string, userId: string): Table {
    const t = this.tables.get(tableId);
    if (!t) throw new BadRequestException('unknown table');
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
        this.log.error(`blackjack ${tableId} error: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
  }

  private async runRound(tableId: string) {
    const t = this.tables.get(tableId)!;
    t.state = 'WAITING';
    t.dealer = [];
    t.seats = [];
    t.pending.clear();
    const bettingEndsAt = Date.now() + BETTING_MS;
    this.broadcast(tableId, 'blackjack:state', {
      tableId,
      state: 'WAITING',
      bettingEndsAt,
      seats: t.members.size,
      maxSeats: MAX_SEATS,
    });
    await sleep(BETTING_MS);
    await this.redis.acquireOrRenew(room(tableId), this.token, LOCK_TTL);

    if (t.pending.size === 0) {
      await sleep(1500);
      return; // nobody bet; loop again
    }

    // Build/replenish the provably-fair shoe.
    const round = await this.fairness.create(GameType.BLACKJACK, tableId);
    t.fairnessId = round.id;
    if (t.shoe.length < RESHUFFLE_AT) {
      const rng = await this.fairness.rng(round.id);
      t.shoe = rng.shuffle(buildShoe(6));
    }

    // Seat everyone who bet and deal two cards each + dealer.
    t.state = 'DEALING';
    t.seats = [...t.pending.entries()].map(([userId, p]) => ({
      userId,
      username: p.username,
      bet: p.bet,
      betId: p.betId,
      cards: [],
      doubled: false,
      standing: false,
      done: false,
    }));
    for (let i = 0; i < 2; i++) {
      for (const s of t.seats) s.cards.push(this.draw(t));
      t.dealer.push(this.draw(t));
    }
    const game = await this.prisma.blackjackGame.create({
      data: { tableId, state: 'DEALING', fairnessId: round.id, shoe: [], dealerHand: [] },
    });
    for (const s of t.seats) {
      await this.prisma.blackjackHand.create({
        data: { gameId: game.id, userId: s.userId, seat: t.seats.indexOf(s), bet: s.bet, cards: s.cards as object },
      });
    }
    this.broadcast(tableId, 'blackjack:deal', {
      tableId,
      gameId: game.id,
      dealerUp: t.dealer[0], // only the up-card is public
      seats: t.seats.map((s) => this.seatView(s)),
    });

    // Player turns in seat order (skip naturals).
    t.state = 'PLAYER_TURNS';
    for (const seat of t.seats) {
      if (isBlackjack(seat.cards)) {
        seat.standing = true;
        seat.done = true;
        continue;
      }
      await this.playSeat(t, seat);
    }
    t.turnUserId = undefined;

    // Dealer turn (only if at least one player is live).
    t.state = 'DEALER_TURN';
    const anyLive = t.seats.some((s) => !isBust(s.cards));
    if (anyLive) while (dealerShouldHit(t.dealer)) t.dealer.push(this.draw(t));
    this.broadcast(tableId, 'blackjack:dealer', { tableId, dealer: t.dealer, value: handValue(t.dealer).total });

    // Settle.
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
      if (payout > 0n) await this.ledger.credit(seat.userId, payout, TxType.BET_CREDIT, { tableId, kind }, seat.betId);
      results.push({ userId: seat.userId, result: kind, payout: payout.toString() });
    }
    const reveal = await this.fairness.reveal(round.id);
    await this.prisma.blackjackGame.update({
      where: { id: game.id },
      data: { state: 'SETTLED', dealerHand: t.dealer as object, settledAt: new Date() },
    });
    this.broadcast(tableId, 'blackjack:result', { tableId, gameId: game.id, dealer: t.dealer, results, fairness: reveal });
    await sleep(4000);
  }

  /** Resolve when the seat finishes acting (stand/bust/double) or times out. */
  private playSeat(t: Table, seat: Seat): Promise<void> {
    t.turnUserId = seat.userId;
    return new Promise<void>((resolve) => {
      t.resolveTurn = resolve;
      this.broadcast(t.tableId, 'blackjack:turn', {
        tableId: t.tableId,
        userId: seat.userId,
        turnEndsAt: Date.now() + TURN_MS,
      });
      this.armTurnTimer(t);
    });
  }

  private draw(t: Table): Card {
    if (t.shoe.length === 0) t.shoe = buildShoe(1); // safety; normally reshuffled
    return t.shoe.pop()!;
  }

  private seatView(s: Seat) {
    return {
      userId: s.userId,
      username: s.username,
      bet: s.bet.toString(),
      cards: s.cards,
      value: handValue(s.cards).total,
      doubled: s.doubled,
      done: s.done,
    };
  }

  private broadcast(tableId: string, event: string, payload: unknown) {
    this.server?.to(room(tableId)).emit(event, payload);
  }
}
