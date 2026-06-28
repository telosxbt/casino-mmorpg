import Phaser from 'phaser';
import type { MvMap } from '../lib/mvMap';
import type { Interactable, Zone } from '../store';
import { FRAME } from '../lib/looks';

const TILE = 48;
// Character sheets are MV "$" single-character sheets: 3 cols x 4 rows.
const CHAR_W = FRAME.w;
const CHAR_H = FRAME.h;
const DISPLAY_H = 62; // ~1.3 tiles tall
const DIRS = ['down', 'left', 'right', 'up'] as const;
type Dir = (typeof DIRS)[number];
const DIR_ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
const WALK_CYCLE = [0, 1, 2, 1];

export interface WorldSceneData {
  mvMap: MvMap;
  charUrl: string;
  spawn: { x: number; y: number };
  interactables: Interactable[];
  zones: Zone[];
  selfId: string;
  onMoveTo: (tile: { x: number; y: number }) => void;
  onNear: (i: Interactable | null) => void;
  onZone: (z: Zone | null) => void;
}

interface PlayerObj {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Container;
  bubbleTimer?: number;
  texKey: string;
  tx: number;
  ty: number;
  dir: Dir;
  moving: boolean;
}

const frameAt = (dir: Dir, col: number) => DIR_ROW[dir] * 3 + col;
const sheetFor = (avatar?: string) => (avatar === 'female' ? 'female' : 'male');

/**
 * Renders the casino + animated players. Each player's sprite is recoloured at
 * load time from their chosen presets (skin/hair/suit) into a cached texture,
 * then walk-animated by stepping frames. Movement is server-authoritative.
 */
export class WorldScene extends Phaser.Scene {
  private cfg!: WorldSceneData;
  private players = new Map<string, PlayerObj>();
  private lastNearId: string | null = null;
  private lastZoneId: string | null = null;
  private walkIdx = 0;

  constructor() {
    super('World');
  }

  init(data: WorldSceneData) {
    this.cfg = data;
  }

  preload() {
    this.load.spritesheet('male', '/assets/characters/male.png', { frameWidth: CHAR_W, frameHeight: CHAR_H });
    this.load.spritesheet('female', '/assets/characters/female.png', { frameWidth: CHAR_W, frameHeight: CHAR_H });
  }

