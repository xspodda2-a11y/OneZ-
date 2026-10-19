import { Quaternion, Vector3, Euler } from 'three';
import { BONE_DEFS, BONE_NAMES, BuiltSkeleton } from './Skeleton';

/**
 * Poses are authored as EITHER
 *  - euler degrees  [rx, ry, rz]  (spine, chest, neck, head, shoulders, hem, hair)
 *  - aim directions [dx, dy, dz]  (limb bones) expressed in TORSO space
 *     +Z forward, +Y up, +X = character's LEFT. An optional 4th value adds twist (degrees)
 *     about the bone axis.
 * Missing bones fall back to the skeleton rest pose, so keyframes stay compact.
 */
export type PoseValue = [number, number, number] | [number, number, number, number];
export type Pose = Record<string, PoseValue>;

export interface ClipKey {
  t: number;
  p: Pose;
  /** extra root offsets (metres) applied on top of the auto-ground solve */
  rootY?: number;
}
export interface ClipDef {
  name: string;
  dur: number;
  loop: boolean;
  keys: ClipKey[];
  /** solve the root height so the lowest foot touches y=0 */
  ground?: boolean;
  /** don't move the root vertically at all (air / swim poses) */
  noGround?: boolean;
  /** clip is blended on top of the current locomotion pose */
  overlay?: boolean;
  /** bones this overlay drives (defaults to every bone present in the clip) */
  mask?: string[];
  /** extra root displacement driven by the clip (metres, torso space) */
  motion?: { t: number; v: [number, number, number] }[];
}

export interface CompiledClip {
  name: string;
  dur: number;
  loop: boolean;
  ground: boolean;
  overlay: boolean;
  /** per key: array aligned to bone list of quaternions (null = rest) */
  keys: { t: number; q: (Quaternion | null)[]; rootY: number; motion: [number, number, number] }[];
  mask: boolean[];
  motionTimes: number[];
}

const LIMB = new Set([
  'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR',
]);

/** Direction from a bone to its first child, in the bone's own local frame. */
const BONE_AXIS: Record<string, Vector3> = {
  upperArmL: new Vector3(1, 0, 0), upperArmR: new Vector3(-1, 0, 0),
  foreArmL: new Vector3(1, 0, 0), foreArmR: new Vector3(-1, 0, 0),
  handL: new Vector3(1, 0, 0), handR: new Vector3(-1, 0, 0),
  thighL: new Vector3(0, -1, 0), thighR: new Vector3(0, -1, 0),
  shinL: new Vector3(0, -1, 0), shinR: new Vector3(0, -1, 0),
  footL: new Vector3(0, -0.39, 0.92).normalize(), footR: new Vector3(0, -0.39, 0.92).normalize(),
};

const _v = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler();

export function compileClip(def: ClipDef, skel: BuiltSkeleton): CompiledClip {
  const n = skel.bones.length;
  const nameToIndex = new Map<string, number>();
  skel.bones.forEach((b, i) => nameToIndex.set(b.name, i));
  const childAxis: Vector3[] = skel.bones.map((b) => {
    const axis = BONE_AXIS[b.name];
    if (axis) return axis.clone();
    // fall back to the first child's offset direction
    if (b.children.length) {
      const c = b.children[0];
      const v = new Vector3(c.position.x, c.position.y, c.position.z);
      if (v.lengthSq() < 1e-8) return new Vector3(0, 1, 0);
      return v.normalize();
    }
    return new Vector3(0, 1, 0);
  });

  const keys = def.keys.map((k) => {
    // 1) resolve local rotations for all bones, walking parents first
    const localQ: Quaternion[] = skel.bones.map((b, i) => skel.restQuat[i].clone());
    const worldQ: Quaternion[] = new Array(n);
    const poseVals = new Map<string, PoseValue>();
    for (const key in k.p) poseVals.set(key, k.p[key]);

    for (let i = 0; i < n; i++) {
      const bone = skel.bones[i];
      const def2 = BONE_DEFS[i];
      const parentIdx = def2.parent ? nameToIndex.get(def2.parent)! : -1;
      const parentWorld = parentIdx >= 0 ? worldQ[parentIdx] : new Quaternion();
      const pv = poseVals.get(bone.name);
      if (pv === undefined) {
        localQ[i] = skel.restQuat[i].clone();
      } else if (LIMB.has(bone.name)) {
        const axis = childAxis[i];
        const dir = _v.set(pv[0], pv[1], pv[2]).normalize().clone();
        // express the aim direction in the parent's frame
        const local = dir.clone().applyQuaternion(parentWorld.clone().invert());
        const q = new Quaternion().setFromUnitVectors(axis, local);
        if (pv.length > 3 && pv[3]) {
          const roll = new Quaternion().setFromAxisAngle(axis, (pv[3] as number) * Math.PI / 180);
          q.multiply(roll);
        }
        localQ[i] = q;
      } else {
        _e.set(pv[0] * Math.PI / 180, pv[1] * Math.PI / 180, pv[2] * Math.PI / 180, 'XYZ');
        localQ[i] = new Quaternion().setFromEuler(_e);
      }
      worldQ[i] = parentWorld.clone().multiply(localQ[i]);
    }

    // 2) forward-kinematics to auto-solve root height
    let rootY = 0;
    if (!def.noGround) {
      const positions: Vector3[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const def2 = BONE_DEFS[i];
        const parentIdx = def2.parent ? nameToIndex.get(def2.parent)! : -1;
        const p = new Vector3(def2.p[0], def2.p[1], def2.p[2]).applyQuaternion(parentIdx >= 0 ? worldQ[parentIdx] : new Quaternion());
        positions[i] = parentIdx >= 0 ? positions[parentIdx].clone().add(p) : p;
      }
      let lowest = Infinity;
      for (let i = 0; i < n; i++) {
        const nm = BONE_NAMES[i];
        if (nm !== 'footL' && nm !== 'footR' && nm !== 'toeL' && nm !== 'toeR') continue;
        lowest = Math.min(lowest, positions[i].y);
      }
      if (lowest !== Infinity) rootY = -lowest;
    }
    rootY += k.rootY ?? 0;

    // 3) store nulls where the pose didn't specify a bone
    const q: (Quaternion | null)[] = new Array(n);
    for (let i = 0; i < n; i++) q[i] = poseVals.has(BONE_NAMES[i]) ? localQ[i] : null;
    return { t: k.t, q, rootY, motion: [0, 0, 0] as [number, number, number] };
  });

  // motion keys
  const motionTimes: number[] = [];
  if (def.motion) {
    for (const m of def.motion) {
      let best = keys[0], bestD = Infinity;
      for (const k of keys) { const d = Math.abs(k.t - m.t); if (d < bestD) { bestD = d; best = k; } }
      best.motion = m.v;
      motionTimes.push(m.t);
    }
  }

  const mask: boolean[] = new Array(n).fill(false);
  if (def.overlay) {
    if (def.mask) for (const m of def.mask) mask[nameToIndex.get(m)!] = true;
    else {
      for (const k of keys) for (let i = 0; i < n; i++) if (k.q[i]) mask[i] = true;
    }
  }

  return {
    name: def.name, dur: def.dur, loop: def.loop, ground: !def.noGround && def.ground !== false,
    overlay: !!def.overlay, keys, mask, motionTimes,
  };
}

/* ============================================================================
   CLIP LIBRARY
   ========================================================================== */

const REST_FOOT: [number, number, number] = [0, -0.39, 0.92];

