import { Vector3, Color } from 'three';
import { Entity, DamageInfo } from '../Entity';
import { clamp, clamp01, lerpN } from '../core/Noise';
import { bus, EV } from '../core/Events';

export interface AttackDef {
  id: string;
  name: string;
  nameCN: string;
  clip: string;
  kind: 'light' | 'heavy' | 'special' | 'enemy' | 'boss';
  /** seconds within the clip */
  windup: number;
  activeStart: number;
  activeEnd: number;
  dur: number;
  damage: number;
  stamina: number;
  poise: number;
  range: number;
  arc: number;       // degrees, total
  knockback: number;
  hitstop: number;
  shake: number;
  /** multiplier applied to the attacker's attack power */
  scale: number;
  trail?: { color: string; width: number };
  slash?: { color: string; scale: number; arc: number; tilt: number; y: number };
  aoe?: number;
  projectile?: { speed: number; life: number; radius: number; color: string };
  next?: string;
  comboWindow?: number;      // time after activeEnd where the next combo step is accepted
  unlock?: string;           // skill id required
  cooldown?: number;
  qi?: number;               // qi cost (special moves)
  sfx?: string;
  moveSpeed?: number;        // forward root motion multiplier
}

export const ATTACKS: Record<string, AttackDef> = {
  light1: {
    id: 'light1', name: 'Diagonal Cut', nameCN: '斜斩', clip: 'light1', kind: 'light',
    windup: 0.14, activeStart: 0.17, activeEnd: 0.34, dur: 0.62, damage: 1.0, stamina: 7,
    poise: 8, range: 2.7, arc: 110, knockback: 1.6, hitstop: 0.045, shake: 0.10, scale: 1.0,
    trail: { color: '#bfe7ff', width: 0.14 }, slash: { color: '#cfeaff', scale: 1.0, arc: 1.4, tilt: 0.9, y: 1.1 },
    next: 'light2', comboWindow: 0.42, sfx: 'swing', moveSpeed: 0.55,
  },
  light2: {
    id: 'light2', name: 'Rising Crescent', nameCN: '撩月式', clip: 'light2', kind: 'light',
    windup: 0.10, activeStart: 0.14, activeEnd: 0.30, dur: 0.58, damage: 1.05, stamina: 8,
    poise: 10, range: 2.7, arc: 115, knockback: 2.0, hitstop: 0.05, shake: 0.12, scale: 1.0,
    trail: { color: '#cfe7ff', width: 0.15 }, slash: { color: '#dff0ff', scale: 1.05, arc: 1.5, tilt: -0.7, y: 1.2 },
    next: 'light3', comboWindow: 0.45, sfx: 'swing', moveSpeed: 0.6,
  },
  light3: {
    id: 'light3', name: 'Whirling Step', nameCN: '回风斩', clip: 'light3', kind: 'light',
    windup: 0.16, activeStart: 0.20, activeEnd: 0.42, dur: 0.78, damage: 1.5, stamina: 11,
    poise: 16, range: 3.0, arc: 200, knockback: 3.4, hitstop: 0.07, shake: 0.2, scale: 1.0,
    trail: { color: '#a8dcff', width: 0.2 }, slash: { color: '#bfe7ff', scale: 1.35, arc: 2.4, tilt: 0.2, y: 1.0 },
    sfx: 'swingHeavy', moveSpeed: 0.9,
  },
  heavy1: {
    id: 'heavy1', name: 'Mountain Cleaver', nameCN: '劈山式', clip: 'heavy1', kind: 'heavy',
    windup: 0.44, activeStart: 0.52, activeEnd: 0.70, dur: 1.05, damage: 2.5, stamina: 22,
    poise: 45, range: 3.2, arc: 130, knockback: 6.0, hitstop: 0.11, shake: 0.42, scale: 1.0,
    trail: { color: '#ffd9a0', width: 0.26 }, slash: { color: '#ffe0b0', scale: 1.7, arc: 1.7, tilt: 1.2, y: 1.0 },
    aoe: 2.4, next: 'heavy2', comboWindow: 0.5, sfx: 'swingHeavy', moveSpeed: 0.5,
  },
  heavy2: {
    id: 'heavy2', name: 'Piercing Thrust', nameCN: '贯虹刺', clip: 'heavy2', kind: 'heavy',
    windup: 0.26, activeStart: 0.31, activeEnd: 0.50, dur: 0.9, damage: 2.1, stamina: 18,
    poise: 30, range: 4.2, arc: 55, knockback: 4.0, hitstop: 0.09, shake: 0.28, scale: 1.0,
    trail: { color: '#ffcf8a', width: 0.16 }, slash: { color: '#ffd9a0', scale: 0.9, arc: 0.8, tilt: 0.1, y: 1.2 },
    sfx: 'thrust', moveSpeed: 2.6,
  },
  special1: {
    id: 'special1', name: 'Whirlwind Lotus', nameCN: '旋风莲华', clip: 'special1', kind: 'special',
    windup: 0.26, activeStart: 0.30, activeEnd: 1.00, dur: 1.35, damage: 1.3, stamina: 0, qi: 35,
    poise: 22, range: 3.6, arc: 360, knockback: 2.4, hitstop: 0.05, shake: 0.3, scale: 1.0,
    trail: { color: '#9ff0ff', width: 0.3 }, slash: { color: '#aef0ff', scale: 1.9, arc: 4.2, tilt: 0.15, y: 1.0 },
    cooldown: 7, sfx: 'special1', moveSpeed: 0.35,
  },
  special2: {
    id: 'special2', name: 'Shadowless Step', nameCN: '无影步', clip: 'special2', kind: 'special',
    windup: 0.22, activeStart: 0.28, activeEnd: 0.48, dur: 1.1, damage: 3.0, stamina: 0, qi: 45,
    poise: 60, range: 4.4, arc: 70, knockback: 7, hitstop: 0.13, shake: 0.45, scale: 1.0,
    trail: { color: '#c6a8ff', width: 0.24 }, slash: { color: '#d8c0ff', scale: 1.4, arc: 1.2, tilt: 0.1, y: 1.1 },
    cooldown: 11, unlock: 'shadowless', sfx: 'special2', moveSpeed: 5.5,
  },
  counter: {
    id: 'counter', name: 'Returning Thunder', nameCN: '回雷式', clip: 'counter', kind: 'special',
    windup: 0.10, activeStart: 0.16, activeEnd: 0.4, dur: 0.8, damage: 3.4, stamina: 5,
    poise: 70, range: 3.4, arc: 140, knockback: 6, hitstop: 0.14, shake: 0.5, scale: 1.0,
    trail: { color: '#fff0a8', width: 0.3 }, slash: { color: '#fff4c0', scale: 1.6, arc: 2.0, tilt: 0.3, y: 1.1 },
    sfx: 'counter', moveSpeed: 1.2,
  },
};

