import {
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

const members = (id: string) => `lobby:p:${id}`;

/**
 * Roulette socket surface. A player may only join a lobby's room if they are a
 * member of that lobby (joined via the lobby browser) AND standing in the
 * roulette zone. The round loop itself is driven by RouletteService.
 */
@WebSocketGateway({ namespace: '/roulette' })
export class RouletteGateway implements OnGatewayInit {
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
  async onJoin(socket: Socket, body: { lobbyId: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId || !body?.lobbyId) return;
    const me = this.world.get(userId);
    if (!me || !this.map.inZone({ x: Math.round(me.x), y: Math.round(me.y) }, 'ROULETTE')) {
      return socket.emit('roulette:error', { reason: 'enter the roulette area first' });
    }
    if ((await this.redis.client.sismember(members(body.lobbyId), userId)) !== 1) {
      return socket.emit('roulette:error', { reason: 'join the lobby first' });
    }
    socket.data.lobbyId = body.lobbyId;
    await socket.join(`roulette:${body.lobbyId}`);
    socket.emit('roulette:joined', { lobbyId: body.lobbyId, seats: await this.roulette.seatCount(body.lobbyId) });
  }

  @SubscribeMessage('roulette:bet')
  async onBet(socket: Socket, body: { lobbyId: string; type: BetType; selection: Selection; amount: string }) {
    const userId = socket.data.user?.sub as string | undefined;
    if (!userId) return;
    if (!(await this.redis.allow(`roulette:bet:${userId}`, 15, 10))) return socket.emit('roulette:error', { reason: 'slow down' });
    if (!/^[1-9][0-9]{0,30}$/.test(body?.amount ?? '')) return socket.emit('roulette:error', { reason: 'invalid amount' });
    try {
      const res = await this.roulette.placeBet(userId, body.lobbyId, body.type, body.selection ?? {}, BigInt(body.amount));
      socket.emit('roulette:bet:ok', res);
    } catch (e) {
      socket.emit('roulette:error', { reason: (e as Error).message });
    }
  }

  @SubscribeMessage('roulette:leave')
  async onLeave(socket: Socket) {
    const lobbyId = socket.data.lobbyId as string | undefined;
    if (lobbyId) await socket.leave(`roulette:${lobbyId}`);
    socket.data.lobbyId = undefined;
  }
}
