import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Matrix4, Vector3, Color,
  BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, TorusGeometry, LatheGeometry,
  Vector2, Group, Mesh, MeshStandardMaterial, DoubleSide,
} from 'three';
import { MeshBuilder, mat } from './MeshBuilder';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Palette {
  wood: string; darkWood: string; plaster: string; stone: string; darkStone: string;
  tile: string; tileDark: string; red: string; gold: string; cloth: string; green?: string;
}

export const PAL: Palette = {
  wood: '#8a5a3a', darkWood: '#5d3b26', plaster: '#e8e0cf', stone: '#9a978d',
  darkStone: '#6f6c66', tile: '#4a5560', tileDark: '#39434c', red: '#8c2b2b',
  gold: '#c8a24a', cloth: '#b8452f', green: '#4a6b3f',
};
export const PAL_TEMPLE: Palette = {
  ...PAL, wood: '#9c3b2f', darkWood: '#6b241d', plaster: '#e2d6bb', tile: '#3f4a58',
  tileDark: '#2e3742', red: '#a02c22', gold: '#d8b055', cloth: '#c8a24a',
};

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/* ------------------------------------------------------------------ helpers */

export function platform(b: MeshBuilder, pos: Vector3, w: number, d: number, h: number, p: Palette, rotY = 0) {
  b.box(p.stone, v3(pos.x, pos.y + h / 2, pos.z), v3(w, h, d), rotY, 'opaque', 0.35);
  b.box(p.darkStone, v3(pos.x, pos.y + h + 0.04, pos.z), v3(w + 0.3, 0.12, d + 0.3), rotY, 'opaque', 0.5);
}

export function pillars(b: MeshBuilder, pos: Vector3, w: number, d: number, h: number, count: number, p: Palette, rotY = 0, radius = 0.16) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    for (const s of [-1, 1] as const) {
      const lx = (t - 0.5) * w, lz = s * d / 2;
      const cs = Math.cos(rotY), sn = Math.sin(rotY);
      b.add(new CylinderGeometry(radius, radius * 1.08, h, 10), p.wood,
        mat(v3(pos.x + lx * cs + lz * sn, pos.y + h / 2, pos.z - lx * sn + lz * cs), 0));
      // base stone
      b.add(new CylinderGeometry(radius * 1.5, radius * 1.7, 0.14, 8), p.darkStone,
        mat(v3(pos.x + lx * cs + lz * sn, pos.y + 0.07, pos.z - lx * sn + lz * cs), 0));
    }
  }
}

/**
 * Curved Chinese hip roof. The eaves sweep up at the corners and the surface is
 * concave — the signature silhouette of the architecture.
 */
