import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  /**
   * Fixed-window rate limiter. Returns true if the action is allowed.
   * Used for HTTP routes, socket events, and chat cooldowns.
   */
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    const count = await this.client.incr(k);
    if (count === 1) await this.client.expire(k, windowSec);
    return count <= limit;
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
