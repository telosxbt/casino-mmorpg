import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { socketAuthMiddleware } from '../auth/ws-auth';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { MapService, GameZoneType } from '../world/map.service';
import { WorldService } from '../world/world.service';
import { LobbyService } from './lobby.service';

/**
 * Lobby browser. Clients join the 'lobby' room to receive live create/update/
 * remove events, and can create/join/leave lobbies — but only while physically
 * standing in the matching interaction zone (anti-cheat, server-checked).
 */
@WebSocketGateway({ namespace: '/lobby' })
export class LobbyGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly map: MapService,
    private readonly world: WorldService,
    private readonly lobby: LobbyService,
  ) {}

  afterInit(server: Server) {
    server.use(socketAuthMiddleware(this.jwt));
    this.lobby.bindServer(server);
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user as { sub: string } | undefined;
    if (!user) return socket.disconnect();
    socket.data.userId = user.sub;
    socket.data.lobbies = new Set<string>();
    await socket.join('lobby');
  }

  @SubscribeMessage('lobby:list')
  async onList(socket: Socket, body: { type?: GameZoneType }) {
    return this.lobby.list(body?.type);
  }

  @SubscribeMessage('lobby:create')
  async onCreate(socket: Socket, body: { type: GameZoneType; name?: string }) {
    const userId = socket.data.userId as string;
    if (!this.inZone(userId, body?.type)) return socket.emit('lobby:error', { reason: 'enter the area first' });
    if (!(await this.redis.allow(`lobby:create:${userId}`, 5, 30))) return socket.emit('lobby:error', { reason: 'slow down' });

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const lobby = await this.lobby.create(body.type, body.name ?? `${user?.username ?? 'player'}'s table`, userId, Date.now());
    // Host auto-joins.
    const joined = await this.lobby.join(lobby.id, userId);
    (socket.data.lobbies as Set<string>).add(lobby.id);
    socket.emit('lobby:joined', joined);
  }

  @SubscribeMessage('lobby:join')
  async onJoin(socket: Socket, body: { id: string }) {
    const userId = socket.data.userId as string;
    try {
      const lobbies = await this.lobby.list();
      const target = lobbies.find((l) => l.id === body?.id);
      if (!target) return socket.emit('lobby:error', { reason: 'lobby no longer exists' });
      if (!this.inZone(userId, target.type)) return socket.emit('lobby:error', { reason: 'enter the area first' });
      const joined = await this.lobby.join(body.id, userId);
      (socket.data.lobbies as Set<string>).add(body.id);
      socket.emit('lobby:joined', joined);
    } catch (e) {
      socket.emit('lobby:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('lobby:leave')
  async onLeave(socket: Socket, body: { id: string }) {
    const userId = socket.data.userId as string;
    if (!body?.id) return;
    await this.lobby.leave(body.id, userId, Date.now());
    (socket.data.lobbies as Set<string>).delete(body.id);
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    const set = socket.data.lobbies as Set<string> | undefined;
    if (!userId || !set) return;
    for (const id of set) await this.lobby.leave(id, userId, Date.now());
  }

  private inZone(userId: string, type?: GameZoneType): boolean {
    if (type !== 'ROULETTE' && type !== 'BLACKJACK') return false;
    const me = this.world.get(userId);
    if (!me) return false;
    return this.map.inZone({ x: Math.round(me.x), y: Math.round(me.y) }, type);
  }
}
