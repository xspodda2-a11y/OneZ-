import {
  Group, Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshStandardMaterial,
  Color, Vector3, Object3D, CylinderGeometry, SphereGeometry, TorusGeometry, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type WeaponType = 'jian' | 'dao' | 'spear' | 'staff' | 'dagger' | 'fists' | 'twin' | 'halberd';

export interface WeaponOptions {
  bladeColor?: string;
  edgeColor?: string;
  guardColor?: string;
  handleColor?: string;
  wrapColor?: string;
  length?: number;
  glow?: number;
  quality?: number;
}

function vcolor(geo: BufferGeometry, hex: string, rough = 1) {
  const c = new Color(hex).convertSRGBToLinear();
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new BufferAttribute(arr, 3));
  return geo;
}

/** Extruded, tapered blade with a diamond cross-section and optional curve. */
function bladeGeometry(len: number, width: number, thick: number, curve = 0, segs = 10, fuller = true) {
  const ring = 6;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows: number[] = [];
  let v = 0;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const y = t * len;
    const taper = Math.pow(1 - t, 0.55);
    const w = width * taper * (1 - Math.pow(t, 4) * 0.85);
    const th = thick * taper * (1 - Math.pow(t, 3) * 0.7);
    const xo = curve * t * t;
    rows.push(v);
    for (let r = 0; r < ring; r++) {
      const a = (r / ring) * Math.PI * 2;
      // diamond-ish section
      const cs = Math.cos(a), sn = Math.sin(a);
      const px = Math.sign(cs) * Math.pow(Math.abs(cs), 0.6) * w * 0.5;
      const pz = Math.sign(sn) * Math.pow(Math.abs(sn), 0.6) * th * 0.5 * (fuller ? (Math.abs(cs) > 0.6 ? 0.55 : 1) : 1);
      positions.push(px + xo, y, pz);
      const nl = Math.hypot(px, pz) || 1;
      normals.push(px / nl, 0.12, pz / nl);
      uvs.push(r / ring, t);
      v++;
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let r = 0; r < ring; r++) {
      const r2 = (r + 1) % ring;
      const a = rows[s] + r, b = rows[s] + r2, c = rows[s + 1] + r, d = rows[s + 1] + r2;
      indices.push(a, c, b, b, c, d);
    }
  }
  // tip
  const tip = v;
  positions.push(curve, len + width * 0.22, 0);
  normals.push(0, 1, 0); uvs.push(0.5, 1); v++;
  for (let r = 0; r < ring; r++) {
    const r2 = (r + 1) % ring;
    indices.push(rows[segs] + r, tip, rows[segs] + r2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const matCache = new Map<string, MeshStandardMaterial>();
function weaponMaterial(metalness: number, roughness: number) {
  const key = `${metalness}_${roughness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ vertexColors: true, metalness, roughness, side: DoubleSide, name: 'weapon' });
    matCache.set(key, m);
  }
  return m;
}

export interface WeaponResult {
  group: Group;
  /** tip + base markers used for sword trails */
  tip: Object3D;
  base: Object3D;
  length: number;
}

export function buildWeapon(type: WeaponType, o: WeaponOptions = {}): WeaponResult {
  const group = new Group();
  const blade = o.bladeColor ?? '#dfe6ee';
  const guard = o.guardColor ?? '#b9922f';
  const handle = o.handleColor ?? '#3a2a1e';
  const wrap = o.wrapColor ?? '#8c2b2b';
  const L = o.length ?? 1;
  const parts: { geo: BufferGeometry; metal: boolean }[] = [];

  const addMesh = (geo: BufferGeometry, hex: string, metal: boolean) => {
    const m = new Mesh(vcolor(geo, hex), weaponMaterial(metal ? 0.92 : 0.12, metal ? 0.24 : 0.7));
    m.castShadow = true;
    group.add(m);
    return m;
  };

  let bladeLen = 0.86 * L;
  let tipY = 0;

  if (type === 'jian' || type === 'dao' || type === 'dagger' || type === 'twin') {
    const isDao = type === 'dao';
    const isDagger = type === 'dagger';
    bladeLen = (isDagger ? 0.38 : isDao ? 0.82 : 0.84) * L;
    const width = isDao ? 0.072 : isDagger ? 0.055 : 0.052;
    const curve = isDao ? 0.10 * L : 0;
    const bg = bladeGeometry(bladeLen, width * L, (isDao ? 0.014 : 0.018) * L, curve, 12);
    parts.push({ geo: bg, metal: true });
    // guard
    const guardGeo = isDao ? new CylinderGeometry(0.042 * L, 0.042 * L, 0.016 * L, 12)
      : new TorusGeometry(0.036 * L, 0.011 * L, 6, 12);
    if (!isDao) guardGeo.rotateX(Math.PI / 2);
    guardGeo.translate(0, -0.012 * L, 0);
    // pommel
    const pom = new SphereGeometry(0.026 * L, 10, 8);
    pom.translate(0, -0.185 * L, 0);
    // handle
    const hg = new CylinderGeometry(0.019 * L, 0.021 * L, 0.17 * L, 10);
    hg.translate(0, -0.10 * L, 0);
    tipY = bladeLen;

    addMesh(bg, blade, true);
    addMesh(guardGeo, guard, true);
    addMesh(hg, handle, false);
    addMesh(pom, guard, true);
    // grip wrap rings
    for (let i = 0; i < 5; i++) {
      const r = new TorusGeometry(0.023 * L, 0.005 * L, 5, 10);
      r.rotateX(Math.PI / 2);
      r.translate(0, (-0.04 - i * 0.030) * L, 0);
      addMesh(r, wrap, false);
    }
    // tassel ring
    const ring = new TorusGeometry(0.014 * L, 0.004 * L, 5, 8);
    ring.translate(0.008 * L, -0.20 * L, 0);
    addMesh(ring, wrap, false);
  } else if (type === 'spear' || type === 'halberd') {
    bladeLen = 0.42 * L;
    const shaftLen = 2.05 * L;
    const sg = new CylinderGeometry(0.017 * L, 0.020 * L, shaftLen, 10);
    sg.translate(0, -shaftLen / 2 + 0.15 * L, 0);
    addMesh(sg, handle, false);
    const bg = bladeGeometry(bladeLen, 0.062 * L, 0.013 * L, 0, 8);
    bg.translate(0, 0.16 * L, 0);
    addMesh(bg, blade, true);
    // tassel
    const tg = new CylinderGeometry(0.026 * L, 0.008 * L, 0.13 * L, 8);
    tg.translate(0, 0.10 * L, 0);
    addMesh(tg, '#a8241f', false);
    const collar = new CylinderGeometry(0.030 * L, 0.030 * L, 0.03 * L, 10);
    collar.translate(0, 0.155 * L, 0);
    addMesh(collar, guard, true);
    tipY = 0.16 * L + bladeLen;
    if (type === 'halberd') {
      const hook = bladeGeometry(0.26 * L, 0.05 * L, 0.014 * L, -0.12 * L, 6);
      hook.rotateZ(-1.15);
      hook.translate(0.055 * L, 0.22 * L, 0);
      addMesh(hook, blade, true);
    }
  } else if (type === 'staff') {
    const shaftLen = 1.95 * L;
    const sg = new CylinderGeometry(0.022 * L, 0.022 * L, shaftLen, 10);
    sg.translate(0, -shaftLen / 2 + 0.2 * L, 0);
    addMesh(sg, '#5b4630', false);
    for (const y of [0.24 * L, -shaftLen + 0.22 * L]) {
      const cap = new CylinderGeometry(0.030 * L, 0.030 * L, 0.07 * L, 10);
      cap.translate(0, y, 0);
      addMesh(cap, '#b9922f', true);
      const ring = new TorusGeometry(0.028 * L, 0.006 * L, 5, 12);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, y + 0.045 * L, 0);
      addMesh(ring, '#d9b64a', true);
    }
    tipY = 0.24 * L;
  }

  const tip = new Object3D();
  tip.position.set(0, tipY, 0);
  group.add(tip);
  const base = new Object3D();
  base.position.set(0, bladeLen * 0.18, 0);
  group.add(base);
  group.name = 'weapon_' + type;
  return { group, tip, base, length: tipY };
}

/** Scabbard (attached to the back when the weapon is sheathed). */
export function buildScabbard(color = '#2c2620', trim = '#b9922f', len = 0.95) {
  const g = new Group();
  const body = new Mesh(
    vcolor(bladeGeometry(len, 0.075, 0.05, 0.02, 4, false), color),
    weaponMaterial(0.1, 0.75),
  );
  body.castShadow = true;
  g.add(body);
  for (const y of [0.06, len * 0.55]) {
    const band = new Mesh(
      vcolor(new CylinderGeometry(0.045, 0.045, 0.035, 10).translate(0, y, 0), trim),
      weaponMaterial(0.9, 0.3),
    );
    g.add(band);
  }
  return g;
}