export function curvedRoof(
  b: MeshBuilder, pos: Vector3, width: number, depth: number, height: number, p: Palette,
  opts: { eave?: number; lift?: number; ridgeRatio?: number; tiers?: number; rotY?: number; color?: string } = {},
) {
  const eave = opts.eave ?? 0.75;
  const lift = opts.lift ?? 0.5;
  const rr = opts.ridgeRatio ?? 0.42;
  const rotY = opts.rotY ?? 0;
  const W = width / 2 + eave, D = depth / 2 + eave;
  const RW = (width / 2) * rr;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const SEG = 7;

  const eaveY = (s: number) => pos.y + lift * Math.pow(Math.abs(s) * 2, 2.2);
  const ridgeY = pos.y + height;

  // four sloped surfaces: ridge line -> eave line
  const sides: { a: Vector3; bVec: Vector3; a2: Vector3; b2: Vector3; len: number }[] = [
    // +Z front
    { a: v3(-RW, ridgeY, 0), bVec: v3(RW, ridgeY, 0), a2: v3(-W, 0, D), b2: v3(W, 0, D), len: depth },
    // -Z back
    { a: v3(RW, ridgeY, 0), bVec: v3(-RW, ridgeY, 0), a2: v3(W, 0, -D), b2: v3(-W, 0, -D), len: depth },
    // +X right (hip end)
    { a: v3(RW, ridgeY, 0), bVec: v3(RW, ridgeY, 0), a2: v3(W, 0, D), b2: v3(W, 0, -D), len: width },
    // -X left
    { a: v3(-RW, ridgeY, 0), bVec: v3(-RW, ridgeY, 0), a2: v3(-W, 0, -D), b2: v3(-W, 0, D), len: width },
  ];

  let v = 0;
  for (const side of sides) {
    const rows: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      rows.push(v);
      for (let k = 0; k <= SEG; k++) {
        const s = k / SEG;
        // point on the ridge
        const rx = side.a.x + (side.bVec.x - side.a.x) * s;
        const rz = side.a.z + (side.bVec.z - side.a.z) * s;
        // point on the eave (with corner lift)
        const ex = side.a2.x + (side.b2.x - side.a2.x) * s;
        const ez = side.a2.z + (side.b2.z - side.a2.z) * s;
        const ey = eaveY(s - 0.5) - (side.a2.x === 0 ? 0 : 0);
        const eyy = pos.y + lift * Math.pow(Math.abs(s - 0.5) * 2, 2.2);
        // concave profile
        const tt = Math.pow(t, 1.55);
        const y = ridgeY + (eyy - ridgeY) * tt;
        const x = rx + (ex - rx) * t;
        const z = rz + (ez - rz) * t;
        // rotate around Y then translate
        const cs = Math.cos(rotY), sn = Math.sin(rotY);
        positions.push(pos.x + x * cs + z * sn, y, pos.z - x * sn + z * cs);
        uvs.push(s * side.len * 0.5, t * height * 0.7);
        v++;
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let k = 0; k < SEG; k++) {
        const a = rows[i] + k, bb = rows[i] + k + 1, c = rows[i + 1] + k, d = rows[i + 1] + k + 1;
        indices.push(a, c, bb, bb, c, d);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  b.add(g, opts.color ?? p.tile, new Matrix4());

  // ridge beam + ornaments
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const ax = -RW * cs, az = RW * sn;
  b.box(p.tileDark, v3(pos.x, ridgeY + 0.06, pos.z), v3(RW * 2 + 0.2, 0.18, 0.28), rotY, 'opaque', 0.6);
  for (const s of [-1, 1]) {
    const ex = s * W, ez = 0;
    // upturned horn at the ridge ends
    b.add(new ConeGeometry(0.12, 0.55, 6), p.gold,
      mat(v3(pos.x + s * RW * cs, ridgeY + 0.3, pos.z - s * RW * sn), rotY, v3(1, 1, 1)));
    // corner eave horns
    for (const zs of [-1, 1]) {
      const cx = s * W, cz = zs * D;
      b.add(new ConeGeometry(0.11, 0.5, 5), p.tileDark,
        mat(v3(pos.x + cx * cs + cz * sn, pos.y + lift * 0.9 + 0.2, pos.z - cx * sn + cz * cs), rotY));
    }
  }
  // eave trim
  for (const zs of [-1, 1]) {
    b.box(p.darkWood, v3(pos.x + 0 * cs + zs * D * sn, pos.y + 0.06, pos.z + zs * D * cs), v3(W * 2, 0.16, 0.30), rotY, 'opaque', 0.6);
  }
  for (const xs of [-1, 1]) {
    b.box(p.darkWood, v3(pos.x + xs * W * cs, pos.y + 0.06, pos.z - xs * W * sn), v3(0.30, 0.16, D * 2), rotY, 'opaque', 0.6);
  }
}

/** Simple gable roof (village houses). */
export function gableRoof(b: MeshBuilder, pos: Vector3, width: number, depth: number, height: number, p: Palette, rotY = 0, eave = 0.55, lift = 0.32) {
  const W = width / 2 + eave, D = depth / 2 + eave;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const SEG = 5;
  let v = 0;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const put = (x: number, y: number, z: number, u: number, vv: number) => {
    positions.push(pos.x + x * cs + z * sn, y, pos.z - x * sn + z * cs);
    uvs.push(u, vv);
    v++;
  };
  for (const zs of [1, -1]) {
    const rows: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      rows.push(v);
      for (let k = 0; k <= SEG; k++) {
        const s = k / SEG;
        const x = -W + 2 * W * s;
        const eyy = pos.y + lift * Math.pow(Math.abs(s - 0.5) * 2, 2.2);
        const y = (pos.y + height) + (eyy - (pos.y + height)) * Math.pow(t, 1.5);
        put(x, y, zs * D * (1 - t), s * width * 0.5, t * depth * 0.4 + height * 0.4);
      }
    }
    for (let i = 0; i < SEG; i++) for (let k = 0; k < SEG; k++) {
      const a = rows[i] + k, bb = rows[i] + k + 1, c = rows[i + 1] + k, d = rows[i + 1] + k + 1;
      if (zs > 0) indices.push(a, c, bb, bb, c, d); else indices.push(a, bb, c, bb, d, c);
    }
  }
  // gable ends
  for (const xs of [-1, 1]) {
    const rows: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      rows.push(v);
      for (let k = 0; k <= SEG; k++) {
        const s = k / SEG;
        const z = -D + 2 * D * s;
        const eyy = pos.y + lift * Math.pow(Math.abs(s - 0.5) * 2, 2.2);
        const y = (pos.y + height) + (eyy - (pos.y + height)) * Math.pow(t, 1.5);
        put(xs * W * (1 - t), y, z, s * depth * 0.5, t * width * 0.4 + height * 0.4);
      }
    }
    for (let i = 0; i < SEG; i++) for (let k = 0; k < SEG; k++) {
      const a = rows[i] + k, bb = rows[i] + k + 1, c = rows[i + 1] + k, d = rows[i + 1] + k + 1;
      if (xs > 0) indices.push(a, bb, c, bb, d, c); else indices.push(a, c, bb, bb, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  b.add(g, p.tile, new Matrix4());
  b.box(p.tileDark, v3(pos.x, pos.y + height + 0.05, pos.z), v3(width * 0.5, 0.2, 0.26), rotY, 'opaque', 0.6);
}

export function lantern(b: MeshBuilder, pos: Vector3, scale = 1, color = '#ff9a3c') {
  const g = new SphereGeometry(0.22 * scale, 10, 8);
  const m = new Matrix4();
  m.makeScale(1, 1.25, 1);
  m.setPosition(pos);
  b.add(g, color, m, 'glow');
  b.add(new CylinderGeometry(0.07 * scale, 0.07 * scale, 0.06 * scale, 8), '#3a2a1e',
    mat(v3(pos.x, pos.y + 0.29 * scale, pos.z)));
  b.add(new CylinderGeometry(0.02 * scale, 0.02 * scale, 0.5 * scale, 5), '#2a1c14',
    mat(v3(pos.x, pos.y + 0.55 * scale, pos.z)));
  b.add(new CylinderGeometry(0.06 * scale, 0.06 * scale, 0.05 * scale, 8), '#8c2b2b',
    mat(v3(pos.x, pos.y - 0.30 * scale, pos.z)));
}

export function banner(b: MeshBuilder, pos: Vector3, height: number, width: number, color: string, rotY = 0) {
  b.box(color, v3(pos.x, pos.y - height / 2, pos.z), v3(width, height, 0.03), rotY, 'opaque', 0.5);
  b.box('#3a2a1e', v3(pos.x, pos.y + 0.08, pos.z), v3(width * 1.2, 0.12, 0.12), rotY);
  b.box('#3a2a1e', v3(pos.x, pos.y - height - 0.08, pos.z), v3(width * 1.2, 0.12, 0.12), rotY);
}

export function stairs(b: MeshBuilder, pos: Vector3, width: number, steps: number, rise: number, run: number, p: Palette, rotY = 0) {
  for (let i = 0; i < steps; i++) {
    b.box(p.darkStone, v3(pos.x, pos.y + rise * (i + 0.5), pos.z - i * run * Math.cos(rotY)), v3(width, rise, run), rotY, 'opaque', 0.4);
  }
}

/* ------------------------------------------------------------------ buildings */

export interface HouseOpts { w?: number; d?: number; h?: number; rotY?: number; pal?: Palette; fence?: boolean; }

export function house(b: MeshBuilder, pos: Vector3, o: HouseOpts = {}) {
  const p = o.pal ?? PAL;
  const w = o.w ?? 6, d = o.d ?? 5, h = o.h ?? 3.0;
  const rotY = o.rotY ?? 0;
  platform(b, pos, w + 0.9, d + 0.9, 0.35, p, rotY);
  const y0 = pos.y + 0.35;
  // walls
  b.box(p.plaster, v3(pos.x, y0 + h / 2, pos.z), v3(w, h, d), rotY, 'opaque', 0.5);
  // timber frame
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const lx = xs * w / 2, lz = zs * d / 2;
    b.box(p.darkWood, v3(pos.x + lx * cs + lz * sn, y0 + h / 2, pos.z - lx * sn + lz * cs), v3(0.22, h, 0.22), rotY);
  }
  // door + windows
  b.box(p.darkWood, v3(pos.x, y0 + 1.0, pos.z + (d / 2) * Math.cos(rotY)), v3(1.1, 2.0, 0.12), rotY);
  b.box('#2b2118', v3(pos.x, y0 + 1.0, pos.z + (d / 2 + 0.02) * Math.cos(rotY)), v3(0.95, 1.85, 0.06), rotY);
  for (const xs of [-1, 1]) {
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    b.box(p.darkWood, v3(pos.x + xs * (w / 4) * cs + (d / 2) * sn, y0 + 1.7, pos.z - xs * (w / 4) * sn + (d / 2) * cs), v3(1.0, 1.0, 0.1), rotY);
    b.box('#241c17', v3(pos.x + xs * (w / 4) * cs + (d / 2 + 0.02) * sn, y0 + 1.7, pos.z - xs * (w / 4) * sn + (d / 2 + 0.02) * cs), v3(0.85, 0.85, 0.06), rotY);
  }
  // lattice window bars
  gableRoof(b, v3(pos.x, y0 + h, pos.z), w, d, 1.5, p, rotY);
  // side wall gable cap
  b.box(p.plaster, v3(pos.x, y0 + h + 0.35, pos.z), v3(w * 0.98, 0.7, d * 0.98), rotY, 'opaque', 0.5);
  if (o.fence) {
    for (const zs of [-1, 1]) for (let i = 0; i < 6; i++) {
      const lx = (i / 5 - 0.5) * (w + 2.5);
      const lz = zs * (d / 2 + 1.4);
      const cs = Math.cos(rotY), sn = Math.sin(rotY);
      b.box(p.darkWood, v3(pos.x + lx * cs + lz * sn, y0 + 0.5, pos.z - lx * sn + lz * cs), v3(0.1, 1.0, 0.1), rotY);
    }
  }
  // hanging lantern by the door
  lantern(b, v3(pos.x + 1.3 * Math.cos(rotY), y0 + h - 0.2, pos.z - 1.3 * Math.sin(rotY)), 0.9);
}

export function hall(b: MeshBuilder, pos: Vector3, o: { w?: number; d?: number; h?: number; rotY?: number; pal?: Palette; tiers?: number } = {}) {
  const p = o.pal ?? PAL_TEMPLE;
  const w = o.w ?? 12, d = o.d ?? 9, h = o.h ?? 4.4;
  const rotY = o.rotY ?? 0;
  platform(b, pos, w + 2, d + 2, 0.7, p, rotY);
  stairs(b, v3(pos.x, pos.y + 0.7, pos.z + (d / 2 + 1.0) * Math.cos(rotY)), w * 0.4, 3, 0.24, 0.5, p, rotY);
  const y0 = pos.y + 0.7;
  b.box(p.plaster, v3(pos.x, y0 + h / 2, pos.z), v3(w, h, d), rotY, 'opaque', 0.45);
  // columns
  const cols = 4;
  for (let i = 0; i < cols; i++) {
    const t = i / (cols - 1);
    for (const zs of [-1, 1]) {
      const lx = (t - 0.5) * (w - 1.2), lz = zs * (d / 2 + 0.35);
      const cs = Math.cos(rotY), sn = Math.sin(rotY);
      b.add(new CylinderGeometry(0.26, 0.28, h, 12), p.wood, mat(v3(pos.x + lx * cs + lz * sn, y0 + h / 2, pos.z - lx * sn + lz * cs)));
      b.add(new CylinderGeometry(0.36, 0.40, 0.2, 10), p.darkStone, mat(v3(pos.x + lx * cs + lz * sn, y0 + 0.1, pos.z - lx * sn + lz * cs)));
    }
  }
  // doors (red lattice)
  b.box(p.red, v3(pos.x, y0 + 1.6, pos.z + (d / 2 + 0.06) * Math.cos(rotY)), v3(w * 0.55, 3.2, 0.14), rotY);
  for (let i = 0; i < 6; i++) {
    const lx = (i / 5 - 0.5) * w * 0.5;
    b.box(p.gold, v3(pos.x + lx * Math.cos(rotY) + (d / 2 + 0.14) * Math.sin(rotY), y0 + 1.6, pos.z - lx * Math.sin(rotY) + (d / 2 + 0.14) * Math.cos(rotY)), v3(0.06, 3.0, 0.05), rotY);
  }
  // beam + corbel brackets
  b.box(p.wood, v3(pos.x, y0 + h + 0.15, pos.z), v3(w + 1.0, 0.4, d + 1.0), rotY, 'opaque', 0.4);
  curvedRoof(b, v3(pos.x, y0 + h + 0.5, pos.z), w, d, 2.4, p, { eave: 1.3, lift: 0.95, rotY, ridgeRatio: 0.5 });
  // plaque
  b.box('#3a2a1e', v3(pos.x, y0 + h - 0.35, pos.z + (d / 2 + 0.1) * Math.cos(rotY)), v3(2.4, 0.7, 0.12), rotY);
  b.box(p.gold, v3(pos.x, y0 + h - 0.35, pos.z + (d / 2 + 0.18) * Math.cos(rotY)), v3(2.1, 0.45, 0.06), rotY);
  lantern(b, v3(pos.x - (w / 2 - 0.6) * Math.cos(rotY), y0 + h - 0.4, pos.z + (w / 2 - 0.6) * Math.sin(rotY) + (d / 2) * Math.cos(rotY)), 1.3);
  lantern(b, v3(pos.x + (w / 2 - 0.6) * Math.cos(rotY), y0 + h - 0.4, pos.z - (w / 2 - 0.6) * Math.sin(rotY) + (d / 2) * Math.cos(rotY)), 1.3);
}

export function pagoda(b: MeshBuilder, pos: Vector3, o: { tiers?: number; base?: number; rotY?: number; pal?: Palette } = {}) {
  const p = o.pal ?? PAL_TEMPLE;
  const tiers = o.tiers ?? 5;
  const base = o.base ?? 9;
  const rotY = o.rotY ?? 0;
  let y = pos.y;
  platform(b, pos, base + 3, base + 3, 0.8, p, rotY);
  y += 0.8;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const w = base * (1 - k * 0.16);
    const h = 3.2 * (1 - k * 0.1);
    b.box(p.plaster, v3(pos.x, y + h / 2, pos.z), v3(w, h, w), rotY, 'opaque', 0.4);
    b.box(p.red, v3(pos.x, y + h / 2, pos.z), v3(w * 0.99, h * 0.98, w * 0.99), rotY, 'opaque', 0.4);
    // veranda posts
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2 + Math.PI / 4;
      const lx = Math.cos(a) * w * 0.5, lz = Math.sin(a) * w * 0.5;
      const cs = Math.cos(rotY), sn = Math.sin(rotY);
      b.add(new CylinderGeometry(0.14, 0.15, h, 8), p.wood, mat(v3(pos.x + lx * cs + lz * sn, y + h / 2, pos.z - lx * sn + lz * cs)));
    }
    // windows
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2;
      const lx = Math.cos(a) * w * 0.5, lz = Math.sin(a) * w * 0.5;
      const cs = Math.cos(rotY), sn = Math.sin(rotY);
      b.box('#2a2018', v3(pos.x + lx * cs + lz * sn, y + h * 0.55, pos.z - lx * sn + lz * cs), v3(1.1, 1.2, 0.16), rotY + a);
    }
    y += h;
    curvedRoof(b, v3(pos.x, y, pos.z), w, w, 1.5, p, { eave: 1.05, lift: 0.75, rotY, ridgeRatio: 0.35 });
    y += 0.55;
  }
  // finial
  b.add(new CylinderGeometry(0.10, 0.14, 2.4, 8), p.gold, mat(v3(pos.x, y + 1.2, pos.z)), 'metal');
  for (let i = 0; i < 4; i++) {
    b.add(new TorusGeometry(0.36 - i * 0.07, 0.045, 6, 14), p.gold,
      new Matrix4().makeRotationX(Math.PI / 2).setPosition(v3(pos.x, y + 0.5 + i * 0.35, pos.z)), 'metal');
  }
  b.add(new SphereGeometry(0.26, 12, 10), p.gold, mat(v3(pos.x, y + 2.5, pos.z)), 'metal');
}

