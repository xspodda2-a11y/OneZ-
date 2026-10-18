import { Vector3, Group } from 'three';
import { Actor } from './character/Actor';
import { physics } from './core/Physics';
import { bus, EV } from './core/Events';

export type Faction = 'player' | 'enemy' | 'neutral';

export interface DamageInfo {
  amount: number;
  crit?: boolean;
  knockback?: number;
  poise?: number;
  from?: Vector3;
  type?: 'physical' | 'qi' | 'fire';
  source?: Entity;
  blocked?: boolean;
  parried?: boolean;
}

let nextId = 1;

export abstract class Entity {
  id = nextId++;
  name = 'entity';
  nameCN = '';
  faction: Faction = 'neutral';
  pos = new Vector3();
  vel = new Vector3();
  yaw = 0;
  hp = 100;
  maxHp = 100;
  poise = 40;
  maxPoise = 40;
  alive = true;
  radius = 0.42;
  height = 1.76;
  defense = 5;
  actor!: Actor;
  root!: Group;
  invuln = 0;
  staggerTimer = 0;
  hitCooldown = 0;
  /** last time this entity was damaged by the player (for combat music) */
  lastCombatTime = -999;

  get eyePos(): Vector3 { return new Vector3(this.pos.x, this.pos.y + this.height * 0.85, this.pos.z); }
  get centerPos(): Vector3 { return new Vector3(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z); }

  /** Returns the damage actually dealt (0 if fully negated). */
  takeDamage(info: DamageInfo): number {
    if (!this.alive) return 0;
    if (this.invuln > 0) return 0;
    let dmg = info.amount;
    const def = Math.max(0, this.defense);
    dmg *= 1 - def / (def + 130);
    if (info.crit) dmg *= 1.7;
    if (dmg < 1) dmg = 1;
    this.hp -= dmg;
    this.lastCombatTime = performance.now() / 1000;
    if (info.poise) {
      this.poise -= info.poise;
      if (this.poise <= 0) { this.poise = this.maxPoise; this.staggerTimer = Math.max(this.staggerTimer, 0.55); }
    }
    this.onDamaged(info, dmg);
    if (this.hp <= 0) { this.hp = 0; this.die(info); }
    return dmg;
  }

  heal(amount: number) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  protected onDamaged(info: DamageInfo, dealt: number) {
    this.actor?.flash(info.crit ? 0xffdd88 : 0xffffff, 0.7, 0.14);
  }

  die(info?: DamageInfo) {
    if (!this.alive) return;
    this.alive = false;
    this.onDeath(info);
  }

  protected onDeath(info?: DamageInfo) { }

  distanceTo(e: Entity): number {
    const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, dy = this.pos.y - e.pos.y;
    return Math.hypot(dx, dy, dz);
  }

  distanceToPoint(p: Vector3): number {
    return Math.hypot(this.pos.x - p.x, this.pos.y - p.y, this.pos.z - p.z);
  }

  /** Horizontal + vertical distance to a point (gameplay uses horizontal mostly). */
  flatDistanceTo(p: Vector3): number {
    return Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
  }

  /** Shared capsule movement: horizontal + vertical integration, static collision, ground snap. */
  moveAndCollide(dt: number, stepHeight = 0.55): { grounded: boolean; wall: boolean; wallNormal: Vector3 | null } {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    const res = physics.resolveCapsule(this.pos, this.radius, this.height * 0.95);
    const support = physics.supportHeight(this.pos.x, this.pos.z, this.pos.y, this.radius, stepHeight);
    let grounded = false;
    if (this.pos.y <= support.y + 0.03 && this.vel.y <= 0.02) {
      this.pos.y = support.y;
      if (this.vel.y < -0.1) this.vel.y = 0;
      grounded = true;
    }
    return { grounded, wall: !!res.hit, wallNormal: res.wallNormal };
  }

  syncActor() {
    if (!this.actor) return;
    this.actor.root.position.copy(this.pos);
    this.actor.root.rotation.y = this.yaw;
  }

  abstract update(dt: number): void;
}
