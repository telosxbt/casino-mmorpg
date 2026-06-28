import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * socket.io adapter backed by Redis pub/sub so rooms (roulette/blackjack
 * tables, world presence) are shared across all backend instances on Railway.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect(): Promise<void> {
    const pubClient = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    });
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: (process.env.CORS_ORIGINS ?? '*').split(','),
        credentials: true,
      },
    });
    server.adapter(this.adapterConstructor);
    return server;
  }
}