/** 牌坊 — ceremonial archway. */
export function gate(b: MeshBuilder, pos: Vector3, o: { w?: number; h?: number; rotY?: number; pal?: Palette } = {}) {
  const p = o.pal ?? PAL;
  const w = o.w ?? 7, h = o.h ?? 6, rotY = o.rotY ?? 0;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  for (const s of [-1, 1]) {
    const lx = s * w / 2;
    b.add(new CylinderGeometry(0.32, 0.38, h, 12), p.stone, mat(v3(pos.x + lx * cs, pos.y + h / 2, pos.z - lx * sn)));
    b.box(p.darkStone, v3(pos.x + lx * cs, pos.y + 0.3, pos.z - lx * sn), v3(1.1, 0.6, 1.1), rotY);
    b.add(new SphereGeometry(0.28, 10, 8), p.stone, mat(v3(pos.x + lx * cs, pos.y + h + 0.15, pos.z - lx * sn)));
  }
  b.box(p.wood, v3(pos.x, pos.y + h * 0.72, pos.z), v3(w + 1.2, 0.55, 0.6), rotY);
  b.box(p.red, v3(pos.x, pos.y + h * 0.72, pos.z), v3(w * 0.5, 0.4, 0.75), rotY);
  b.box(p.wood, v3(pos.x, pos.y + h * 0.88, pos.z), v3(w + 0.6, 0.4, 0.5), rotY);
  curvedRoof(b, v3(pos.x, pos.y + h * 0.95, pos.z), w * 0.85, 1.6, 1.2, p, { eave: 0.9, lift: 0.65, rotY, ridgeRatio: 0.7 });
  curvedRoof(b, v3(pos.x, pos.y + h * 0.62, pos.z), w * 0.5, 1.2, 0.8, p, { eave: 0.7, lift: 0.5, rotY, ridgeRatio: 0.7 });
}

