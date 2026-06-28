import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { socketAuthMiddleware } from '../auth/ws-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MapService } from './map.service';
import { WorldService } from './world.service';

const PRESENCE_KEY = 'world:presence';
const TICK_MS = 100;

/**
 * Real-time world: presence (enter/leave/idle) + server-authoritative movement.
 * The client sends only a target tile; the server validates reachability,
 * walks the player at a fixed speed, and broadcasts authoritative positions.
 * Cross-instance presence is mirrored in Redis so new joiners see everyone.
 */
@WebSocketGateway({ namespace: '/world' })
export class WorldGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(WorldGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly map: MapService,
    private readonly world: WorldService,
  ) {}

  afterInit(server: Server) {
    server.use(socketAuthMiddleware(this.jwt));
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      const changed = this.world.tick(dt);
      for (const p of changed) {
        this.server.to('world').emit(p.idle ? 'player:idle' : 'player:move', {
          userId: p.userId,
          x: p.x,
          y: p.y,
          dir: p.dir,
          moving: p.moving,
        });
        if (!p.moving) void this.persist(p);
      }
    }, TICK_MS).unref();
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user as { sub: string; wallet: string } | undefined;
    if (!user) return socket.disconnect();

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) return socket.disconnect();

    const state = this.world.spawn(dbUser.id, dbUser.username, dbUser.avatar, {
      skin: dbUser.skinTone,
      hair: dbUser.hairColor,
      suit: dbUser.suitColor,
    });
    socket.data.userId = dbUser.id;
    await socket.join('world');

    // Send the full current roster (from Redis, across all instances).
    const roster = await this.redis.client.hgetall(PRESENCE_KEY);
    const others = Object.values(roster)
      .map((v) => JSON.parse(v))
      .filter((p) => p.userId !== dbUser.id);
    socket.emit('world:init', {
      self: this.publicState(state),
      players: others,
      interactables: this.map.interactables,
      spawn: this.map.spawn,
    });

    await this.persist(state);
    socket.to('world').emit('player:join', this.publicState(state));
    this.log.log(`${dbUser.username} joined the casino`);
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    this.world.remove(userId);
    await this.redis.client.hdel(PRESENCE_KEY, userId);
    this.server.to('world').emit('player:leave', { userId });
  }

  /** Click-to-move: validate + path the target, then broadcast acceptance. */
  @SubscribeMessage('move')
  async onMove(socket: Socket, body: { x: number; y: number }) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    if (!Number.isInteger(body?.x) || !Number.isInteger(body?.y)) return;

    // Rate-limit move spam per player.
    if (!(await this.redis.allow(`move:${userId}`, 20, 5))) return;

    const path = this.world.setTarget(userId, body.x, body.y);
    if (!path) {
      socket.emit('move:rejected', { x: body.x, y: body.y });
      return;
    }
    // Tell everyone the validated destination so clients can pre-plan the walk;
    // the per-tick broadcast remains the source of truth.
    const p = this.world.get(userId)!;
    this.server.to('world').emit('player:path', {
      userId,
      from: { x: p.x, y: p.y },
      path,
    });
  }

  private async persist(p: ReturnType<WorldService['get']> & object) {
    if (!p) return;
    await this.redis.client.hset(PRESENCE_KEY, p.userId, JSON.stringify(this.publicState(p)));
  }

  private publicState(p: NonNullable<ReturnType<WorldService['get']>>) {
    return {
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      look: p.look,
      x: p.x,
      y: p.y,
      dir: p.dir,
      moving: p.moving,
    };
  }
}
