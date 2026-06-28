import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { MapService, GameZoneType } from '../world/map.service';
import { RouletteService } from '../games/roulette/roulette.service';
import { BlackjackService } from '../games/blackjack/blackjack.service';

const LOBBIES = 'lobbies'; // hash: lobbyId -> JSON
const members = (id: string) => `lobby:p:${id}`;
const EV_CHANNEL = 'lobby:ev';
const EMPTY_TTL_MS = 60_000; // keep an empty lobby alive this long before deleting
const SWEEP_MS = 15_000;

export interface Lobby {
  id: string;
  type: GameZoneType;
  name: string;
  host: string;
  createdAt: number;
  emptySince: number | null;
}

/**
 * Dynamic game lobbies. A lobby is a Socket.IO room created on demand; the
 * matching game engine (roulette/blackjack) runs a round loop while it exists.
 *
 * - Lobby metadata lives in Redis so every connected client sees the same list
 *   and updates broadcast in real time (via the socket.io Redis adapter).
 * - Loop start/stop is coordinated across backend instances over a Redis
 *   pub/sub channel, so any instance can drive a lobby and restarts recover.
 * - An empty lobby is kept for EMPTY_TTL_MS; if nobody rejoins, a leader-locked
 *   sweeper deletes it and removes it from everyone's UI live.
 */
@Injectable()
export class LobbyService implements OnModuleInit {
  private readonly log = new Logger(LobbyService.name);
  private readonly token = randomUUID();
  private server!: Server;
  private sub!: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly map: MapService,
    private readonly roulette: RouletteService,
    private readonly blackjack: BlackjackService,
  ) {}

  bindServer(server: Server) {
    this.server = server;
  }

  async onModuleInit() {
    // Cross-instance loop control.
    this.sub = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    await this.sub.subscribe(EV_CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      try {
        const ev = JSON.parse(raw) as { kind: 'start' | 'stop'; id: string; type: GameZoneType };
        if (ev.kind === 'start') this.engine(ev.type).ensureRunning(ev.id);
        else this.stopEngines(ev.id);
      } catch {
        /* ignore */
      }
    });

    // Resume loops for any lobbies that already exist (e.g. after a restart).
    for (const l of await this.list()) this.engine(l.type).ensureRunning(l.id);

    setInterval(() => void this.sweep(), SWEEP_MS).unref();
  }

  private engine(type: GameZoneType) {
    return type === 'ROULETTE' ? this.roulette : this.blackjack;
  }
  private stopEngines(id: string) {
    this.roulette.stop(id);
    this.blackjack.stop(id);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async list(type?: GameZoneType): Promise<(Lobby & { players: number; max: number })[]> {
    const raw = await this.redis.client.hgetall(LOBBIES);
    const lobbies = Object.values(raw).map((v) => JSON.parse(v) as Lobby);
    const out: (Lobby & { players: number; max: number })[] = [];
    for (const l of lobbies) {
      if (type && l.type !== type) continue;
      const players = await this.redis.client.scard(members(l.id));
      out.push({ ...l, players, max: this.maxFor(l.type) });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  private maxFor(type: GameZoneType): number {
    return this.map.zones.find((z) => z.type === type)?.maxSeats ?? (type === 'ROULETTE' ? 8 : 5);
  }

  async isMember(id: string, userId: string): Promise<boolean> {
    return (await this.redis.client.sismember(members(id), userId)) === 1;
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  async create(type: GameZoneType, name: string, host: string, createdAt: number): Promise<Lobby> {
    const clean = (name || `${type} table`).slice(0, 24);
    const lobby: Lobby = { id: randomUUID(), type, name: clean, host, createdAt, emptySince: null };
    await this.redis.client.hset(LOBBIES, lobby.id, JSON.stringify(lobby));
    await this.redis.client.publish(EV_CHANNEL, JSON.stringify({ kind: 'start', id: lobby.id, type }));
    this.broadcastUpdate(lobby);
    this.log.log(`lobby created ${type} ${lobby.id} by ${host}`);
    return lobby;
  }

  async join(id: string, userId: string): Promise<Lobby & { players: number; max: number }> {
    const lobby = await this.get(id);
    if (!lobby) throw new BadRequestException('lobby no longer exists');
    const max = this.maxFor(lobby.type);
    const already = await this.isMember(id, userId);
    if (!already && (await this.redis.client.scard(members(id))) >= max) {
      throw new BadRequestException('lobby is full');
    }
    await this.redis.client.sadd(members(id), userId);
    if (lobby.emptySince !== null) {
      lobby.emptySince = null;
      await this.redis.client.hset(LOBBIES, id, JSON.stringify(lobby));
    }
    const players = await this.redis.client.scard(members(id));
    this.broadcastUpdate({ ...lobby });
    return { ...lobby, players, max };
  }

  async leave(id: string, userId: string, now: number) {
    const lobby = await this.get(id);
    if (!lobby) return;
    await this.redis.client.srem(members(id), userId);
    const players = await this.redis.client.scard(members(id));
    if (players === 0) {
      lobby.emptySince = now;
      await this.redis.client.hset(LOBBIES, id, JSON.stringify(lobby));
    }
    this.broadcastUpdate(lobby);
  }

  private async get(id: string): Promise<Lobby | null> {
    const v = await this.redis.client.hget(LOBBIES, id);
    return v ? (JSON.parse(v) as Lobby) : null;
  }

  // ── TTL sweep (leader only) ─────────────────────────────────────────────────

  private async sweep() {
    if (!(await this.redis.acquireOrRenew('lobby:sweep', this.token, SWEEP_MS * 2))) return;
    const now = Date.now();
    for (const l of await this.list()) {
      if (l.players === 0 && l.emptySince && now - l.emptySince > EMPTY_TTL_MS) {
        await this.redis.client.hdel(LOBBIES, l.id);
        await this.redis.client.del(members(l.id));
        await this.redis.client.publish(EV_CHANNEL, JSON.stringify({ kind: 'stop', id: l.id, type: l.type }));
        this.server?.to('lobby').emit('lobby:removed', { id: l.id });
        this.log.log(`lobby swept ${l.id}`);
      }
    }
  }

  private broadcastUpdate(lobby: Lobby) {
    void this.redis.client.scard(members(lobby.id)).then((players) => {
      this.server?.to('lobby').emit('lobby:update', { ...lobby, players, max: this.maxFor(lobby.type) });
    });
  }
}