/** Arched stone bridge. */
export function bridge(b: MeshBuilder, from: Vector3, to: Vector3, width = 4, p: Palette = PAL) {
  const dir = new Vector3().subVectors(to, from);
  const len = dir.length();
  const rotY = Math.atan2(dir.x, dir.z);
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const archH = Math.min(4.5, len * 0.18);
  const SEGS = Math.max(8, Math.floor(len / 1.6));
  for (let i = 0; i < SEGS; i++) {
    const t = (i + 0.5) / SEGS;
    const arc = Math.sin(t * Math.PI) * archH;
    const x = from.x + dir.x * t, z = from.z + dir.z * t;
    b.box(p.stone, v3(x, from.y + arc - 0.35, z), v3(width, 0.7, len / SEGS + 0.05), rotY, 'opaque', 0.6);
    // railings
    for (const s of [-1, 1]) {
      const nx = -dir.z / len * s * width / 2, nz = dir.x / len * s * width / 2;
      b.box(p.darkStone, v3(x + nx, from.y + arc + 0.45, z + nz), v3(0.28, 0.9, len / SEGS * 0.95), rotY);
      if (i % 2 === 0) b.add(new SphereGeometry(0.16, 8, 6), p.darkStone, mat(v3(x + nx, from.y + arc + 1.0, z + nz)));
    }
  }
  for (const s of [-1, 1]) {
    const nx = -dir.z / len * s * width / 2, nz = dir.x / len * s * width / 2;
    for (let i = 0; i < SEGS; i++) {
      const t0 = i / SEGS, t1 = (i + 1) / SEGS;
      const a0 = Math.sin(t0 * Math.PI) * archH, a1 = Math.sin(t1 * Math.PI) * archH;
      const x0 = from.x + dir.x * t0, z0 = from.z + dir.z * t0;
      const x1 = from.x + dir.x * t1, z1 = from.z + dir.z * t1;
      const mx = (x0 + x1) / 2 + nx, mz = (z0 + z1) / 2 + nz;
      const my = (from.y + a0 + from.y + a1) / 2 + 0.85;
      const seg = new Vector3(x1 - x0, a1 - a0, z1 - z0);
      const l = seg.length();
      const m = new Matrix4();
      m.lookAt(new Vector3(0, 0, 0), seg.normalize(), new Vector3(0, 1, 0));
      const mm = new Matrix4().makeRotationY(Math.atan2(seg.x, seg.z));
      mm.setPosition(v3(mx, my, mz));
      b.add(new BoxGeometry(0.2, 0.16, l * 1.05), p.darkStone, mm);
    }
  }
  // arch underside
  const archGeo = new CylinderGeometry(len * 0.42, len * 0.42, width, 16, 1, true, 0, Math.PI);
  const am = new Matrix4();
  am.makeRotationZ(Math.PI / 2);
  am.premultiply(new Matrix4().makeRotationY(rotY));
  am.setPosition(v3((from.x + to.x) / 2, from.y - 0.2, (from.z + to.z) / 2));
  b.add(archGeo, p.darkStone, am, 'opaque', 0.6);
}