  create() {
    const { mvMap, interactables } = this.cfg;
    this.textures.addCanvas('mapBase', mvMap.base);
    this.textures.addCanvas('mapOver', mvMap.over);
    this.add.image(0, 0, 'mapBase').setOrigin(0).setDepth(0);

    for (const o of interactables) {
      const px = o.x * TILE + TILE / 2;
      const py = o.y * TILE + TILE / 2;
      this.add.circle(px, py, 10, 0xe0c84b, 0.85).setDepth(1);
      this.add
        .text(px, py - 22, o.label, { fontSize: '11px', color: '#fff', backgroundColor: '#0008' })
        .setOrigin(0.5)
        .setDepth(1);
    }

    for (const z of this.cfg.zones) {
      const tint = z.type === 'ROULETTE' ? 0xe04b4b : 0x4be07a;
      for (const [x0, y0, x1, y1] of z.rects) {
        this.add
          .rectangle(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE, tint, 0.1)
          .setOrigin(0)
          .setDepth(2)
          .setStrokeStyle(2, tint, 0.5);
      }
      const [rx0, ry0, rx1] = z.rects[0];
      this.add
        .text(((rx0 + rx1) / 2) * TILE, ry0 * TILE - 4, z.label, { fontSize: '13px', color: '#fff', backgroundColor: '#000a', padding: { x: 6, y: 3 } })
        .setOrigin(0.5, 1)
        .setDepth(3);
    }

    this.add.image(0, 0, 'mapOver').setOrigin(0).setDepth(1000);
    this.cameras.main.setBounds(0, 0, mvMap.pxWidth, mvMap.pxHeight);
    this.cameras.main.setBackgroundColor('#0b0b12');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.cfg.onMoveTo({ x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE) });
    });

    // Walk frame cadence (manual stepping across all player sprites).
    this.time.addEvent({ delay: 150, loop: true, callback: () => (this.walkIdx = (this.walkIdx + 1) % WALK_CYCLE.length) });
  }

  // ── Player lifecycle ────────────────────────────────────────────────────────

  upsertPlayer(s: { userId: string; username: string; x: number; y: number; dir?: string; avatar?: string }) {
    let p = this.players.get(s.userId);
    const texKey = sheetFor(s.avatar);
    if (!p) {
      const sprite = this.add.sprite(0, 0, texKey, frameAt('down', 1)).setOrigin(0.5, 0.95);
      sprite.setDisplaySize((DISPLAY_H * CHAR_W) / CHAR_H, DISPLAY_H);
      const label = this.add
        .text(0, -66, s.username, { fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 4 })
        .setOrigin(0.5);
      const container = this.add.container(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, [sprite, label]);
      container.setDepth(10);
      p = { container, sprite, label, texKey, tx: s.x, ty: s.y, dir: 'down', moving: false };
      this.players.set(s.userId, p);
      if (s.userId === this.cfg.selfId) this.cameras.main.startFollow(container, true, 0.15, 0.15);
    } else if (texKey !== p.texKey) {
      p.texKey = texKey;
      p.sprite.setTexture(texKey, frameAt(p.dir, 1));
    }
    p.tx = s.x;
    p.ty = s.y;
    if (s.dir) p.dir = s.dir as Dir;
  }

  movePlayer(s: { userId: string; x: number; y: number; dir: string; moving: boolean }) {
    const p = this.players.get(s.userId);
    if (!p) {
      this.upsertPlayer({ userId: s.userId, username: '…', x: s.x, y: s.y, dir: s.dir });
      return;
    }
    p.tx = s.x;
    p.ty = s.y;
    p.dir = s.dir as Dir;
    p.moving = s.moving;
  }

  removePlayer(userId: string) {
    const p = this.players.get(userId);
    if (!p) return;
    p.bubble?.destroy();
    p.container.destroy();
    this.players.delete(userId);
  }

  showBubble(userId: string, body: string) {
    const p = this.players.get(userId);
    if (!p) return;
    p.bubble?.destroy();
    const text = this.add
      .text(0, 0, body, { fontSize: '12px', color: '#111', backgroundColor: '#fff', padding: { x: 6, y: 4 }, wordWrap: { width: 160 } })
      .setOrigin(0.5, 1);
    const bubble = this.add.container(0, -80, [text]);
    p.container.add(bubble);
    p.bubble = bubble;
    p.bubbleTimer = this.time.now + 5000;
  }

  update(_time: number, delta: number) {
    const lerp = Math.min(1, (delta / 1000) * 12);
    for (const p of this.players.values()) {
      const targetX = p.tx * TILE + TILE / 2;
      const targetY = p.ty * TILE + TILE / 2;
      p.container.x += (targetX - p.container.x) * lerp;
      p.container.y += (targetY - p.container.y) * lerp;
      p.container.setDepth(10 + p.container.y / 1000);
      const col = p.moving ? WALK_CYCLE[this.walkIdx] : 1;
      p.sprite.setFrame(frameAt(p.dir, col));

      if (p.bubble && p.bubbleTimer && this.time.now > p.bubbleTimer) {
        p.bubble.destroy();
        p.bubble = undefined;
      }
    }
    this.checkNearby();
  }

  private checkNearby() {
    const me = this.players.get(this.cfg.selfId);
    if (!me) return;
    const mx = Math.round((me.container.x - TILE / 2) / TILE);
    const my = Math.round((me.container.y - TILE / 2) / TILE);

    let near: Interactable | null = null;
    for (const o of this.cfg.interactables) {
      if (Math.abs(o.x - mx) <= 1 && Math.abs(o.y - my) <= 1) {
        near = o;
        break;
      }
    }
    const id = near?.id ?? null;
    if (id !== this.lastNearId) {
      this.lastNearId = id;
      this.cfg.onNear(near);
    }

    let zone: Zone | null = null;
    for (const z of this.cfg.zones) {
      if (z.rects.some(([x0, y0, x1, y1]) => mx >= x0 && mx <= x1 && my >= y0 && my <= y1)) {
        zone = z;
        break;
      }
    }
    const zid = zone?.id ?? null;
    if (zid !== this.lastZoneId) {
      this.lastZoneId = zid;
      this.cfg.onZone(zone);
    }
  }
}
