import { DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping } from 'three';
import { WORLD } from '../core/TerrainHeight';

export const MASK_RES = 512;
export const CH_PATH = 0, CH_SETTLE = 1, CH_FIELD = 2, CH_WATER = 3;

let data = new Uint8Array(MASK_RES * MASK_RES * 4);
let tex: DataTexture | null = null;
let dirty = true;

export function resetMasks() {
  data = new Uint8Array(MASK_RES * MASK_RES * 4);
  dirty = true;
  if (tex) { tex.image.data = data; tex.needsUpdate = true; }
}

function idx(x: number, y: number) { return (y * MASK_RES + x) * 4; }

export function paintDisc(wx: number, wz: number, radius: number, channel: number, strength = 1, feather = 0.5) {
  const px = (wx + WORLD.half) / WORLD.size * MASK_RES;
  const pz = (wz + WORLD.half) / WORLD.size * MASK_RES;
  const r = radius / WORLD.size * MASK_RES;
  const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(MASK_RES - 1, Math.ceil(px + r));
  const y0 = Math.max(0, Math.floor(pz - r)), y1 = Math.min(MASK_RES - 1, Math.ceil(pz + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - px, y - pz);
      if (d > r) continue;
      const t = feather <= 0 ? (d < r ? 1 : 0) : Math.min(1, (r - d) / (r * feather));
      const i = idx(x, y) + channel;
      const v = Math.round(t * t * (3 - 2 * t) * strength * 255);
      if (v > data[i]) data[i] = v;
    }
  }
  dirty = true;
}

export function strokeLine(x0: number, z0: number, x1: number, z1: number, width: number, channel: number, strength = 1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (width * 0.4)) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintDisc(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, width, channel, strength, 0.85);
  }
  dirty = true;
}

export function blurMasks(iterations = 1) {
  for (let it = 0; it < iterations; it++) {
    const src = data.slice();
    for (let y = 1; y < MASK_RES - 1; y++) {
      for (let x = 1; x < MASK_RES - 1; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy) * MASK_RES + (x + dx)) * 4 + c];
          data[idx(x, y) + c] = Math.round(sum / 9);
        }
      }
    }
  }
  dirty = true;
}

export function getMaskTexture(): DataTexture {
  if (!tex) {
    tex = new DataTexture(data, MASK_RES, MASK_RES, RGBAFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  }
  if (dirty) { tex.needsUpdate = true; dirty = false; }
  return tex;
}

export function sampleMask(wx: number, wz: number, channel: number): number {
  const fx = ((wx + WORLD.half) / WORLD.size) * (MASK_RES - 1);
  const fy = ((wz + WORLD.half) / WORLD.size) * (MASK_RES - 1);
  const x = Math.max(0, Math.min(MASK_RES - 1, Math.round(fx)));
  const y = Math.max(0, Math.min(MASK_RES - 1, Math.round(fy)));
  return data[idx(x, y) + channel] / 255;
}