export function cityWall(b: MeshBuilder, from: Vector3, to: Vector3, height = 6, p: Palette = PAL) {
  const dir = new Vector3().subVectors(to, from);
  const len = dir.length();
  const rotY = Math.atan2(dir.x, dir.z);
  const segs = Math.max(2, Math.floor(len / 4));
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const x = from.x + dir.x * t, z = from.z + dir.z * t;
    b.box(p.darkStone, v3(x, from.y + height / 2, z), v3(1.6, height, len / segs + 0.1), rotY, 'opaque', 0.35);
    // crenellations
    for (const s of [-1, 1]) {
      b.box(p.stone, v3(x + (-dir.z / len) * s * 0.9, from.y + height + 0.5, z + (dir.x / len) * s * 0.9), v3(1.2, 1.0, 0.8), rotY, 'opaque', 0.5);
    }
  }
}

export function watchTower(b: MeshBuilder, pos: Vector3, height = 9, p: Palette = PAL, rotY = 0) {
  b.box(p.darkStone, v3(pos.x, pos.y + height / 2, pos.z), v3(5, height, 5), rotY, 'opaque', 0.4);
  b.box(p.stone, v3(pos.x, pos.y + height + 0.5, pos.z), v3(6, 1.2, 6), rotY, 'opaque', 0.4);
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    b.box(p.stone, v3(pos.x + xs * 2.6, pos.y + height + 1.4, pos.z + zs * 2.6), v3(1.2, 1.6, 1.2), rotY);
  }
  curvedRoof(b, v3(pos.x, pos.y + height + 2.4, pos.z), 5, 5, 2.0, p, { eave: 1.1, lift: 0.7, rotY, ridgeRatio: 0.4 });
  b.box(p.darkWood, v3(pos.x, pos.y + 1.2, pos.z + 2.55), v3(1.2, 2.4, 0.2), rotY);
}

