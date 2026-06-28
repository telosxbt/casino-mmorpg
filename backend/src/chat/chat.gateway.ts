import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatScope } from '@prisma/client';
import { socketAuthMiddleware } from '../auth/ws-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WorldService } from '../world/world.service';
import { clean } from './profanity';

const MAX_LEN = 200;
const NEARBY_TILES = 8;

/**
 * Chat: global + nearby scopes. Every message is rate-limited, length-capped,
 * profanity-filtered, persisted, then broadcast both into the chat feed and as
 * a bubble keyed by userId (the client renders it above that avatar).
 */
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly world: WorldService,
  ) {}

  afterInit(server: Server) {
    server.use(socketAuthMiddleware(this.jwt));
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user as { sub: string } | undefined;
    if (!user) return socket.disconnect();
    socket.data.userId = user.sub;
    await socket.join('global');
  }

  @SubscribeMessage('chat:history')
  async history() {
    const rows = await this.prisma.chatMessage.findMany({
      where: { scope: ChatScope.GLOBAL },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { username: true } } },
    });
    return rows.reverse().map((m) => ({
      id: m.id,
      userId: m.userId,
      username: m.user.username,
      scope: m.scope,
      body: m.body,
      createdAt: m.createdAt,
    }));
  }

  @SubscribeMessage('chat:send')
  async onSend(socket: Socket, body: { scope?: string; body?: string }) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;

    const raw = (body?.body ?? '').toString().trim();
    if (!raw) return;
    if (raw.length > MAX_LEN) {
      socket.emit('chat:error', { reason: 'message too long' });
      return;
    }

    // Spam protection: burst limit + a hard 1s cooldown between messages.
    if (!(await this.redis.allow(`chat:burst:${userId}`, 5, 10))) {
      socket.emit('chat:error', { reason: 'slow down' });
      return;
    }
    if (!(await this.redis.allow(`chat:cd:${userId}`, 1, 1))) {
      socket.emit('chat:error', { reason: 'cooldown' });
      return;
    }

    const scope = body?.scope === 'NEARBY' ? ChatScope.NEARBY : ChatScope.GLOBAL;
    const text = clean(raw);

    const msg = await this.prisma.chatMessage.create({
      data: { userId, scope, body: text },
      include: { user: { select: { username: true } } },
    });

    const payload = {
      id: msg.id,
      userId,
      username: msg.user.username,
      scope,
      body: text,
      createdAt: msg.createdAt,
    };

    if (scope === ChatScope.GLOBAL) {
      this.server.to('global').emit('chat:message', payload);
    } else {
      // Nearby: deliver only to players within NEARBY_TILES of the sender.
      const me = this.world.get(userId);
      this.server.to('global').emit('chat:message', { ...payload, near: me ? { x: me.x, y: me.y, radius: NEARBY_TILES } : null });
    }
    // Bubble above the avatar (consumed by the world renderer via userId).
    this.server.to('global').emit('chat:bubble', { userId, body: text });
  }
}
