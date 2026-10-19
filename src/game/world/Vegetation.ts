import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, InstancedMesh, InstancedBufferAttribute,
  MeshStandardMaterial, Matrix4, Vector3, Color, Group, CylinderGeometry, ConeGeometry,
  SphereGeometry, IcosahedronGeometry, PlaneGeometry, BoxGeometry, Object3D, DoubleSide,
  Mesh, ShaderMaterial, AdditiveBlending, Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** mergeGeometries needs uniform index-ness: normalise to non-indexed. */
const nonIdx = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
import { WORLD, heightAt, terrainNormal, biomeAt, moistureAt } from '../core/TerrainHeight';
import { makeRng, chunkHash, clamp01, lerpN } from '../core/Noise';
import { sampleMask, CH_PATH, CH_SETTLE, CH_FIELD, CH_WATER } from './Masks';
import { windUniforms } from '../render/Environment';
import { QualityPreset } from '../render/Renderer';
import { physics, Collider } from '../core/Physics';

const _m = new Matrix4();
const _q = new Object3D();
const _v = new Vector3();

/** Applies a transform, a flat vertex colour and a wind-sway weight to a primitive. */
function part(geo: BufferGeometry, color: string | number, m: Matrix4, sway = 0, swayPow = 1.4): BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(m);
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new Color(color as any).convertSRGBToLinear();
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  const swayArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    const y = Math.max(0, g.attributes.position.getY(i));
    swayArr[i] = Math.pow(clamp01(y / 6), 1 / swayPow) * sway;
  }
  g.setAttribute('color', new BufferAttribute(cols, 3));
  g.setAttribute('aSway', new BufferAttribute(swayArr, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aSway'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  const m = new Matrix4();
  m.makeRotationFromEuler(new Euler(rx, ry, rz));
  m.scale(new Vector3(sx, sy, sz));
  m.setPosition(new Vector3(x, y, z));
  return m;
}

/* ------------------------------------------------------------- geometry sets */

function bambooClump(detailed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = detailed ? 5 : 2;
  const rng = makeRng(99);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.55;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 7 + rng() * 5;
    const rad = 0.055 + rng() * 0.025;
    const segs = detailed ? 8 : 3;
    const lean = (rng() - 0.5) * 0.10;
    parts.push(part(new CylinderGeometry(rad * 0.7, rad, h, detailed ? 7 : 5, segs), '#7fae4a',
      trs(x, h / 2, z, lean, 0, lean * 0.6), 1.0));
    if (detailed) {
      // nodes
      for (let k = 1; k < 6; k++) {
        parts.push(part(new CylinderGeometry(rad * 1.22, rad * 1.22, 0.045, 6), '#5f8a36',
          trs(x + lean * k * 0.5, (h / 6) * k, z, 0, 0, 0)));
      }
      // leaves
      const leafCount = 7;
      for (let k = 0; k < leafCount; k++) {
        const ly = h * (0.55 + rng() * 0.45);
        const la = rng() * Math.PI * 2;
        const ll = 0.7 + rng() * 0.7;
        const lm = trs(x + Math.cos(la) * ll * 0.5, ly, z + Math.sin(la) * ll * 0.5,
          (rng() - 0.5) * 0.7, la, (rng() - 0.4) * 0.9);
        parts.push(part(new PlaneGeometry(ll, 0.16), k % 2 ? '#4e7b31' : '#63943a', lm, 1.2));
      }
    } else {
      parts.push(part(new ConeGeometry(0.55, 2.4, 6), '#5f8a36', trs(x, h * 0.85, z), 1.2));
    }
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function pineTree(detailed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const h = 9 + (detailed ? 3 : 0);
  parts.push(part(new CylinderGeometry(0.16, 0.34, h, detailed ? 8 : 5), '#5a4029', trs(0, h / 2, 0), 0.35));
  const tiers = detailed ? 4 : 2;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = h * (0.32 + t * 0.55);
    const r = 2.7 * (1 - t * 0.62);
    parts.push(part(new ConeGeometry(r, 3.4 - t * 1.2, detailed ? 9 : 6), i % 2 ? '#2f4a2a' : '#3a5a30',
      trs(0, y, 0), 0.55));
  }
  if (detailed) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(part(new CylinderGeometry(0.05, 0.09, 1.6, 5), '#4a3320',
        trs(Math.cos(a) * 0.9, h * 0.55, Math.sin(a) * 0.9, 0.9, a, 0), 0.8));
    }
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function broadleafTree(detailed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const h = 7.5;
  parts.push(part(new CylinderGeometry(0.22, 0.42, h, detailed ? 9 : 5), '#6b4c30', trs(0, h / 2, 0), 0.3));
  const blobs = detailed ? [[0, h + 0.6, 0, 2.6], [-1.5, h - 0.2, 0.8, 1.8], [1.4, h + 0.1, -0.7, 1.9], [0.2, h + 1.9, 1.1, 1.5]]
    : [[0, h + 0.3, 0, 2.9]];
  for (const [x, y, z, r] of blobs) {
    parts.push(part(new IcosahedronGeometry(r, detailed ? 1 : 0), '#3f6231', trs(x, y, z, 0, 0, 0, 1, 0.85, 1), 0.75));
  }
  if (detailed) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(part(new CylinderGeometry(0.06, 0.12, 2.4, 5), '#543c26',
        trs(Math.cos(a) * 1.1, h * 0.72, Math.sin(a) * 1.1, 0.7, a, 0), 0.9));
    }
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function snowTree(detailed: boolean): BufferGeometry {
  const g = pineTree(detailed);
  const col = g.attributes.color as BufferAttribute;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 5.5) {
      const k = clamp01((pos.getY(i) - 5.5) / 4);
      col.setXYZ(i, lerpN(col.getX(i), 0.86, k), lerpN(col.getY(i), 0.88, k), lerpN(col.getZ(i), 0.92, k));
    }
  }
  col.needsUpdate = true;
  return g;
}

