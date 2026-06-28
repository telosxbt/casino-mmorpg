import { Injectable } from '@nestjs/common';
import { MapService } from './map.service';

export interface Look {
  skin: string;
  hair: string;
  suit: string;
}

export interface PlayerState {
  userId: string;
  username: string;
  avatar: string;
  look: Look;
  // Fractional tile position (server-authoritative).
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
  // Remaining path of tiles to walk through.
  path: { x: number; y: number }[];
  lastActiveAt: number;
  idle: boolean;
}

// Tiles per second a player may move. The tick advances by this much; clients
// only interpolate — they can never make the server move them faster.
const SPEED = 4;

/**
 * Holds movement state for players connected to THIS instance and advances them
 * each tick. Authoritative position lives here; the gateway broadcasts it.
 * Cross-instance presence (the full player list) is mirrored in Redis by the
 * gateway so a newly-connected client sees everyone.
 */
@Injectable()
export class WorldService {
  private readonly players = new Map<string, PlayerState>();

  constructor(private readonly map: MapService) {}

  spawn(userId: string, username: string, avatar: string, look: Look): PlayerState {
    const p: PlayerState = {
      userId,
      username,
      avatar,
      look,
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      dir: 'down',
      moving: false,
      path: [],
      lastActiveAt: Date.now(),
      idle: false,
    };
    this.players.set(userId, p);
    return p;
  }

  remove(userId: string) {
    this.players.delete(userId);
  }

  get(userId: string): PlayerState | undefined {
    return this.players.get(userId);
  }

  /**
   * Validate + accept a click-to-move target. Rejects out-of-bounds, blocked,
   * and unreachable tiles (anti-teleport). Returns the accepted path or null.
   */
  setTarget(userId: string, tx: number, ty: number): { x: number; y: number }[] | null {
    const p = this.players.get(userId);
    if (!p) return null;
    const fromTile = { x: Math.round(p.x), y: Math.round(p.y) };
    const path = this.map.findPath(fromTile, { x: tx, y: ty });
    if (!path) return null;
    // Snap to the tile we're standing on, then walk the validated path.
    p.x = fromTile.x;
    p.y = fromTile.y;
    p.path = path;
    p.moving = path.length > 0;
    p.lastActiveAt = Date.now();
    p.idle = false;
    return path;
  }

  /**
   * Advance all local players by dt seconds. Returns the players whose state
   * changed this tick (for broadcast).
   */
  tick(dt: number): PlayerState[] {
    const changed: PlayerState[] = [];
    const now = Date.now();
    for (const p of this.players.values()) {
      if (p.moving && p.path.length > 0) {
        let remaining = SPEED * dt;
        while (remaining > 0 && p.path.length > 0) {
          const next = p.path[0];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const dist = Math.abs(dx) + Math.abs(dy); // grid-aligned, one axis at a time
          if (dist === 0) {
            p.path.shift();
            continue;
          }
          p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          const step = Math.min(remaining, dist);
          p.x += Math.sign(dx) * Math.min(step, Math.abs(dx));
          p.y += Math.sign(dy) * Math.min(step, Math.abs(dy));
          remaining -= step;
          if (Math.abs(next.x - p.x) < 1e-6 && Math.abs(next.y - p.y) < 1e-6) {
            p.x = next.x;
            p.y = next.y;
            p.path.shift();
          }
        }
        if (p.path.length === 0) {
          p.moving = false;
          p.lastActiveAt = now;
        }
        changed.push(p);
      } else if (!p.idle && now - p.lastActiveAt > 60_000) {
        p.idle = true;
        changed.push(p);
      }
    }
    return changed;
  }

  all(): PlayerState[] {
    return [...this.players.values()];
  }
}
