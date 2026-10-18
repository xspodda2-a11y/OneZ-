import { Bone, Skeleton, Matrix4, Euler, Quaternion, Vector3, Object3D } from 'three';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** position relative to parent (metres, character faces +Z) */
  p: [number, number, number];
  /** rest-pose euler in DEGREES */
  r?: [number, number, number];
}

/** Humanoid rig: ~1.75m tall at scale 1. Rest pose is a relaxed A-pose. */
export const BONE_DEFS: BoneDef[] = [
  { name: 'hips', parent: null, p: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', p: [0, 0.14, 0] },
  { name: 'chest', parent: 'spine', p: [0, 0.20, 0] },
  { name: 'neck', parent: 'chest', p: [0, 0.21, 0] },
  { name: 'head', parent: 'neck', p: [0, 0.11, 0] },

  { name: 'shoulderL', parent: 'chest', p: [0.045, 0.15, 0] },
  { name: 'upperArmL', parent: 'shoulderL', p: [0.10, -0.01, 0], r: [0, 8, -68] },
  { name: 'foreArmL', parent: 'upperArmL', p: [0.27, 0, 0], r: [0, 12, -14] },
  { name: 'handL', parent: 'foreArmL', p: [0.25, 0, 0], r: [0, 6, -6] },

  { name: 'shoulderR', parent: 'chest', p: [-0.045, 0.15, 0] },
  { name: 'upperArmR', parent: 'shoulderR', p: [-0.10, -0.01, 0], r: [0, -8, 68] },
  { name: 'foreArmR', parent: 'upperArmR', p: [-0.27, 0, 0], r: [0, -12, 14] },
  { name: 'handR', parent: 'foreArmR', p: [-0.25, 0, 0], r: [0, -6, 6] },

  { name: 'thighL', parent: 'hips', p: [0.085, -0.06, 0], r: [2, 0, -1] },
  { name: 'shinL', parent: 'thighL', p: [0, -0.44, 0], r: [-7, 0, 0] },
  { name: 'footL', parent: 'shinL', p: [0, -0.40, 0], r: [4, 0, 0] },
  { name: 'toeL', parent: 'footL', p: [0, -0.055, 0.13] },

  { name: 'thighR', parent: 'hips', p: [-0.085, -0.06, 0], r: [2, 0, 1] },
  { name: 'shinR', parent: 'thighR', p: [0, -0.44, 0], r: [-7, 0, 0] },
  { name: 'footR', parent: 'shinR', p: [0, -0.40, 0], r: [4, 0, 0] },
  { name: 'toeR', parent: 'footR', p: [0, -0.055, 0.13] },

  // robe hem (procedurally swayed)
  { name: 'hemF', parent: 'hips', p: [0, -0.44, 0.13] },
  { name: 'hemB', parent: 'hips', p: [0, -0.44, -0.13] },
  { name: 'hemL', parent: 'hips', p: [0.10, -0.44, 0] },
  { name: 'hemR', parent: 'hips', p: [-0.10, -0.44, 0] },
  // hair
  { name: 'hairBack', parent: 'head', p: [0, 0.02, -0.11] },
];

export const BONE_NAMES = BONE_DEFS.map((b) => b.name);

export interface BuiltSkeleton {
  root: Bone;
  bones: Bone[];
  byName: Record<string, Bone>;
  skeleton: Skeleton;
  restQuat: Quaternion[];
  restEuler: Vector3[];
}

const D2R = Math.PI / 180;

export function buildSkeleton(scale = 1): BuiltSkeleton {
  const bones: Bone[] = [];
  const byName: Record<string, Bone> = {};
  for (const def of BONE_DEFS) {
    const b = new Bone();
    b.name = def.name;
    b.position.set(def.p[0] * scale, def.p[1] * scale, def.p[2] * scale);
    if (def.r) b.rotation.set(def.r[0] * D2R, def.r[1] * D2R, def.r[2] * D2R);
    bones.push(b);
    byName[def.name] = b;
  }
  for (let i = 0; i < BONE_DEFS.length; i++) {
    const parent = BONE_DEFS[i].parent;
    if (parent) byName[parent].add(bones[i]);
  }
  const root = byName['hips'];
  root.updateMatrixWorld(true);

  const restQuat = bones.map((b) => b.quaternion.clone());
  const restEuler = bones.map((b) => new Vector3(b.rotation.x, b.rotation.y, b.rotation.z));

  const skeleton = new Skeleton(bones);
  return { root, bones, byName, skeleton, restQuat, restEuler };
}

/** Creates attach points for weapons / props. */
export function makeSockets(byName: Record<string, Bone>) {
  const mk = (bone: string, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const o = new Object3D();
    o.position.set(pos[0], pos[1], pos[2]);
    o.rotation.set(rot[0], rot[1], rot[2]);
    byName[bone].add(o);
    return o;
  };
  return {
    handR: mk('handR', [-0.02, -0.02, 0.0], [1.02, 0, -0.22]),
    handL: mk('handL', [0.02, -0.02, 0.0], [1.02, 0, 0.22]),
    back: mk('spine', [0.02, 0.10, -0.11], [0.25, 0, 1.35]),
    hipR: mk('hips', [-0.11, -0.03, 0.03], [0, 0, 0.35]),
    head: mk('head', [0, 0.13, 0.01]),
    chest: mk('chest', [0, 0.04, 0.13]),
  };
}

const _m = new Matrix4();
const _e = new Euler();
const _q = new Quaternion();
export function eulerToQuat(x: number, y: number, z: number, out = new Quaternion()) {
  _e.set(x, y, z, 'XYZ');
  return out.setFromEuler(_e);
}
