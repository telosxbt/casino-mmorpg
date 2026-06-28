// Derives a shared casino map descriptor from the RPG Maker MV data:
//   - collision grid (server anti-cheat + client pathing) from MV passage flags
//   - interactable anchors (roulette/blackjack tables, slot machines)
//   - spawn point
// Output is consumed by BOTH backend (movement validation) and frontend
// (render + click-to-move). The raw MV map + tilesets are copied to the
// frontend so the in-browser MV renderer (lib/mvMap.ts) can draw them 1:1.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const mvData = resolve(root, 'casinoluxury/examples/data');
const mvImg = resolve(root, 'casinoluxury/examples/img');

const map = JSON.parse(readFileSync(resolve(mvData, 'Map001.json'), 'utf8'));
const tilesets = JSON.parse(readFileSync(resolve(mvData, 'Tilesets.json'), 'utf8'));
const flags = tilesets[map.tilesetId].flags;
const { width, height, data } = map;

const read = (x, y, z) => data[(z * height + y) * width + x] || 0;

// MV passability: scan layers top→bottom; first non-star, visible tile decides.
// A tile is blocked when all four direction bits are set (flag & 0x0f === 0x0f).
const collision = new Array(width * height).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let blocked = 0;
    for (let z = 3; z >= 0; z--) {
      const tile = read(x, y, z);
      if (!tile) continue;
      const f = flags[tile] || 0;
      if (f & 0x10) continue; // star: passable, drawn above the player
      blocked = (f & 0x0f) === 0x0f ? 1 : 0;
      break;
    }
    collision[y * width + x] = blocked;
  }
}

const passable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && !collision[y * width + x];

// Interactable anchors: the tile the player stands ON to use the object. Placed
// in front of the real casino furniture in the MV map (verified against the
// baked render + collision grid): slots line the left hall, blackjack tables sit
// in the central pit, roulette wheels fill the right-hand gaming hall.
const interactables = [
  // Roulette — right-hand gaming hall (wheel tables).
  { id: 'roulette-1', type: 'ROULETTE', label: 'Roulette I', x: 50, y: 13 },
  { id: 'roulette-2', type: 'ROULETTE', label: 'Roulette II', x: 54, y: 13 },
  { id: 'roulette-3', type: 'ROULETTE', label: 'Roulette III', x: 50, y: 16 },
  // Blackjack — central pit (green card tables).
  { id: 'blackjack-1', type: 'BLACKJACK', label: 'Blackjack I', x: 19, y: 13 },
  { id: 'blackjack-2', type: 'BLACKJACK', label: 'Blackjack II', x: 34, y: 13 },
  // Slots — left hall, standing in front of each machine row.
  { id: 'slot-1', type: 'SLOTS', label: 'Lucky 7s', x: 4, y: 7 },
  { id: 'slot-2', type: 'SLOTS', label: 'Mega Fruit', x: 10, y: 7 },
  { id: 'slot-3', type: 'SLOTS', label: 'Gold Rush', x: 4, y: 10 },
  { id: 'slot-4', type: 'SLOTS', label: 'Diamond Spin', x: 10, y: 10 },
  { id: 'slot-5', type: 'SLOTS', label: 'Neon Nights', x: 4, y: 13 },
  { id: 'slot-6', type: 'SLOTS', label: 'Cosmic Cash', x: 10, y: 13 },
];

// Find a guaranteed-passable spawn near the map centre.
let spawn = null;
outer: for (let r = 0; r < Math.max(width, height); r++) {
  for (let y = Math.floor(height / 2) - r; y <= Math.floor(height / 2) + r; y++) {
    for (let x = Math.floor(width / 2) - r; x <= Math.floor(width / 2) + r; x++) {
      if (passable(x, y)) { spawn = { x, y }; break outer; }
    }
  }
}

// Snap any anchor sitting on a blocked tile to the nearest walkable one (BFS).
const snap = (sx, sy) => {
  if (passable(sx, sy)) return { x: sx, y: sy };
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (seen.has(k) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (passable(nx, ny)) return { x: nx, y: ny };
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return { x: sx, y: sy };
};
for (const o of interactables) {
  const s = snap(o.x, o.y);
  o.x = s.x;
  o.y = s.y;
}
const warnings = interactables.filter((o) => !passable(o.x, o.y)).map((o) => o.id);

const out = {
  tileWidth: 48,
  tileHeight: 48,
  width,
  height,
  spawn,
  collision,
  interactables,
  // Asset paths (served from frontend/public) for the in-browser MV renderer.
  assets: {
    mapData: '/assets/map/Map001.json',
    tilesets: '/assets/map/Tilesets.json',
    tilesetImages: {
      0: '/assets/tilesets/Luxury_Casino_A1.png',
      1: '/assets/tilesets/Luxury_Casino_A2.png',
      3: '/assets/tilesets/Luxury_Casino_A4.png',
      5: '/assets/tilesets/Luxury_Casino_B.png',
      6: '/assets/tilesets/Luxury_Casino_C.png',
    },
    characters: '/assets/characters/Actor1.png',
  },
};

// Backend copy (movement validation) — strip the heavy asset refs it doesn't need.
writeFileSync(
  resolve(root, 'backend/src/world/data/casino-map.json'),
  JSON.stringify({ tileWidth: 48, tileHeight: 48, width, height, spawn, collision, interactables }, null, 0),
);
// Frontend copy (full, incl. asset paths).
writeFileSync(resolve(root, 'frontend/public/assets/map/casino.json'), JSON.stringify(out));
// Raw MV files for the renderer.
copyFileSync(resolve(mvData, 'Map001.json'), resolve(root, 'frontend/public/assets/map/Map001.json'));
copyFileSync(resolve(mvData, 'Tilesets.json'), resolve(root, 'frontend/public/assets/map/Tilesets.json'));
for (const f of ['Luxury_Casino_A1', 'Luxury_Casino_A2', 'Luxury_Casino_A4', 'Luxury_Casino_B', 'Luxury_Casino_C'])
  copyFileSync(resolve(mvImg, `tilesets/${f}.png`), resolve(root, `frontend/public/assets/tilesets/${f}.png`));
copyFileSync(resolve(mvImg, 'characters/Actor1.png'), resolve(root, 'frontend/public/assets/characters/Actor1.png'));

const blocked = collision.reduce((a, b) => a + b, 0);
console.log(`map ${width}x${height} | blocked ${blocked}/${width * height} | spawn ${JSON.stringify(spawn)} | bad anchors: ${warnings.join(',') || 'none'}`);
