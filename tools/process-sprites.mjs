// Convert the provided character JPGs (checkerboard background baked in) into
// clean, transparent, ALIGNMENT-LOCKED PNG spritesheets.
//
//  1. flood-fill the checkerboard background to transparent (edge-connected
//     only, so interior whites like the shirt survive)
//  2. slice the 3x4 grid, find the union bounding box of all 12 frames, and
//     re-emit every frame cropped to that SAME window — so the body stays fixed
//     and only the legs animate (kills the walk jitter), with margins trimmed so
//     the sprite isn't oversized and the head isn't clipped.
import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const COLS = 3, ROWS = 4;

const SRC = [
  ['male', '/home/ubuntu/.openclaw/workspace/.openclaw-cli-images/ecfe6c498585275cfe9b3c1a8671eebc8f2febb2ce81d83be023fb725f8617d9.jpg'],
  ['female', '/home/ubuntu/.openclaw/workspace/.openclaw-cli-images/71c3c4e1e4d125771159b23023178371a0a5b7669b3416c65a90b6f41ea67ee2.jpg'],
];

const isBg = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn > 140 && mx - mn < 28;
};

// Phase 1: background removal -> store transparent canvases + grid dims.
const sheets = [];
for (const [name, path] of SRC) {
  const img = await loadImage(path);
  const W = Math.ceil(img.width / COLS) * COLS;
  const H = Math.ceil(img.height / ROWS) * ROWS;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const at = (x, y) => (y * W + x) * 4;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push([x, 0]); stack.push([x, H - 1]); }
  for (let y = 0; y < H; y++) { stack.push([0, y]); stack.push([W - 1, y]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (seen[p]) continue;
    const i = at(x, y);
    if (!isBg(d[i], d[i + 1], d[i + 2])) continue;
    seen[p] = 1;
    d[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(id, 0, 0);
  sheets.push({ name, cv, ctx, W, H, cw: W / COLS, ch: H / ROWS });
}

// Phase 2: per-sheet union bbox of content within a cell (relative coords).
function unionBox(s) {
  let x0 = s.cw, y0 = s.ch, x1 = 0, y1 = 0;
  const id = s.ctx.getImageData(0, 0, s.W, s.H).data;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (let yy = 0; yy < s.ch; yy++) {
        for (let xx = 0; xx < s.cw; xx++) {
          const px = c * s.cw + xx, py = r * s.ch + yy;
          if (id[(py * s.W + px) * 4 + 3] > 16) {
            if (xx < x0) x0 = xx; if (yy < y0) y0 = yy;
            if (xx > x1) x1 = xx; if (yy > y1) y1 = yy;
          }
        }
      }
    }
  }
  return { x0, y0, x1, y1 };
}

const boxes = sheets.map(unionBox);
// Common window across both sheets (+small padding), centred horizontally.
const pad = 6;
const gx0 = Math.max(0, Math.min(...boxes.map((b) => b.x0)) - pad);
const gy0 = Math.max(0, Math.min(...boxes.map((b) => b.y0)) - pad);
const gx1 = Math.max(...boxes.map((b) => b.x1)) + pad;
const gy1 = Math.max(...boxes.map((b) => b.y1)) + pad;
const cellW = gx1 - gx0 + 1;
const cellH = gy1 - gy0 + 1;

// Phase 3: re-emit each sheet with the aligned, tight cells.
for (const s of sheets) {
  const out = createCanvas(cellW * COLS, cellH * ROWS);
  const octx = out.getContext('2d');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      octx.drawImage(
        s.cv,
        c * s.cw + gx0, r * s.ch + gy0, cellW, cellH,
        c * cellW, r * cellH, cellW, cellH,
      );
    }
  }
  writeFileSync(resolve(root, `frontend/public/assets/characters/${s.name}.png`), out.toBuffer('image/png'));
}
console.log(`frame ${cellW}x${cellH} (sheet ${cellW * COLS}x${cellH * ROWS})`);
