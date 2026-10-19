import { Vector3 } from 'three';
import { heightAt } from './TerrainHeight';

export interface BoxCollider {
  type: 'box';
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  yaw: number;
  climbable: boolean;
  id: number;
  tag?: string;
}
export interface CylinderCollider {
  type: 'cyl';
  cx: number; cy: number; cz: number;
  radius: number; halfHeight: number;
  climbable: boolean;
  id: number;
  tag?: string;
}
export type Collider = BoxCollider | CylinderCollider;

const CELL = 32;
function key(x: number, z: number) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }

/**
 * Lightweight static-collider world: axis-aligned-ish boxes with yaw + vertical cylinders.
 * Terrain is handled implicitly by the height field. Designed for capsule character
 * controllers, camera collision and line-of-sight queries.
 */
export class PhysicsWorld {
  private grid = new Map<string, Collider[]>();
  private all: Collider[] = [];
  private nextId = 1;

  addBox(center: Vector3, half: Vector3, yaw = 0, climbable = false, tag?: string): BoxCollider {
    const c: BoxCollider = {
      type: 'box', cx: center.x, cy: center.y, cz: center.z,
      hx: half.x, hy: half.y, hz: half.z, yaw, climbable, id: this.nextId++, tag,
    };
    this.insert(c);
    return c;
  }

  addCylinder(center: Vector3, radius: number, halfHeight: number, climbable = false, tag?: string): CylinderCollider {
    const c: CylinderCollider = {
      type: 'cyl', cx: center.x, cy: center.y, cz: center.z,
      radius, halfHeight, climbable, id: this.nextId++, tag,
    };
    this.insert(c);
    return c;
  }

  addOrientedBox(center: Vector3, size: Vector3, yaw: number, climbable = false, tag?: string): BoxCollider {
    return this.addBox(center, new Vector3(size.x / 2, size.y / 2, size.z / 2), yaw, climbable, tag);
  }

  private bounds(c: Collider): [number, number, number, number] {
    if (c.type === 'box') {
      const r = Math.hypot(c.hx, c.hz) + 1;
      return [c.cx - r, c.cz - r, c.cx + r, c.cz + r];
    }
    const r = c.radius + 1;
    return [c.cx - r, c.cz - r, c.cx + r, c.cz + r];
  }