export function shrine(b: MeshBuilder, pos: Vector3, p: Palette = PAL, rotY = 0) {
  platform(b, pos, 3.4, 3.0, 0.3, p, rotY);
  b.box(p.stone, v3(pos.x, pos.y + 1.0, pos.z), v3(2.2, 1.4, 2.0), rotY, 'opaque', 0.5);
  b.box(p.darkStone, v3(pos.x, pos.y + 1.85, pos.z), v3(2.6, 0.18, 2.4), rotY);
  // statue: seated figure silhouette
  b.add(new SphereGeometry(0.32, 10, 8), p.gold, mat(v3(pos.x, pos.y + 2.4, pos.z)), 'metal');
  b.add(new CylinderGeometry(0.42, 0.62, 1.0, 10), p.gold, mat(v3(pos.x, pos.y + 2.05, pos.z)), 'metal');
  b.add(new TorusGeometry(0.55, 0.07, 6, 16), p.gold,
    new Matrix4().makeRotationX(Math.PI / 2).setPosition(v3(pos.x, pos.y + 2.7, pos.z)), 'metal');
  curvedRoof(b, v3(pos.x, pos.y + 2.9, pos.z), 2.6, 2.4, 1.1, p, { eave: 0.65, lift: 0.45, rotY, ridgeRatio: 0.3 });
  lantern(b, v3(pos.x + 1.4, pos.y + 2.6, pos.z + 1.4), 0.8);
}

