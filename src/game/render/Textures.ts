import {
  CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture, DataTexture, RGBAFormat,
  LinearFilter, LinearMipmapLinearFilter,
} from 'three';
import { fbm2, hash2, clamp01 } from '../core/Noise';

/** All textures in Winds of Eternity are generated procedurally at runtime —
 *  no external image assets, no licensing concerns, instant loading. */

function cnv(size: number, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! };
}

function tex(canvas: HTMLCanvasElement, repeat = 1, srgb = true): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function px(ctx: CanvasRenderingContext2D, size: number, fn: (x: number, y: number) => [number, number, number]) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b] = fn(x, y);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map<string, Texture>();

function cached(key: string, make: () => Texture): Texture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

/* ------------------------------------------------------------------ ground */

export function grassTexture() {
  return cached('grass', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.09, y * 0.09, 4) * 0.5 + 0.5;
      const n2 = fbm2(x * 0.4 + 30, y * 0.4 - 12, 3) * 0.5 + 0.5;
      const blade = Math.sin(x * 1.7 + n2 * 9) * 0.5 + 0.5;
      const g = 0.30 + n * 0.30 + blade * 0.14;
      return [
        clamp01(0.16 + n * 0.20 + blade * 0.06) * 255,
        clamp01(g * 0.92) * 255,
        clamp01(0.12 + n2 * 0.16) * 255,
      ];
    });
    return tex(c, 1);
  });
}

export function dirtTexture() {
  return cached('dirt', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.07, y * 0.07, 4) * 0.5 + 0.5;
      const n2 = fbm2(x * 0.33, y * 0.33, 3) * 0.5 + 0.5;
      const v = 0.34 + n * 0.34 + n2 * 0.16;
      return [v * 0.86 * 255, v * 0.70 * 255, v * 0.52 * 255];
    });
    return tex(c, 1);
  });
}

export function rockTexture() {
  return cached('rock', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.05, y * 0.05, 5) * 0.5 + 0.5;
      const crack = 1 - Math.abs(fbm2(x * 0.02 + 8, y * 0.02 - 3, 3));
      const v = 0.34 + n * 0.32 - crack * 0.10;
      return [v * 0.98 * 255, v * 0.96 * 255, v * 0.94 * 255];
    });
    return tex(c, 1);
  });
}

export function sandTexture() {
  return cached('sand', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.25, y * 0.25, 3) * 0.5 + 0.5;
      const n2 = fbm2(x * 0.06, y * 0.06, 3) * 0.5 + 0.5;
      const v = 0.66 + n * 0.16 + n2 * 0.12;
      return [v * 0.98 * 255, v * 0.90 * 255, v * 0.72 * 255];
    });
    return tex(c, 1);
  });
}

export function snowTexture() {
  return cached('snow', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.12, y * 0.12, 3) * 0.5 + 0.5;
      const v = 0.84 + n * 0.16;
      return [v * 252, v * 253, v * 255];
    });
    return tex(c, 1);
  });
}

export function pathTexture() {
  return cached('path', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.11, y * 0.11, 4) * 0.5 + 0.5;
      const stone = fbm2(x * 0.4 + 5, y * 0.4 + 9, 2) * 0.5 + 0.5;
      const v = 0.42 + n * 0.22 + stone * 0.10;
      return [v * 0.92 * 255, v * 0.86 * 255, v * 0.76 * 255];
    });
    return tex(c, 1);
  });
}

/* ------------------------------------------------------------------ nature */

export function barkTexture() {
  return cached('bark', () => {
    const S = 128, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const streak = fbm2(x * 0.5, y * 0.06, 4);
      const n = fbm2(x * 0.2, y * 0.2, 3) * 0.5 + 0.5;
      const v = 0.28 + streak * 0.22 + n * 0.18;
      return [v * 0.86 * 255, v * 0.68 * 255, v * 0.50 * 255];
    });
    return tex(c, 1);
  });
}

export function bambooTexture() {
  return cached('bamboo', () => {
    const S = 128, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const seg = Math.sin(y * 0.5) * 0.5 + 0.5;
      const n = fbm2(x * 0.6, y * 0.1, 3) * 0.5 + 0.5;
      const v = 0.52 + seg * 0.16 + n * 0.12;
      return [v * 0.72 * 255, v * 0.92 * 255, v * 0.48 * 255];
    });
    return tex(c, 1);
  });
}

export function woodTexture() {
  return cached('wood', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const rings = Math.sin((x * 0.09 + fbm2(x * 0.02, y * 0.06, 3) * 6) * 3.0) * 0.5 + 0.5;
      const n = fbm2(x * 0.3, y * 0.3, 2) * 0.5 + 0.5;
      const v = 0.30 + rings * 0.22 + n * 0.10;
      return [v * 0.78 * 255, v * 0.52 * 255, v * 0.34 * 255];
    });
    return tex(c, 1);
  });
}

export function plasterTexture() {
  return cached('plaster', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.09, y * 0.09, 4) * 0.5 + 0.5;
      const v = 0.74 + n * 0.16;
      return [v * 0.97 * 255, v * 0.94 * 255, v * 0.86 * 255];
    });
    return tex(c, 1);
  });
}

