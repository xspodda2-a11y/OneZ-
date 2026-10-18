import {
  Group, Vector3, MeshStandardMaterial, Color, Object3D, Quaternion, Euler, Box3,
} from 'three';
import { buildCharacter, RigResult, CharacterLook } from './CharacterRig';
import { Animator } from './Animator';
import { ALL_CLIP_DEFS } from './Clips';
import { buildWeapon, buildScabbard, WeaponType, WeaponResult, WeaponOptions } from './Weapons';
import { Ribbon } from './Cloth';
import { clamp, damp } from '../core/Noise';

export class Actor {
  rig: RigResult;
  anim: Animator;
  root: Group;
  weapon: WeaponResult | null = null;
  scabbard: Object3D | null = null;
  ribbons: Ribbon[] = [];
  weaponType: WeaponType = 'jian';
  height: number;
  /** world velocity of the actor (set by the controller) */
  velocity = new Vector3();
  lookDir = new Vector3(0, 0, 1);
  sheathed = true;
  flashTimer = 0;
  private mats: MeshStandardMaterial[] = [];
  private baseEmissive: Color[] = [];
  private _tmp = new Vector3();
  private _tmp2 = new Vector3();
  private _q = new Quaternion();
  private footPhase = 0;
  onFootstep?: (pos: Vector3, running: boolean) => void;

  constructor(look: Partial<CharacterLook>, opts: { weapon?: WeaponType; weaponOpts?: WeaponOptions; scale?: number } = {}) {
    this.rig = buildCharacter(look);
    this.root = this.rig.root;
    this.anim = new Animator(this.rig.skel, ALL_CLIP_DEFS);
    this.height = 1.76 * (this.rig.look.height ?? 1);
    if (opts.scale) { this.root.scale.setScalar(opts.scale); this.height *= opts.scale; }
    this.weaponType = opts.weapon ?? 'jian';
    if (this.weaponType !== 'fists') {
      this.weapon = buildWeapon(this.weaponType, opts.weaponOpts ?? {});
      this.scabbard = buildScabbard();
      this.rig.sockets.back.add(this.scabbard);
      this.setSheathed(true);
      // sash streamers
      const sashColor = this.rig.look.sash;
      this.ribbons.push(new Ribbon({
        anchor: this.rig.skel.byName['hips'], offset: new Vector3(0.10, -0.06, 0.06),
        segments: 7, length: 0.62, width: 0.055, color: sashColor, gravity: -7.5,
      }));
      this.ribbons.push(new Ribbon({
        anchor: this.rig.skel.byName['hips'], offset: new Vector3(-0.10, -0.06, 0.06),
        segments: 7, length: 0.58, width: 0.055, color: sashColor, gravity: -7.5,
      }));
      for (const r of this.ribbons) this.root.add(r.mesh);
    }
    this.makeUniqueMaterials();
  }

  private makeUniqueMaterials() {
    const m = this.rig.mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
    const arr = Array.isArray(m) ? m : [m];
    this.mats = arr.map((mm) => mm.clone());
    this.baseEmissive = this.mats.map((mm) => mm.emissive.clone());
    this.rig.mesh.material = this.mats.length === 1 ? this.mats[0] : this.mats;
  }

  setSheathed(v: boolean) {
    this.sheathed = v;
    if (!this.weapon) return;
    if (v) {
      this.rig.sockets.back.add(this.weapon.group);
      this.weapon.group.position.set(0, -0.15, 0);
      this.weapon.group.rotation.set(0.15, 0, 0);
      if (this.scabbard) this.scabbard.visible = true;
    } else {
      this.rig.sockets.handR.add(this.weapon.group);
      this.weapon.group.position.set(0, 0, 0);
      this.weapon.group.rotation.set(0, 0, 0);
      if (this.scabbard) this.scabbard.visible = false;
    }
  }

  get bone() { return this.rig.skel.byName; }

  /** World-space position of a bone (or socket) — used for VFX and combat hit tests. */
  boneWorld(name: string, out = new Vector3()): Vector3 {
    const b = this.rig.skel.byName[name];
    if (!b) return out.copy(this.root.position);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  socketWorld(name: keyof RigResult['sockets'], out = new Vector3()): Vector3 {
    const s = this.rig.sockets[name] as Object3D;
    s.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(s.matrixWorld);
  }

  flash(color = 0xffffff, strength = 0.9, time = 0.16) {
    this.flashTimer = time;
    this._flashColor.set(color);
    this._flashStrength = strength;
  }
  private _flashColor = new Color(1, 1, 1);
  private _flashStrength = 0.9;

  update(dt: number, cameraPos: Vector3, wind: Vector3, time: number) {
    // hem / hair sway from local velocity
    const localVel = this._tmp.copy(this.velocity);
    const yaw = this.root.rotation.y;
    const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
    this._tmp2.set(localVel.x * cs - localVel.z * sn, 0, localVel.x * sn + localVel.z * cs);
    this.anim.sway.set(
      damp(this.anim.sway.x, clamp(this._tmp2.x, -8, 8), 6, dt),
      damp(this.anim.sway.y, clamp(this.velocity.y, -12, 12), 6, dt),
      damp(this.anim.sway.z, clamp(this._tmp2.z, -8, 8), 6, dt),
    );
    this.anim.update(dt);

    // the mesh sits at the root: the animator drives hips through the skeleton,
    // rootY raises/lowers the whole rig for crouches, jumps and rolls
    this.rig.mesh.position.y = this.anim.rootY;

    // flash feedback
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const k = Math.max(0, this.flashTimer / 0.16);
      for (let i = 0; i < this.mats.length; i++) {
        this.mats[i].emissive.copy(this._flashColor).multiplyScalar(this._flashStrength * k);
      }
      if (this.flashTimer <= 0) for (let i = 0; i < this.mats.length; i++) this.mats[i].emissive.copy(this.baseEmissive[i]);
    }

    // ribbons
    for (const r of this.ribbons) {
      r.update(dt, wind, cameraPos, this._tmp.set(0, 0, 0).addScaledVector(this.velocity, -0.12));
    }

    // footstep events from the locomotion phase
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (sp > 0.6) {
      const prev = this.footPhase;
      this.footPhase += dt * (sp > 5 ? 2.6 : sp > 2.4 ? 2.0 : 1.5);
      if (Math.floor(this.footPhase / Math.PI) !== Math.floor(prev / Math.PI)) {
        if (this.onFootstep) {
          this.boneWorld('footL', this._tmp);
          this.onFootstep(this._tmp.clone(), sp > 4.5);
        }
      }
    }
  }

  setVisible(v: boolean) { this.root.visible = v; }

  dispose() {
    this.rig.mesh.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const r of this.ribbons) r.dispose();
    this.root.removeFromParent();
  }
}
