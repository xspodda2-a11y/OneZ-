import { Vector3 } from 'three';
import { clamp, clamp01, fbm2, gradNoise2, lerpN, ridged2, smoothstep } from './Noise';

export const WORLD = {
  size: 2560,          // total world extent (meters)
  half: 1280,          // playable radius from origin
  chunk: 128,          // terrain chunk size
  waterLevel: 4.2,     // global water plane height
  maxHeight: 235,
  seed: 20241018,
};

export type BiomeName = 'water' | 'shore' | 'grass' | 'forest' | 'bamboo' | 'rock' | 'snow' | 'highland';

export interface FlattenDisc {
  x: number; z: number; radius: number; inner: number; height: number; feather: number;
}

/** Flatten discs (villages, temple platforms, arenas) registered by the world generator. */
const discGrid = new Map<string, FlattenDisc[]>();
const allDiscs: FlattenDisc[] = [];
const GRID = 256;

function cellKey(x: number, z: number) {
  return `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
}

export function registerFlatten(d: FlattenDisc) {
  allDiscs.push(d);
  const r = d.radius + d.feather;
  const x0 = Math.floor((d.x - r) / GRID), x1 = Math.floor((d.x + r) / GRID);
  const z0 = Math.floor((d.z - r) / GRID), z1 = Math.floor((d.z + r) / GRID);
  for (let cx = x0; cx <= x1; cx++)
    for (let cz = z0; cz <= z1; cz++) {
      const k = `${cx},${cz}`;
      let arr = discGrid.get(k);
      if (!arr) { arr = []; discGrid.set(k, arr); }
      arr.push(d);
    }
}
export function clearFlattens() { discGrid.clear(); allDiscs.length = 0; }
export function getFlattenDiscs() { return allDiscs; }

function flattenAt(x: number, z: number): { h: number; w: number } | null {
  const arr = discGrid.get(cellKey(x, z));
  if (!arr || arr.length === 0) return null;
  let bestH = 0, bestW = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    const dx = x - d.x, dz = z - d.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > d.radius + d.feather) continue;
    let w: number;
    if (dist <= d.radius - d.inner) w = 1;
    else w = 1 - smoothstep(d.radius - d.inner, d.radius + d.feather, dist);
    if (w <= bestW) continue;
    bestW = w; bestH = d.height;
  }
  return bestW > 0 ? { h: bestH, w: bestW } : null;
}

/** Raw (un-flattened) terrain elevation. */
export function rawHeight(x: number, z: number): number {
  const s = 0.00055;
  // Continent-scale shape: a broad basin ringed by mountains.
  const distFromCentre = Math.sqrt(x * x + z * z) / WORLD.half;
  const rim = smoothstep(0.55, 1.02, distFromCentre);

  // Rolling hills / plains
  let h = 12 + fbm2(x * s * 2.1, z * s * 2.1, 5) * 16;

  // Large mountain ranges
  const rangeMask = clamp01(fbm2(x * 0.00035 + 11.3, z * 0.00035 - 4.7, 3) * 1.35 + 0.28);
  const mountains = ridged2(x * 0.00092 + 3.1, z * 0.00092 - 7.4, 5) * 150;
  h += mountains * rangeMask * (0.35 + rim * 0.85);

  // Medium detail
  h += fbm2(x * 0.0042 - 19.2, z * 0.0042 + 8.8, 4) * 7.5;
  // Fine detail
  h += gradNoise2(x * 0.021, z * 0.021) * 1.1;

  // Terraces on steep mountain flanks (classic asian landscape look)
  const terr = Math.sin(h * 0.16) * 1.4 * clamp01(rangeMask * 1.4);
  h += terr;

  // Lake basins
  const lake = fbm2(x * 0.00075 + 41.7, z * 0.00075 + 22.1, 3);
  const lakeMask = smoothstep(0.16, 0.44, lake);
  h = lerpN(h, -7.5 + fbm2(x * 0.006, z * 0.006, 2) * 2.2, lakeMask * 0.95);

  // Rivers: winding channels carved below the water line
  const warp = fbm2(x * 0.0011 + 5.5, z * 0.0011 - 2.5, 2) * 1.6;
  const rv = Math.abs(gradNoise2(x * 0.0017 + warp, z * 0.0017 - warp));
  const riverMask = 1 - smoothstep(0.004, 0.055, rv);
  const riverFloor = WORLD.waterLevel - 5.5;
  h = lerpN(h, Math.min(h, riverFloor), riverMask * clamp01(1 - lakeMask) * 0.92);

  // Clamp toward the world edge (misty impassable peaks)
  const edge = smoothstep(0.86, 1.0, distFromCentre);
  h = lerpN(h, 120 + ridged2(x * 0.002, z * 0.002, 4) * 90, edge);

  return h;
}

/** Final terrain height including village/platform flattening. */
export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  const f = flattenAt(x, z);
  if (f) h = lerpN(h, f.h, f.w);
  // Hard clamp: never below the deep-water floor
  return clamp(h, -18, WORLD.maxHeight);
}

const _n = new Vector3();
export function terrainNormal(x: number, z: number, out = new Vector3()): Vector3 {
  const e = 1.0;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  _n.set(hL - hR, 2 * e, hD - hU).normalize();
  return out.copy(_n);
}

export function slopeAt(x: number, z: number): number {
  const n = terrainNormal(x, z, new Vector3());
  return 1 - n.y;
}

export function moistureAt(x: number, z: number): number {
  return clamp01(fbm2(x * 0.0013 - 33.3, z * 0.0013 + 17.9, 3) * 0.5 + 0.5);
}

export function biomeAt(x: number, z: number): BiomeName {
  const h = heightAt(x, z);
  if (h < WORLD.waterLevel + 0.6) return 'water';
  if (h < WORLD.waterLevel + 2.6) return 'shore';
  const m = moistureAt(x, z);
  const s = slopeAt(x, z);
  if (h > 132) return 'snow';
  if (s > 0.42) return 'rock';
  if (h > 78) return 'highland';
  if (m > 0.58 && h < 66) return 'bamboo';
  if (m > 0.42) return 'forest';
  return 'grass';
}

/** Is this point under the surface of the (global) water plane and above the bed? */
export function waterDepthAt(x: number, z: number): number {
  return WORLD.waterLevel - heightAt(x, z);
}

export function isUnderwater(y: number, x: number, z: number): boolean {
  return y < WORLD.waterLevel && waterDepthAt(x, z) > 0.35;
}

/** Cheap look-up: highest terrain point in a small neighbourhood (used for safe spawning). */
export function findStableGround(x: number, z: number, radius = 24): { x: number; z: number; y: number } {
  let best = { x, z, y: heightAt(x, z) };
  let bestScore = Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = (i % 3 === 0) ? 0 : radius * (0.4 + 0.6 * ((i % 5) / 5));
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const y = heightAt(px, pz);
    if (y <= WORLD.waterLevel + 1.2) continue;
    const score = slopeAt(px, pz) * 40 + Math.abs(y - 30);
    if (score < bestScore) { bestScore = score; best = { x: px, z: pz, y }; }
  }
  return best;
}
