import {
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { socketAuthMiddleware } from '../../auth/ws-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MapService } from '../../world/map.service';
import { WorldService } from '../../world/world.service';
import { BlackjackService } from './blackjack.service';

const members = (id: string) => `lobby:p:${id}`;

@WebSocketGateway({ namespace: '/blackjack' })
export class BlackjackGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly map: MapService,
    private readonly world: WorldService,
    private readonly blackjack: BlackjackService,
  ) {}

  afterInit(server: Server) {
    server.use(socketAuthMiddleware(this.jwt));
    this.blackjack.bindServer(server);
  }

  @SubscribeMessage('blackjack:join')
  async onJoin(socket: Socket, body: { lobbyId: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId || !body?.lobbyId) return;
    const me = this.world.get(userId);
    if (!me || !this.map.inZone({ x: Math.round(me.x), y: Math.round(me.y) }, 'BLACKJACK')) {
      return socket.emit('blackjack:error', { reason: 'enter the blackjack area first' });
    }
    if ((await this.redis.client.sismember(members(body.lobbyId), userId)) !== 1) {
      return socket.emit('blackjack:error', { reason: 'join the lobby first' });
    }
    this.blackjack.ensureRunning(body.lobbyId); // idempotent safety net
    socket.data.lobbyId = body.lobbyId;
    await socket.join(`blackjack:${body.lobbyId}`);
    socket.emit('blackjack:joined', { lobbyId: body.lobbyId });
  }

  @SubscribeMessage('blackjack:bet')
  async onBet(socket: Socket, body: { lobbyId: string; amount: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    if (!/^[1-9][0-9]{0,30}$/.test(body?.amount ?? '')) return socket.emit('blackjack:error', { reason: 'invalid amount' });
    if (!(await this.redis.allow(`bj:bet:${userId}`, 10, 10))) return socket.emit('blackjack:error', { reason: 'slow down' });
    if ((await this.redis.client.sismember(members(body.lobbyId), userId)) !== 1) return socket.emit('blackjack:error', { reason: 'join the lobby first' });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    try {
      await this.blackjack.placeBet(body.lobbyId, userId, user?.username ?? 'player', BigInt(body.amount));
      socket.emit('blackjack:bet:ok', {});
    } catch (e) {
      socket.emit('blackjack:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('blackjack:action')
  async onAction(socket: Socket, body: { lobbyId: string; action: 'hit' | 'stand' | 'double' }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    try {
      if (body.action === 'hit') await this.blackjack.hit(body.lobbyId, userId);
      else if (body.action === 'stand') await this.blackjack.stand(body.lobbyId, userId);
      else if (body.action === 'double') await this.blackjack.double(body.lobbyId, userId);
      else socket.emit('blackjack:error', { reason: 'unknown action' });
    } catch (e) {
      socket.emit('blackjack:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('blackjack:leave')
  async onLeave(socket: Socket) {
    const lobbyId = socket.data.lobbyId as string | undefined;
    if (lobbyId) await socket.leave(`blackjack:${lobbyId}`);
    socket.data.lobbyId = undefined;
  }
}