function bushGeo(detailed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = detailed ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(part(new IcosahedronGeometry(0.55 + (i % 2) * 0.25, detailed ? 1 : 0), i % 2 ? '#3d5c2c' : '#4a6b34',
      trs(Math.cos(a) * 0.4, 0.5 + (i % 2) * 0.2, Math.sin(a) * 0.4, 0, 0, 0, 1, 0.8, 1), 0.5));
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function rockGeo(detailed: boolean, seed = 1): BufferGeometry {
  const g = new IcosahedronGeometry(1, detailed ? 1 : 0);
  const pos = g.attributes.position as BufferAttribute;
  const rng = makeRng(seed * 7919);
  const offs = [rng() * 10, rng() * 10, rng() * 10];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 3 + offs[0]) * Math.cos(z * 2.7 + offs[1]) * 0.22 + Math.sin(y * 4.1 + offs[2]) * 0.14;
    const s = 1 + n;
    pos.setXYZ(i, x * s, y * s * 0.8, z * s);
  }
  g.computeVertexNormals();
  return part(g, '#7a766e', new Matrix4(), 0);
}

function reedGeo(detailed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = detailed ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.15 + (i % 3) * 0.12;
    const h = 1.4 + (i % 3) * 0.5;
    parts.push(part(new CylinderGeometry(0.018, 0.03, h, 4), '#7d8c4a',
      trs(Math.cos(a) * r, h / 2, Math.sin(a) * r, (i % 2 ? 0.12 : -0.1), a, 0), 1.0));
    if (detailed && i % 2 === 0) {
      parts.push(part(new CylinderGeometry(0.05, 0.05, 0.32, 6), '#6b4a2e',
        trs(Math.cos(a) * r, h + 0.1, Math.sin(a) * r, 0, 0, 0), 1.2));
    }
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function lilyGeo(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(part(new CylinderGeometry(0.45, 0.45, 0.03, 10), '#3f6b3a',
      trs(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5), 0));
  }
  const g = mergeGeometries(parts.map(nonIdx), false)!;
  return g;
}

/* ------------------------------------------------------------------- pools */

class Pool {
  mesh: InstancedMesh;
  free: number[] = [];
  high = 0;
  constructor(geo: BufferGeometry, capacity: number, castShadow: boolean, name: string) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, side: DoubleSide });
    patchWind(mat);
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.name = name;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    // hide unused instances
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  alloc(): number | null {
    const i = this.free.pop();
    if (i === undefined) return null;
    if (i + 1 > this.high) { this.high = i + 1; this.mesh.count = this.high; }
    return i;
  }
  release(i: number) {
    const zero = new Matrix4().makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(i);
  }
}

