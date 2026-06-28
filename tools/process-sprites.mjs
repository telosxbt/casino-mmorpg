// Convert the provided character JPGs (checkerboard background baked in) into
// transparent PNG spritesheets. We flood-fill from the borders and clear only
// background-connected light/gray checkerboard pixels, so interior whites
// (shirt, dress trim) are preserved. Output: frontend/public/assets/characters.
import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const SRC = [
  ['male', '/home/ubuntu/.openclaw/workspace/.openclaw-cli-images/ecfe6c498585275cfe9b3c1a8671eebc8f2febb2ce81d83be023fb725f8617d9.jpg'],
  ['female', '/home/ubuntu/.openclaw/workspace/.openclaw-cli-images/71c3c4e1e4d125771159b23023178371a0a5b7669b3416c65a90b6f41ea67ee2.jpg'],
];

// Is this pixel part of the checkerboard? Light and near-gray (low saturation).
function isBg(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn > 140 && mx - mn < 28; // light + low chroma => white/gray squares
}

for (const [name, path] of SRC) {
  const img = await loadImage(path);
  // Pad to an exact 3-col x 4-row cell grid so Phaser slices cleanly.
  const W = Math.ceil(img.width / 3) * 3;
  const H = Math.ceil(img.height / 4) * 4;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const at = (x, y) => (y * W + x) * 4;
  const seen = new Uint8Array(W * H);
  const stack = [];
  // seed from every border pixel
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
    d[i + 3] = 0; // transparent
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(id, 0, 0);
  writeFileSync(resolve(root, `frontend/public/assets/characters/${name}.png`), cv.toBuffer('image/png'));
  console.log(`${name}: ${W}x${H} -> frame ${Math.round(W / 3)}x${Math.round(H / 4)}`);
}