export function roofTileTexture() {
  return cached('rooftile', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const col = Math.floor(x / 16);
      const off = (col % 2) * 8;
      const yy = (y + off) % 20;
      const curve = Math.sin((x % 16) / 16 * Math.PI);
      const lip = smoothBand(yy, 0, 3) * 0.35;
      const n = fbm2(x * 0.4, y * 0.4, 2) * 0.5 + 0.5;
      const v = (0.28 + curve * 0.20 + lip + n * 0.10);
      return [v * 0.62 * 255, v * 0.66 * 255, v * 0.72 * 255];
    });
    return tex(c, 1);
  });
}

function smoothBand(v: number, a: number, b: number) {
  if (v < a) return 0;
  if (v > b) return 1;
  const t = (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export function stoneBrickTexture() {
  return cached('stonebrick', () => {
    const S = 256, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const row = Math.floor(y / 32);
      const off = (row % 2) * 32;
      const bx = (x + off) % 64, by = y % 32;
      const mortar = (bx < 4 || by < 4) ? 0.72 : 1.0;
      const n = fbm2(x * 0.3, y * 0.3, 3) * 0.5 + 0.5;
      const v = (0.42 + n * 0.26) * mortar;
      return [v * 0.98 * 255, v * 0.97 * 255, v * 0.92 * 255];
    });
    return tex(c, 1);
  });
}

export function silkTexture(base: [number, number, number]) {
  const key = 'silk' + base.join('_');
  return cached(key, () => {
    const S = 128, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      // subtle woven damask
      const weave = (Math.sin(x * 1.9) * Math.sin(y * 1.9)) * 0.04;
      const motif = Math.sin((x + y) * 0.25) * Math.sin((x - y) * 0.25) * 0.05;
      const n = fbm2(x * 0.2, y * 0.2, 2) * 0.5 + 0.5;
      const f = 0.9 + weave + motif + n * 0.08;
      return [clamp01(base[0] * f) * 255, clamp01(base[1] * f) * 255, clamp01(base[2] * f) * 255];
    });
    return tex(c, 1);
  });
}

export function leafAlphaTexture() {
  return cached('leafalpha', () => {
    const S = 128, { c, ctx } = cnv(S);
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const n = fbm2(x * 0.08, y * 0.08, 3) * 0.5 + 0.5;
        const v = 0.35 + n * 0.65;
        d[i] = v * 70; d[i + 1] = v * 130; d[i + 2] = v * 60; d[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return tex(c, 1);
  });
}

/** A soft round alpha sprite used for particles, dust, rain and glows. */
export function softDot() {
  return cached('softdot', () => {
    const S = 64, { c, ctx } = cnv(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return tex(c, 1, false);
  });
}

/** Long, tapered leaf/flower-petal sprite. */
export function petalSprite() {
  return cached('petal', () => {
    const S = 64, { c, ctx } = cnv(S);
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, 'rgba(255,210,225,0.95)');
    g.addColorStop(0.5, 'rgba(255,240,246,0.9)');
    g.addColorStop(1, 'rgba(255,170,200,0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, S * 0.42, S * 0.18, Math.PI * 0.25, 0, Math.PI * 2);
    ctx.fill();
    return tex(c, 1);
  });
}

/** Streak sprite used for rain and sword sparks. */
export function streakSprite() {
  return cached('streak', () => {
    const W = 16, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });
}

/** Normal map derived from a luminance height function (sobel). */
export function normalFromHeight(size: number, hfn: (u: number, v: number) => number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const e = 1 / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = (hfn(u + e, v) - hfn(u - e, v));
      const dy = (hfn(u, v + e) - hfn(u, v - e));
      const nx = -dx * 6, ny = -dy * 6, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function waterNormalTexture() {
  return cached('waternormal', () => {
    const t = normalFromHeight(256, (u, v) => {
      return fbm2(u * 6, v * 6, 4) * 0.5 + 0.5 + fbm2(u * 14 + 3, v * 14 - 2, 3) * 0.25;
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });
}

export function roofNormalTexture() {
  return cached('roofnormal', () => {
    const t = normalFromHeight(128, (u, v) => {
      const col = Math.floor(u * 8);
      return Math.sin((u * 8 - col) * Math.PI) * 0.5 + Math.sin(v * 40) * 0.05;
    });
    return t;
  });
}

/** Emissive lantern / paper texture. */
export function paperTexture() {
  return cached('paper', () => {
    const S = 64, { c, ctx } = cnv(S);
    px(ctx, S, (x, y) => {
      const n = fbm2(x * 0.4, y * 0.4, 2) * 0.5 + 0.5;
      const v = 0.82 + n * 0.18;
      return [v * 255, v * 232, v * 196];
    });
    return tex(c, 1);
  });
}

/** Calligraphy-like banner art (used on flags/shop signs). */
export function bannerTexture(glyphs: string, bg = '#7a1b1b', fg = '#f2e6c8') {
  return cached('banner' + glyphs + bg, () => {
    const W = 128, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = fg;
    ctx.font = 'bold 44px "Noto Serif SC", "Songti SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = glyphs.split('');
    chars.forEach((ch, i) => {
      ctx.fillText(ch, W / 2, H / 2 + (i - (chars.length - 1) / 2) * 52);
    });
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
