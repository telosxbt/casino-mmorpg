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
import { RedisService } from '../../redis/redis.service';
import { MapService } from '../../world/map.service';
import { WorldService } from '../../world/world.service';
import { RouletteService } from './roulette.service';
import { BetType, Selection } from './roulette.engine';

@WebSocketGateway({ namespace: '/roulette' })
export class RouletteGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly map: MapService,
    private readonly world: WorldService,
    private readonly roulette: RouletteService,
  ) {}

  afterInit(server: Server) {
    server.use(socketAuthMiddleware(this.jwt));
    this.roulette.bindServer(server);
  }

  @SubscribeMessage('roulette:join')
  async onJoin(socket: Socket, body: { tableId: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    const table = this.map.interactable(body?.tableId);
    if (!table || table.type !== 'ROULETTE') return socket.emit('roulette:error', { reason: 'unknown table' });

    // Anti-cheat: must be standing at the table.
    const me = this.world.get(userId);
    if (!me || !this.map.isNear({ x: Math.round(me.x), y: Math.round(me.y) }, table, 2)) {
      return socket.emit('roulette:error', { reason: 'walk up to the table first' });
    }

    const seated = await this.roulette.takeSeat(body.tableId, userId);
    if (!seated) return socket.emit('roulette:full', { tableId: body.tableId });

    socket.data.tableId = body.tableId;
    await socket.join(`roulette:${body.tableId}`);
    socket.emit('roulette:joined', { tableId: body.tableId, seats: await this.roulette.seatCount(body.tableId) });
    this.server.to(`roulette:${body.tableId}`).emit('roulette:seats', {
      tableId: body.tableId,
      seats: await this.roulette.seatCount(body.tableId),
    });
  }

  @SubscribeMessage('roulette:leave')
  async onLeave(socket: Socket) {
    await this.releaseSeat(socket);
  }

  @SubscribeMessage('roulette:bet')
  async onBet(
    socket: Socket,
    body: { tableId: string; type: BetType; selection: Selection; amount: string },
  ) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    if (!(await this.redis.allow(`roulette:bet:${userId}`, 15, 10))) {
      return socket.emit('roulette:error', { reason: 'slow down' });
    }
    if (!/^[1-9][0-9]{0,30}$/.test(body?.amount ?? '')) {
      return socket.emit('roulette:error', { reason: 'invalid amount' });
    }
    try {
      const res = await this.roulette.placeBet(userId, body.tableId, body.type, body.selection ?? {}, BigInt(body.amount));
      socket.emit('roulette:bet:ok', res);
    } catch (e) {
      socket.emit('roulette:error', { reason: (e as Error).message });
    }
  }

  async handleDisconnect(socket: Socket) {
    await this.releaseSeat(socket);
  }

  private async releaseSeat(socket: Socket) {
    const userId = socket.data.user?.sub as string | undefined;
    const tableId = socket.data.tableId as string | undefined;
    if (!userId || !tableId) return;
    await this.roulette.leaveSeat(tableId, userId);
    await socket.leave(`roulette:${tableId}`);
    socket.data.tableId = undefined;
    this.server.to(`roulette:${tableId}`).emit('roulette:seats', {
      tableId,
      seats: await this.roulette.seatCount(tableId),
    });
  }
}