export function marketStall(b: MeshBuilder, pos: Vector3, p: Palette = PAL, rotY = 0) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const lx = xs * 1.5, lz = zs * 1.1;
    b.box(p.wood, v3(pos.x + lx * cs + lz * sn, pos.y + 1.15, pos.z - lx * sn + lz * cs), v3(0.13, 2.3, 0.13), rotY);
  }
  b.box(p.wood, v3(pos.x, pos.y + 1.0, pos.z), v3(3.2, 0.12, 2.4), rotY, 'opaque', 0.5);
  // awning (sloped cloth)
  const aw = new BoxGeometry(3.6, 0.08, 2.8);
  const m = new Matrix4().makeRotationX(-0.28);
  m.premultiply(new Matrix4().makeRotationY(rotY));
  m.setPosition(v3(pos.x, pos.y + 2.45, pos.z));
  b.add(aw, p.cloth, m, 'opaque', 0.5);
  b.box(p.darkWood, v3(pos.x, pos.y + 0.75, pos.z), v3(3.0, 0.5, 0.35), rotY);
  // goods
  for (let i = 0; i < 4; i++) {
    const lx = (i / 3 - 0.5) * 2.2;
    b.add(new SphereGeometry(0.16, 8, 6), ['#c25a3a', '#8a9c3a', '#c8a24a', '#6a7c8a'][i],
      mat(v3(pos.x + lx * cs, pos.y + 1.3, pos.z - lx * sn)));
  }
  banner(b, v3(pos.x + 1.7 * cs, pos.y + 2.3, pos.z - 1.7 * sn), 1.0, 0.42, '#8c2b2b', rotY);
}

export function well(b: MeshBuilder, pos: Vector3, p: Palette = PAL) {
  b.add(new CylinderGeometry(0.85, 0.95, 0.9, 14), p.darkStone, mat(v3(pos.x, pos.y + 0.45, pos.z)), 'opaque', 0.6);
  b.add(new CylinderGeometry(0.7, 0.7, 0.12, 14), '#1a2430', mat(v3(pos.x, pos.y + 0.92, pos.z)));
  for (const s of [-1, 1]) b.box(p.wood, v3(pos.x + s * 0.85, pos.y + 1.4, pos.z), v3(0.14, 2.0, 0.14));
  b.box(p.wood, v3(pos.x, pos.y + 2.3, pos.z), v3(2.0, 0.14, 0.14));
  gableRoof(b, v3(pos.x, pos.y + 2.4, pos.z), 2.2, 1.4, 0.7, p, 0, 0.4, 0.25);
  b.add(new CylinderGeometry(0.05, 0.05, 1.0, 6), '#3a2a1e', mat(v3(pos.x, pos.y + 1.8, pos.z)));
}

export function camp(b: MeshBuilder, pos: Vector3, p: Palette = PAL, rotY = 0) {
  // tents
  for (let i = 0; i < 3; i++) {
    const a = rotY + i * 2.1;
    const r = 5 + (i % 2) * 1.5;
    const tx = pos.x + Math.cos(a) * r, tz = pos.z + Math.sin(a) * r;
    const tent = new ConeGeometry(2.0, 2.6, 6, 1, true);
    b.add(tent, i % 2 ? '#6b5a3a' : '#7a6242', mat(v3(tx, pos.y + 1.3, tz), a * 0.3), 'opaque', 0.6);
    b.box('#3a2a1e', v3(tx, pos.y + 0.15, tz), v3(3.6, 0.3, 3.6), a * 0.3);
  }
  // campfire
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(new SphereGeometry(0.28, 8, 6), '#6f6c66', mat(v3(pos.x + Math.cos(a) * 0.9, pos.y + 0.12, pos.z + Math.sin(a) * 0.9)));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box('#4a3524', v3(pos.x + Math.cos(a) * 0.25, pos.y + 0.25, pos.z + Math.sin(a) * 0.25), v3(0.12, 0.7, 0.12), a);
  }
  b.add(new ConeGeometry(0.45, 1.0, 7), '#ff8a2c', mat(v3(pos.x, pos.y + 0.55, pos.z)), 'glow');
  // crates + weapon rack
  for (let i = 0; i < 4; i++) {
    const a = rotY + 1 + i * 0.6;
    b.box('#7a5a34', v3(pos.x + Math.cos(a) * (3 + i * 0.4), pos.y + 0.35, pos.z + Math.sin(a) * (3 + i * 0.4)), v3(0.7, 0.7, 0.7), a);
  }
  banner(b, v3(pos.x + 2 * Math.cos(rotY), pos.y + 4.2, pos.z - 2 * Math.sin(rotY)), 2.4, 0.7, '#5a2a2a', rotY);
}

