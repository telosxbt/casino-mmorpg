// In-browser RPG Maker MV tilemap renderer. Ported from the MV runtime's
// Tilemap drawing logic (casinoluxury/examples/js/rpg_core.js) so the casino
// map renders 1:1 with the source project — including A1–A4 autotiles and
// B/C object tiles — without shipping the MV engine.
//
// Produces two baked canvases: `base` (drawn under players) and `over`
// (star/▲ tiles, drawn above players for correct depth).

const TILE = 48;
const TILE_ID_A5 = 1536;
const TILE_ID_A1 = 2048;
const TILE_ID_A2 = 2816;
const TILE_ID_A3 = 4352;
const TILE_ID_A4 = 5888;
const TILE_ID_MAX = 8192;

const isVisible = (id: number) => id > 0 && id < TILE_ID_MAX;
const isAutotile = (id: number) => id >= TILE_ID_A1;
const getKind = (id: number) => Math.floor((id - TILE_ID_A1) / 48);
const getShape = (id: number) => (id - TILE_ID_A1) % 48;
const isA1 = (id: number) => id >= TILE_ID_A1 && id < TILE_ID_A2;
const isA2 = (id: number) => id >= TILE_ID_A2 && id < TILE_ID_A3;
const isA3 = (id: number) => id >= TILE_ID_A3 && id < TILE_ID_A4;
const isA4 = (id: number) => id >= TILE_ID_A4 && id < TILE_ID_MAX;
const isA5 = (id: number) => id >= TILE_ID_A5 && id < TILE_ID_A1;

