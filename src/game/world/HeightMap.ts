import {
  DataTexture, RedFormat, HalfFloatType, LinearFilter, ClampToEdgeWrapping,
  RGBAFormat, UnsignedByteType, DataUtils, SRGBColorSpace, Texture,
} from 'three';
import { WORLD, heightAt, biomeAt, terrainNormal } from '../core/TerrainHeight';
import { clamp01 } from '../core/Noise';

let heightTex: DataTexture | null = null;
let heightData: Float32Array | null = null;
let mapTex: Texture | null = null;
export const HEIGHT_RES = 512;

export function getHeightTexture(): { tex: DataTexture; data: Float32Array; res: number } {
  if (!heightTex) build();
  return { tex: heightTex!, data: heightData!, res: HEIGHT_RES };
}

export function sampleHeightData(data: Float32Array, res: number, x: number, z: number): number {
  const u = (x + WORLD.half) / WORLD.size;
  const v = (z + WORLD.half) / WORLD.size;
  let fx = u * (res - 1), fy = v * (res - 1);
  fx = Math.max(0, Math.min(res - 1.001, fx));
  fy = Math.max(0, Math.min(res - 1.001, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const i00 = y0 * res + x0;
  const a = data[i00], b = data[i00 + 1], c = data[i00 + res], d = data[i00 + res + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function build() {
  const res = HEIGHT_RES;
  heightData = new Float32Array(res * res);
  const half = new Uint16Array(res * res);
  for (let y = 0; y < res; y++) {
    const wz = (y / (res - 1)) * WORLD.size - WORLD.half;
    for (let x = 0; x < res; x++) {
      const wx = (x / (res - 1)) * WORLD.size - WORLD.half;
      const h = heightAt(wx, wz);
      heightData[y * res + x] = h;
      half[y * res + x] = DataUtils.toHalfFloat(h);
    }
  }
  heightTex = new DataTexture(half, res, res, RedFormat, HalfFloatType);
  heightTex.minFilter = LinearFilter;
  heightTex.magFilter = LinearFilter;
  heightTex.wrapS = heightTex.wrapT = ClampToEdgeWrapping;
  heightTex.needsUpdate = true;
}

const BIOME_COLOR: Record<string, [number, number, number]> = {
  water: [40, 78, 104],
  shore: [176, 168, 132],
  grass: [104, 138, 76],
  forest: [66, 104, 60],
  bamboo: [92, 142, 82],
  rock: [124, 118, 108],
  snow: [238, 242, 248],
  highland: [122, 126, 96],
};

/** Painted top-down world map + minimap source texture. */
export function getWorldMapTexture(): Texture {
  if (mapTex) return mapTex;
  const res = 512;
  const data = new Uint8Array(res * res * 4);
  const { data: hd } = getHeightTexture();
  for (let y = 0; y < res; y++) {
    const wz = (y / (res - 1)) * WORLD.size - WORLD.half;
    for (let x = 0; x < res; x++) {
      const wx = (x / (res - 1)) * WORLD.size - WORLD.half;
      const h = sampleHeightData(hd, HEIGHT_RES, wx, wz);
      let col: [number, number, number] = BIOME_COLOR.grass;
      if (h < WORLD.waterLevel) col = [30 + clamp01((WORLD.waterLevel - h) / 14) * 8, 70 + clamp01((WORLD.waterLevel - h) / 14) * 18, 104];
      else if (h < WORLD.waterLevel + 2.5) col = BIOME_COLOR.shore;
      else if (h > 140) col = BIOME_COLOR.snow;
      else if (h > 100) col = BIOME_COLOR.rock;
      else if (h > 74) col = BIOME_COLOR.highland;
      else {
        const b = biomeAt(wx, wz);
        col = BIOME_COLOR[b] || BIOME_COLOR.grass;
      }
      // hillshade from the analytic height field
      const hl = sampleHeightData(hd, HEIGHT_RES, wx - 14, wz);
      const hr = sampleHeightData(hd, HEIGHT_RES, wx + 14, wz);
      const hu = sampleHeightData(hd, HEIGHT_RES, wx, wz - 14);
      const hdo = sampleHeightData(hd, HEIGHT_RES, wx, wz + 14);
      const nx = hl - hr, nz = hu - hdo;
      const shade = clamp01(0.62 + (nx * 0.7 + nz * 0.7) / 24 + 0.28);
      const i = (y * res + x) * 4;
      data[i] = Math.min(255, col[0] * shade);
      data[i + 1] = Math.min(255, col[1] * shade);
      data[i + 2] = Math.min(255, col[2] * shade);
      data[i + 3] = 255;
    }
  }
  mapTex = new DataTexture(data, res, res, RGBAFormat, UnsignedByteType);
  mapTex.colorSpace = SRGBColorSpace;
  mapTex.minFilter = LinearFilter;
  mapTex.magFilter = LinearFilter;
  mapTex.needsUpdate = true;
  return mapTex;
}

/** Fast terrain-height lookup straight from the baked field (used by gameplay probes). */
export function bakedHeight(x: number, z: number): number {
  if (!heightData) build();
  return sampleHeightData(heightData!, HEIGHT_RES, x, z);
}
