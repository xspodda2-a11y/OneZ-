import {
  BufferGeometry, BufferAttribute, Vector3, Color, Float32BufferAttribute, Matrix4, Euler,
} from 'three';
import { BuiltSkeleton } from './Skeleton';

export interface JointSpec {
  b: string;                       // bone name
  o?: [number, number, number];    // offset in that bone's local space
  r: number;                       // radius at this joint
  sx?: number; sz?: number;        // cross-section scale
}

export interface TubeSpec {
  joints: JointSpec[];
  radial?: number;
  rings?: number;              // rings per segment
  mat?: number;
  color: string | number;
  capStart?: boolean;
  capEnd?: boolean;
  uvScale?: number;
  /** rotate the cross-section frame (radians) */
  twist?: number;
  /** wavy hem amplitude (applied increasingly toward the last joint) */
  ripple?: number;
  rippleFreq?: number;
}

export interface BlobSpec {
  bone: string;
  o?: [number, number, number];
  radius: [number, number, number];
  mat?: number;
  color: string | number;
  radial?: number;
  rings?: number;
  /** squash the bottom (for feet / shoes) */
  flatBottom?: number;
  rot?: [number, number, number];
}

const _v = new Vector3();
const _v2 = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _c = new Color();

function col(hex: string | number): [number, number, number] {
  _c.set(hex as any).convertSRGBToLinear();
  return [_c.r, _c.g, _c.b];
}

export class PartBuilder {
  geos: BufferGeometry[] = [];
  mats: number[] = [];

  constructor(private skel: BuiltSkeleton) {}

  /** World-space (bind) position of a joint. */
  private jointPos(j: JointSpec, out: Vector3): Vector3 {
    const b = this.skel.byName[j.b];
    if (!b) throw new Error('unknown bone ' + j.b);
    out.set(j.o ? j.o[0] : 0, j.o ? j.o[1] : 0, j.o ? j.o[2] : 0);
    return out.applyMatrix4(b.matrixWorld);
  }

  private boneIndex(name: string): number {
    const i = this.skel.bones.findIndex((b) => b.name === name);
    return i < 0 ? 0 : i;
  }

  addTube(spec: TubeSpec) {
    const radial = spec.radial ?? 10;
    const rings = spec.rings ?? 3;
    const n = spec.joints.length;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const sIdx: number[] = [];
    const sWt: number[] = [];
    const colors: number[] = [];
    const [cr, cg, cb] = col(spec.color);

    const pts: Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(this.jointPos(spec.joints[i], new Vector3()));

    // cross-section frames per joint
    const frames: { right: Vector3; up: Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      _dir.copy(next).sub(prev).normalize();
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
      const ref = Math.abs(_dir.y) > 0.94 ? _v2.set(1, 0, 0) : _v2.set(0, 1, 0);
      const right = new Vector3().crossVectors(_dir, ref).normalize();
      const up = new Vector3().crossVectors(right, _dir).normalize();
      frames.push({ right, up });
    }

    let vCount = 0;
    const vertRows: number[] = []; // vertex index of first vertex in each ring row
    const rowCount = (n - 1) * rings + 1;
    for (let ri = 0; ri < rowCount; ri++) {
      const segF = ri / rings;
      const si = Math.min(n - 2, Math.floor(segF));
      const t = segF - si;
      const a = pts[si], b = pts[si + 1];
      const ja = spec.joints[si], jb = spec.joints[si + 1];
      const radius = ja.r + (jb.r - ja.r) * t;
      const sx = (ja.sx ?? 1) + ((jb.sx ?? 1) - (ja.sx ?? 1)) * t;
      const sz = (ja.sz ?? 1) + ((jb.sz ?? 1) - (ja.sz ?? 1)) * t;
      _dir.copy(b).sub(a);
      const segLen = _dir.length();
      _dir.normalize();
      const ref = Math.abs(_dir.y) > 0.94 ? _v2.set(1, 0, 0) : _v2.set(0, 1, 0);
      const right = new Vector3().crossVectors(_dir, ref).normalize();
      const up = new Vector3().crossVectors(right, _dir).normalize();
      // smooth the frame to avoid twisting
      if (si > 0 && t < 0.5) { /* keep simple */ }
      const twist = (spec.twist ?? 0) * (ri / Math.max(1, rowCount - 1));
      const ripAmp = (spec.ripple ?? 0) * Math.pow(ri / Math.max(1, rowCount - 1), 1.6);
      const cs = Math.cos(twist), sn = Math.sin(twist);
      const r2 = right.clone().multiplyScalar(cs).addScaledVector(up, sn);
      const u2 = up.clone().multiplyScalar(cs).addScaledVector(right, -sn);

      vertRows.push(vCount);
      const bi0 = this.boneIndex(ja.b), bi1 = this.boneIndex(jb.b);
      // weights: linear between the two joints, with a touch of the previous bone
      const w0 = 1 - t, w1 = t;
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        const cx = Math.cos(ang), cy = Math.sin(ang);
        const rip = ripAmp ? 1 + ripAmp * Math.sin(ang * (spec.rippleFreq ?? 3)) : 1;
        _v.copy(a).addScaledVector(_dir, segLen * t)
          .addScaledVector(r2, cx * radius * sx * rip)
          .addScaledVector(u2, cy * radius * sz * rip);
        positions.push(_v.x, _v.y, _v.z);
        // normal: approximate by the cross-section direction
        _v2.copy(r2).multiplyScalar(cx / Math.max(0.0001, sx)).addScaledVector(u2, cy / Math.max(0.0001, sz)).normalize();
        normals.push(_v2.x, _v2.y, _v2.z);
        uvs.push(k / radial * (spec.uvScale ?? 1), ri / rings * 0.5 * (spec.uvScale ?? 1));
        sIdx.push(bi0, bi1, 0, 0);
        sWt.push(w0 * 0.85 + 0.15, w1 * 0.85, 0, 0);
        const shade = 0.9 + 0.1 * Math.cos(ang);
        colors.push(cr * shade, cg * shade, cb * shade);
        vCount++;
      }
    }