  private insert(c: Collider) {
    this.all.push(c);
    const [x0, z0, x1, z1] = this.bounds(c);
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++)
      for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
        const k = `${x},${z}`;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(c);
      }
  }

  remove(c: Collider) {
    const i = this.all.indexOf(c);
    if (i >= 0) this.all.splice(i, 1);
    const [x0, z0, x1, z1] = this.bounds(c);
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++)
      for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
        const arr = this.grid.get(`${x},${z}`);
        if (!arr) continue;
        const j = arr.indexOf(c);
        if (j >= 0) arr.splice(j, 1);
      }
  }

  clear() { this.grid.clear(); this.all.length = 0; this.nextId = 1; }

  /** All colliders whose cell overlaps the circle. */
  query(x: number, z: number, radius: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    const x0 = Math.floor((x - radius) / CELL), x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL), z1 = Math.floor((z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(`${cx},${cz}`);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
      }
    return out;
  }

  /** Highest support surface (collider top or terrain) at/under `y`. */
  supportHeight(x: number, z: number, y: number, radius: number, maxDrop = 1.0): { y: number; collider: Collider | null } {
    let best = heightAt(x, z);
    let bestC: Collider | null = null;
    const list = this.query(x, z, radius + 2, _tmpList);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      let top: number;
      let inside: boolean;
      if (c.type === 'box') {
        const dx = x - c.cx, dz = z - c.cz;
        const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        inside = Math.abs(lx) <= c.hx + radius && Math.abs(lz) <= c.hz + radius;
        top = c.cy + c.hy;
      } else {
        const dx = x - c.cx, dz = z - c.cz;
        inside = dx * dx + dz * dz <= (c.radius + radius) * (c.radius + radius);
        top = c.cy + c.halfHeight;
      }
      if (!inside) continue;
      if (top <= y + maxDrop && top > best) { best = top; bestC = c; }
    }
    return { y: best, collider: bestC };
  }

  /**
   * Push a vertical capsule (feet at p.y, head at p.y+height) out of static geometry.
   * Returns the horizontal correction applied.
   */
  resolveCapsule(p: Vector3, radius: number, height: number, out = new Vector3()): { push: Vector3; hit: Collider | null; wallNormal: Vector3 | null } {
    out.set(0, 0, 0);
    let hit: Collider | null = null;
    let normal: Vector3 | null = null;
    const list = this.query(p.x, p.z, radius + 4, _tmpList2);
    const feet = p.y, head = p.y + height;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        // vertical overlap test (capsule spans [feet, head])
        if (c.type === 'box') {
          if (head < c.cy - c.hy || feet > c.cy + c.hy) continue;
          const dx = p.x - c.cx, dz = p.z - c.cz;
          const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
          const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          const ex = c.hx + radius, ez = c.hz + radius;
          if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
          let nlx = 0, nlz = 0, depth = 0;
          if (px < pz) { nlx = Math.sign(lx) || 1; depth = px; }
          else { nlz = Math.sign(lz) || 1; depth = pz; }
          // rotate normal back to world
          const csi = Math.cos(c.yaw), sni = Math.sin(c.yaw);
          const nx = nlx * csi - nlz * sni, nz = nlx * sni + nlz * csi;
          out.x += nx * depth; out.z += nz * depth;
          p.x += nx * depth; p.z += nz * depth;
          hit = c;
          normal = new Vector3(nx, 0, nz);
        } else {
          if (head < c.cy - c.halfHeight || feet > c.cy + c.halfHeight) continue;
          const dx = p.x - c.cx, dz = p.z - c.cz;
          const d2 = dx * dx + dz * dz;
          const rr = c.radius + radius;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.0001;
          const nx = dx / d, nz = dz / d;
          const depth = rr - d;
          out.x += nx * depth; out.z += nz * depth;
          p.x += nx * depth; p.z += nz * depth;
          hit = c;
          normal = new Vector3(nx, 0, nz);
        }
      }
    }
    return { push: out, hit, wallNormal: normal };
  }

  /** Is there anything solid between a and b? (LOS + camera) */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, ignoreTag?: string): { hit: boolean; dist: number; point: Vector3 } {
    const res = { hit: false, dist: maxDist, point: new Vector3() };
    const steps = Math.min(96, Math.max(8, Math.ceil(maxDist / 1.2)));
    const prevY = heightAt(origin.x, origin.z);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const h = heightAt(x, z);
      if (y <= h) {
        // refine a little
        let lo = t - maxDist / steps, hi = t;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          const yy = origin.y + dir.y * m;
          const hh = heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
          if (yy <= hh) hi = m; else lo = m;
        }
        res.hit = true; res.dist = Math.max(0.05, hi - 0.05);
        res.point.copy(origin).addScaledVector(dir, res.dist);
        return res;
      }
      prevY;
    }
    // static geometry (coarse slab test)
    const midX = origin.x + dir.x * maxDist * 0.5, midZ = origin.z + dir.z * maxDist * 0.5;
    const list = this.query(midX, midZ, maxDist * 0.5 + 4, _tmpList3);
    let bestT = maxDist;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (ignoreTag && c.tag === ignoreTag) continue;
      const t = rayBoxCyl(origin, dir, c);
      if (t !== null && t < bestT) { bestT = t; res.hit = true; }
    }
    if (res.hit) {
      res.dist = Math.max(0.05, bestT - 0.06);
      res.point.copy(origin).addScaledVector(dir, res.dist);
    }
    return res;
  }
}

const _tmpList: Collider[] = [];
const _tmpList2: Collider[] = [];
const _tmpList3: Collider[] = [];

function rayBoxCyl(o: Vector3, d: Vector3, c: Collider): number | null {
  let lo = 0, hi = 1e9;
  if (c.type === 'box') {
    const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
    const ox = o.x - c.cx, oz = o.z - c.cz;
    const lox = ox * cs - oz * sn, loz = ox * sn + oz * cs;
    const ldx = d.x * cs - d.z * sn, ldz = d.x * sn + d.z * cs;
    const slab = (oo: number, dd: number, h: number) => {
      if (Math.abs(dd) < 1e-6) return oo < -h || oo > h ? false : true;
      let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > lo) lo = t1;
      if (t2 < hi) hi = t2;
      return hi >= lo;
    };
    if (!slab(lox, ldx, c.hx)) return null;
    if (!slab(o.y - c.cy, d.y, c.hy)) return null;
    if (!slab(loz, ldz, c.hz)) return null;
    return lo >= 0 ? lo : (hi >= 0 ? 0 : null);
  }
  // vertical cylinder
  const ox = o.x - c.cx, oz = o.z - c.cz;
  const a = d.x * d.x + d.z * d.z;
  const b = 2 * (ox * d.x + oz * d.z);
  const cc = ox * ox + oz * oz - c.radius * c.radius;
  let tBest: number | null = null;
  if (a > 1e-8) {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        const y = o.y + d.y * t;
        if (t >= 0 && Math.abs(y - c.cy) <= c.halfHeight) { tBest = tBest === null ? t : Math.min(tBest, t); }
      }
    }
  }
  if (Math.abs(d.y) > 1e-6) {
    for (const sign of [1, -1]) {
      const t = (c.cy + sign * c.halfHeight - o.y) / d.y;
      if (t < 0) continue;
      const x = o.x + d.x * t - c.cx, z = o.z + d.z * t - c.cz;
      if (x * x + z * z <= c.radius * c.radius) tBest = tBest === null ? t : Math.min(tBest, t);
    }
  }
  return tBest;
}

export const physics = new PhysicsWorld();
