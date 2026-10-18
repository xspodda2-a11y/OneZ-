import {
  MeshStandardMaterial, SkinnedMesh, BufferGeometry, Group, Mesh, Color, DoubleSide,
  Object3D, Vector3, CylinderGeometry, ConeGeometry, TorusGeometry, LatheGeometry, Vector2,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** mergeGeometries needs uniform index-ness: normalise to non-indexed. */
const nonIdx = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
import { buildSkeleton, makeSockets, BuiltSkeleton } from './Skeleton';
import { PartBuilder } from './Parts';

export interface CharacterLook {
  skin: string;
  robe: string;
  robeDark: string;
  trim: string;
  sash: string;
  hair: string;
  leather: string;
  metal: string;
  eye?: string;
  build?: 'slim' | 'normal' | 'heavy' | 'child';
  height?: number;
  hairStyle?: 'topknot' | 'ponytail' | 'long' | 'bun' | 'bald' | 'wild';
  hat?: 'none' | 'straw' | 'helm' | 'hood' | 'crown';
  sleeves?: 'wide' | 'normal' | 'none';
  skirt?: 'long' | 'short' | 'none';
  shoulderPads?: boolean;
  mask?: boolean;
}

export const DEFAULT_LOOK: CharacterLook = {
  skin: '#e8c4a0', robe: '#f2ece0', robeDark: '#cfc6b4', trim: '#2f4f7a', sash: '#8c2b2b',
  hair: '#201a18', leather: '#4a3626', metal: '#c8cdd4', eye: '#2b2016',
  build: 'normal', height: 1.0, hairStyle: 'topknot', hat: 'none', sleeves: 'wide',
  skirt: 'long', shoulderPads: false, mask: false,
};

let bodyMat: MeshStandardMaterial | null = null;
let metalMat: MeshStandardMaterial | null = null;

export function characterMaterials(): [MeshStandardMaterial, MeshStandardMaterial] {
  if (!bodyMat) {
    bodyMat = new MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0.0, side: DoubleSide,
      name: 'charBody',
    });
    metalMat = new MeshStandardMaterial({
      vertexColors: true, roughness: 0.28, metalness: 0.92, side: DoubleSide,
      name: 'charMetal',
    });
  }
  return [bodyMat, metalMat];
}

export interface RigResult {
  mesh: SkinnedMesh;
  skel: BuiltSkeleton;
  sockets: ReturnType<typeof makeSockets>;
  root: Group;
  look: CharacterLook;
  scale: number;
}