    const idx: number[] = [];
    for (let ri = 0; ri < rowCount - 1; ri++) {
      const a0 = vertRows[ri], b0 = vertRows[ri + 1];
      for (let k = 0; k < radial; k++) {
        const a = a0 + k, b = a0 + k + 1, c = b0 + k, d = b0 + k + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    if (spec.capStart) {
      const c0 = this.jointPos(spec.joints[0], new Vector3());
      const center = vCount;
      positions.push(c0.x, c0.y, c0.z);
      normals.push(0, -1, 0); uvs.push(0.5, 0.5);
      sIdx.push(this.boneIndex(spec.joints[0].b), 0, 0, 0); sWt.push(1, 0, 0, 0);
      colors.push(cr, cg, cb);
      vCount++;
      for (let k = 0; k < radial; k++) idx.push(center, vertRows[0] + k + 1, vertRows[0] + k);
    }
    if (spec.capEnd) {
      const c0 = this.jointPos(spec.joints[n - 1], new Vector3());
      const center = vCount;
      positions.push(c0.x, c0.y, c0.z);
      normals.push(0, 1, 0); uvs.push(0.5, 0.5);
      sIdx.push(this.boneIndex(spec.joints[n - 1].b), 0, 0, 0); sWt.push(1, 0, 0, 0);
      colors.push(cr, cg, cb);
      vCount++;
      const last = vertRows[rowCount - 1];
      for (let k = 0; k < radial; k++) idx.push(center, last + k, last + k + 1);
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(sIdx), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sWt, 4));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    this.geos.push(g);
    this.mats.push(spec.mat ?? 0);
    return g;
  }

  addBlob(spec: BlobSpec) {
    const b = this.skel.byName[spec.bone];
    const radial = spec.radial ?? 12;
    const rings = spec.rings ?? 10;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const sIdx: number[] = [];
    const sWt: number[] = [];
    const colors: number[] = [];
    const [cr, cg, cb] = col(spec.color);
    const bi = this.boneIndex(spec.bone);
    const off = new Vector3(...(spec.o ?? [0, 0, 0])).applyMatrix4(b.matrixWorld);
    const rotM = new Matrix4();
    if (spec.rot) rotM.makeRotationFromEuler(new Euler(spec.rot[0], spec.rot[1], spec.rot[2]));
    const lp = new Vector3();
    const rows: number[] = [];
    let v = 0;
    for (let y = 0; y <= rings; y++) {
      const phi = (y / rings) * Math.PI;
      rows.push(v);
      for (let x = 0; x <= radial; x++) {
        const theta = (x / radial) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        let rx = nx * spec.radius[0];
        let ry = ny * spec.radius[1];
        let rz = nz * spec.radius[2];
        if (spec.flatBottom && ry < 0) ry *= 1 - spec.flatBottom;
        lp.set(rx, ry, rz).applyMatrix4(rotM);
        positions.push(off.x + lp.x, off.y + lp.y, off.z + lp.z);
        const nl = Math.hypot(lp.x, lp.y, lp.z) || 1;
        normals.push(lp.x / nl, lp.y / nl, lp.z / nl);
        uvs.push(x / radial, y / rings);
        sIdx.push(bi, 0, 0, 0); sWt.push(1, 0, 0, 0);
        const shade = 0.88 + 0.12 * (ny * 0.5 + 0.5);
        colors.push(cr * shade, cg * shade, cb * shade);
        v++;
      }
    }
    const idx: number[] = [];
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < radial; x++) {
        const a = rows[y] + x, b2 = rows[y] + x + 1, c = rows[y + 1] + x, d = rows[y + 1] + x + 1;
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(sIdx), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sWt, 4));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    this.geos.push(g);
    this.mats.push(spec.mat ?? 0);
    return g;
  }
}
