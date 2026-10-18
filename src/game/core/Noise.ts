// Deterministic, dependency-free noise utilities (value noise + simplex-ish gradient noise).

export function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export function hash3(x: number, y: number, z: number): number {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Classic 2D value noise in [0,1]. */
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** 2D gradient (Perlin-style) noise in ~[-1,1]. */
const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];
export function gradNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const h = Math.floor(hash2(ix, iy) * 8) % 8;
    const gr = GRAD2[h];
    return gr[0] * dx + gr[1] * dy;
  };
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
}

export function fbm2(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradNoise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal — great for mountain crests. Returns [0,1]. */
export function ridged2(x: number, y: number, octaves = 5, lacunarity = 2.1, gain = 0.5): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(gradNoise2(x * freq, y * freq));
    n *= n;
    n *= prev;
    prev = n;
    sum += amp * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
export function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export function damp(a: number, b: number, lambda: number, dt: number) {
  return lerpN(a, b, 1 - Math.exp(-lambda * dt));
}

/** Small fast PRNG (mulberry32). */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of a chunk coordinate -> [0,1) */
export function chunkHash(cx: number, cz: number, salt = 0): number {
  return hash3(cx * 73856093 ^ 0x9e3779b9, cz * 19349663 ^ 0x85ebca6b, salt * 83492791);
}
