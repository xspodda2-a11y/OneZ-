import { Quaternion, Vector3 } from 'three';
import { BuiltSkeleton } from './Skeleton';
import { CompiledClip, compileClip, ClipDef } from './Clips';

interface Layer {
  clip: CompiledClip;
  time: number;
  weight: number;
  target: number;
  fade: number;
  speed: number;
  loops: boolean;
  done: boolean;
  requestEnd: boolean;
}

const _qA = new Quaternion();
const _qB = new Quaternion();
const _qC = new Quaternion();
const _v = new Vector3();

/**
 * Two-layer animation mixer: a full-body base layer (locomotion / emotes) and a
 * masked overlay layer (attacks, blocks) blended on top of the upper body.
 */
export class Animator {
  skel: BuiltSkeleton;
  clips: Record<string, CompiledClip> = {};
  private base: Layer | null = null;
  private overlays: Layer[] = [];
  private snapshot: Quaternion[] | null = null;
  private snapRootY = 0;
  private snapTime = 0;
  private snapDur = 0.001;
  /** final local rotations, indexed like skel.bones */
  out: Quaternion[];
  rootY = 0;
  rootMotion = new Vector3();
  timeScale = 1;
  /** procedural extras */
  sway = new Vector3();
  lookTarget: Vector3 | null = null;
  lookWeight = 0;
  private tmpPose: Quaternion[];

  constructor(skel: BuiltSkeleton, defs: ClipDef[]) {
    this.skel = skel;
    for (const d of defs) this.clips[d.name] = compileClip(d, skel);
    this.out = skel.bones.map((b) => b.quaternion.clone());
    this.tmpPose = skel.bones.map(() => new Quaternion());
  }

  has(name: string) { return !!this.clips[name]; }

  /** Play a base (full body) clip. */
  play(name: string, fade = 0.18, speed = 1) {
    const clip = this.clips[name];
    if (!clip) { console.warn('missing clip', name); return; }
    if (this.base && this.base.clip.name === name && !this.base.requestEnd) return;
    this.snapshot = this.out.map((q) => q.clone());
    this.snapRootY = this.rootY;
    this.snapTime = 0;
    this.snapDur = Math.max(0.0001, fade);
    this.base = { clip, time: 0, weight: 0, target: 1, fade, speed, loops: clip.loop, done: false, requestEnd: false };
  }

  /** Play a one-shot overlay (usually an attack). Returns the layer duration. */
  playOverlay(name: string, fade = 0.08, speed = 1): number {
    const clip = this.clips[name];
    if (!clip) { console.warn('missing clip', name); return 0; }
    const layer: Layer = { clip, time: 0, weight: 0, target: 1, fade, speed, loops: false, done: false, requestEnd: false };
    this.overlays = this.overlays.filter((o) => !o.requestEnd);
    this.overlays.push(layer);
    return clip.dur / speed;
  }

  stopOverlay(fade = 0.15) {
    for (const o of this.overlays) { o.target = 0; o.fade = fade; o.requestEnd = true; }
  }

  get current() { return this.base?.clip.name ?? ''; }
  get overlayName() { return this.overlays.length ? this.overlays[this.overlays.length - 1].clip.name : ''; }
  get baseTime() { return this.base?.time ?? 0; }
  setBaseTime(t: number) { if (this.base) this.base.time = t; }

