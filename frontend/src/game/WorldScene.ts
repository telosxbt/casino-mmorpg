import Phaser from 'phaser';
import type { MvMap } from '../lib/mvMap';
import type { Interactable, Zone } from '../store';

const TILE = 48;

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
  tx: number; // target tile x (fractional)
  ty: number;
  dir: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
}

// MV character sheet: 12 cols x 8 rows; each character = 3 cols x 4 rows.
// Direction rows within a block: down, left, right, up. Middle col = idle.
function frameFor(charIndex: number, dir: PlayerObj['dir'], walk: number): number {
  const blockCol = (charIndex % 4) * 3;
  const blockRow = Math.floor(charIndex / 4) * 4;
  const dirRow = { down: 0, left: 1, right: 2, up: 3 }[dir];
  return (blockRow + dirRow) * 12 + (blockCol + walk);
}

/**
 * Renders the casino: baked MV map (under + over layers), other players, and
 * the local player. Movement is server-authoritative — we only lerp sprites
 * toward the positions the server broadcasts and forward click targets.
 */
export class WorldScene extends Phaser.Scene {
  private cfg!: WorldSceneData;
  private players = new Map<string, PlayerObj>();
  private lastNearId: string | null = null;
  private lastZoneId: string | null = null;

  constructor() {
    super('World');
  }

  init(data: WorldSceneData) {
    this.cfg = data;
  }

  preload() {
    this.load.spritesheet('chars', this.cfg.charUrl, { frameWidth: TILE, frameHeight: TILE });
  }

  create() {
    const { mvMap, interactables } = this.cfg;
    this.textures.addCanvas('mapBase', mvMap.base);
    this.textures.addCanvas('mapOver', mvMap.over);
    this.add.image(0, 0, 'mapBase').setOrigin(0).setDepth(0);

    // Interactable markers + labels.
    for (const o of interactables) {
      const px = o.x * TILE + TILE / 2;
      const py = o.y * TILE + TILE / 2;
      const color = o.type === 'ROULETTE' ? 0xe04b4b : o.type === 'BLACKJACK' ? 0x4be07a : 0xe0c84b;
      this.add.circle(px, py, 10, color, 0.85).setDepth(1);
      this.add
        .text(px, py - 22, o.label, { fontSize: '11px', color: '#fff', backgroundColor: '#0008' })
        .setOrigin(0.5)
        .setDepth(1);
    }

    // Interaction zones: subtle tint + label over each gaming area.
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

    // Over-layer (tall furniture) drawn above players.
    this.add.image(0, 0, 'mapOver').setOrigin(0).setDepth(1000);

    this.cameras.main.setBounds(0, 0, mvMap.pxWidth, mvMap.pxHeight);
    this.cameras.main.setBackgroundColor('#0b0b12');

    // Click-to-move: translate world point → tile, ask the server to move.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const tx = Math.floor(wp.x / TILE);
      const ty = Math.floor(wp.y / TILE);
      this.cfg.onMoveTo({ x: tx, y: ty });
    });

    // Walk animation cadence.
    this.time.addEvent({ delay: 180, loop: true, callback: () => this.stepWalkFrames() });
  }

  private walkPhase = 0;
  private stepWalkFrames() {
    this.walkPhase = this.walkPhase === 0 ? 2 : 0;
    for (const p of this.players.values()) {
      const walk = p.moving ? this.walkPhase : 1;
      p.sprite.setFrame(frameFor(this.avatarIndex(p), p.dir, walk));
    }
  }

  private avatarIndex(_p: PlayerObj): number {
    return 0; // single Actor1 sheet; block 0 for everyone (cosmetic)
  }

  // ── Player lifecycle (called by GameClient from socket events) ──────────────

  upsertPlayer(s: { userId: string; username: string; x: number; y: number; dir?: string; avatar?: string }) {
    let p = this.players.get(s.userId);
    if (!p) {
      const sprite = this.add.sprite(0, 0, 'chars', frameFor(0, 'down', 1)).setOrigin(0.5, 0.8);
      const label = this.add
        .text(0, -34, s.username, { fontSize: '11px', color: '#fff', stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5);
      const container = this.add.container(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, [sprite, label]);
      container.setDepth(10);
      p = { container, sprite, label, tx: s.x, ty: s.y, dir: 'down', moving: false };
      this.players.set(s.userId, p);
      if (s.userId === this.cfg.selfId) this.cameras.main.startFollow(container, true, 0.15, 0.15);
    }
    p.tx = s.x;
    p.ty = s.y;
    if (s.dir) p.dir = s.dir as PlayerObj['dir'];
  }

  movePlayer(s: { userId: string; x: number; y: number; dir: string; moving: boolean }) {
    const p = this.players.get(s.userId);
    if (!p) {
      this.upsertPlayer({ userId: s.userId, username: '…', x: s.x, y: s.y, dir: s.dir });
      return;
    }
    p.tx = s.x;
    p.ty = s.y;
    p.dir = s.dir as PlayerObj['dir'];
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
      .text(0, 0, body, {
        fontSize: '12px',
        color: '#111',
        backgroundColor: '#fff',
        padding: { x: 6, y: 4 },
        wordWrap: { width: 160 },
      })
      .setOrigin(0.5, 1);
    const bubble = this.add.container(0, -44, [text]);
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
      if (p.bubble && p.bubbleTimer && this.time.now > p.bubbleTimer) {
        p.bubble.destroy();
        p.bubble = undefined;
      }
    }
    this.checkNearby();
  }

  /** Report the slot machine (if any) and the gaming zone the player is in. */
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
