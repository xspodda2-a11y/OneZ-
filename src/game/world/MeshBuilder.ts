import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Matrix4, Vector3, Color,
  MeshStandardMaterial, Mesh, BoxGeometry, PlaneGeometry, DoubleSide, FrontSide, Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Layer = 'opaque' | 'metal' | 'glow' | 'glass';

/**
 * Accumulates transformed primitives into a handful of merged, vertex-coloured
 * meshes so an entire village costs only a few draw calls.
 */
export class MeshBuilder {
  private layers: Record<Layer, BufferGeometry[]> = { opaque: [], metal: [], glow: [], glass: [] };

  add(geo: BufferGeometry, color: string | number, matrix: Matrix4, layer: Layer = 'opaque', uvScale = 1) {
    // mergeGeometries requires every input to share the same index-ness:
    // normalise everything to non-indexed so hand-built and primitive
    // geometries can be merged together.
    let g = geo.clone();
    if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
    if (uvScale !== 1) {
      const uv = g.attributes.uv as BufferAttribute;
      if (uv) {
        const arr = uv.array as Float32Array;
        for (let i = 0; i < arr.length; i++) arr[i] *= uvScale;
        uv.needsUpdate = true;
      }
    }
    g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = new Color(color as any).convertSRGBToLinear();
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new BufferAttribute(cols, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    // drop anything the merge doesn't need
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
    }
    this.layers[layer].push(g);
    return g;
  }

  /** Convenience: axis-aligned box. */
  box(color: string | number, pos: Vector3, size: Vector3, rotY = 0, layer: Layer = 'opaque', uvScale = 1) {
    const m = new Matrix4();
    m.makeRotationY(rotY);
    m.setPosition(pos);
    const g = new BoxGeometry(size.x, size.y, size.z);
    return this.add(g, color, m, layer, uvScale);
  }

  build(): Mesh[] {
    const meshes: Mesh[] = [];
    const makeMat = (layer: Layer) => {
      switch (layer) {
        case 'metal': return matCache.metal || (matCache.metal = new MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.35, name: 'structMetal' }));
        case 'glow': return matCache.glow || (matCache.glow = new MeshStandardMaterial({
          vertexColors: true, roughness: 0.6, emissive: new Color(0xffb060), emissiveIntensity: 1.7, name: 'structGlow',
        }));
        case 'glass': return matCache.glass || (matCache.glass = new MeshStandardMaterial({
          vertexColors: true, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.42,
          side: DoubleSide, name: 'structGlass',
        }));
        default: return matCache.opaque || (matCache.opaque = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, name: 'structOpaque' }));
      }
    };
    for (const layer of ['opaque', 'metal', 'glow', 'glass'] as Layer[]) {
      const list = this.layers[layer];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, makeMat(layer));
      mesh.castShadow = layer !== 'glow';
      mesh.receiveShadow = true;
      mesh.name = 'struct_' + layer;
      meshes.push(mesh);
    }
    return meshes;
  }

  get isEmpty() {
    return this.layers.opaque.length + this.layers.metal.length + this.layers.glow.length + this.layers.glass.length === 0;
  }
}

const matCache: Record<string, MeshStandardMaterial> = {};

export const _m = new Matrix4();
export const _v = new Vector3();

export function mat(pos: Vector3, rotY = 0, scale?: Vector3): Matrix4 {
  const m = new Matrix4();
  m.makeRotationY(rotY);
  if (scale) m.scale(scale);
  m.setPosition(pos);
  return m;
}

export function matFull(pos: Vector3, rot: Vector3, scale?: Vector3): Matrix4 {
  const m = new Matrix4();
  m.makeRotationFromEuler(new Euler(rot.x, rot.y, rot.z));
  if (scale) m.scale(scale);
  m.setPosition(pos);
  return m;
}
