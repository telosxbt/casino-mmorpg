// Cosmetic recolor presets + the pixel segmentation used to repaint character
// sheets at load time. Region colours are derived from each pixel's luminance
// (shading preserved). Keys MUST match the backend's allowed lists.

type RGB = [number, number, number];

export const SKIN: Record<string, RGB | null> = {
  default: null,
  light: [238, 194, 158],
  tan: [214, 158, 118],
  brown: [156, 102, 66],
  dark: [105, 66, 44],
  pale: [247, 221, 194],
};
export const HAIR: Record<string, RGB | null> = {
  default: null,
  black: [34, 32, 38],
  blonde: [226, 196, 96],
  red: [158, 64, 42],
  gray: [178, 178, 184],
  white: [236, 236, 238],
  blue: [64, 96, 200],
  pink: [226, 120, 182],
};
export const SUIT: Record<string, RGB | null> = {
  default: null,
  blue: [44, 84, 200],
  red: [156, 36, 46],
  green: [34, 120, 72],
  purple: [112, 52, 162],
  white: [228, 228, 234],
  gold: [200, 160, 52],
  teal: [32, 150, 160],
  burgundy: [112, 30, 52],
  navy: [26, 42, 92],
};

// Swatch colours for the picker (default shown with a representative tone).
export const SWATCH: Record<string, RGB> = {
  ...(Object.fromEntries(Object.entries(SKIN).map(([k, v]) => [`skin:${k}`, v ?? [205, 150, 110]])) as any),
  ...(Object.fromEntries(Object.entries(HAIR).map(([k, v]) => [`hair:${k}`, v ?? [90, 60, 38]])) as any),
  ...(Object.fromEntries(Object.entries(SUIT).map(([k, v]) => [`suit:${k}`, v ?? [40, 40, 46]])) as any),
};

export interface Look {
  skin: string;
  hair: string;
  suit: string;
}

export type Region = 'skin' | 'hair' | 'suit' | null;

/** Classify a pixel into a recolourable region (or null = leave untouched). */
export function classify(r: number, g: number, b: number): Region {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const warm = r >= g && g >= b;
  // gold trim -> accent, leave
  if (r > 150 && g > 120 && b < 110 && r - b > 70) return null;
  // saturated red dress / red suit
  if (r > 120 && r - g > 50 && r - b > 60) return 'suit';
  // bright low-chroma -> white shirt, leave
  if (lum > 175 && mx - mn < 45) return null;
  if (warm && r > 120 && r - b > 35 && lum > 95) return 'skin';
  if (warm && r - b > 12 && lum >= 45 && lum < 130) return 'hair';
  if (lum < 95 && mx - mn < 60) return 'suit';
  return null;
}

/** Repaint a character sheet for the given look; returns a fresh canvas. */
export function recolorSheet(src: CanvasImageSource & { width: number; height: number }, look: Look): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const want: Record<Exclude<Region, null>, RGB | null> = {
    skin: SKIN[look.skin] ?? null,
    hair: HAIR[look.hair] ?? null,
    suit: SUIT[look.suit] ?? null,
  };
  if (!want.skin && !want.hair && !want.suit) return cv; // all default, no work

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const region = classify(r, g, b);
    if (!region) continue;
    const t = want[region];
    if (!t) continue;
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const k = Math.min(1.6, 0.5 + lum);
    d[i] = Math.min(255, t[0] * k);
    d[i + 1] = Math.min(255, t[1] * k);
    d[i + 2] = Math.min(255, t[2] * k);
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

export const lookKey = (sheet: string, l: Look) => `${sheet}:${l.skin}:${l.hair}:${l.suit}`;
