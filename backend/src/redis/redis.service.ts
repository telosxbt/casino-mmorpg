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

  /**
   * Best-effort leader lock. Returns true if THIS instance now holds the lock
   * for `key`. Game tables use this so exactly one instance drives a table's
   * round loop while broadcasts still fan out to all instances via the adapter.
   */
  async acquireOrRenew(key: string, token: string, ttlMs: number): Promise<boolean> {
    const k = `lock:${key}`;
    const cur = await this.client.get(k);
    if (cur === token) {
      await this.client.pexpire(k, ttlMs);
      return true;
    }
    const ok = await this.client.set(k, token, 'PX', ttlMs, 'NX');
    return ok === 'OK';
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
