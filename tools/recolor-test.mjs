// Feasibility test: segment the character sheet into skin / hair / suit regions
// by colour heuristics, then recolour each while preserving shading (multiply by
// luminance). Outputs a side-by-side preview so we can judge quality.
import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';

const img = await loadImage('frontend/public/assets/characters/male.png');
const W = img.width, H = img.height;

function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), lum = 0.3*r+0.59*g+0.11*b;
  const warm = r >= g && g >= b;
  // gold trim: bright yellow -> leave as accent
  if (r > 150 && g > 120 && b < 110 && r - b > 70) return 'gold';
  // white shirt: bright low-chroma -> leave
  if (lum > 175 && mx - mn < 45) return 'shirt';
  // skin: warm, mid-bright, clear r>b gap
  if (warm && r > 120 && r - b > 35 && lum > 95) return 'skin';
  // hair: warm but darker/mid
  if (warm && r - b > 12 && lum >= 45 && lum < 130) return 'hair';
  // suit: dark, low chroma
  if (lum < 95 && mx - mn < 60) return 'suit';
  return 'other';
}

// target colours
const SUIT = [40, 80, 200];   // royal blue
const HAIR = [225, 195, 90];  // blonde
const SKIN = [150, 95, 60];   // deeper skin

function recolor(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;
    const r = data[i], g = data[i+1], b = data[i+2];
    const cls = classify(r, g, b);
    const lum = (0.3*r + 0.59*g + 0.11*b) / 255;
    let t = null;
    if (cls === 'suit') t = SUIT; else if (cls === 'hair') t = HAIR; else if (cls === 'skin') t = SKIN;
    if (t) {
      const k = Math.min(1.6, 0.5 + lum); // keep shading
      data[i]   = Math.min(255, t[0] * k);
      data[i+1] = Math.min(255, t[1] * k);
      data[i+2] = Math.min(255, t[2] * k);
    }
  }
}

// preview: original (top) vs recoloured (bottom), first two rows only
const rows = 2, cw = Math.round(W/3), ch = Math.round(H/4);
const out = createCanvas(W, ch*rows*2);
const ctx = out.getContext('2d');
ctx.drawImage(img, 0, 0, W, ch*rows, 0, 0, W, ch*rows);
const work = createCanvas(W, ch*rows); const wctx = work.getContext('2d');
wctx.drawImage(img, 0, 0, W, ch*rows, 0, 0, W, ch*rows);
const id = wctx.getImageData(0,0,W,ch*rows); recolor(id.data); wctx.putImageData(id,0,0);
ctx.drawImage(work, 0, ch*rows);
writeFileSync('tools/_recolor.png', out.toBuffer('image/png'));
console.log('wrote tools/_recolor.png');
