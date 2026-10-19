import {
  Group, Points, BufferGeometry, BufferAttribute, Float32BufferAttribute, ShaderMaterial,
  AdditiveBlending, Vector3, Color, Mesh, RingGeometry, PlaneGeometry, MeshBasicMaterial,
  DoubleSide, Object3D, Scene, PerspectiveCamera, Matrix4, Quaternion, Sprite,
  SpriteMaterial, CanvasTexture,
} from 'three';
import { softDot, streakSprite, petalSprite } from './render/Textures';
import { clamp01, lerpN } from './core/Noise';

const MAX_P = 2200;

class ParticlePool {
  points: Points;
  pos: Float32Array;
  col: Float32Array;
  siz: Float32Array;
  alp: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  spin: Float32Array;
  count = 0;
  cursor = 0;
  private geo: BufferGeometry;
  private mat: ShaderMaterial;

  constructor(scene: Scene) {
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.siz = new Float32Array(MAX_P);
    this.alp = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.maxLife = new Float32Array(MAX_P);
    this.grav = new Float32Array(MAX_P);
    this.drag = new Float32Array(MAX_P);
    this.spin = new Float32Array(MAX_P);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.siz, 1));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alp, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uMap: { value: softDot() }, uPx: { value: 700 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uPx;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPx / max(1.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a * vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(p: Vector3, v: Vector3, color: Color, size: number, life: number, gravity = -9, drag = 1.6) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_P;
    if (this.count < MAX_P) this.count++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.siz[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag;
    this.alp[i] = 1;
  }

  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alp[i] = 0; continue; }
      this.life[i] -= dt;
      const k = clamp01(this.life[i] / this.maxLife[i]);
      this.alp[i] = k * k;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.setDrawRange(0, this.count);
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
  }
}

interface Trail {
  mesh: Mesh;
  life: number;
  maxLife: number;
  history: { tip: Vector3; base: Vector3 }[];
  width: number;
  color: Color;
}

interface SlashFx {
  mesh: Mesh;
  life: number;
  maxLife: number;
  scale0: number;
  scale1: number;
}

