import { Injectable } from '@nestjs/common';
import map from './data/casino-map.json';

export interface Interactable {
  id: string;
  type: 'ROULETTE' | 'BLACKJACK' | 'SLOTS';
  label: string;
  x: number;
  y: number;
}

export type GameZoneType = 'ROULETTE' | 'BLACKJACK';

export interface Zone {
  id: string;
  type: GameZoneType;
  label: string;
  maxSeats: number;
  rects: [number, number, number, number][]; // [x0,y0,x1,y1] inclusive
}

/**
 * Authoritative map model used for anti-cheat: bounds, collision, pathfinding,
 * and interactable lookups. Loaded from the shared casino-map.json that the
 * converter (tools/build-map.mjs) derives from the RPG Maker MV data.
 */
@Injectable()
export class MapService {
  readonly width = map.width;
  readonly height = map.height;
  readonly spawn = map.spawn as { x: number; y: number };
  readonly interactables = map.interactables as Interactable[];
  readonly zones = (((map as unknown as { zones?: unknown }).zones ?? []) as Zone[]);
  private readonly collision = map.collision as number[];

  zone(id: string): Zone | undefined {
    return this.zones.find((z) => z.id === id);
  }

  /** The interaction zone containing this tile, if any. */
  zoneAt(x: number, y: number): Zone | undefined {
    return this.zones.find((z) =>
      z.rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1),
    );
  }

  /** True if `tile` is inside a zone of the given type. */
  inZone(tile: { x: number; y: number }, type: GameZoneType): boolean {
    const z = this.zoneAt(tile.x, tile.y);
    return !!z && z.type === type;
  }

  passable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.collision[y * this.width + x] === 0;
  }

  interactable(id: string): Interactable | undefined {
    return this.interactables.find((o) => o.id === id);
  }

  /**
   * BFS shortest path on the 4-connected walkable grid. Returns the list of
   * tiles from `from` (exclusive) to `to` (inclusive), or null if unreachable.
   * This is the anti-cheat core: a move is only accepted if a real path exists.
   */
  findPath(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number }[] | null {
    if (!this.passable(to.x, to.y)) return null;
    if (from.x === to.x && from.y === to.y) return [];

    const key = (x: number, y: number) => y * this.width + x;
    const prev = new Map<number, number>();
    const seen = new Set<number>([key(from.x, from.y)]);
    const q: { x: number; y: number }[] = [from];

    while (q.length) {
      const cur = q.shift()!;
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const k = key(nx, ny);
        if (seen.has(k) || !this.passable(nx, ny)) continue;
        seen.add(k);
        prev.set(k, key(cur.x, cur.y));
        if (nx === to.x && ny === to.y) {
          // Reconstruct.
          const path: { x: number; y: number }[] = [];
          let ck = k;
          const startK = key(from.x, from.y);
          while (ck !== startK) {
            path.push({ x: ck % this.width, y: Math.floor(ck / this.width) });
            ck = prev.get(ck)!;
          }
          return path.reverse();
        }
        q.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  /** True if `tile` is adjacent to (or on) an interactable's anchor. */
  isNear(tile: { x: number; y: number }, anchor: { x: number; y: number }, radius = 1): boolean {
    return Math.abs(tile.x - anchor.x) <= radius && Math.abs(tile.y - anchor.y) <= radius;
  }
}