function patchWind(mat: MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uGust = windUniforms.uGust;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        attribute float aSway;
        uniform float uTime, uWind, uGust;
        uniform vec3 uWindDir;
        vec3 windOffset(vec3 wp, float sway){
          float ph = wp.x * 0.055 + wp.z * 0.045;
          float s = sin(uTime * 1.55 + ph) * 0.62 + sin(uTime * 2.6 + ph * 1.7) * 0.24 + sin(uTime * 0.31) * 0.5;
          float g = 0.55 + 0.45 * sin(uTime * 0.19 + wp.x * 0.006) + (uGust - 1.0);
          float amt = sway * sway * uWind * g * 0.42;
          return vec3(uWindDir.x, 0.0, uWindDir.z) * (s * amt) + vec3(0.0, -abs(s) * amt * 0.28, 0.0);
        }
      `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      #ifdef USE_INSTANCING
      {
        vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 off = windOffset(iw, aSway);
        mvPosition.xyz += (viewMatrix * vec4(off, 0.0)).xyz;
      }
      #endif
    `);
  };
  mat.customProgramCacheKey = () => 'windVeg';
}

/* --------------------------------------------------------------- vegetation */

interface Species {
  name: string;
  near: Pool;
  far: Pool;
}

interface ChunkVeg {
  key: string;
  items: { sp: number; idx: number; isNear: boolean }[];
  colliders: Collider[];
  grass: { idx: number }[];
}

export class Vegetation {
  group = new Group();
  private species: Species[] = [];
  private chunks = new Map<string, ChunkVeg>();
  private grass!: InstancedMesh;
  private grassFree: number[] = [];
  private grassHigh = 0;
  private grassCapacity = 9000;
  private lastCx = NaN;
  private lastCz = NaN;
  private grassMaterial: ShaderMaterial;

  constructor() {
    this.group.name = 'vegetation';
    const defs: [string, BufferGeometry, BufferGeometry, number, number, boolean][] = [
      ['bamboo', bambooClump(true), bambooClump(false), 700, 900, true],
      ['pine', pineTree(true), pineTree(false), 900, 1100, true],
      ['broadleaf', broadleafTree(true), broadleafTree(false), 800, 1000, true],
      ['snowtree', snowTree(true), snowTree(false), 300, 400, true],
      ['bush', bushGeo(true), bushGeo(false), 1200, 900, false],
      ['rock', rockGeo(true, 1), rockGeo(false, 2), 500, 600, true],
      ['reed', reedGeo(true), reedGeo(false), 600, 400, false],
      ['lily', lilyGeo(), lilyGeo(), 250, 250, false],
    ];
    for (const [name, gn, gf, cn, cf, shadow] of defs) {
      const near = new Pool(gn, cn, shadow, 'veg_' + name + '_near');
      const far = new Pool(gf, cf, false, 'veg_' + name + '_far');
      this.group.add(near.mesh, far.mesh);
      this.species.push({ name, near, far });
    }
    this.buildGrass();
  }