export class VFX {
  group = new Group();
  private particles: ParticlePool;
  private trails: Trail[] = [];
  private slashes: SlashFx[] = [];
  private ripples: { mesh: Mesh; life: number; maxLife: number; r0: number; r1: number }[] = [];
  trauma = 0;
  private scene: Scene;
  private dmgContainer: HTMLElement | null = null;
  private _v = new Vector3();
  private _v2 = new Vector3();
  private _c = new Color();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'vfx';
    scene.add(this.group);
    this.particles = new ParticlePool(scene);
    this.dmgContainer = document.getElementById('dmg-layer');
  }

  /* ------------------------------------------------------------ particles */

  burst(pos: Vector3, color: string | Color, count = 12, speed = 4, size = 0.5, life = 0.5, gravity = -8) {
    const c = typeof color === 'string' ? new Color(color) : color;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI * 0.7;
      const s = speed * (0.4 + Math.random() * 0.9);
      this._v.set(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.4, Math.sin(a) * Math.cos(e)).multiplyScalar(s);
      this.particles.emit(pos, this._v, this._c.copy(c).offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.2),
        size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), gravity);
    }
  }

  sparks(pos: Vector3, dir: Vector3, count = 14, color = '#ffd68a') {
    const c = new Color(color);
    for (let i = 0; i < count; i++) {
      this._v.copy(dir).multiplyScalar(1.5 + Math.random() * 3);
      this._v.x += (Math.random() - 0.5) * 5;
      this._v.y += Math.random() * 3.5;
      this._v.z += (Math.random() - 0.5) * 5;
      this.particles.emit(pos, this._v, c, 0.16 + Math.random() * 0.2, 0.22 + Math.random() * 0.3, -14, 2.4);
    }
    this.burst(pos, '#fff2c8', 5, 2.2, 0.42, 0.22, -3);
  }

  blood(pos: Vector3, dir: Vector3, amount = 10) {
    const c = new Color('#8e1d1d');
    for (let i = 0; i < amount; i++) {
      this._v.copy(dir).multiplyScalar(1.2 + Math.random() * 2.5);
      this._v.x += (Math.random() - 0.5) * 3;
      this._v.y += Math.random() * 2.2;
      this._v.z += (Math.random() - 0.5) * 3;
      this.particles.emit(pos, this._v, c, 0.13 + Math.random() * 0.16, 0.5 + Math.random() * 0.4, -13, 1.2);
    }
  }

  dust(pos: Vector3, count = 10, size = 0.9, up = 1.2) {
    const c = new Color('#b6a892');
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.2 + Math.random() * 2.4;
      this._v.set(Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s);
      this.particles.emit(pos, this._v, c, size * (0.5 + Math.random()), 0.7 + Math.random() * 0.6, -1.2, 2.6);
    }
  }

  splash(pos: Vector3, count = 22) {
    const c = new Color('#cfe9f5');
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 4;
      this._v.set(Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s);
      this.particles.emit(pos, this._v, c, 0.16 + Math.random() * 0.22, 0.5 + Math.random() * 0.5, -13, 1.0);
    }
    this.ripple(pos, 0.6, 4.5, 0.7, '#cfe9f5');
  }

  qi(pos: Vector3, color = '#7fe8ff', count = 20, speed = 3.4) {
    const c = new Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * 1.2;
      this._v.set(Math.cos(a) * Math.cos(e), Math.sin(e) * 0.6 + 0.8, Math.sin(a) * Math.cos(e)).multiplyScalar(speed * (0.5 + Math.random()));
      this.particles.emit(pos, this._v, c, 0.3 + Math.random() * 0.4, 0.6 + Math.random() * 0.5, 1.6, 1.4);
    }
  }

  leaves(pos: Vector3, count = 8) {
    const c = new Color('#8fbf5a');
    for (let i = 0; i < count; i++) {
      this._v.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2);
      this.particles.emit(pos, this._v, c, 0.2 + Math.random() * 0.22, 1.6 + Math.random(), -1.4, 1.0);
    }
  }

  /* --------------------------------------------------------------- slashes */

  /** Crescent slash arc in front of an attacker. */
  slash(pos: Vector3, yaw: number, opts: { color?: string; scale?: number; life?: number; tilt?: number; arc?: number; inner?: number } = {}) {
    const geo = new RingGeometry(opts.inner ?? 0.9, (opts.inner ?? 0.9) + 1.5, 24, 1, 0, opts.arc ?? 1.35);
    const mat = new MeshBasicMaterial({
      color: new Color(opts.color ?? '#cfeaff'), transparent: true, opacity: 0.95,
      blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.set(Math.PI / 2 - (opts.tilt ?? 0.35), 0, 0);
    mesh.rotation.y = 0;
    const g = new Group();
    g.position.copy(pos);
    g.rotation.y = yaw;
    const m2 = new Mesh(geo, mat);
    m2.rotation.set(-Math.PI / 2 + (opts.tilt ?? 0.35), 0, 0);
    g.add(m2);
    this.group.add(g);
    const s0 = (opts.scale ?? 1) * 0.55, s1 = (opts.scale ?? 1) * 1.35;
    g.scale.setScalar(s0);
    this.slashes.push({ mesh: g as any, life: opts.life ?? 0.26, maxLife: opts.life ?? 0.26, scale0: s0, scale1: s1 });
    // store the inner mesh for opacity
    (g as any).userData.mesh = m2;
    (g as any).userData.mat = mat;
  }

  /** Expanding ground ring (shockwaves, telegraphs). */
  ripple(pos: Vector3, r0: number, r1: number, life: number, color = '#ffffff', opacity = 0.8) {
    const geo = new RingGeometry(0.86, 1.0, 48);
    const mat = new MeshBasicMaterial({
      color: new Color(color), transparent: true, opacity, blending: AdditiveBlending,
      depthWrite: false, side: DoubleSide,
    });
    const mesh = new Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.06;
    mesh.scale.setScalar(r0);
    this.group.add(mesh);
    this.ripples.push({ mesh, life, maxLife: life, r0, r1 });
  }

  /* ---------------------------------------------------------------- trails */

  startTrail(color: string, width = 0.16, life = 0.32): Trail {
    const n = 14;
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 2 * 3);
    const alpha = new Float32Array(n * 2);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(color) }, uMap: { value: streakSprite() }, uFade: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float aAlpha; varying float vA; varying vec2 vUv;
        void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform sampler2D uMap; uniform float uFade;
        varying float vA; varying vec2 vUv;
        void main(){
          float a = vA * uFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * (0.8 + vA * 1.4), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const t: Trail = { mesh, life, maxLife: life, history: [], width, color: new Color(color) };
    this.trails.push(t);
    return t;
  }

  updateTrail(t: Trail, tip: Vector3, base: Vector3) {
    t.history.push({ tip: tip.clone(), base: base.clone() });
    if (t.history.length > 14) t.history.shift();
    const n = 14;
    const pos = t.mesh.geometry.attributes.position.array as Float32Array;
    const alpha = t.mesh.geometry.attributes.aAlpha.array as Float32Array;
    const uv = t.mesh.geometry.attributes.uv.array as Float32Array;
    const h = t.history;
    for (let i = 0; i < n; i++) {
      const src = h[Math.max(0, h.length - n + i)] ?? h[h.length - 1];
      const k = i / (n - 1);
      if (!src) continue;
      pos[i * 2 * 3] = src.tip.x; pos[i * 2 * 3 + 1] = src.tip.y; pos[i * 2 * 3 + 2] = src.tip.z;
      pos[(i * 2 + 1) * 3] = src.base.x; pos[(i * 2 + 1) * 3 + 1] = src.base.y; pos[(i * 2 + 1) * 3 + 2] = src.base.z;
      alpha[i * 2] = k * 0.9; alpha[i * 2 + 1] = k * k * 0.75;
      uv[i * 2 * 2] = k; uv[i * 2 * 2 + 1] = 0;
      uv[(i * 2 + 1) * 2] = k; uv[(i * 2 + 1) * 2 + 1] = 1;
    }
    (t.mesh.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (t.mesh.geometry.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    (t.mesh.geometry.attributes.uv as BufferAttribute).needsUpdate = true;
  }

  /* -------------------------------------------------------- damage numbers */

  damageNumber(pos: Vector3, amount: number, kind: 'normal' | 'crit' | 'player' | 'heal' = 'normal') {
    if (!this.dmgContainer) return;
    const el = document.createElement('div');
    el.className = 'dmg-num ' + kind;
    const txt = kind === 'heal' ? `+${Math.round(amount)}` : `${Math.round(amount)}`;
    el.textContent = kind === 'crit' ? txt + '!' : txt;
    this.dmgContainer.appendChild(el);
    const rec = { el, pos: pos.clone(), life: kind === 'crit' ? 1.3 : 0.95, vy: 1.6 + Math.random() * 0.6, ox: (Math.random() - 0.5) * 26 };
    this.dmgNumbers.push(rec);
  }
  private dmgNumbers: { el: HTMLElement; pos: Vector3; life: number; vy: number; ox: number }[] = [];

  private updateDamageNumbers(dt: number, camera: PerspectiveCamera, w: number, h: number) {
    for (let i = this.dmgNumbers.length - 1; i >= 0; i--) {
      const d = this.dmgNumbers[i];
      d.life -= dt;
      if (d.life <= 0) { d.el.remove(); this.dmgNumbers.splice(i, 1); continue; }
      d.pos.y += d.vy * dt;
      d.vy -= dt * 1.2;
      const p = this._v.copy(d.pos).project(camera);
      const x = (p.x * 0.5 + 0.5) * w + d.ox;
      const y = (-p.y * 0.5 + 0.5) * h;
      const k = clamp01(d.life / 0.95);
      d.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.85 + k * 0.35).toFixed(2)})`;
      d.el.style.opacity = String(clamp01(k * 1.8));
    }
  }

  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt: number, camera: PerspectiveCamera, w: number, h: number) {
    this.particles.update(dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.9);

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= dt;
      const k = clamp01(t.life / t.maxLife);
      (t.mesh.material as ShaderMaterial).uniforms.uFade.value = k * k;
      if (t.life <= 0) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as ShaderMaterial).dispose();
        this.trails.splice(i, 1);
      }
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= dt;
      const k = clamp01(s.life / s.maxLife);
      const e = 1 - k;
      s.mesh.scale.setScalar(lerpN(s.scale0, s.scale1, Math.pow(e, 0.55)));
      const mat = (s.mesh as any).userData.mat as MeshBasicMaterial;
      if (mat) mat.opacity = k * k * 0.95;
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        const m = (s.mesh as any).userData.mesh as Mesh;
        m.geometry.dispose();
        mat.dispose();
        this.slashes.splice(i, 1);
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life -= dt;
      const k = clamp01(r.life / r.maxLife);
      r.mesh.scale.setScalar(lerpN(r.r1, r.r0, k));
      (r.mesh.material as MeshBasicMaterial).opacity = k * 0.85;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as MeshBasicMaterial).dispose();
        this.ripples.splice(i, 1);
      }
    }
    (this.particles.points.material as ShaderMaterial).uniforms.uPx.value = h * 0.55;
    this.updateDamageNumbers(dt, camera, w, h);
  }
}
