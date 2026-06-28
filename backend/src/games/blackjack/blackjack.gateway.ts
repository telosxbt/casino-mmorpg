import {
  OnGatewayDisconnect,
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

@WebSocketGateway({ namespace: '/blackjack' })
export class BlackjackGateway implements OnGatewayInit, OnGatewayDisconnect {
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
  async onJoin(socket: Socket, body: { tableId: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    const table = this.map.interactable(body?.tableId);
    if (!table || table.type !== 'BLACKJACK') return socket.emit('blackjack:error', { reason: 'unknown table' });

    const me = this.world.get(userId);
    if (!me || !this.map.isNear({ x: Math.round(me.x), y: Math.round(me.y) }, table, 2)) {
      return socket.emit('blackjack:error', { reason: 'walk up to the table first' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const res = await this.blackjack.join(body.tableId, userId, user?.username ?? 'player');
    if (res === 'full') return socket.emit('blackjack:full', { tableId: body.tableId });

    socket.data.tableId = body.tableId;
    await socket.join(`blackjack:${body.tableId}`);
    socket.emit('blackjack:joined', { tableId: body.tableId });
  }

  @SubscribeMessage('blackjack:bet')
  async onBet(socket: Socket, body: { tableId: string; amount: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    if (!/^[1-9][0-9]{0,30}$/.test(body?.amount ?? '')) return socket.emit('blackjack:error', { reason: 'invalid amount' });
    if (!(await this.redis.allow(`bj:bet:${userId}`, 10, 10))) return socket.emit('blackjack:error', { reason: 'slow down' });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    try {
      await this.blackjack.placeBet(body.tableId, userId, user?.username ?? 'player', BigInt(body.amount));
      socket.emit('blackjack:bet:ok', {});
    } catch (e) {
      socket.emit('blackjack:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('blackjack:action')
  async onAction(socket: Socket, body: { tableId: string; action: 'hit' | 'stand' | 'double' }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    try {
      if (body.action === 'hit') await this.blackjack.hit(body.tableId, userId);
      else if (body.action === 'stand') await this.blackjack.stand(body.tableId, userId);
      else if (body.action === 'double') await this.blackjack.double(body.tableId, userId);
      else socket.emit('blackjack:error', { reason: 'unknown action' });
    } catch (e) {
      socket.emit('blackjack:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('blackjack:leave')
  async onLeave(socket: Socket) {
    this.releaseMember(socket);
  }

  handleDisconnect(socket: Socket) {
    this.releaseMember(socket);
  }

  private releaseMember(socket: Socket) {
    const userId = socket.data.user?.sub as string | undefined;
    const tableId = socket.data.tableId as string | undefined;
    if (!userId || !tableId) return;
    this.blackjack.leave(tableId, userId);
    void socket.leave(`blackjack:${tableId}`);
    socket.data.tableId = undefined;
  }
}