export const CLIPS: ClipDef[] = [
  /* ------------------------------------------------------------ idle */
  {
    name: 'idle', dur: 3.4, loop: true, keys: [
      { t: 0, p: {
        spine: [1.5, 0, 0], chest: [-1, 0, 0], head: [1, 0, 0],
        upperArmL: [0.32, -0.93, 0.16], foreArmL: [0.36, -0.86, 0.36], handL: [0.4, -0.7, 0.58],
        upperArmR: [-0.32, -0.93, 0.16], foreArmR: [-0.36, -0.86, 0.36], handR: [-0.4, -0.7, 0.58],
        thighL: [0.03, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.03, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
      { t: 1.7, p: {
        spine: [3, 0, 0], chest: [-2, 0, 0], head: [-1, 2, 0],
        upperArmL: [0.34, -0.92, 0.19], foreArmL: [0.38, -0.85, 0.39], handL: [0.42, -0.68, 0.6],
        upperArmR: [-0.34, -0.92, 0.19], foreArmR: [-0.38, -0.85, 0.39], handR: [-0.42, -0.68, 0.6],
        thighL: [0.03, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.03, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
      { t: 3.4, p: {
        spine: [1.5, 0, 0], chest: [-1, 0, 0], head: [1, 0, 0],
        upperArmL: [0.32, -0.93, 0.16], foreArmL: [0.36, -0.86, 0.36], handL: [0.4, -0.7, 0.58],
        upperArmR: [-0.32, -0.93, 0.16], foreArmR: [-0.36, -0.86, 0.36], handR: [-0.4, -0.7, 0.58],
        thighL: [0.03, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.03, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
    ],
  },
  /* ------------------------------------------------------------ combat idle */
  {
    name: 'combatIdle', dur: 2.2, loop: true, keys: [
      { t: 0, p: {
        hips: [0, 0, 0], spine: [4, 14, 0], chest: [1, 7, 0], neck: [-3, 0, 0], head: [2, -6, 0],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95], handL: [0.34, 0.35, 0.87],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95], handR: [-0.20, 0.55, 0.81],
        thighL: [0.0, -0.93, 0.36], shinL: [0, -0.97, -0.24], footL: [0, -0.36, 0.93],
        thighR: [-0.02, -0.93, -0.34], shinR: [0, -0.99, 0.14], footR: [0, -0.36, 0.93],
      } },
      { t: 1.1, p: {
        hips: [0, 0, 0], spine: [5.5, 15, 0], chest: [1.5, 8, 0], neck: [-2, 0, 0], head: [1, -7, 0],
        upperArmL: [0.46, -0.60, 0.66], foreArmL: [0.31, 0.12, 0.94], handL: [0.35, 0.37, 0.86],
        upperArmR: [-0.31, -0.60, 0.73], foreArmR: [-0.17, 0.30, 0.94], handR: [-0.21, 0.57, 0.80],
        thighL: [0.0, -0.93, 0.37], shinL: [0, -0.97, -0.25], footL: [0, -0.36, 0.93],
        thighR: [-0.02, -0.93, -0.35], shinR: [0, -0.99, 0.15], footR: [0, -0.36, 0.93],
      } },
      { t: 2.2, p: {
        hips: [0, 0, 0], spine: [4, 14, 0], chest: [1, 7, 0], neck: [-3, 0, 0], head: [2, -6, 0],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95], handL: [0.34, 0.35, 0.87],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95], handR: [-0.20, 0.55, 0.81],
        thighL: [0.0, -0.93, 0.36], shinL: [0, -0.97, -0.24], footL: [0, -0.36, 0.93],
        thighR: [-0.02, -0.93, -0.34], shinR: [0, -0.99, 0.14], footR: [0, -0.36, 0.93],
      } },
    ],
  },
  /* ------------------------------------------------------------ walk */
  {
    name: 'walk', dur: 1.1, loop: true, keys: [
      { t: 0, p: {
        spine: [3, -3, 0], chest: [0, 4, 0], head: [0, 2, 0],
        upperArmL: [0.30, -0.93, 0.20], foreArmL: [0.34, -0.86, 0.38],
        upperArmR: [-0.30, -0.93, -0.20], foreArmR: [-0.34, -0.86, -0.30],
        thighL: [0, -0.96, 0.28], shinL: [0, -0.99, 0.02], footL: [0, -0.16, 0.99],
        thighR: [0, -0.96, -0.28], shinR: [0, -0.90, 0.42], footR: [0, 0.16, 0.99],
      }, rootY: 0.0 },
      { t: 0.275, p: {
        spine: [3, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
        upperArmL: [0.30, -0.94, 0.0], foreArmL: [0.34, -0.88, 0.1],
        upperArmR: [-0.30, -0.94, 0.0], foreArmR: [-0.34, -0.88, -0.1],
        thighL: [0, -0.995, 0.03], shinL: [0, -1, -0.02], footL: [0, -0.39, 0.92],
        thighR: [0, -0.86, 0.5], shinR: [0, -0.80, -0.58], footR: [0, -0.30, 0.95],
      }, rootY: 0.03 },
      { t: 0.55, p: {
        spine: [3, 3, 0], chest: [0, -4, 0], head: [0, -2, 0],
        upperArmL: [0.30, -0.93, -0.20], foreArmL: [0.34, -0.86, -0.30],
        upperArmR: [-0.30, -0.93, 0.20], foreArmR: [-0.34, -0.86, 0.38],
        thighL: [0, -0.96, -0.28], shinL: [0, -0.90, 0.42], footL: [0, 0.16, 0.99],
        thighR: [0, -0.96, 0.28], shinR: [0, -0.99, 0.02], footR: [0, -0.16, 0.99],
      }, rootY: 0.0 },
      { t: 0.825, p: {
        spine: [3, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
        upperArmL: [0.30, -0.94, 0.0], foreArmL: [0.34, -0.88, -0.1],
        upperArmR: [-0.30, -0.94, 0.0], foreArmR: [-0.34, -0.88, 0.1],
        thighL: [0, -0.86, 0.5], shinL: [0, -0.80, -0.58], footL: [0, -0.30, 0.95],
        thighR: [0, -0.995, 0.03], shinR: [0, -1, -0.02], footR: [0, -0.39, 0.92],
      }, rootY: 0.03 },
      { t: 1.1, p: {
        spine: [3, -3, 0], chest: [0, 4, 0], head: [0, 2, 0],
        upperArmL: [0.30, -0.93, 0.20], foreArmL: [0.34, -0.86, 0.38],
        upperArmR: [-0.30, -0.93, -0.20], foreArmR: [-0.34, -0.86, -0.30],
        thighL: [0, -0.96, 0.28], shinL: [0, -0.99, 0.02], footL: [0, -0.16, 0.99],
        thighR: [0, -0.96, -0.28], shinR: [0, -0.90, 0.42], footR: [0, 0.16, 0.99],
      }, rootY: 0.0 },
    ],
  },
  /* ------------------------------------------------------------ run */
  {
    name: 'run', dur: 0.72, loop: true, keys: [
      { t: 0, p: {
        spine: [10, -6, 0], chest: [2, 8, 0], head: [-6, 3, 0],
        upperArmL: [0.30, -0.80, 0.52], foreArmL: [0.36, -0.52, 0.78],
        upperArmR: [-0.30, -0.80, -0.52], foreArmR: [-0.36, -0.52, -0.72],
        thighL: [0, -0.86, 0.51], shinL: [0, -0.82, -0.57], footL: [0, -0.28, 0.96],
        thighR: [0, -0.94, -0.34], shinR: [0, -0.80, 0.60], footR: [0, 0.30, 0.95],
      }, rootY: 0.02 },
      { t: 0.18, p: {
        spine: [11, 0, 0], chest: [2, 0, 0], head: [-7, 0, 0],
        upperArmL: [0.32, -0.84, 0.10], foreArmL: [0.38, -0.70, 0.30],
        upperArmR: [-0.32, -0.84, -0.10], foreArmR: [-0.38, -0.70, -0.30],
        thighL: [0, -0.99, 0.14], shinL: [0, -0.96, -0.28], footL: [0, -0.38, 0.92],
        thighR: [0, -0.62, 0.78], shinR: [0, -0.72, -0.69], footR: [0, -0.20, 0.98],
      }, rootY: 0.07 },
      { t: 0.36, p: {
        spine: [10, 6, 0], chest: [2, -8, 0], head: [-6, -3, 0],
        upperArmL: [0.30, -0.80, -0.52], foreArmL: [0.36, -0.52, -0.72],
        upperArmR: [-0.30, -0.80, 0.52], foreArmR: [-0.36, -0.52, 0.78],
        thighL: [0, -0.94, -0.34], shinL: [0, -0.80, 0.60], footL: [0, 0.30, 0.95],
        thighR: [0, -0.86, 0.51], shinR: [0, -0.82, -0.57], footR: [0, -0.28, 0.96],
      }, rootY: 0.02 },
      { t: 0.54, p: {
        spine: [11, 0, 0], chest: [2, 0, 0], head: [-7, 0, 0],
        upperArmL: [0.32, -0.84, -0.10], foreArmL: [0.38, -0.70, -0.30],
        upperArmR: [-0.32, -0.84, 0.10], foreArmR: [-0.38, -0.70, 0.30],
        thighL: [0, -0.62, 0.78], shinL: [0, -0.72, -0.69], footL: [0, -0.20, 0.98],
        thighR: [0, -0.99, 0.14], shinR: [0, -0.96, -0.28], footR: [0, -0.38, 0.92],
      }, rootY: 0.07 },
      { t: 0.72, p: {
        spine: [10, -6, 0], chest: [2, 8, 0], head: [-6, 3, 0],
        upperArmL: [0.30, -0.80, 0.52], foreArmL: [0.36, -0.52, 0.78],
        upperArmR: [-0.30, -0.80, -0.52], foreArmR: [-0.36, -0.52, -0.72],
        thighL: [0, -0.86, 0.51], shinL: [0, -0.82, -0.57], footL: [0, -0.28, 0.96],
        thighR: [0, -0.94, -0.34], shinR: [0, -0.80, 0.60], footR: [0, 0.30, 0.95],
      }, rootY: 0.02 },
    ],
  },
  /* ------------------------------------------------------------ sprint */
  {
    name: 'sprint', dur: 0.58, loop: true, keys: [
      { t: 0, p: {
        spine: [18, -8, 0], chest: [4, 10, 0], head: [-13, 4, 0],
        upperArmL: [0.34, -0.62, 0.71], foreArmL: [0.40, -0.30, 0.91],
        upperArmR: [-0.34, -0.62, -0.71], foreArmR: [-0.40, -0.30, -0.85],
        thighL: [0, -0.72, 0.70], shinL: [0, -0.70, -0.71], footL: [0, -0.22, 0.97],
        thighR: [0, -0.90, -0.44], shinR: [0, -0.70, 0.71], footR: [0, 0.34, 0.94],
      }, rootY: 0.03 },
      { t: 0.145, p: {
        spine: [19, 0, 0], chest: [4, 0, 0], head: [-14, 0, 0],
        upperArmL: [0.36, -0.70, 0.16], foreArmL: [0.42, -0.44, 0.42],
        upperArmR: [-0.36, -0.70, -0.16], foreArmR: [-0.42, -0.44, -0.42],
        thighL: [0, -0.98, 0.20], shinL: [0, -0.90, -0.43], footL: [0, -0.38, 0.92],
        thighR: [0, -0.45, 0.89], shinR: [0, -0.62, -0.78], footR: [0, -0.10, 0.99],
      }, rootY: 0.09 },
      { t: 0.29, p: {
        spine: [18, 8, 0], chest: [4, -10, 0], head: [-13, -4, 0],
        upperArmL: [0.34, -0.62, -0.71], foreArmL: [0.40, -0.30, -0.85],
        upperArmR: [-0.34, -0.62, 0.71], foreArmR: [-0.40, -0.30, 0.91],
        thighL: [0, -0.90, -0.44], shinL: [0, -0.70, 0.71], footL: [0, 0.34, 0.94],
        thighR: [0, -0.72, 0.70], shinR: [0, -0.70, -0.71], footR: [0, -0.22, 0.97],
      }, rootY: 0.03 },
      { t: 0.435, p: {
        spine: [19, 0, 0], chest: [4, 0, 0], head: [-14, 0, 0],
        upperArmL: [0.36, -0.70, -0.16], foreArmL: [0.42, -0.44, -0.42],
        upperArmR: [-0.36, -0.70, 0.16], foreArmR: [-0.42, -0.44, 0.42],
        thighL: [0, -0.45, 0.89], shinL: [0, -0.62, -0.78], footL: [0, -0.10, 0.99],
        thighR: [0, -0.98, 0.20], shinR: [0, -0.90, -0.43], footR: [0, -0.38, 0.92],
      }, rootY: 0.09 },
      { t: 0.58, p: {
        spine: [18, -8, 0], chest: [4, 10, 0], head: [-13, 4, 0],
        upperArmL: [0.34, -0.62, 0.71], foreArmL: [0.40, -0.30, 0.91],
        upperArmR: [-0.34, -0.62, -0.71], foreArmR: [-0.40, -0.30, -0.85],
        thighL: [0, -0.72, 0.70], shinL: [0, -0.70, -0.71], footL: [0, -0.22, 0.97],
        thighR: [0, -0.90, -0.44], shinR: [0, -0.70, 0.71], footR: [0, 0.34, 0.94],
      }, rootY: 0.03 },
    ],
  },
  /* ------------------------------------------------------------ jump / air / land */
  {
    name: 'jump', dur: 0.34, loop: false, keys: [
      { t: 0, p: {
        spine: [14, 0, 0], chest: [4, 0, 0], head: [-4, 0, 0],
        upperArmL: [0.34, -0.72, 0.60], foreArmL: [0.36, -0.55, 0.75],
        upperArmR: [-0.34, -0.72, 0.60], foreArmR: [-0.36, -0.55, 0.75],
        thighL: [0, -0.80, 0.60], shinL: [0, -0.85, -0.52], footL: [0, -0.20, 0.98],
        thighR: [0, -0.80, 0.60], shinR: [0, -0.85, -0.52], footR: [0, -0.20, 0.98],
      } },
      { t: 0.16, p: {
        spine: [-4, 0, 0], chest: [-2, 0, 0], head: [4, 0, 0],
        upperArmL: [0.40, -0.30, 0.86], foreArmL: [0.42, 0.15, 0.89],
        upperArmR: [-0.40, -0.30, 0.86], foreArmR: [-0.42, 0.15, 0.89],
        thighL: [0, -0.99, 0.14], shinL: [0, -0.98, -0.20], footL: [0, -0.10, 0.99],
        thighR: [0, -0.99, 0.14], shinR: [0, -0.98, -0.20], footR: [0, -0.10, 0.99],
      }, rootY: 0.05 },
      { t: 0.34, p: {
        spine: [-6, 0, 0], chest: [-3, 0, 0], head: [6, 0, 0],
        upperArmL: [0.45, 0.10, 0.89], foreArmL: [0.46, 0.45, 0.76],
        upperArmR: [-0.45, 0.10, 0.89], foreArmR: [-0.46, 0.45, 0.76],
        thighL: [0, -0.86, -0.50], shinL: [0, -0.72, 0.69], footL: [0, 0.10, 0.99],
        thighR: [0, -0.92, 0.38], shinR: [0, -0.90, -0.43], footR: [0, -0.30, 0.95],
      }, rootY: 0.02 },
    ],
  },
  {
    name: 'air', dur: 1.0, loop: true, noGround: true, keys: [
      { t: 0, p: {
        spine: [-4, 0, 0], chest: [-2, 0, 0], head: [4, 0, 0],
        upperArmL: [0.48, 0.05, 0.87], foreArmL: [0.50, 0.40, 0.77],
        upperArmR: [-0.48, 0.05, 0.87], foreArmR: [-0.50, 0.40, 0.77],
        thighL: [0, -0.90, 0.44], shinL: [0, -0.88, -0.47], footL: [0, -0.25, 0.97],
        thighR: [0, -0.94, -0.34], shinR: [0, -0.95, 0.30], footR: [0, 0.05, 0.99],
      } },
      { t: 0.5, p: {
        spine: [-6, 0, 0], chest: [-3, 0, 0], head: [5, 0, 0],
        upperArmL: [0.52, 0.14, 0.84], foreArmL: [0.54, 0.50, 0.67],
        upperArmR: [-0.52, 0.14, 0.84], foreArmR: [-0.54, 0.50, 0.67],
        thighL: [0, -0.92, 0.38], shinL: [0, -0.90, -0.43], footL: [0, -0.22, 0.97],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.92, 0.38], footR: [0, 0.02, 0.99],
      } },
      { t: 1.0, p: {
        spine: [-4, 0, 0], chest: [-2, 0, 0], head: [4, 0, 0],
        upperArmL: [0.48, 0.05, 0.87], foreArmL: [0.50, 0.40, 0.77],
        upperArmR: [-0.48, 0.05, 0.87], foreArmR: [-0.50, 0.40, 0.77],
        thighL: [0, -0.90, 0.44], shinL: [0, -0.88, -0.47], footL: [0, -0.25, 0.97],
        thighR: [0, -0.94, -0.34], shinR: [0, -0.95, 0.30], footR: [0, 0.05, 0.99],
      } },
    ],
  },
  {
    name: 'land', dur: 0.42, loop: false, keys: [
      { t: 0, p: {
        spine: [8, 0, 0], chest: [2, 0, 0], head: [0, 0, 0],
        upperArmL: [0.42, -0.55, 0.72], foreArmL: [0.44, -0.35, 0.83],
        upperArmR: [-0.42, -0.55, 0.72], foreArmR: [-0.44, -0.35, 0.83],
        thighL: [0, -0.84, 0.54], shinL: [0, -0.86, -0.50], footL: [0, -0.35, 0.94],
        thighR: [0, -0.84, 0.54], shinR: [0, -0.86, -0.50], footR: [0, -0.35, 0.94],
      } },
      { t: 0.14, p: {
        spine: [16, 0, 0], chest: [6, 0, 0], head: [-6, 0, 0],
        upperArmL: [0.36, -0.72, 0.59], foreArmL: [0.36, -0.60, 0.71],
        upperArmR: [-0.36, -0.72, 0.59], foreArmR: [-0.36, -0.60, 0.71],
        thighL: [0, -0.72, 0.70], shinL: [0, -0.78, -0.62], footL: [0, -0.39, 0.92],
        thighR: [0, -0.72, 0.70], shinR: [0, -0.78, -0.62], footR: [0, -0.39, 0.92],
      } },
      { t: 0.42, p: {
        spine: [6, 0, 0], chest: [1, 0, 0], head: [0, 0, 0],
        upperArmL: [0.33, -0.86, 0.38], foreArmL: [0.36, -0.80, 0.48],
        upperArmR: [-0.33, -0.86, 0.38], foreArmR: [-0.36, -0.80, 0.48],
        thighL: [0, -0.94, 0.34], shinL: [0, -0.95, -0.31], footL: [0, -0.39, 0.92],
        thighR: [0, -0.94, 0.34], shinR: [0, -0.95, -0.31], footR: [0, -0.39, 0.92],
      } },
    ],
  },
  /* ------------------------------------------------------------ dodge roll */
  {
    name: 'dodge', dur: 0.72, loop: false, keys: [
      { t: 0, p: {
        spine: [10, 0, 0], chest: [3, 0, 0],
        upperArmL: [0.40, -0.70, 0.59], foreArmL: [0.40, -0.60, 0.69],
        upperArmR: [-0.40, -0.70, 0.59], foreArmR: [-0.40, -0.60, 0.69],
        thighL: [0, -0.80, 0.60], shinL: [0, -0.82, -0.57], footL: [0, -0.30, 0.95],
        thighR: [0, -0.80, 0.60], shinR: [0, -0.82, -0.57], footR: [0, -0.30, 0.95],
      } },
      { t: 0.18, p: {
        hips: [55, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], head: [-14, 0, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [0.20, -0.30, 0.93],
        upperArmR: [-0.30, -0.55, 0.78], foreArmR: [-0.20, -0.30, 0.93],
        thighL: [0, -0.55, 0.84], shinL: [0, -0.30, 0.95], footL: [0, 0.05, 0.99],
        thighR: [0, -0.55, 0.84], shinR: [0, -0.30, 0.95], footR: [0, 0.05, 0.99],
      } },
      { t: 0.36, p: {
        hips: [145, 0, 0], spine: [14, 0, 0], chest: [8, 0, 0], head: [-16, 0, 0],
        upperArmL: [0.20, -0.20, 0.96], foreArmL: [0.05, 0.05, 0.99],
        upperArmR: [-0.20, -0.20, 0.96], foreArmR: [-0.05, 0.05, 0.99],
        thighL: [0, -0.20, 0.98], shinL: [0, 0.10, 0.99], footL: [0, 0.20, 0.98],
        thighR: [0, -0.20, 0.98], shinR: [0, 0.10, 0.99], footR: [0, 0.20, 0.98],
      } },
      { t: 0.54, p: {
        hips: [235, 0, 0], spine: [12, 0, 0], chest: [6, 0, 0], head: [-12, 0, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [0.20, -0.30, 0.93],
        upperArmR: [-0.30, -0.55, 0.78], foreArmR: [-0.20, -0.30, 0.93],
        thighL: [0, -0.55, 0.84], shinL: [0, -0.30, 0.95], footL: [0, 0.05, 0.99],
        thighR: [0, -0.55, 0.84], shinR: [0, -0.30, 0.95], footR: [0, 0.05, 0.99],
      } },
      { t: 0.72, p: {
        hips: [340, 0, 0], spine: [8, 0, 0], chest: [2, 0, 0], head: [-4, 0, 0],
        upperArmL: [0.40, -0.70, 0.59], foreArmL: [0.40, -0.60, 0.69],
        upperArmR: [-0.40, -0.70, 0.59], foreArmR: [-0.40, -0.60, 0.69],
        thighL: [0, -0.82, 0.57], shinL: [0, -0.80, -0.59], footL: [0, -0.30, 0.95],
        thighR: [0, -0.82, 0.57], shinR: [0, -0.80, -0.59], footR: [0, -0.30, 0.95],
      } },
    ],
    motion: [{ t: 0, v: [0, 0, 0] }, { t: 0.18, v: [0, 0, 2.6] }, { t: 0.36, v: [0, 0, 3.4] }, { t: 0.54, v: [0, 0, 2.4] }, { t: 0.72, v: [0, 0, 0.8] }],
  },
  /* ------------------------------------------------------------ block / parry */
  {
    name: 'block', dur: 1.4, loop: true, keys: [
      { t: 0, p: {
        spine: [6, 18, 0], chest: [2, 10, 0], head: [0, -8, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [-0.05, 0.10, 0.99],
        upperArmR: [-0.34, -0.50, 0.80], foreArmR: [-0.62, 0.12, 0.77],
        thighL: [0, -0.90, 0.43], shinL: [0, -0.94, -0.34], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.96, 0.26], footR: [0, -0.39, 0.92],
      } },
      { t: 0.7, p: {
        spine: [7, 19, 0], chest: [2.5, 11, 0], head: [-1, -8, 0],
        upperArmL: [0.31, -0.54, 0.78], foreArmL: [-0.04, 0.12, 0.99],
        upperArmR: [-0.35, -0.49, 0.80], foreArmR: [-0.63, 0.14, 0.76],
        thighL: [0, -0.90, 0.44], shinL: [0, -0.94, -0.35], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.39], shinR: [0, -0.96, 0.27], footR: [0, -0.39, 0.92],
      } },
      { t: 1.4, p: {
        spine: [6, 18, 0], chest: [2, 10, 0], head: [0, -8, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [-0.05, 0.10, 0.99],
        upperArmR: [-0.34, -0.50, 0.80], foreArmR: [-0.62, 0.12, 0.77],
        thighL: [0, -0.90, 0.43], shinL: [0, -0.94, -0.34], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.96, 0.26], footR: [0, -0.39, 0.92],
      } },
    ],
  },
  {
    name: 'parry', dur: 0.55, loop: false, keys: [
      { t: 0, p: {
        spine: [4, 16, 0], chest: [2, 8, 0], head: [0, -6, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [-0.05, 0.10, 0.99],
        upperArmR: [-0.34, -0.50, 0.80], foreArmR: [-0.62, 0.12, 0.77],
        thighL: [0, -0.90, 0.43], shinL: [0, -0.94, -0.34], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.96, 0.26], footR: [0, -0.39, 0.92],
      } },
      { t: 0.18, p: {
        spine: [-2, -10, 0], chest: [0, -6, 0], head: [4, 6, 0],
        upperArmL: [0.55, -0.35, 0.76], foreArmL: [0.70, 0.10, 0.70],
        upperArmR: [-0.20, -0.20, 0.96], foreArmR: [-0.30, 0.35, 0.88],
        thighL: [0, -0.94, 0.34], shinL: [0, -0.96, -0.28], footL: [0, -0.39, 0.92],
        thighR: [0, -0.90, -0.43], shinR: [0, -0.94, 0.34], footR: [0, -0.39, 0.92],
      } },
      { t: 0.55, p: {
        spine: [4, 16, 0], chest: [2, 8, 0], head: [0, -6, 0],
        upperArmL: [0.30, -0.55, 0.78], foreArmL: [-0.05, 0.10, 0.99],
        upperArmR: [-0.34, -0.50, 0.80], foreArmR: [-0.62, 0.12, 0.77],
        thighL: [0, -0.90, 0.43], shinL: [0, -0.94, -0.34], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.96, 0.26], footR: [0, -0.39, 0.92],
      } },
    ],
  },
  /* ------------------------------------------------------------ hit / death */
  {
    name: 'hit', dur: 0.42, loop: false, keys: [
      { t: 0, p: {
        spine: [-8, 0, 0], chest: [-4, 0, 0], head: [-10, 0, 0],
        upperArmL: [0.42, -0.72, 0.55], foreArmL: [0.44, -0.62, 0.65],
        upperArmR: [-0.42, -0.72, 0.55], foreArmR: [-0.44, -0.62, 0.65],
        thighL: [0, -0.95, -0.30], shinL: [0, -0.97, 0.24], footL: [0, -0.39, 0.92],
        thighR: [0, -0.95, -0.30], shinR: [0, -0.97, 0.24], footR: [0, -0.39, 0.92],
      } },
      { t: 0.14, p: {
        spine: [-14, 6, 0], chest: [-8, 4, 0], head: [-16, 6, 0],
        upperArmL: [0.55, -0.55, 0.62], foreArmL: [0.58, -0.40, 0.71],
        upperArmR: [-0.55, -0.55, 0.62], foreArmR: [-0.58, -0.40, 0.71],
        thighL: [0, -0.92, -0.38], shinL: [0, -0.94, 0.34], footL: [0, -0.39, 0.92],
        thighR: [0, -0.92, -0.38], shinR: [0, -0.94, 0.34], footR: [0, -0.39, 0.92],
      } },
      { t: 0.42, p: {
        spine: [-2, 0, 0], chest: [-1, 0, 0], head: [-2, 0, 0],
        upperArmL: [0.35, -0.86, 0.36], foreArmL: [0.38, -0.80, 0.46],
        upperArmR: [-0.35, -0.86, 0.36], foreArmR: [-0.38, -0.80, 0.46],
        thighL: [0, -0.97, 0.22], shinL: [0, -0.99, -0.14], footL: [0, -0.39, 0.92],
        thighR: [0, -0.97, -0.22], shinR: [0, -0.99, 0.14], footR: [0, -0.39, 0.92],
      } },
    ],
  },
  {
    name: 'death', dur: 2.0, loop: false, keys: [
      { t: 0, p: {
        spine: [-6, 0, 0], chest: [-4, 0, 0], head: [-12, 0, 0],
        upperArmL: [0.42, -0.72, 0.55], foreArmL: [0.44, -0.62, 0.65],
        upperArmR: [-0.42, -0.72, 0.55], foreArmR: [-0.44, -0.62, 0.65],
        thighL: [0, -0.95, -0.30], shinL: [0, -0.97, 0.24], footL: [0, -0.39, 0.92],
        thighR: [0, -0.95, -0.30], shinR: [0, -0.97, 0.24], footR: [0, -0.39, 0.92],
      } },
      { t: 0.5, p: {
        hips: [0, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], head: [-8, 0, 0],
        upperArmL: [0.50, -0.40, 0.77], foreArmL: [0.52, -0.25, 0.81],
        upperArmR: [-0.50, -0.40, 0.77], foreArmR: [-0.52, -0.25, 0.81],
        thighL: [0, -0.60, 0.80], shinL: [0, -0.55, 0.83], footL: [0, -0.20, 0.98],
        thighR: [0, -0.60, 0.80], shinR: [0, -0.55, 0.83], footR: [0, -0.20, 0.98],
      }, rootY: -0.52 },
      { t: 1.1, p: {
        hips: [40, 0, 0], spine: [16, 0, 0], chest: [8, 0, 0], head: [-14, 0, 0],
        upperArmL: [0.70, -0.30, 0.65], foreArmL: [0.80, -0.10, 0.59],
        upperArmR: [-0.70, -0.30, 0.65], foreArmR: [-0.80, -0.10, 0.59],
        thighL: [0, -0.30, 0.95], shinL: [0, -0.20, 0.98], footL: [0, -0.05, 0.99],
        thighR: [0, -0.30, 0.95], shinR: [0, -0.20, 0.98], footR: [0, -0.05, 0.99],
      }, rootY: -0.78 },
      { t: 2.0, p: {
        hips: [78, 0, 0], spine: [12, 0, 0], chest: [6, 0, 0], head: [-6, 0, 0],
        upperArmL: [0.85, -0.10, 0.51], foreArmL: [0.95, 0.02, 0.31],
        upperArmR: [-0.85, -0.10, 0.51], foreArmR: [-0.95, 0.02, 0.31],
        thighL: [0, -0.05, 0.99], shinL: [0, 0.02, 0.99], footL: [0, 0.02, 0.99],
        thighR: [0, -0.05, 0.99], shinR: [0, 0.02, 0.99], footR: [0, 0.02, 0.99],
      }, rootY: -0.86 },
    ],
  },
];

/* ---------------------------------------------------------------------------
   Combat clips are OVERLAYS: they only drive the upper body, so the character
   can keep running / strafing while swinging.
   ------------------------------------------------------------------------- */

const UPPER_MASK = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR',
  'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'hips'];

export const COMBAT_CLIPS: ClipDef[] = [
  {
    name: 'light1', dur: 0.62, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [2, 26, 0], chest: [0, 14, 0], head: [0, -10, 0],
        upperArmR: [-0.55, 0.35, -0.75], foreArmR: [-0.30, 0.62, -0.72], handR: [-0.2, 0.8, -0.55],
        upperArmL: [0.50, -0.45, 0.74], foreArmL: [0.30, 0.10, 0.95],
      } },
      { t: 0.16, p: {
        spine: [4, 34, 0], chest: [2, 18, 0], head: [0, -14, 0],
        upperArmR: [-0.62, 0.55, -0.55], foreArmR: [-0.35, 0.78, -0.51], handR: [-0.25, 0.9, -0.35],
        upperArmL: [0.55, -0.40, 0.73], foreArmL: [0.32, 0.14, 0.94],
      } },
      { t: 0.30, p: {
        spine: [10, -18, 0], chest: [4, -12, 0], head: [2, 12, 0],
        upperArmR: [-0.30, -0.55, 0.78], foreArmR: [-0.10, -0.35, 0.93], handR: [-0.05, -0.3, 0.95],
        upperArmL: [0.30, -0.70, 0.65], foreArmL: [0.20, -0.20, 0.96],
      } },
      { t: 0.62, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95], handR: [-0.20, 0.55, 0.81],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
  },
  {
    name: 'light2', dur: 0.58, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [8, -16, 0], chest: [4, -10, 0], head: [2, 10, 0],
        upperArmR: [-0.30, -0.55, 0.78], foreArmR: [-0.10, -0.35, 0.93],
        upperArmL: [0.30, -0.70, 0.65], foreArmL: [0.20, -0.20, 0.96],
      } },
      { t: 0.14, p: {
        spine: [6, -26, 0], chest: [3, -16, 0], head: [2, 14, 0],
        upperArmR: [-0.45, -0.72, 0.52], foreArmR: [-0.20, -0.60, 0.77],
        upperArmL: [0.35, -0.78, 0.52], foreArmL: [0.24, -0.40, 0.89],
      } },
      { t: 0.28, p: {
        spine: [4, 30, 0], chest: [2, 20, 0], head: [0, -12, 0],
        upperArmR: [-0.35, 0.45, 0.82], foreArmR: [-0.15, 0.75, 0.64],
        upperArmL: [0.55, -0.30, 0.78], foreArmL: [0.35, 0.20, 0.91],
      } },
      { t: 0.58, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
  },
  {
    name: 'light3', dur: 0.78, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [4, -30, 0], chest: [2, -20, 0], head: [0, 16, 0],
        upperArmR: [-0.70, -0.10, 0.70], foreArmR: [-0.75, 0.05, 0.66],
        upperArmL: [0.50, -0.30, 0.81], foreArmL: [0.40, 0.05, 0.91],
      } },
      { t: 0.18, p: {
        spine: [2, -50, 0], chest: [0, -30, 0], head: [0, 24, 0],
        upperArmR: [-0.90, 0.05, 0.43], foreArmR: [-0.97, 0.10, 0.22],
        upperArmL: [0.70, -0.15, 0.70], foreArmL: [0.55, 0.15, 0.82],
      } },
      { t: 0.36, p: {
        spine: [6, 20, 0], chest: [3, 14, 0], head: [0, -10, 0],
        upperArmR: [-0.40, 0.10, 0.91], foreArmR: [-0.55, 0.20, 0.81],
        upperArmL: [0.30, -0.20, 0.93], foreArmL: [0.10, 0.05, 0.99],
      } },
      { t: 0.78, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
  },
  {
    name: 'heavy1', dur: 1.05, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [6, 20, 0], chest: [3, 12, 0], head: [0, -8, 0],
        upperArmR: [-0.40, 0.20, 0.89], foreArmR: [-0.30, 0.55, 0.78],
        upperArmL: [0.40, -0.40, 0.82], foreArmL: [0.28, 0.05, 0.96],
      } },
      { t: 0.30, p: {
        spine: [-8, 24, 0], chest: [-4, 14, 0], head: [8, -10, 0],
        upperArmR: [-0.30, 0.72, 0.62], foreArmR: [-0.20, 0.88, 0.43],
        upperArmL: [0.28, 0.35, 0.89], foreArmL: [0.20, 0.70, 0.68],
      } },
      { t: 0.46, p: {
        spine: [-16, 26, 0], chest: [-8, 15, 0], head: [14, -10, 0],
        upperArmR: [-0.25, 0.92, 0.30], foreArmR: [-0.15, 0.97, 0.18],
        upperArmL: [0.22, 0.55, 0.81], foreArmL: [0.15, 0.85, 0.50],
      } },
      { t: 0.60, p: {
        spine: [22, -6, 0], chest: [10, -4, 0], head: [-8, 4, 0],
        upperArmR: [-0.20, -0.80, 0.57], foreArmR: [-0.08, -0.55, 0.83],
        upperArmL: [0.22, -0.72, 0.65], foreArmL: [0.14, -0.45, 0.88],
      } },
      { t: 1.05, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
    motion: [{ t: 0, v: [0, 0, 0] }, { t: 0.60, v: [0, 0, 1.4] }, { t: 1.05, v: [0, 0, 0.4] }],
  },
  {
    name: 'heavy2', dur: 0.9, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [4, -20, 0], chest: [2, -14, 0], head: [0, 12, 0],
        upperArmR: [-0.55, -0.45, 0.70], foreArmR: [-0.75, -0.30, 0.59],
        upperArmL: [0.45, -0.55, 0.70], foreArmL: [0.60, -0.35, 0.72],
      } },
      { t: 0.22, p: {
        spine: [2, -34, 0], chest: [0, -22, 0], head: [0, 18, 0],
        upperArmR: [-0.60, -0.62, 0.50], foreArmR: [-0.85, -0.48, 0.20],
        upperArmL: [0.50, -0.65, 0.57], foreArmL: [0.70, -0.50, 0.51],
      } },
      { t: 0.38, p: {
        spine: [14, 12, 0], chest: [6, 8, 0], head: [-4, -6, 0],
        upperArmR: [-0.12, 0.05, 0.99], foreArmR: [-0.05, 0.05, 0.99],
        upperArmL: [0.18, -0.30, 0.94], foreArmL: [0.10, -0.20, 0.97],
      } },
      { t: 0.9, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
    motion: [{ t: 0, v: [0, 0, 0] }, { t: 0.38, v: [0, 0, 2.6] }, { t: 0.9, v: [0, 0, 0.5] }],
  },
  {
    name: 'special1', dur: 1.35, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [8, 10, 0], chest: [4, 6, 0], head: [0, -4, 0],
        upperArmR: [-0.75, 0.05, 0.66], foreArmR: [-0.90, 0.10, 0.42],
        upperArmL: [0.60, -0.30, 0.74], foreArmL: [0.45, -0.10, 0.89],
      } },
      { t: 0.28, p: {
        hips: [0, -40, 0], spine: [6, -30, 0], chest: [3, -20, 0], head: [0, 20, 0],
        upperArmR: [-0.95, 0.02, 0.31], foreArmR: [-0.99, 0.05, 0.14],
        upperArmL: [0.85, -0.10, 0.51], foreArmL: [0.70, -0.05, 0.71],
      } },
      { t: 0.55, p: {
        hips: [0, -160, 0], spine: [10, -60, 0], chest: [4, -30, 0], head: [0, 24, 0],
        upperArmR: [-0.90, -0.10, 0.42], foreArmR: [-0.95, -0.05, 0.31],
        upperArmL: [0.75, -0.20, 0.63], foreArmL: [0.55, -0.10, 0.83],
      } },
      { t: 0.82, p: {
        hips: [0, -280, 0], spine: [12, -20, 0], chest: [5, -10, 0], head: [0, 18, 0],
        upperArmR: [-0.60, -0.20, 0.77], foreArmR: [-0.50, -0.15, 0.85],
        upperArmL: [0.50, -0.30, 0.81], foreArmL: [0.35, -0.15, 0.92],
      } },
      { t: 1.35, p: {
        hips: [0, -358, 0], spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
  },
  {
    name: 'special2', dur: 1.1, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [2, -16, 0], chest: [0, -10, 0], head: [0, 8, 0],
        upperArmR: [-0.50, -0.50, 0.70], foreArmR: [-0.70, -0.35, 0.62],
        upperArmL: [0.40, -0.55, 0.73], foreArmL: [0.55, -0.40, 0.73],
      } },
      { t: 0.26, p: {
        spine: [-4, -26, 0], chest: [-2, -16, 0], head: [4, 14, 0],
        upperArmR: [-0.60, -0.68, 0.42], foreArmR: [-0.88, -0.45, 0.16],
        upperArmL: [0.50, -0.68, 0.54], foreArmL: [0.72, -0.55, 0.42],
      } },
      { t: 0.42, p: {
        spine: [16, 8, 0], chest: [8, 4, 0], head: [-6, -4, 0],
        upperArmR: [-0.10, 0.02, 0.99], foreArmR: [-0.02, 0.02, 0.99],
        upperArmL: [0.16, -0.24, 0.96], foreArmL: [0.08, -0.15, 0.98],
      } },
      { t: 0.70, p: {
        spine: [14, 6, 0], chest: [7, 3, 0], head: [-5, -3, 0],
        upperArmR: [-0.12, 0.05, 0.99], foreArmR: [-0.04, 0.05, 0.99],
        upperArmL: [0.18, -0.26, 0.95], foreArmL: [0.10, -0.18, 0.98],
      } },
      { t: 1.1, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
    motion: [{ t: 0, v: [0, 0, 0] }, { t: 0.26, v: [0, 0, 1.0] }, { t: 0.42, v: [0, 0, 6.0] }, { t: 0.70, v: [0, 0, 3.0] }, { t: 1.1, v: [0, 0, 0.4] }],
  },
  {
    name: 'draw', dur: 0.9, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [4, -10, 0], chest: [2, -6, 0],
        upperArmR: [-0.55, -0.35, 0.75], foreArmR: [-0.70, -0.20, 0.68],
        upperArmL: [0.40, -0.75, 0.53], foreArmL: [0.35, -0.60, 0.72],
      } },
      { t: 0.35, p: {
        spine: [2, -20, 0], chest: [0, -12, 0],
        upperArmR: [-0.62, -0.15, 0.77], foreArmR: [-0.85, 0.20, 0.48],
        upperArmL: [0.50, -0.45, 0.74], foreArmL: [0.45, -0.20, 0.87],
      } },
      { t: 0.55, p: {
        spine: [6, 10, 0], chest: [3, 6, 0],
        upperArmR: [-0.40, 0.30, 0.86], foreArmR: [-0.30, 0.70, 0.65],
        upperArmL: [0.55, -0.35, 0.76], foreArmL: [0.40, 0.10, 0.91],
      } },
      { t: 0.9, p: {
        spine: [5, -4, 0], chest: [2, -2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
  },
  {
    name: 'counter', dur: 0.8, loop: false, overlay: true, mask: UPPER_MASK, keys: [
      { t: 0, p: {
        spine: [-10, -14, 0], chest: [-5, -8, 0], head: [6, 8, 0],
        upperArmR: [-0.60, -0.30, 0.74], foreArmR: [-0.80, -0.15, 0.58],
        upperArmL: [0.55, -0.45, 0.70], foreArmL: [0.45, -0.25, 0.86],
      } },
      { t: 0.22, p: {
        spine: [12, 20, 0], chest: [6, 12, 0], head: [-6, -10, 0],
        upperArmR: [-0.25, 0.35, 0.90], foreArmR: [-0.10, 0.65, 0.75],
        upperArmL: [0.30, -0.30, 0.90], foreArmL: [0.15, -0.10, 0.98],
      } },
      { t: 0.8, p: {
        spine: [5, -4, 0], chest: [2, -2, 0], head: [0, 2, 0],
        upperArmR: [-0.30, -0.62, 0.72], foreArmR: [-0.16, 0.28, 0.95],
        upperArmL: [0.44, -0.62, 0.65], foreArmL: [0.30, 0.10, 0.95],
      } },
    ],
    motion: [{ t: 0, v: [0, 0, 0] }, { t: 0.22, v: [0, 0, 2.2] }, { t: 0.8, v: [0, 0, 0.3] }],
  },
];

/* --------------------------------------------------------------- NPC / state */

export const EXTRA_CLIPS: ClipDef[] = [
  {
    name: 'sit', dur: 3.0, loop: true, keys: [
      { t: 0, p: {
        spine: [4, 0, 0], chest: [1, 0, 0], head: [0, 0, 0],
        upperArmL: [0.30, -0.75, 0.59], foreArmL: [0.28, -0.35, 0.90],
        upperArmR: [-0.30, -0.75, 0.59], foreArmR: [-0.28, -0.35, 0.90],
        thighL: [0, -0.10, 0.99], shinL: [0, 0.97, 0.24], footL: [0, -0.39, 0.92],
        thighR: [0, -0.10, 0.99], shinR: [0, 0.97, 0.24], footR: [0, -0.39, 0.92],
      }, rootY: -0.42 },
      { t: 1.5, p: {
        spine: [6, 0, 0], chest: [2, 0, 0], head: [1, 0, 0],
        upperArmL: [0.31, -0.74, 0.60], foreArmL: [0.29, -0.33, 0.90],
        upperArmR: [-0.31, -0.74, 0.60], foreArmR: [-0.29, -0.33, 0.90],
        thighL: [0, -0.10, 0.99], shinL: [0, 0.97, 0.24], footL: [0, -0.39, 0.92],
        thighR: [0, -0.10, 0.99], shinR: [0, 0.97, 0.24], footR: [0, -0.39, 0.92],
      }, rootY: -0.42 },
      { t: 3.0, p: {
        spine: [4, 0, 0], chest: [1, 0, 0], head: [0, 0, 0],
        upperArmL: [0.30, -0.75, 0.59], foreArmL: [0.28, -0.35, 0.90],
        upperArmR: [-0.30, -0.75, 0.59], foreArmR: [-0.28, -0.35, 0.90],
        thighL: [0, -0.10, 0.99], shinL: [0, 0.97, 0.24], footL: [0, -0.39, 0.92],
        thighR: [0, -0.10, 0.99], shinR: [0, 0.97, 0.24], footR: [0, -0.39, 0.92],
      }, rootY: -0.42 },
    ],
  },
  {
    name: 'bow', dur: 2.2, loop: false, keys: [
      { t: 0, p: {
        spine: [2, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
        upperArmL: [0.28, -0.90, 0.32], foreArmL: [0.26, -0.50, 0.82],
        upperArmR: [-0.28, -0.90, 0.32], foreArmR: [-0.26, -0.50, 0.82],
        thighL: [0.02, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.02, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
      { t: 0.8, p: {
        spine: [34, 0, 0], chest: [16, 0, 0], head: [10, 0, 0],
        upperArmL: [0.22, -0.72, 0.65], foreArmL: [0.20, -0.30, 0.93],
        upperArmR: [-0.22, -0.72, 0.65], foreArmR: [-0.20, -0.30, 0.93],
        thighL: [0.02, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.02, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
      { t: 1.4, p: {
        spine: [32, 0, 0], chest: [15, 0, 0], head: [9, 0, 0],
        upperArmL: [0.22, -0.72, 0.65], foreArmL: [0.20, -0.30, 0.93],
        upperArmR: [-0.22, -0.72, 0.65], foreArmR: [-0.20, -0.30, 0.93],
        thighL: [0.02, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.02, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
      { t: 2.2, p: {
        spine: [2, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
        upperArmL: [0.28, -0.90, 0.32], foreArmL: [0.26, -0.50, 0.82],
        upperArmR: [-0.28, -0.90, 0.32], foreArmR: [-0.26, -0.50, 0.82],
        thighL: [0.02, -0.998, 0.02], shinL: [0, -1, 0.01], thighR: [-0.02, -0.998, 0.02], shinR: [0, -1, 0.01],
      } },
    ],
  },
  {
    name: 'swim', dur: 1.0, loop: true, noGround: true, keys: [
      { t: 0, p: {
        hips: [72, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [-30, 0, 0],
        upperArmL: [0.30, -0.60, 0.74], foreArmL: [0.20, -0.20, 0.96],
        upperArmR: [-0.30, -0.30, 0.90], foreArmR: [-0.20, 0.20, 0.96],
        thighL: [0, -0.95, 0.30], shinL: [0, -0.98, -0.18], footL: [0, -0.20, 0.98],
        thighR: [0, -0.98, -0.18], shinR: [0, -0.98, 0.18], footR: [0, -0.20, 0.98],
      } },
      { t: 0.5, p: {
        hips: [72, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [-30, 12, 0],
        upperArmL: [0.30, -0.30, 0.90], foreArmL: [0.20, 0.20, 0.96],
        upperArmR: [-0.30, -0.60, 0.74], foreArmR: [-0.20, -0.20, 0.96],
        thighL: [0, -0.98, -0.18], shinL: [0, -0.98, 0.18], footL: [0, -0.20, 0.98],
        thighR: [0, -0.95, 0.30], shinR: [0, -0.98, -0.18], footR: [0, -0.20, 0.98],
      } },
      { t: 1.0, p: {
        hips: [72, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [-30, 0, 0],
        upperArmL: [0.30, -0.60, 0.74], foreArmL: [0.20, -0.20, 0.96],
        upperArmR: [-0.30, -0.30, 0.90], foreArmR: [-0.20, 0.20, 0.96],
        thighL: [0, -0.95, 0.30], shinL: [0, -0.98, -0.18], footL: [0, -0.20, 0.98],
        thighR: [0, -0.98, -0.18], shinR: [0, -0.98, 0.18], footR: [0, -0.20, 0.98],
      } },
    ],
  },
  {
    name: 'climb', dur: 1.0, loop: true, noGround: true, keys: [
      { t: 0, p: {
        spine: [-4, 0, 0], chest: [-2, 0, 0], head: [-10, 0, 0],
        upperArmL: [0.35, 0.70, 0.62], foreArmL: [0.25, 0.85, 0.46],
        upperArmR: [-0.35, 0.70, 0.62], foreArmR: [-0.25, 0.85, 0.46],
        thighL: [0, -0.85, 0.52], shinL: [0, -0.80, -0.59], footL: [0, -0.30, 0.95],
        thighR: [0, -0.90, -0.43], shinR: [0, -0.92, 0.38], footR: [0, -0.39, 0.92],
      } },
      { t: 0.5, p: {
        spine: [-6, 0, 0], chest: [-3, 0, 0], head: [-12, 0, 0],
        upperArmL: [0.35, 0.55, 0.76], foreArmL: [0.25, 0.70, 0.66],
        upperArmR: [-0.35, 0.90, 0.24], foreArmR: [-0.25, 0.95, 0.18],
        thighL: [0, -0.90, -0.43], shinL: [0, -0.92, 0.38], footL: [0, -0.39, 0.92],
        thighR: [0, -0.85, 0.52], shinR: [0, -0.80, -0.59], footR: [0, -0.30, 0.95],
      } },
      { t: 1.0, p: {
        spine: [-4, 0, 0], chest: [-2, 0, 0], head: [-10, 0, 0],
        upperArmL: [0.35, 0.70, 0.62], foreArmL: [0.25, 0.85, 0.46],
        upperArmR: [-0.35, 0.70, 0.62], foreArmR: [-0.25, 0.85, 0.46],
        thighL: [0, -0.85, 0.52], shinL: [0, -0.80, -0.59], footL: [0, -0.30, 0.95],
        thighR: [0, -0.90, -0.43], shinR: [0, -0.92, 0.38], footR: [0, -0.39, 0.92],
      } },
    ],
  },
  {
    name: 'wallrun', dur: 0.6, loop: true, noGround: true, keys: [
      { t: 0, p: {
        hips: [0, 0, 22], spine: [6, -14, 0], chest: [3, -8, 0], head: [-4, 8, 0],
        upperArmL: [0.55, -0.40, 0.73], foreArmL: [0.45, -0.20, 0.87],
        upperArmR: [-0.45, -0.50, 0.74], foreArmR: [-0.40, -0.30, 0.86],
        thighL: [0, -0.80, 0.60], shinL: [0, -0.78, -0.62], footL: [0, -0.30, 0.95],
        thighR: [0, -0.88, -0.47], shinR: [0, -0.75, 0.66], footR: [0, 0.20, 0.98],
      } },
      { t: 0.3, p: {
        hips: [0, 0, 22], spine: [7, -14, 0], chest: [3, -8, 0], head: [-4, 8, 0],
        upperArmL: [0.50, -0.45, 0.74], foreArmL: [0.42, -0.25, 0.87],
        upperArmR: [-0.50, -0.45, 0.74], foreArmR: [-0.42, -0.25, 0.87],
        thighL: [0, -0.88, -0.47], shinL: [0, -0.75, 0.66], footL: [0, 0.20, 0.98],
        thighR: [0, -0.80, 0.60], shinR: [0, -0.78, -0.62], footR: [0, -0.30, 0.95],
      } },
      { t: 0.6, p: {
        hips: [0, 0, 22], spine: [6, -14, 0], chest: [3, -8, 0], head: [-4, 8, 0],
        upperArmL: [0.55, -0.40, 0.73], foreArmL: [0.45, -0.20, 0.87],
        upperArmR: [-0.45, -0.50, 0.74], foreArmR: [-0.40, -0.30, 0.86],
        thighL: [0, -0.80, 0.60], shinL: [0, -0.78, -0.62], footL: [0, -0.30, 0.95],
        thighR: [0, -0.88, -0.47], shinR: [0, -0.75, 0.66], footR: [0, 0.20, 0.98],
      } },
    ],
  },
];

export const ALL_CLIP_DEFS = [...CLIPS, ...COMBAT_CLIPS, ...EXTRA_CLIPS];