export interface ActiveAttack {
  def: AttackDef;
  attacker: Entity;
  time: number;
  hitSet: Set<number>;
  trail?: any;
  hitTarget?: Entity;
  done: boolean;
}

export class Combat {
  active: ActiveAttack[] = [];
  /** global time-scale multiplier used for hit stop (0..1) */
  hitStop = 0;
  private hitStopTimer = 0;

  constructor(private getTargets: (attacker: Entity, def: AttackDef) => Entity[]) { }

  startAttack(attacker: Entity, def: AttackDef, hitTarget?: Entity): ActiveAttack {
    const a: ActiveAttack = { def, attacker, time: 0, hitSet: new Set(), hitTarget, done: false };
    this.active.push(a);
    return a;
  }

  cancel(attacker: Entity) {
    for (const a of this.active) if (a.attacker === attacker) a.done = true;
    this.active = this.active.filter((a) => !a.done);
  }

  isActive(attacker: Entity): boolean {
    return this.active.some((a) => a.attacker === attacker && !a.done);
  }

  requestHitStop(duration: number, scale = 0.06) {
    this.hitStopTimer = Math.max(this.hitStopTimer, duration);
    this.hitStop = scale;
  }

  update(dt: number) {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      if (this.hitStopTimer <= 0) this.hitStop = 0;
    }
    for (const a of this.active) {
      if (a.done) continue;
      const prev = a.time;
      a.time += dt;
      const d = a.def;
      if (a.time >= d.activeStart && prev < d.activeEnd && a.time <= d.activeEnd + 0.001) {
        this.resolveHits(a);
      }
      if (a.time >= d.dur) a.done = true;
    }
    this.active = this.active.filter((a) => !a.done);
  }

  private resolveHits(a: ActiveAttack) {
    const d = a.def;
    const targets = this.getTargets(a.attacker, d);
    const center = a.attacker.centerPos;
    const fwd = new Vector3(Math.sin(a.attacker.yaw), 0, Math.cos(a.attacker.yaw));
    const cosHalf = Math.cos((d.arc * Math.PI / 180) / 2);
    for (const t of targets) {
      if (!t.alive || t === a.attacker) continue;
      if (a.hitSet.has(t.id)) continue;
      const to = new Vector3(t.pos.x - a.attacker.pos.x, 0, t.pos.z - a.attacker.pos.z);
      const dist = to.length();
      if (dist > d.range + t.radius) continue;
      if (Math.abs(t.pos.y - a.attacker.pos.y) > 2.6) continue;
      if (d.arc < 360 && dist > 0.3) {
        to.normalize();
        if (to.dot(fwd) < cosHalf) continue;
      }
      a.hitSet.add(t.id);
      this.hit(a, t);
    }
  }

  private hit(a: ActiveAttack, target: Entity) {
    const d = a.def;
    const attacker = a.attacker as any;
    const power = (attacker.attackPower ?? 20);
    let amount = power * d.scale * d.damage;
    const crit = Math.random() < (attacker.critChance ?? 0.08);
    const info: DamageInfo = {
      amount, crit, knockback: d.knockback, poise: d.poise,
      from: a.attacker.pos.clone(), source: a.attacker,
    };
    const dealt = target.takeDamage(info);
    if (dealt > 0) {
      if (d.hitstop) this.requestHitStop(d.hitstop);
      bus.emit(EV.ENEMY_HIT, { attacker: a.attacker, target, dealt, crit, point: target.centerPos, def: d });
    }
  }
}

/* ------------------------------------------------------------------ helpers */

export function angleTo(from: Entity, to: Entity): number {
  return Math.atan2(to.pos.x - from.pos.x, to.pos.z - from.pos.z);
}

export function facingDot(a: Entity, p: Vector3): number {
  const fwd = new Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
  const to = new Vector3(p.x - a.pos.x, 0, p.z - a.pos.z).normalize();
  return fwd.dot(to);
}