export function dock(b: MeshBuilder, pos: Vector3, length = 12, width = 4, p: Palette = PAL, rotY = 0) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const segs = Math.floor(length / 2);
  for (let i = 0; i < segs; i++) {
    const lz = (i - segs / 2 + 0.5) * 2;
    b.box(p.wood, v3(pos.x + lz * sn, pos.y + 0.25, pos.z + lz * cs), v3(width, 0.2, 1.9), rotY, 'opaque', 0.6);
    for (const s of [-1, 1]) {
      b.box('#5d3b26', v3(pos.x + lz * sn + s * (width / 2) * cs, pos.y - 0.6, pos.z + lz * cs - s * (width / 2) * sn), v3(0.22, 1.6, 0.22), rotY);
    }
  }
  // moored boat
  const bx = pos.x + (width / 2 + 2.2) * cs, bz = pos.z - (width / 2 + 2.2) * sn;
  const hull = new LatheGeometry([new Vector2(0.05, 0), new Vector2(0.7, 0.25), new Vector2(0.95, 0.6), new Vector2(0.8, 0.75)], 10);
  const hm = new Matrix4().makeRotationZ(Math.PI / 2);
  hm.premultiply(new Matrix4().makeRotationY(rotY + Math.PI / 2));
  hm.setPosition(v3(bx, pos.y + 0.1, bz));
  b.add(hull, '#6b4a2e', hm, 'opaque', 0.5);
  b.box('#8a5a3a', v3(bx, pos.y + 0.75, bz), v3(0.9, 0.1, 3.4), rotY);
}

/** Rocky cave mouth with a dark interior. */
export function caveEntrance(b: MeshBuilder, pos: Vector3, rotY = 0, scale = 1) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 3.4 * scale;
    const x = Math.cos(a) * r, y = Math.sin(a) * 2.4 * scale;
    if (y < -0.4 * scale) continue;
    const wx = pos.x + x * cs, wz = pos.z - x * sn;
    b.add(new SphereGeometry(1.3 * scale * (0.7 + 0.5 * Math.abs(Math.sin(a * 2.3))), 8, 6), '#6a6660',
      mat(v3(wx, pos.y + y, wz)), 'opaque', 0.5);
  }
  // dark interior plane
  const g = new BoxGeometry(4.6 * scale, 3.4 * scale, 0.1);
  const m = new Matrix4().makeRotationY(rotY);
  m.setPosition(v3(pos.x, pos.y + 1.2 * scale, pos.z));
  b.add(g, '#0a0c10', m);
}

export function statue(b: MeshBuilder, pos: Vector3, p: Palette = PAL, rotY = 0, kind: 'guardian' | 'master' = 'guardian') {
  platform(b, pos, 2.4, 2.4, 0.9, p, rotY);
  const y = pos.y + 0.9;
  if (kind === 'guardian') {
    b.add(new CylinderGeometry(0.55, 0.75, 1.4, 10), p.stone, mat(v3(pos.x, y + 0.7, pos.z)), 'opaque', 0.6);
    b.add(new SphereGeometry(0.42, 12, 10), p.stone, mat(v3(pos.x, y + 1.8, pos.z)));
    b.add(new SphereGeometry(0.20, 8, 6), p.stone, mat(v3(pos.x - 0.18, y + 1.95, pos.z + 0.1)));
    b.add(new SphereGeometry(0.20, 8, 6), p.stone, mat(v3(pos.x + 0.18, y + 1.95, pos.z + 0.1)));
    b.add(new CylinderGeometry(0.18, 0.22, 0.9, 8), p.stone, mat(v3(pos.x - 0.5, y + 1.0, pos.z + 0.3)));
    b.add(new CylinderGeometry(0.18, 0.22, 0.9, 8), p.stone, mat(v3(pos.x + 0.5, y + 1.0, pos.z + 0.3)));
  } else {
    b.add(new CylinderGeometry(0.45, 0.7, 2.0, 12), p.plaster, mat(v3(pos.x, y + 1.0, pos.z)), 'opaque', 0.5);
    b.add(new SphereGeometry(0.34, 12, 10), '#d8c8a8', mat(v3(pos.x, y + 2.3, pos.z)));
    b.add(new CylinderGeometry(0.12, 0.12, 2.2, 8), '#8a5a3a', mat(v3(pos.x + 0.5, y + 1.3, pos.z)), 'opaque', 0.5);
    b.add(new SphereGeometry(0.16, 8, 6), p.gold, mat(v3(pos.x + 0.5, y + 2.5, pos.z)), 'metal');
  }
}

export function torii(b: MeshBuilder, pos: Vector3, p: Palette = PAL, rotY = 0) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  for (const s of [-1, 1]) {
    b.add(new CylinderGeometry(0.22, 0.26, 5.0, 10), p.red, mat(v3(pos.x + s * 2.2 * cs, pos.y + 2.5, pos.z - s * 2.2 * sn)));
  }
  b.box(p.red, v3(pos.x, pos.y + 4.7, pos.z), v3(6.0, 0.3, 0.5), rotY);
  b.box(p.red, v3(pos.x, pos.y + 4.95, pos.z), v3(6.6, 0.24, 0.7), rotY);
  b.box(p.red, v3(pos.x, pos.y + 3.9, pos.z), v3(5.2, 0.24, 0.4), rotY);
}