// Autotile assembly tables (lifted verbatim from rpg_core.js).
const FLOOR: number[][][] = [
  [[2,4],[1,4],[2,3],[1,3]],[[2,0],[1,4],[2,3],[1,3]],[[2,4],[3,0],[2,3],[1,3]],[[2,0],[3,0],[2,3],[1,3]],
  [[2,4],[1,4],[2,3],[3,1]],[[2,0],[1,4],[2,3],[3,1]],[[2,4],[3,0],[2,3],[3,1]],[[2,0],[3,0],[2,3],[3,1]],
  [[2,4],[1,4],[2,1],[1,3]],[[2,0],[1,4],[2,1],[1,3]],[[2,4],[3,0],[2,1],[1,3]],[[2,0],[3,0],[2,1],[1,3]],
  [[2,4],[1,4],[2,1],[3,1]],[[2,0],[1,4],[2,1],[3,1]],[[2,4],[3,0],[2,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],
  [[0,4],[1,4],[0,3],[1,3]],[[0,4],[3,0],[0,3],[1,3]],[[0,4],[1,4],[0,3],[3,1]],[[0,4],[3,0],[0,3],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[2,2],[1,2],[2,3],[3,1]],[[2,2],[1,2],[2,1],[1,3]],[[2,2],[1,2],[2,1],[3,1]],
  [[2,4],[3,4],[2,3],[3,3]],[[2,4],[3,4],[2,1],[3,3]],[[2,0],[3,4],[2,3],[3,3]],[[2,0],[3,4],[2,1],[3,3]],
  [[2,4],[1,4],[2,5],[1,5]],[[2,0],[1,4],[2,5],[1,5]],[[2,4],[3,0],[2,5],[1,5]],[[2,0],[3,0],[2,5],[1,5]],
  [[0,4],[3,4],[0,3],[3,3]],[[2,2],[1,2],[2,5],[1,5]],[[0,2],[1,2],[0,3],[1,3]],[[0,2],[1,2],[0,3],[3,1]],
  [[2,2],[3,2],[2,3],[3,3]],[[2,2],[3,2],[2,1],[3,3]],[[2,4],[3,4],[2,5],[3,5]],[[2,0],[3,4],[2,5],[3,5]],
  [[0,4],[1,4],[0,5],[1,5]],[[0,4],[3,0],[0,5],[1,5]],[[0,2],[3,2],[0,3],[3,3]],[[0,2],[1,2],[0,5],[1,5]],
  [[0,4],[3,4],[0,5],[3,5]],[[2,2],[3,2],[2,5],[3,5]],[[0,2],[3,2],[0,5],[3,5]],[[0,0],[1,0],[0,1],[1,1]],
];
const WALL: number[][][] = [
  [[2,2],[1,2],[2,1],[1,1]],[[0,2],[1,2],[0,1],[1,1]],[[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],
  [[2,2],[3,2],[2,1],[3,1]],[[0,2],[3,2],[0,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[0,2],[1,2],[0,3],[1,3]],[[2,0],[1,0],[2,3],[1,3]],[[0,0],[1,0],[0,3],[1,3]],
  [[2,2],[3,2],[2,3],[3,3]],[[0,2],[3,2],[0,3],[3,3]],[[2,0],[3,0],[2,3],[3,3]],[[0,0],[3,0],[0,3],[3,3]],
];
const WATERFALL: number[][][] = [
  [[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
];

export interface MvMap {
  base: HTMLCanvasElement;
  over: HTMLCanvasElement;
  width: number;
  height: number;
  pxWidth: number;
  pxHeight: number;
}

interface MapJson {
  width: number;
  height: number;
  data: number[];
  tilesetId: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Render the MV map to baked canvases. */
export async function renderMvMap(
  mapUrl: string,
  tilesetsUrl: string,
  imageUrls: Record<number, string>,
): Promise<MvMap> {
  const [map, tilesets] = await Promise.all([
    fetch(mapUrl).then((r) => r.json() as Promise<MapJson>),
    fetch(tilesetsUrl).then((r) => r.json()),
  ]);
  const flags: number[] = tilesets[map.tilesetId].flags;

  // bitmaps[setNumber]: 0=A1 1=A2 2=A3 3=A4 4=A5 5=B 6=C 7=D 8=E
  const bitmaps: (HTMLImageElement | null)[] = new Array(9).fill(null);
  await Promise.all(
    Object.entries(imageUrls).map(async ([k, url]) => {
      bitmaps[Number(k)] = await loadImage(url);
    }),
  );

  const { width, height, data } = map;
  const mk = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const base = mk(width * TILE, height * TILE);
  const over = mk(width * TILE, height * TILE);
  const baseCtx = base.getContext('2d')!;
  const overCtx = over.getContext('2d')!;
  baseCtx.imageSmoothingEnabled = false;
  overCtx.imageSmoothingEnabled = false;

  const read = (x: number, y: number, z: number) => data[(z * height + y) * width + x] || 0;

  const drawNormal = (ctx: CanvasRenderingContext2D, tileId: number, dx: number, dy: number) => {
    const setNumber = isA5(tileId) ? 4 : 5 + Math.floor(tileId / 256);
    const src = bitmaps[setNumber];
    if (!src) return;
    const sx = ((Math.floor(tileId / 128) % 2) * 8 + (tileId % 8)) * TILE;
    const sy = (Math.floor((tileId % 256) / 8) % 16) * TILE;
    ctx.drawImage(src, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
  };

  const drawAutotile = (ctx: CanvasRenderingContext2D, tileId: number, dx: number, dy: number) => {
    let table = FLOOR;
    const kind = getKind(tileId);
    const shape = getShape(tileId);
    const tx = kind % 8;
    const ty = Math.floor(kind / 8);
    let bx = 0;
    let by = 0;
    let setNumber = 0;
    let isTable = false;

    if (isA1(tileId)) {
      setNumber = 0;
      if (kind === 0) { bx = 0; by = 0; }
      else if (kind === 1) { bx = 0; by = 3; }
      else if (kind === 2) { bx = 6; by = 0; }
      else if (kind === 3) { bx = 6; by = 3; }
      else {
        bx = Math.floor(tx / 4) * 8;
        by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
        if (kind % 2 !== 0) { bx += 6; table = WATERFALL; }
      }
    } else if (isA2(tileId)) {
      setNumber = 1;
      bx = tx * 2;
      by = (ty - 2) * 3;
      isTable = !!(flags[tileId] & 0x80);
    } else if (isA3(tileId)) {
      setNumber = 2;
      bx = tx * 2;
      by = (ty - 6) * 2;
      table = WALL;
    } else if (isA4(tileId)) {
      setNumber = 3;
      bx = tx * 2;
      by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
      if (ty % 2 === 1) table = WALL;
    }

    const t = table[shape];
    const src = bitmaps[setNumber];
    if (!t || !src) return;
    const w1 = TILE / 2;
    const h1 = TILE / 2;
    for (let i = 0; i < 4; i++) {
      const qsx = t[i][0];
      const qsy = t[i][1];
      const sx1 = (bx * 2 + qsx) * w1;
      const sy1 = (by * 2 + qsy) * h1;
      const dx1 = dx + (i % 2) * w1;
      let dy1 = dy + Math.floor(i / 2) * h1;
      if (isTable && (qsy === 1 || qsy === 5)) {
        const qsx2 = qsy === 1 ? [0, 3, 2, 1][qsx] : qsx;
        const sx2 = (bx * 2 + qsx2) * w1;
        const sy2 = (by * 2 + 3) * h1;
        ctx.drawImage(src, sx2, sy2, w1, h1, dx1, dy1, w1, h1);
        dy1 += h1 / 2;
        ctx.drawImage(src, sx1, sy1, w1, h1 / 2, dx1, dy1, w1, h1 / 2);
      } else {
        ctx.drawImage(src, sx1, sy1, w1, h1, dx1, dy1, w1, h1);
      }
    }
  };

  const drawTile = (ctx: CanvasRenderingContext2D, tileId: number, dx: number, dy: number) => {
    if (!isVisible(tileId)) return;
    if (isAutotile(tileId)) drawAutotile(ctx, tileId, dx, dy);
    else drawNormal(ctx, tileId, dx, dy);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x * TILE;
      const dy = y * TILE;
      for (let z = 0; z < 4; z++) {
        const tileId = read(x, y, z);
        if (!isVisible(tileId)) continue;
        // Star tiles (▲ passage) render above the player.
        const ctx = flags[tileId] & 0x10 ? overCtx : baseCtx;
        drawTile(ctx, tileId, dx, dy);
      }
    }
  }

  return { base, over, width, height, pxWidth: width * TILE, pxHeight: height * TILE };
}