/** Builds a complete, rigged, skinned Wuxia character. */
export function buildCharacter(lookIn: Partial<CharacterLook> = {}): RigResult {
  const look = { ...DEFAULT_LOOK, ...lookIn };
  const buildMul = look.build === 'heavy' ? 1.28 : look.build === 'slim' ? 0.88 : look.build === 'child' ? 0.78 : 1.0;
  const vs = (v: number) => v * buildMul;
  const scale = look.height ?? 1;
  const skel = buildSkeleton(scale);
  const pb = new PartBuilder(skel);
  const M = { BODY: 0, METAL: 1 };

  const robe = look.robe, robeDark = look.robeDark, trim = look.trim, skin = look.skin;
  const leather = look.leather, metal = look.metal, hair = look.hair, sash = look.sash;

  // ---------------------------------------------------------------- legs
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    pb.addTube({
      joints: [
        { b: `thigh${side}`, r: vs(0.088), sx: 1.05, sz: 1.0 },
        { b: `shin${side}`, r: vs(0.072), sx: 1.0, sz: 1.0 },
        { b: `foot${side}`, r: vs(0.052) },
      ],
      radial: 8, rings: 4, color: robeDark, mat: M.BODY, capEnd: false,
    });
    // boot
    pb.addBlob({ bone: `foot${side}`, o: [0, 0.012, 0.045], radius: [vs(0.062), vs(0.05), vs(0.115)], color: leather, flatBottom: 0.55, radial: 10, rings: 8 });
    pb.addTube({
      joints: [
        { b: `shin${side}`, o: [0, -0.10, 0], r: vs(0.085) },
        { b: `foot${side}`, o: [0, 0.02, 0], r: vs(0.078) },
      ],
      radial: 8, rings: 2, color: leather, mat: M.BODY,
    });
  }

  // ---------------------------------------------------------------- robe skirt
  if (look.skirt !== 'none') {
    const long = look.skirt === 'long';
    pb.addTube({
      joints: [
        { b: 'hips', o: [0, 0.06, 0], r: vs(0.175), sx: 1.22, sz: 0.92 },
        { b: 'hips', o: [0, -0.16, 0], r: vs(0.215), sx: 1.24, sz: 0.98 },
        { b: 'hips', o: [0, -0.34, 0], r: vs(0.265), sx: 1.26, sz: 1.02 },
        { b: 'hips', o: [0, long ? -0.56 : -0.40, 0], r: vs(long ? 0.315 : 0.30), sx: 1.28, sz: 1.06 },
      ],
      radial: 18, rings: 4, color: robe, mat: M.BODY,
      ripple: 0.045, rippleFreq: 5, uvScale: 1,
    });
    // hem trim band
    pb.addTube({
      joints: [
        { b: 'hips', o: [0, long ? -0.55 : -0.39, 0], r: vs(long ? 0.317 : 0.302), sx: 1.28, sz: 1.06 },
        { b: 'hips', o: [0, long ? -0.60 : -0.44, 0], r: vs(long ? 0.322 : 0.307), sx: 1.28, sz: 1.06 },
      ],
      radial: 18, rings: 1, color: trim, mat: M.BODY, ripple: 0.045, rippleFreq: 5,
    });
  }

  // ---------------------------------------------------------------- torso
  pb.addTube({
    joints: [
      { b: 'hips', o: [0, 0.02, 0], r: vs(0.155), sx: 1.30, sz: 0.86 },
      { b: 'spine', r: vs(0.168), sx: 1.32, sz: 0.86 },
      { b: 'chest', r: vs(0.175), sx: 1.36, sz: 0.88 },
      { b: 'neck', o: [0, -0.02, 0], r: vs(0.115), sx: 1.2, sz: 0.9 },
    ],
    radial: 14, rings: 3, color: robe, mat: M.BODY,
  });
  // crossed collar (交領) — two overlapping panels in trim colour
  pb.addBlob({ bone: 'chest', o: [0.0, 0.05, 0.115], radius: [vs(0.115), vs(0.15), vs(0.018)], color: trim, rot: [0.12, 0, 0.5], radial: 8, rings: 6 });
  pb.addBlob({ bone: 'chest', o: [0.0, 0.03, 0.118], radius: [vs(0.115), vs(0.15), vs(0.018)], color: trim, rot: [0.12, 0, -0.5], radial: 8, rings: 6 });
  // collar band
  pb.addTube({
    joints: [
      { b: 'chest', o: [-0.09, 0.15, 0.02], r: vs(0.030) },
      { b: 'chest', o: [0, 0.09, 0.11], r: vs(0.032) },
      { b: 'chest', o: [0.09, 0.15, 0.02], r: vs(0.030) },
    ],
    radial: 6, rings: 3, color: trim, mat: M.BODY,
  });
  // sash / belt
  pb.addBlob({ bone: 'hips', o: [0, 0.03, 0], radius: [vs(0.205), vs(0.055), vs(0.155)], color: sash, radial: 14, rings: 8 });
  pb.addBlob({ bone: 'hips', o: [0.11, -0.10, 0.02], radius: [vs(0.022), vs(0.10), vs(0.026)], color: sash, radial: 8, rings: 6 });

  // ---------------------------------------------------------------- arms
  const sleeveW = look.sleeves === 'wide' ? 1.9 : look.sleeves === 'normal' ? 1.25 : 1.0;
  for (const side of ['L', 'R'] as const) {
    const sgn = side === 'L' ? 1 : -1;
    pb.addBlob({ bone: `shoulder${side}`, o: [0, 0.0, 0], radius: [vs(0.075), vs(0.072), vs(0.075)], color: robe, radial: 10, rings: 8 });
    pb.addTube({
      joints: [
        { b: `shoulder${side}`, r: vs(0.062) },
        { b: `upperArm${side}`, r: vs(0.055) },
        { b: `foreArm${side}`, r: vs(0.052) },
        { b: `hand${side}`, o: [0, 0, 0], r: vs(0.042) },
      ],
      radial: 8, rings: 3, color: robe, mat: M.BODY,
    });
    if (look.sleeves !== 'none') {
      pb.addTube({
        joints: [
          { b: `upperArm${side}`, o: [0.06, 0, 0], r: vs(0.062) },
          { b: `foreArm${side}`, o: [0.02, 0, 0], r: vs(0.072 * (sleeveW * 0.6 + 0.4)) },
          { b: `foreArm${side}`, o: [0.20, 0, 0], r: vs(0.075 * sleeveW) },
          { b: `hand${side}`, o: [0.02, 0, 0], r: vs(0.070 * sleeveW) },
        ],
        radial: 12, rings: 3, color: robe, mat: M.BODY, ripple: 0.05, rippleFreq: 3,
      });
      // cuff trim
      pb.addTube({
        joints: [
          { b: `foreArm${side}`, o: [0.185, 0, 0], r: vs(0.076 * sleeveW) },
          { b: `hand${side}`, o: [0.03, 0, 0], r: vs(0.071 * sleeveW) },
        ],
        radial: 12, rings: 1, color: trim, mat: M.BODY, ripple: 0.05, rippleFreq: 3,
      });
    }
    // bracer
    pb.addTube({
      joints: [
        { b: `foreArm${side}`, o: [0.03, 0, 0], r: vs(0.058) },
        { b: `foreArm${side}`, o: [0.16, 0, 0], r: vs(0.050) },
      ],
      radial: 8, rings: 2, color: leather, mat: M.BODY,
    });
    // hand
    pb.addBlob({ bone: `hand${side}`, o: [0.055, -0.005, 0.005], radius: [vs(0.045), vs(0.052), vs(0.030)], color: skin, radial: 8, rings: 6 });
  }

  if (look.shoulderPads) {
    for (const side of ['L', 'R'] as const) {
      pb.addBlob({ bone: `shoulder${side}`, o: [0, 0.02, 0], radius: [vs(0.11), vs(0.075), vs(0.11)], color: leather, radial: 10, rings: 8 });
      pb.addBlob({ bone: `shoulder${side}`, o: [0, 0.055, 0], radius: [vs(0.10), vs(0.03), vs(0.10)], color: metal, mat: M.METAL, radial: 10, rings: 6 });
    }
  }

  // ---------------------------------------------------------------- neck + head
  pb.addTube({
    joints: [
      { b: 'neck', r: vs(0.048) },
      { b: 'head', o: [0, -0.02, 0], r: vs(0.052) },
    ],
    radial: 8, rings: 2, color: skin, mat: M.BODY,
  });
  pb.addBlob({ bone: 'head', o: [0, 0.055, 0.005], radius: [vs(0.088), vs(0.112), vs(0.100)], color: skin, radial: 16, rings: 12 });
  pb.addBlob({ bone: 'head', o: [0, -0.005, 0.014], radius: [vs(0.072), vs(0.055), vs(0.080)], color: skin, radial: 12, rings: 8 });
  // nose / ears / mouth
  pb.addBlob({ bone: 'head', o: [0, 0.028, 0.096], radius: [vs(0.017), vs(0.022), vs(0.022)], color: skin, radial: 8, rings: 6 });
  for (const s of [1, -1]) {
    pb.addBlob({ bone: 'head', o: [s * vs(0.088), 0.048, -0.004], radius: [vs(0.016), vs(0.030), vs(0.020)], color: skin, radial: 8, rings: 6 });
  }
  pb.addBlob({ bone: 'head', o: [0, -0.028, 0.088], radius: [vs(0.021), vs(0.006), vs(0.008)], color: '#8a4a44', radial: 8, rings: 6 });

  // eyes
  const eyeC = look.eye ?? '#2b2016';
  for (const s of [1, -1]) {
    pb.addBlob({ bone: 'head', o: [s * vs(0.036), 0.060, 0.076], radius: [vs(0.019), vs(0.014), vs(0.014)], color: '#f6f2ea', radial: 10, rings: 8 });
    pb.addBlob({ bone: 'head', o: [s * vs(0.037), 0.060, 0.087], radius: [vs(0.0115), vs(0.0125), vs(0.010)], color: eyeC, radial: 10, rings: 8 });
    pb.addBlob({ bone: 'head', o: [s * vs(0.036), 0.086, 0.082], radius: [vs(0.030), vs(0.007), vs(0.009)], color: hair, rot: [0, 0, s * 0.12], radial: 8, rings: 6 });
  }

  if (look.mask) {
    pb.addBlob({ bone: 'head', o: [0, -0.015, 0.075], radius: [vs(0.070), vs(0.055), vs(0.030)], color: '#1e2228', radial: 12, rings: 8 });
  }

  // ---------------------------------------------------------------- hair
  const hs = look.hairStyle ?? 'topknot';
  if (hs !== 'bald') {
    pb.addBlob({ bone: 'head', o: [0, 0.085, -0.014], radius: [vs(0.097), vs(0.100), vs(0.102)], color: hair, radial: 16, rings: 12 });
    // side locks
    for (const s of [1, -1]) {
      pb.addBlob({ bone: 'head', o: [s * vs(0.072), 0.030, -0.010], radius: [vs(0.026), vs(0.085), vs(0.050)], color: hair, radial: 10, rings: 8 });
    }
    // bangs
    pb.addBlob({ bone: 'head', o: [0, 0.108, 0.062], radius: [vs(0.085), vs(0.032), vs(0.042)], color: hair, rot: [0.25, 0, 0], radial: 12, rings: 8 });
  }
  if (hs === 'topknot' || hs === 'bun') {
    pb.addBlob({ bone: 'head', o: [0, 0.195, -0.030], radius: [vs(0.058), vs(0.052), vs(0.058)], color: hair, radial: 12, rings: 10 });
    pb.addBlob({ bone: 'head', o: [0, 0.20, -0.030], radius: [vs(0.008), vs(0.008), vs(0.075)], color: metal, mat: M.METAL, rot: [1.4, 0, 0.3], radial: 6, rings: 6 });
  }
  if (hs === 'ponytail' || hs === 'long' || hs === 'topknot') {
    const len = hs === 'long' ? 0.52 : 0.38;
    pb.addTube({
      joints: [
        { b: 'head', o: [0, 0.11, -0.075], r: vs(0.062) },
        { b: 'head', o: [0, 0.02, -0.115], r: vs(0.050) },
        { b: 'hairBack', o: [0, -len * 0.5, -0.03], r: vs(0.038) },
        { b: 'hairBack', o: [0, -len, 0.02], r: vs(0.014) },
      ],
      radial: 10, rings: 4, color: hair, mat: M.BODY,
    });
  }
  if (hs === 'wild') {
    pb.addBlob({ bone: 'head', o: [0, 0.10, -0.08], radius: [vs(0.11), vs(0.10), vs(0.10)], color: hair, radial: 12, rings: 10 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      pb.addBlob({ bone: 'head', o: [Math.cos(a) * 0.09, 0.13 + Math.sin(a) * 0.03, Math.sin(a) * 0.09], radius: [vs(0.035), vs(0.035), vs(0.035)], color: hair, radial: 8, rings: 6 });
    }
  }

  // ---------------------------------------------------------------- merge
  const byMat: BufferGeometry[][] = [[], []];
  pb.geos.forEach((g, i) => byMat[pb.mats[i]].push(g));
  const merged: BufferGeometry[] = [];
  for (let m = 0; m < 2; m++) {
    if (!byMat[m].length) continue;
    const g = mergeGeometries(byMat[m].map(nonIdx), false);
    if (g) merged.push(g);
  }
  const geo = merged.length > 1 ? mergeGeometries(merged.map(nonIdx), true)! : merged[0];
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius *= 2.2;

  const [mat0, mat1] = characterMaterials();
  const mesh = new SkinnedMesh(geo, [mat0, mat1]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.add(skel.root);
  mesh.bind(skel.skeleton);

  const sockets = makeSockets(skel.byName);
  const root = new Group();
  root.add(mesh);

  // ---------------------------------------------------------------- hats
  const hat = makeHat(look);
  if (hat) sockets.head.add(hat);

  return { mesh, skel, sockets, root, look, scale };
}

function makeHat(look: CharacterLook): Object3D | null {
  const { hat, build } = look;
  if (!hat || hat === 'none') return null;
  const m = look.build === 'heavy' ? 1.15 : 1;
  const g = new Group();
  const bodyMat = characterMaterials()[0];
  const mk = (geo: any, color: string, metal = false) => {
    const mm = new MeshStandardMaterial({ color: new Color(color), roughness: metal ? 0.3 : 0.8, metalness: metal ? 0.85 : 0.02, side: DoubleSide });
    const mesh = new Mesh(geo, mm);
    mesh.castShadow = true;
    return mesh;
  };
  if (hat === 'straw') {
    const pts: Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new Vector2(0.05 + t * 0.42 * m, -0.02 + Math.pow(t, 1.6) * 0.16));
    }
    const lathe = new LatheGeometry(pts, 18);
    const mesh = mk(lathe, '#c8a86a');
    mesh.position.y = 0.14;
    g.add(mesh);
  } else if (hat === 'helm') {
    const dome = mk(new (SphereGeometry)(0.135 * m, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), '#5a6068', true);
    dome.position.y = 0.05;
    g.add(dome);
    const brim = mk(new TorusGeometry(0.13 * m, 0.022, 8, 18), '#6b5250', true);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.02;
    g.add(brim);
    const spike = mk(new ConeGeometry(0.022, 0.20, 8), '#c8cdd4', true);
    spike.position.y = 0.20;
    g.add(spike);
  } else if (hat === 'hood') {
    const hood = mk(new (SphereGeometry)(0.15 * m, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), look.robeDark);
    hood.position.set(0, 0.055, -0.03);
    g.add(hood);
  } else if (hat === 'crown') {
    const band = mk(new TorusGeometry(0.10 * m, 0.018, 8, 16), '#d9b64a', true);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.10;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = mk(new ConeGeometry(0.018, 0.07, 6), '#e8c860', true);
      p.position.set(Math.cos(a) * 0.10, 0.145, Math.sin(a) * 0.10);
      g.add(p);
    }
  }
  return g;
}