  private buildGrass() {
    // a tuft = 3 crossed blades
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const g = new PlaneGeometry(0.16, 0.62, 1, 3);
      g.translate(0, 0.31, 0);
      const m = new Matrix4().makeRotationY(a);
      m.setPosition(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
      g.applyMatrix4(m);
      // taper the top
      const pos = g.attributes.position as BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v);
        const k = 1 - Math.pow(y / 0.62, 1.4) * 0.75;
        pos.setX(v, pos.getX(v) * k);
        pos.setX(v, pos.getX(v) + Math.sin(y * 3.0) * 0.03);
      }
      const n = pos.count;
      const sway = new Float32Array(n);
      for (let v = 0; v < n; v++) sway[v] = Math.pow(pos.getY(v) / 0.62, 1.3);
      g.setAttribute('aSway', new BufferAttribute(sway, 1));
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      parts.push(g);
    }
    const geo = mergeGeometries(parts.map(nonIdx), false)!;
    geo.computeVertexNormals();

    this.grassMaterial = new ShaderMaterial({
      uniforms: {
        uTime: windUniforms.uTime,
        uWind: windUniforms.uWind,
        uWindDir: windUniforms.uWindDir,
        uGust: windUniforms.uGust,
        uSunDir: { value: new Vector3(0.4, 0.7, 0.3) },
        uSunColor: { value: new Color(1, 0.95, 0.85) },
        uAmbient: { value: new Color(0.36, 0.44, 0.5) },
        uFogColor: { value: new Color(0.7, 0.8, 0.9) },
        uFogDensity: { value: 0.0018 },
        uCam: { value: new Vector3() },
        uBase: { value: new Color(0.16, 0.26, 0.11) },
        uTip: { value: new Color(0.44, 0.58, 0.24) },
        uDry: { value: new Color(0.52, 0.47, 0.22) },
      },
      vertexShader: /* glsl */`
        attribute float aSway;
        uniform float uTime, uWind, uGust;
        uniform vec3 uWindDir, uCam;
        varying vec3 vNormalW;
        varying float vSway;
        varying vec3 vWorld;
        varying float vShade;
        void main(){
          vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float ph = iw.x * 0.09 + iw.z * 0.07;
          float s = sin(uTime * 2.1 + ph) * 0.7 + sin(uTime * 3.3 + ph * 1.7) * 0.3;
          float g = 0.6 + 0.4 * sin(uTime * 0.23 + iw.x * 0.01) + (uGust - 1.0) * 0.6;
          float amt = aSway * aSway * uWind * g * 0.30;
          vec3 off = vec3(uWindDir.x, 0.0, uWindDir.z) * (s * amt);
          // bend away from the camera a touch for volume
          vec3 toCam = normalize(vec3(uCam.x - wp.x, 0.0, uCam.z - wp.z));
          wp.xyz += off + toCam * (aSway * 0.02);
          wp.y -= abs(s) * amt * 0.25;
          vWorld = wp.xyz;
          vNormalW = normalize(vec3(off.x * 2.0, 1.0, off.z * 2.0));
          vSway = aSway;
          vShade = fract(sin(dot(iw.xz, vec2(12.9898,78.233))) * 43758.5453);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uBase, uTip, uDry;
        uniform float uFogDensity;
        uniform vec3 uCam;
        varying vec3 vNormalW;
        varying float vSway;
        varying vec3 vWorld;
        varying float vShade;
        void main(){
          vec3 N = normalize(vNormalW);
          float ndl = max(dot(N, normalize(uSunDir)), 0.0);
          float back = pow(max(dot(-N, normalize(uSunDir)), 0.0), 2.0) * 0.35;
          vec3 base = mix(uBase, uTip, vSway);
          base = mix(base, uDry, vShade * 0.45);
          base *= 0.75 + vShade * 0.5;
          vec3 col = base * (uAmbient + uSunColor * (ndl * 0.9 + back));
          float d = length(uCam - vWorld);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: DoubleSide,
    });
    this.grass = new InstancedMesh(geo, this.grassMaterial, this.grassCapacity);
    this.grass.frustumCulled = false;
    this.grass.castShadow = false;
    this.grass.receiveShadow = false;
    this.grass.count = 0;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = this.grassCapacity - 1; i >= 0; i--) { this.grassFree.push(i); this.grass.setMatrixAt(i, zero); }
    this.grass.instanceMatrix.needsUpdate = true;
    this.group.add(this.grass);
  }

  private allocGrass(): number | null {
    const i = this.grassFree.pop();
    if (i === undefined) return null;
    if (i + 1 > this.grassHigh) { this.grassHigh = i + 1; this.grass.count = this.grassHigh; }
    return i;
  }
  private releaseGrass(i: number) {
    this.grass.setMatrixAt(i, new Matrix4().makeScale(0, 0, 0));
    this.grassFree.push(i);
    this.grass.instanceMatrix.needsUpdate = true;
  }

  update(playerPos: Vector3, quality: QualityPreset, cameraPos: Vector3, sunDir: Vector3, sunColor: Color, fogColor: Color, fogDensity: number) {
    const cs = WORLD.chunk;
    const pcx = Math.floor(playerPos.x / cs), pcz = Math.floor(playerPos.z / cs);
    const reach = Math.ceil(quality.vegetationDistance / cs);
    const grassReach = Math.ceil(quality.grassDistance / cs);

    if (pcx !== this.lastCx || pcz !== this.lastCz) {
      this.lastCx = pcx; this.lastCz = pcz;
      const wanted = new Set<string>();
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (Math.hypot(dx, dz) > reach + 0.3) continue;
          wanted.add(`${pcx + dx},${pcz + dz}`);
        }
      }
      for (const [key, cv] of Array.from(this.chunks)) {
        if (!wanted.has(key)) this.unloadChunk(key);
      }
      // load nearest missing first
      const missing = Array.from(wanted).filter((k) => !this.chunks.has(k));
      missing.sort((a, b) => {
        const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
        return Math.hypot(ax - pcx, az - pcz) - Math.hypot(bx - pcx, bz - pcz);
      });
      for (const k of missing.slice(0, 3)) {
        const [cx, cz] = k.split(',').map(Number);
        this.populateChunk(cx, cz, pcx, pcz, quality, grassReach);
      }
    }

    const u = this.grassMaterial.uniforms;
    (u.uCam.value as Vector3).copy(cameraPos);
    (u.uSunDir.value as Vector3).copy(sunDir);
    (u.uSunColor.value as Color).copy(sunColor);
    (u.uFogColor.value as Color).copy(fogColor);
    u.uFogDensity.value = fogDensity;
  }

  private unloadChunk(key: string) {
    const cv = this.chunks.get(key);
    if (!cv) return;
    for (const it of cv.items) this.species[it.sp][it.isNear ? 'near' : 'far'].release(it.idx);
    for (const c of cv.colliders) physics.remove(c);
    for (const g of cv.grass) this.releaseGrass(g.idx);
    this.chunks.delete(key);
  }

  private populateChunk(cx: number, cz: number, pcx: number, pcz: number, q: QualityPreset, grassReach: number) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const size = WORLD.chunk;
    const ox = cx * size, oz = cz * size;
    const cv: ChunkVeg = { key, items: [], colliders: [], grass: [] };
    const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
    const isNear = dist <= 0;
    const rng = makeRng(Math.floor(chunkHash(cx, cz, 1) * 1e9));

    const place = (spName: string, x: number, z: number, y: number, scale: number, rot: number, tilt = 0) => {
      const spIdx = this.species.findIndex((s) => s.name === spName);
      if (spIdx < 0) return;
      const sp = this.species[spIdx];
      const pool = isNear ? sp.near : sp.far;
      const idx = pool.alloc();
      if (idx === null) return;
      _q.position.set(x, y, z);
      _q.rotation.set(tilt, rot, 0);
      _q.scale.setScalar(scale);
      _q.updateMatrix();
      pool.mesh.setMatrixAt(idx, _q.matrix);
      pool.mesh.instanceMatrix.needsUpdate = true;
      cv.items.push({ sp: spIdx, idx, isNear });
      return { spIdx, isNear, idx };
    };

    const n = { bamboo: 0, tree: 0, bush: 0, rock: 0 };
    const samples = 130;
    for (let i = 0; i < samples; i++) {
      const x = ox + rng() * size, z = oz + rng() * size;
      const h = heightAt(x, z);
      const slope = 1 - terrainNormal(x, z, _v).y;
      const under = h < WORLD.waterLevel;
      const nearWater = h < WORLD.waterLevel + 1.4 && h > WORLD.waterLevel - 2.5;
      const path = sampleMask(x, z, CH_PATH);
      const settle = sampleMask(x, z, CH_SETTLE);
      const field = sampleMask(x, z, CH_FIELD);
      if (settle > 0.4 || path > 0.35) continue;
      const biome = biomeAt(x, z);
      const moist = moistureAt(x, z);

      if (under && slope < 0.3 && h > WORLD.waterLevel - 1.6) {
        if (rng() < 0.5) place('lily', x, z, WORLD.waterLevel + 0.02, 0.8 + rng() * 0.8, rng() * 6.28);
        continue;
      }
      if (nearWater) {
        if (rng() < 0.35) place('reed', x, z, h - 0.1, 0.8 + rng() * 0.7, rng() * 6.28);
        continue;
      }
      if (h > WORLD.waterLevel + 1.0) {
        if (biome === 'bamboo') {
          if (slope > 0.42) { if (rng() < 0.25) place('rock', x, z, h - 0.3, 0.6 + rng() * 1.4, rng() * 6.28); continue; }
          const dens = field > 0.4 ? 0.05 : 0.62;
          if (rng() < dens) { place('bamboo', x, z, h - 0.1, 0.7 + rng() * 0.6, rng() * 6.28, (rng() - 0.5) * 0.08); n.bamboo++; }
          continue;
        }
        if (biome === 'forest') {
          if (slope > 0.5) { if (rng() < 0.3) place('rock', x, z, h - 0.3, 0.7 + rng() * 1.6, rng() * 6.28); continue; }
          if (rng() < (field > 0.4 ? 0.03 : 0.24)) {
            const pine = rng() < 0.45;
            place(pine ? 'pine' : 'broadleaf', x, z, h - 0.15, 0.8 + rng() * 0.8, rng() * 6.28, (rng() - 0.5) * 0.06);
            n.tree++;
          } else if (rng() < 0.22) place('bush', x, z, h - 0.1, 0.7 + rng() * 0.9, rng() * 6.28);
          continue;
        }
        if (biome === 'snow' || biome === 'rock') {
          if (h > 120 && slope < 0.45 && rng() < 0.16) place('snowtree', x, z, h - 0.15, 0.8 + rng() * 0.7, rng() * 6.28);
          else if (rng() < 0.22) place('rock', x, z, h - 0.4, 0.5 + rng() * 1.8, rng() * 6.28);
          continue;
        }
        if (biome === 'highland') {
          if (slope < 0.4 && rng() < 0.12) place('pine', x, z, h - 0.15, 0.7 + rng() * 0.7, rng() * 6.28);
          else if (rng() < 0.18) place('rock', x, z, h - 0.3, 0.5 + rng() * 1.4, rng() * 6.28);
          else if (rng() < 0.2) place('bush', x, z, h - 0.1, 0.6 + rng() * 0.8, rng() * 6.28);
          continue;
        }
        // grass / shore biomes: scattered trees, bushes, rocks
        if (rng() < 0.055) place('broadleaf', x, z, h - 0.15, 0.8 + rng() * 0.8, rng() * 6.28, (rng() - 0.5) * 0.05);
        else if (rng() < 0.12) place('bush', x, z, h - 0.1, 0.6 + rng() * 0.8, rng() * 6.28);
        else if (rng() < 0.06 && slope > 0.15) place('rock', x, z, h - 0.3, 0.4 + rng() * 1.1, rng() * 6.28);
      }
    }

    // trunk colliders near the player
    if (dist <= 1) {
      for (const it of cv.items) {
        const name = this.species[it.sp].name;
        if (name !== 'pine' && name !== 'broadleaf' && name !== 'snowtree') continue;
        const pool = this.species[it.sp][it.isNear ? 'near' : 'far'];
        pool.mesh.getMatrixAt(it.idx, _m);
        const pos = new Vector3().setFromMatrixPosition(_m);
        const scale = new Vector3().setFromMatrixScale(_m).x;
        const c = physics.addCylinder(new Vector3(pos.x, pos.y + 1.5, pos.z), 0.42 * scale, 3.0, false, 'tree');
        cv.colliders.push(c);
      }
    }

    // grass tufts
    const gdist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
    if (gdist <= grassReach) {
      const count = Math.floor(160 * q.grassDensity);
      for (let i = 0; i < count; i++) {
        const x = ox + rng() * size, z = oz + rng() * size;
        const h = heightAt(x, z);
        if (h < WORLD.waterLevel + 0.15 || h > 150) continue;
        const slope = 1 - terrainNormal(x, z, _v).y;
        if (slope > 0.55) continue;
        if (sampleMask(x, z, CH_PATH) > 0.4 || sampleMask(x, z, CH_SETTLE) > 0.5) continue;
        if (sampleMask(x, z, CH_FIELD) > 0.5 && rng() < 0.75) continue;
        const idx = this.allocGrass();
        if (idx === null) break;
        _q.position.set(x, h - 0.05, z);
        _q.rotation.set(0, rng() * 6.28, 0);
        const s = (0.75 + rng() * 0.8) * (h > 100 ? 0.5 : 1);
        _q.scale.set(s, s * (0.8 + rng() * 0.6), s);
        _q.updateMatrix();
        this.grass.setMatrixAt(idx, _q.matrix);
        cv.grass.push({ idx });
      }
      this.grass.instanceMatrix.needsUpdate = true;
    }

    this.chunks.set(key, cv);
  }

  clear() {
    for (const key of Array.from(this.chunks.keys())) this.unloadChunk(key);
  }
}
