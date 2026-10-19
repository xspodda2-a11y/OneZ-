import {
  Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshStandardMaterial,
  Vector3, Color, DoubleSide, Object3D, Matrix4,
} from 'three';

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();

/**
 * Verlet-simulated camera-facing ribbon: sash streamers, sword tassels,
 * banner cloth and the boss cape all use this.
 */
export class Ribbon {
  points: Vector3[] = [];
  prev: Vector3[] = [];
  mesh: Mesh;
  private geo: BufferGeometry;
  private widths: number[] = [];
  private anchor: Object3D;
  private offset: Vector3;
  private gravity: number;
  private stiffness: number;
  private damping: number;
  private color: Color;
  private segLen: number;
  private init = false;
  private localAnchor = new Vector3();

  constructor(opts: {
    anchor: Object3D;
    offset?: Vector3;
    segments?: number;
    length: number;
    width: number;
    color: string;
    gravity?: number;
    stiffness?: number;
    damping?: number;
  }) {
    const n = opts.segments ?? 8;
    this.anchor = opts.anchor;
    this.offset = opts.offset ?? new Vector3();
    this.gravity = opts.gravity ?? -9.0;
    this.stiffness = opts.stiffness ?? 0.85;
    this.damping = opts.damping ?? 0.92;
    this.color = new Color(opts.color).convertSRGBToLinear();
    this.segLen = opts.length / n;
    for (let i = 0; i < n; i++) {
      this.points.push(new Vector3());
      this.prev.push(new Vector3());
      const t = i / (n - 1);
      this.widths.push(opts.width * (1 - t * 0.75));
    }
    const positions = new Float32Array(n * 2 * 3);
    const normals = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const colors = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n * 2; i++) {
      colors[i * 3] = this.color.r; colors[i * 3 + 1] = this.color.g; colors[i * 3 + 2] = this.color.b;
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(positions, 3));
    this.geo.setAttribute('normal', new BufferAttribute(normals, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geo.setAttribute('color', new BufferAttribute(colors, 3));
    this.geo.setIndex(idx);
    const mat = new MeshStandardMaterial({
      vertexColors: true, side: DoubleSide, roughness: 0.85, metalness: 0.0,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  reset() { this.init = false; }

  update(dt: number, wind: Vector3, cameraPos: Vector3, extraForce?: Vector3) {
    this.anchor.updateWorldMatrix(true, false);
    this.localAnchor.copy(this.offset).applyMatrix4(this.anchor.matrixWorld);
    if (!this.init) {
      for (let i = 0; i < this.points.length; i++) {
        this.points[i].copy(this.localAnchor).add(_d.set(0, -this.segLen * i, 0));
        this.prev[i].copy(this.points[i]);
      }
      this.init = true;
    }
    const n = this.points.length;
    // verlet integration
    for (let i = 1; i < n; i++) {
      const p = this.points[i], prev = this.prev[i];
      _a.copy(p).sub(prev).multiplyScalar(this.damping);
      prev.copy(p);
      _b.set(0, this.gravity * dt * dt, 0);
      _b.addScaledVector(wind, dt * dt * 2.2);
      if (extraForce) _b.addScaledVector(extraForce, dt * dt);
      p.add(_a).add(_b);
    }
    this.points[0].copy(this.localAnchor);
    this.prev[0].copy(this.localAnchor);
    // distance constraints
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < n - 1; i++) {
        const p0 = this.points[i], p1 = this.points[i + 1];
        _a.copy(p1).sub(p0);
        const d = _a.length() || 0.0001;
        _a.multiplyScalar((d - this.segLen) / d);
        if (i === 0) p1.addScaledVector(_a, -1 * this.stiffness);
        else {
          p0.addScaledVector(_a, 0.5 * this.stiffness);
          p1.addScaledVector(_a, -0.5 * this.stiffness);
        }
      }
    }
    // build camera-facing strip
    const pos = this.geo.attributes.position.array as Float32Array;
    const nrm = this.geo.attributes.normal.array as Float32Array;
    const uv = this.geo.attributes.uv.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const prevP = i > 0 ? this.points[i - 1] : p;
      const nextP = i < n - 1 ? this.points[i + 1] : p;
      _a.copy(nextP).sub(prevP);
      if (_a.lengthSq() < 1e-8) _a.set(0, -1, 0);
      _a.normalize();
      _b.copy(cameraPos).sub(p).normalize();
      _c.crossVectors(_a, _b);
      if (_c.lengthSq() < 1e-8) _c.set(1, 0, 0);
      _c.normalize().multiplyScalar(this.widths[i]);
      const i2 = i * 2;
      pos[i2 * 3] = p.x + _c.x; pos[i2 * 3 + 1] = p.y + _c.y; pos[i2 * 3 + 2] = p.z + _c.z;
      pos[(i2 + 1) * 3] = p.x - _c.x; pos[(i2 + 1) * 3 + 1] = p.y - _c.y; pos[(i2 + 1) * 3 + 2] = p.z - _c.z;
      nrm[i2 * 3] = _b.x; nrm[i2 * 3 + 1] = _b.y; nrm[i2 * 3 + 2] = _b.z;
      nrm[(i2 + 1) * 3] = _b.x; nrm[(i2 + 1) * 3 + 1] = _b.y; nrm[(i2 + 1) * 3 + 2] = _b.z;
      uv[i2 * 2] = 0; uv[i2 * 2 + 1] = i / (n - 1);
      uv[(i2 + 1) * 2] = 1; uv[(i2 + 1) * 2 + 1] = i / (n - 1);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