  private sample(clip: CompiledClip, time: number, out: Quaternion[], outMask?: boolean[]) {
    const keys = clip.keys;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= time) i++;
    const k0 = keys[i];
    const k1 = keys[Math.min(keys.length - 1, i + 1)];
    const span = Math.max(1e-5, k1.t - k0.t);
    let t = (time - k0.t) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    // smooth easing between keys
    const e = t * t * (3 - 2 * t);
    for (let b = 0; b < out.length; b++) {
      const a = k0.q[b], c = k1.q[b];
      if (a && c) out[b].slerpQuaternions(a, c, e);
      else if (a) out[b].copy(a);
      else if (c) out[b].copy(c);
      else out[b].copy(this.skel.restQuat[b]);
      if (outMask) outMask[b] = !!(a || c);
    }
    return { rootY: k0.rootY + (k1.rootY - k0.rootY) * e, motion: [
      k0.motion[0] + (k1.motion[0] - k0.motion[0]) * e,
      k0.motion[1] + (k1.motion[1] - k0.motion[1]) * e,
      k0.motion[2] + (k1.motion[2] - k0.motion[2]) * e,
    ] as [number, number, number] };
  }

  update(dt: number) {
    const n = this.out.length;
    dt *= this.timeScale;

    // ---- base layer ----
    if (this.base) {
      const L = this.base;
      L.time += dt * L.speed;
      if (L.clip.loop) {
        while (L.time > L.clip.dur) L.time -= L.clip.dur;
      } else if (L.time > L.clip.dur) {
        L.time = L.clip.dur;
        L.done = true;
      }
      L.weight = Math.min(1, L.weight + dt / Math.max(0.0001, L.fade));
      const res = this.sample(L.clip, L.time, this.tmpPose);
      this.rootY = res.rootY;
      this.rootMotion.set(res.motion[0], res.motion[1], res.motion[2]);

      const snapT = Math.min(1, this.snapTime / this.snapDur);
      this.snapTime += dt;
      const w = L.weight * snapT;
      if (this.snapshot && snapT < 1) {
        for (let b = 0; b < n; b++) this.out[b].slerpQuaternions(this.snapshot[b], this.tmpPose[b], w);
        this.rootY = this.snapRootY + (this.rootY - this.snapRootY) * w;
      } else {
        for (let b = 0; b < n; b++) this.out[b].copy(this.tmpPose[b]);
      }
    } else {
      for (let b = 0; b < n; b++) this.out[b].copy(this.skel.restQuat[b]);
      this.rootY = 0;
      this.rootMotion.set(0, 0, 0);
    }

    // ---- overlays ----
    for (let oi = this.overlays.length - 1; oi >= 0; oi--) {
      const O = this.overlays[oi];
      O.time += dt * O.speed;
      if (!O.clip.loop && O.time > O.clip.dur) {
        if (O.clip.overlay) { O.time = O.clip.dur; O.target = 0; O.requestEnd = true; }
        else while (O.time > O.clip.dur) O.time -= O.clip.dur;
      }
      O.weight += (O.target - O.weight) * Math.min(1, dt / Math.max(0.0001, O.fade) * 3.0);
      if (O.requestEnd && O.weight < 0.02) { this.overlays.splice(oi, 1); continue; }
      const res = this.sample(O.clip, O.time, this.tmpPose);
      for (let b = 0; b < n; b++) {
        if (!O.clip.mask[b]) continue;
        this.out[b].slerp(this.tmpPose[b], O.weight);
      }
      if (oi === this.overlays.length - 1 || true) {
        this.rootY += res.rootY * O.weight * 0.6;
        this.rootMotion.x += res.motion[0] * O.weight;
        this.rootMotion.z += res.motion[2] * O.weight;
      }
    }

    // ---- procedural sway for the robe hem + hair ----
    const sw = this.sway;
    const idx = this.skel.byName;
    if (idx['hemF']) {
      const f = Math.max(-0.6, Math.min(0.6, -sw.z * 0.05));
      const s = Math.max(-0.6, Math.min(0.6, sw.x * 0.05));
      idx['hemF'].rotation.set(f * 1.0 + 0.05, 0, s * 0.4);
      idx['hemB'].rotation.set(-f * 0.7 + 0.05, 0, -s * 0.3);
      idx['hemL'].rotation.set(f * 0.8 + 0.05, 0, s * 0.9);
      idx['hemR'].rotation.set(f * 0.8 + 0.05, 0, -s * 0.9);
    }
    if (idx['hairBack']) {
      idx['hairBack'].rotation.set(Math.max(-0.7, Math.min(0.7, -sw.z * 0.06)) + 0.12, 0, sw.x * 0.04);
    }
    // hair / hem bones are not driven by clips: keep them out of the blend
    const skip = new Set(['hemF', 'hemB', 'hemL', 'hemR', 'hairBack']);

    // ---- write to the skeleton ----
    for (let b = 0; b < n; b++) {
      const bone = this.skel.bones[b];
      if (skip.has(bone.name)) continue;
      bone.quaternion.copy(this.out[b]);
    }
  }
}
