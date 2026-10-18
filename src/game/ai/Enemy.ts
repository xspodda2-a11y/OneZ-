import { Vector3, Color } from 'three';
import { Entity, DamageInfo } from '../Entity';
import { Actor } from '../character/Actor';
import { AttackDef, ATTACKS } from '../combat/Combat';
import { heightAt, WORLD } from '../core/TerrainHeight';
import { clamp, clamp01, damp, lerpN, makeRng } from '../core/Noise';
import { bus, EV } from '../core/Events';
import { physics } from '../core/Physics';
import type { Game } from '../Game';
import type { CharacterLook } from '../character/CharacterRig';
import type { WeaponType } from '../character/Weapons';

export type EnemyKind = 'bandit' | 'swordsman' | 'spearman' | 'elite' | 'heishan';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  nameCN: string;
  look: Partial<CharacterLook>;
  weapon: WeaponType;
  scale: number;
  hp: number;
  power: number;
  defense: number;
  speed: number;
  sprint: number;
  aggro: number;
  attackRange: number;
  poise: number;
  xp: number;
  gold: number;
  attacks: string[];
  blockChance: number;
  dodgeChance: number;
  aggression: number;   // 0..1 how eagerly it closes distance
  loot: { id: string; chance: number; min?: number; max?: number }[];
  boss?: boolean;
  phases?: { at: number; attacks: string[]; speed: number; power: number }[];
}

const E = (
  id: string, clip: string, o: Partial<AttackDef> & { damage: number; range: number },
): AttackDef => ({
  id, name: id, nameCN: id, clip, kind: 'enemy',
  windup: o.windup ?? 0.3, activeStart: o.activeStart ?? 0.18, activeEnd: o.activeEnd ?? 0.36,
  dur: o.dur ?? 0.8, damage: o.damage, stamina: 0, poise: o.poise ?? 0,
  range: o.range, arc: o.arc ?? 110, knockback: o.knockback ?? 2.4, hitstop: o.hitstop ?? 0.03,
  shake: o.shake ?? 0.12, scale: o.scale ?? 1, moveSpeed: o.moveSpeed ?? 0.7,
  trail: o.trail, slash: o.slash, aoe: o.aoe, projectile: o.projectile, sfx: o.sfx ?? 'swing',
});

export const ENEMY_ATTACKS: Record<string, AttackDef> = {
  eSlash: E('eSlash', 'light1', { damage: 1.0, range: 2.7, arc: 120, windup: 0.34, activeStart: 0.18, activeEnd: 0.34, dur: 0.72, knockback: 2.2 }),
  eSlash2: E('eSlash2', 'light2', { damage: 1.05, range: 2.7, arc: 120, windup: 0.28, activeStart: 0.14, activeEnd: 0.30, dur: 0.66, knockback: 2.4 }),
  eSpin: E('eSpin', 'light3', { damage: 1.25, range: 3.0, arc: 260, windup: 0.42, activeStart: 0.22, activeEnd: 0.44, dur: 0.9, knockback: 4.0, poise: 0 }),
  eCleave: E('eCleave', 'heavy1', { damage: 2.0, range: 3.2, arc: 140, windup: 0.62, activeStart: 0.54, activeEnd: 0.72, dur: 1.15, knockback: 5.5, shake: 0.3, aoe: 2.6 }),
  eThrust: E('eThrust', 'heavy2', { damage: 1.6, range: 4.2, arc: 60, windup: 0.4, activeStart: 0.32, activeEnd: 0.5, dur: 0.95, knockback: 3.6, moveSpeed: 2.6 }),
  eWhirl: E('eWhirl', 'special1', { damage: 1.15, range: 3.6, arc: 360, windup: 0.5, activeStart: 0.32, activeEnd: 1.0, dur: 1.4, knockback: 3.0, shake: 0.28 }),
  // boss
  bSlam: E('bSlam', 'heavy1', { damage: 2.6, range: 3.4, arc: 160, windup: 0.8, activeStart: 0.62, activeEnd: 0.8, dur: 1.35, knockback: 8, shake: 0.6, aoe: 4.2, sfx: 'slam' }),
  bDash: E('bDash', 'heavy2', { damage: 2.2, range: 4.6, arc: 70, windup: 0.5, activeStart: 0.36, activeEnd: 0.54, dur: 1.1, knockback: 7, moveSpeed: 6.5, shake: 0.4 }),
  bFan: E('bFan', 'light3', {
    damage: 1.5, range: 3.4, arc: 240, windup: 0.6, activeStart: 0.3, activeEnd: 0.55, dur: 1.1, knockback: 4, shake: 0.3,
    projectile: { speed: 16, life: 1.4, radius: 0.5, color: '#8f6bff' }, sfx: 'special2',
  }),
  bStorm: E('bStorm', 'special1', { damage: 1.4, range: 4.2, arc: 360, windup: 0.7, activeStart: 0.34, activeEnd: 1.05, dur: 1.5, knockback: 4, shake: 0.45 }),
};

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  bandit: {
    kind: 'bandit', name: 'Blackwood Bandit', nameCN: '黑木贼',
    look: { robe: '#8a7a5e', robeDark: '#6d6046', trim: '#4a3524', sash: '#7a2b22', skin: '#c9a077', hairStyle: 'wild', sleeves: 'normal', skirt: 'short', metal: '#a8a49c' },
    weapon: 'dao', scale: 1.0, hp: 90, power: 15, defense: 4, speed: 3.4, sprint: 5.2,
    aggro: 22, attackRange: 2.5, poise: 30, xp: 26, gold: 18,
    attacks: ['eSlash', 'eSlash2'], blockChance: 0.12, dodgeChance: 0.10, aggression: 0.75,
    loot: [{ id: 'herb', chance: 0.3 }, { id: 'hide', chance: 0.25 }, { id: 'banditToken', chance: 0.5 }, { id: 'potion', chance: 0.22 }],
  },
  swordsman: {
    kind: 'swordsman', name: 'Jianghu Swordsman', nameCN: '江湖剑客',
    look: { robe: '#3f4f66', robeDark: '#2f3b4d', trim: '#8c2b2b', sash: '#c8a24a', skin: '#e0b892', hairStyle: 'ponytail', sleeves: 'wide', skirt: 'long', metal: '#dfe6ee' },
    weapon: 'jian', scale: 1.0, hp: 130, power: 19, defense: 8, speed: 3.8, sprint: 6.0,
    aggro: 26, attackRange: 2.7, poise: 45, xp: 46, gold: 42,
    attacks: ['eSlash', 'eSlash2', 'eSpin'], blockChance: 0.28, dodgeChance: 0.22, aggression: 0.85,
    loot: [{ id: 'silk', chance: 0.3 }, { id: 'spiritStone', chance: 0.12 }, { id: 'bigPotion', chance: 0.2 }, { id: 'potion', chance: 0.3 }],
  },
  spearman: {
    kind: 'spearman', name: 'Blackwood Spearman', nameCN: '黑木枪手',
    look: { robe: '#5a5f4a', robeDark: '#434734', trim: '#2f3b2a', sash: '#8c2b2b', skin: '#c19a72', hairStyle: 'topknot', sleeves: 'normal', skirt: 'short', shoulderPads: true, metal: '#9a9a92' },
    weapon: 'spear', scale: 1.02, hp: 115, power: 17, defense: 9, speed: 3.2, sprint: 5.0,
    aggro: 24, attackRange: 3.6, poise: 50, xp: 40, gold: 34,
    attacks: ['eThrust', 'eSlash'], blockChance: 0.2, dodgeChance: 0.14, aggression: 0.6,
    loot: [{ id: 'ore', chance: 0.3 }, { id: 'hide', chance: 0.2 }, { id: 'potion', chance: 0.28 }],
  },
  elite: {
    kind: 'elite', name: 'Iron Guard Elite', nameCN: '铁卫精锐',
    look: { robe: '#5b2f2f', robeDark: '#3f2020', trim: '#c8a24a', sash: '#2b2b2b', skin: '#d8ae86', hairStyle: 'topknot', sleeves: 'normal', skirt: 'short', shoulderPads: true, hat: 'helm', metal: '#c8cdd4' },
    weapon: 'jian', scale: 1.08, hp: 240, power: 26, defense: 16, speed: 4.0, sprint: 6.4,
    aggro: 30, attackRange: 2.8, poise: 90, xp: 110, gold: 120,
    attacks: ['eSlash', 'eSpin', 'eCleave'], blockChance: 0.35, dodgeChance: 0.28, aggression: 0.9,
    loot: [{ id: 'spiritStone', chance: 0.35 }, { id: 'bigPotion', chance: 0.4 }, { id: 'moonblade', chance: 0.06 }, { id: 'silk', chance: 0.4 }],
  },
  heishan: {
    kind: 'heishan', name: 'Hei Shan, the Black Mountain', nameCN: '黑山 · 血崖之主',
    look: { robe: '#2a2320', robeDark: '#1a1512', trim: '#8c1f1f', sash: '#5a1010', skin: '#c9a077', hairStyle: 'wild', sleeves: 'wide', skirt: 'long', shoulderPads: true, build: 'heavy', metal: '#b8b0a4' },
    weapon: 'dao', scale: 1.24, hp: 1500, power: 34, defense: 22, speed: 4.2, sprint: 7.2,
    aggro: 60, attackRange: 3.4, poise: 400, xp: 1200, gold: 900,
    attacks: ['eSlash', 'eCleave', 'bDash'], blockChance: 0.25, dodgeChance: 0.2, aggression: 0.95, boss: true,
    phases: [
      { at: 1.0, attacks: ['eSlash', 'eCleave', 'bDash'], speed: 4.2, power: 34 },
      { at: 0.62, attacks: ['eSlash', 'eSpin', 'eCleave', 'bDash', 'bFan'], speed: 4.8, power: 40 },
      { at: 0.28, attacks: ['eSpin', 'bStorm', 'bSlam', 'bFan', 'bDash'], speed: 5.6, power: 48 },
    ],
    loot: [{ id: 'heishanSaber', chance: 1 }, { id: 'spiritStone', chance: 1, min: 3, max: 6 }, { id: 'bigPotion', chance: 1, min: 3, max: 5 }],
  },
};

export type EnemyState =
  | 'idle' | 'patrol' | 'alert' | 'chase' | 'strafe' | 'windup' | 'recover'
  | 'block' | 'dodge' | 'stagger' | 'dead' | 'return' | 'taunt';

export class Enemy extends Entity {
  def: EnemyDef;
  game: Game;
  state: EnemyState = 'idle';
  stateTime = 0;
  home = new Vector3();
  patrolPoints: Vector3[] = [];
  patrolIndex = 0;
  target: Entity | null = null;
  declare actor: Actor;
  attackPower = 15;
  critChance = 0.05;
  currentAttack: AttackDef | null = null;
  attackTime = 0;
  attackStarted = false;
  attackToken = false;
  nextDecision = 0;
  grounded = true;
  phase = 0;
  aggroed = false;
  deathTimer = 0;
  strafeSign = 1;
  blockTimer = 0;
  telegraph: any = null;
  rng: () => number;
  level = 1;
  bossBar = false;
  private _tmp = new Vector3();
  private _tmp2 = new Vector3();
  private lastGroundY = 0;
  private trail: any = null;

  constructor(game: Game, kind: EnemyKind, pos: Vector3, level = 1) {
    super();
    this.game = game;
    this.def = ENEMY_DEFS[kind];
    this.faction = 'enemy';
    this.name = this.def.name;
    this.nameCN = this.def.nameCN;
    this.level = level;
    this.rng = makeRng(Math.floor(pos.x * 31 + pos.z * 17 + 7));
    const scaleUp = 1 + (level - 1) * 0.16;
    this.maxHp = Math.round(this.def.hp * scaleUp);
    this.hp = this.maxHp;
    this.attackPower = Math.round(this.def.power * scaleUp);
    this.defense = Math.round(this.def.defense * scaleUp);
    this.poise = this.def.poise;
    this.maxPoise = this.def.poise;
    this.radius = 0.45 * this.def.scale;
    this.height = 1.76 * this.def.scale;
    this.xp = Math.round(this.def.xp * scaleUp);
    this.goldValue = Math.round(this.def.gold * scaleUp);
    this.bossBar = !!this.def.boss;

    this.actor = new Actor(this.def.look, { weapon: this.def.weapon, weaponOpts: { length: this.def.scale } });
    this.actor.root.scale.setScalar(this.def.scale);
    this.root = this.actor.root;
    this.root.name = 'enemy_' + kind;
    this.pos.copy(pos);
    this.home.copy(pos);
    this.actor.setSheathed(false);
    // patrol ring
    for (let i = 0; i < 3; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 6 + this.rng() * 10;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      this.patrolPoints.push(new Vector3(x, heightAt(x, z), z));
    }
    this.patrolPoints.push(pos.clone());
    this.setState('patrol');
  }

  xp = 0;
  goldValue = 0;

  setState(s: EnemyState) {
    this.state = s;
    this.stateTime = 0;
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number) {
    if (!this.alive) { this.updateDead(dt); return; }
    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.blockTimer = Math.max(0, this.blockTimer - dt);
    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      if (this.staggerTimer > 0) {
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
        this.currentAttack = null;
        this.applyGravity(dt);
        this.moveAndCollide(dt);
        this.animate(dt);
        this.syncActor();
        return;
      }
    }

    const player = this.game.player;
    const dist = player.alive ? this.pos.distanceTo(player.pos) : 999;
    const canSee = player.alive && dist < this.def.aggro && this.hasLineOfSight(player);

    // ---- aggro
    if (!this.aggroed && canSee && dist < this.def.aggro) {
      if (this.def.boss) this.startBossFight();
      else {
        this.aggroed = true;
        this.target = player;
        this.setState('alert');
        this.game.audio.play('enemyAlert');
        this.game.vfx.damageNumber(this.centerPos.add(new Vector3(0, 1.2, 0)), 0, 'crit');
        this.showMarker('!');
      }
    }
    if (this.aggroed && (!player.alive || dist > this.def.aggro * 2.2)) {
      this.aggroed = false;
      this.target = null;
      this.setState('return');
    }

    switch (this.state) {
      case 'idle': this.doIdle(dt); break;
      case 'patrol': this.doPatrol(dt); break;
      case 'alert': this.doAlert(dt, dist); break;
      case 'chase': this.doChase(dt, dist); break;
      case 'strafe': this.doStrafe(dt, dist); break;
      case 'windup': this.doWindup(dt, dist); break;
      case 'recover': this.doRecover(dt); break;
      case 'block': this.doBlock(dt, dist); break;
      case 'dodge': this.doDodge(dt); break;
      case 'return': this.doReturn(dt); break;
      case 'taunt': this.doTaunt(dt); break;
    }

    // ---- physics
    this.applyGravity(dt);
    const res = this.moveAndCollide(dt);
    this.grounded = res.grounded;
    // keep away from other enemies (cheap separation)
    const sep = this.game.separationForce(this, 1.5);
    this.pos.addScaledVector(sep, dt * 3);
    // stay inside the world
    const lim = WORLD.half - 20;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    this.animate(dt);
    this.syncActor();
  }

  private applyGravity(dt: number) {
    if (this.grounded && this.vel.y <= 0) { this.vel.y = 0; return; }
    this.vel.y -= 24 * dt;
    if (this.vel.y < -34) this.vel.y = -34;
    // water buoyancy
    const depth = WORLD.waterLevel - heightAt(this.pos.x, this.pos.z);
    if (depth > 1.2 && this.pos.y < WORLD.waterLevel) {
      this.vel.y = damp(this.vel.y, -0.8, 4, dt);
      if (this.pos.y < WORLD.waterLevel - 1.0) this.pos.y = damp(this.pos.y, WORLD.waterLevel - 0.6, 4, dt);
    }
  }

  /* ------------------------------------------------------------------ brain */

  private hasLineOfSight(p: Entity): boolean {
    const from = this.eyePos;
    const to = p.centerPos;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return true;
    dir.normalize();
    const hit = physics.raycast(from, dir, len - 0.6);
    return !hit.hit;
  }

  private doIdle(dt: number) {
    this.vel.x = damp(this.vel.x, 0, 6, dt);
    this.vel.z = damp(this.vel.z, 0, 6, dt);
    if (this.stateTime > 2 + this.rng() * 3) this.setState('patrol');
  }

  private doPatrol(dt: number) {
    const t = this.patrolPoints[this.patrolIndex % this.patrolPoints.length];
    const d = this.flatDistanceTo(t);
    if (d < 1.4) { this.patrolIndex++; this.setState('idle'); return; }
    this.steerTo(t, dt, this.def.speed * 0.45);
    if (this.stateTime > 18) this.setState('idle');
  }

  private doAlert(dt: number, dist: number) {
    this.vel.x = damp(this.vel.x, 0, 8, dt);
    this.vel.z = damp(this.vel.z, 0, 8, dt);
    if (this.target) this.faceTarget(dt, 8);
    if (this.stateTime > 0.55) this.setState('chase');
  }

  private doChase(dt: number, dist: number) {
    const p = this.target!;
    if (!p) { this.setState('return'); return; }
    this.faceTarget(dt, 6);
    const range = this.currentRange();
    if (dist <= range * 0.95) {
      if (this.nextDecision <= 0) {
        this.nextDecision = 0.35 + this.rng() * 0.5;
        if (this.game.requestAttackToken(this)) this.chooseAttack(dist);
        else this.setState('strafe');
      }
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
    } else {
      this.steerTo(p.pos, dt, this.def.sprint * (this.phaseSpeed()));
    }
    this.nextDecision -= dt;
    // sometimes strafe instead of charging
    if (this.stateTime > 1.6 + this.rng() * 1.6 && dist < range * 1.8) this.setState('strafe');
  }

  private doStrafe(dt: number, dist: number) {
    const p = this.target!;
    if (!p) { this.setState('return'); return; }
    this.faceTarget(dt, 7);
    const to = this._tmp.copy(this.pos).sub(p.pos).setY(0).normalize();
    const side = this._tmp2.set(-to.z, 0, to.x).multiplyScalar(this.strafeSign);
    const desired = to.multiplyScalar(dist > this.currentRange() * 1.5 ? 1 : -0.15).add(side.multiplyScalar(1.0)).normalize();
    const sp = this.def.speed * 0.85 * this.phaseSpeed();
    this.vel.x = damp(this.vel.x, desired.x * sp, 6, dt);
    this.vel.z = damp(this.vel.z, desired.z * sp, 6, dt);
    this.nextDecision -= dt;
    if (this.nextDecision <= 0) {
      this.nextDecision = 0.5 + this.rng() * 0.8;
      if (dist < this.currentRange() && this.game.requestAttackToken(this)) this.chooseAttack(dist);
      else if (this.rng() < 0.35) this.strafeSign *= -1;
      else if (dist > this.currentRange() * 1.6) this.setState('chase');
    }
    if (this.stateTime > 3.4 + this.rng() * 2) this.setState('chase');
  }

  private doWindup(dt: number, dist: number) {
    const a = this.currentAttack;
    if (!a) { this.setState('chase'); return; }
    this.attackTime += dt;
    const p = this.target;
    if (p && this.attackTime < a.activeStart - 0.06) this.faceTarget(dt, 5.5);
    // lunge forward slightly
    const dir = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const lunge = this.attackTime > a.windup * 0.6 ? (a.moveSpeed ?? 0) * 0.6 : 0;
    this.vel.x = damp(this.vel.x, dir.x * lunge, 8, dt);
    this.vel.z = damp(this.vel.z, dir.z * lunge, 8, dt);
    if (!this.attackStarted && this.attackTime >= a.activeStart) {
      this.attackStarted = true;
      this.game.combat.startAttack(this, a, p ?? undefined);
      this.telegraph = null;
      if (a.trail) this.trail = this.game.vfx.startTrail(a.trail.color, a.trail.width, Math.max(0.3, a.activeEnd - a.activeStart + 0.2));
      if (a.slash) {
        const pos = this.pos.clone().addScaledVector(dir, a.range * 0.5);
        pos.y += a.slash.y ?? 1.0;
        this.game.vfx.slash(pos, this.yaw, { color: a.slash.color, scale: a.slash.scale * 0.9, arc: a.slash.arc, tilt: a.slash.tilt, life: 0.22 });
      }
      if (a.aoe) {
        const pos = this.pos.clone().addScaledVector(dir, a.range * 0.6);
        this.game.vfx.ripple(pos, 0.6, a.aoe * 1.5, 0.4, a.slash?.color ?? '#ffb060', 0.85);
        this.game.vfx.shake(a.shake);
        this.game.vfx.burst(pos, '#c8b090', 18, 6, 0.7, 0.6, -6);
      }
      if (a.projectile) this.spawnProjectileFan(a);
      this.game.audio.play(a.sfx ?? 'swing');
    }
    if (this.attackTime >= a.activeEnd + 0.05) {
      this.setState('recover');
    }
  }

  private doRecover(dt: number) {
    this.vel.x = damp(this.vel.x, 0, 8, dt);
    this.vel.z = damp(this.vel.z, 0, 8, dt);
    if (this.target) this.faceTarget(dt, 3);
    if (this.stateTime > 0.35 + this.rng() * 0.5) {
      this.releaseToken();
      this.currentAttack = null;
      this.trail = null;
      this.nextDecision = 0.25 + this.rng() * 0.6;
      this.setState(Math.random() < 0.5 ? 'strafe' : 'chase');
    }
  }

  private doBlock(dt: number, dist: number) {
    this.vel.x = damp(this.vel.x, 0, 10, dt);
    this.vel.z = damp(this.vel.z, 0, 10, dt);
    if (this.target) this.faceTarget(dt, 8);
    if (this.blockTimer <= 0) this.setState('chase');
  }

  private doDodge(dt: number) {
    const t = this.stateTime;
    this.vel.x = damp(this.vel.x, this.dodgeDir.x * 9, 14, dt);
    this.vel.z = damp(this.vel.z, this.dodgeDir.z * 9, 14, dt);
    this.invuln = Math.max(this.invuln, t < 0.35 ? 0.05 : 0);
    if (t > 0.5) { this.nextDecision = 0.3; this.setState('strafe'); }
  }
  private dodgeDir = new Vector3();

  private doReturn(dt: number) {
    const d = this.flatDistanceTo(this.home);
    if (d < 2) {
      this.setState('patrol');
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.35);
      return;
    }
    this.steerTo(this.home, dt, this.def.speed * 0.6);
    if (this.stateTime > 25) { this.setState('patrol'); }
  }

  private doTaunt(dt: number) {
    this.vel.set(0, this.vel.y, 0);
    if (this.stateTime > 1.6) this.setState('chase');
  }

  private startBossFight() {
    this.aggroed = true;
    this.target = this.game.player;
    this.setState('taunt');
    this.game.onBossEngaged(this);
  }

  private chooseAttack(dist: number) {
    const pool = this.phaseAttacks();
    const range = this.currentRange();
    let candidates = pool.filter((id) => {
      const a = ENEMY_ATTACKS[id];
      if (!a) return false;
      if (a.id === 'eThrust' || a.id === 'bDash') return dist > range * 0.7;
      return dist <= (a.range + 0.6);
    });
    if (!candidates.length) candidates = pool;
    const id = candidates[Math.floor(this.rng() * candidates.length)];
    const def = ENEMY_ATTACKS[id];
    if (!def) { this.setState('chase'); return; }
    this.currentAttack = def;
    this.attackTime = 0;
    this.attackStarted = false;
    this.setState('windup');
    this.actor.anim.playOverlay(def.clip, 0.08, 1 / Math.max(0.6, def.windup / 0.35));
    // telegraph ring for heavy attacks
    if (def.aoe || this.def.boss) {
      const color = def.aoe ? '#ff5a3c' : '#ffb060';
      this.game.vfx.ripple(this.pos.clone(), 0.4, (def.aoe ?? 2.2) * 1.4, def.windup, color, 0.75);
    }
    this.game.audio.play(def.aoe ? 'telegraph' : 'swingWindup');
  }

  private spawnProjectileFan(a: AttackDef) {
    if (!a.projectile) return;
    const n = this.def.boss ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.18;
      const dir = new Vector3(Math.sin(this.yaw + spread), 0, Math.cos(this.yaw + spread));
      this.game.spawnProjectile({
        pos: this.centerPos.clone().addScaledVector(dir, 1.0),
        dir, speed: a.projectile.speed, life: a.projectile.life, radius: a.projectile.radius,
        color: new Color(a.projectile.color).getHex(), damage: this.attackPower * a.damage * 0.7, source: this,
      });
    }
  }

  private phaseAttacks(): string[] {
    const ph = this.def.phases?.[this.phase];
    return ph?.attacks ?? this.def.attacks;
  }
  private phaseSpeed(): number {
    const ph = this.def.phases?.[this.phase];
    return ph ? ph.speed / this.def.speed : 1;
  }
  private currentRange(): number {
    return this.def.attackRange * (this.def.boss ? 1.2 : 1);
  }

  private faceTarget(dt: number, rate: number) {
    if (!this.target) return;
    const want = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, rate * dt);
  }

  /** Steering with simple obstacle avoidance. */
  private steerTo(target: Vector3, dt: number, speed: number) {
    const to = this._tmp.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = to.length();
    if (dist < 0.01) return;
    to.normalize();
    const ahead = 2.2;
    let best = to.clone();
    let bestScore = -Infinity;
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.42;
      const cs = Math.cos(a), sn = Math.sin(a);
      const dir = new Vector3(to.x * cs - to.z * sn, 0, to.x * sn + to.z * cs).normalize();
      let score = dir.dot(to) * 2.0;
      const probe = this.pos.clone().addScaledVector(dir, ahead);
      const gy = heightAt(probe.x, probe.z);
      score -= Math.max(0, (gy - this.pos.y)) * 0.9;      // avoid climbing walls
      score -= Math.max(0, (this.pos.y - gy - 3.5)) * 0.4; // avoid cliffs
      const list = physics.query(probe.x, probe.z, 1.0);
      if (list.length) score -= 1.2;
      score += (i % 2 === 0 ? 0 : 0.05);
      if (score > bestScore) { bestScore = score; best = dir; }
    }
    this.vel.x = damp(this.vel.x, best.x * speed, 5, dt);
    this.vel.z = damp(this.vel.z, best.z * speed, 5, dt);
    const want = Math.atan2(best.x, best.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, 7 * dt);
  }

  private releaseToken() {
    if (this.attackToken) { this.attackToken = false; this.game.releaseAttackToken(this); }
  }

  private showMarker(glyph: string) {
    // floating alert marker
    const el = document.createElement('div');
    el.className = 'enemy-marker';
    el.textContent = glyph;
    const layer = document.getElementById('dmg-layer');
    if (layer) {
      layer.appendChild(el);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 900;
        if (t > 1) { el.remove(); return; }
        const p = this.centerPos.clone();
        p.y += 1.6 + t * 0.6;
        const proj = p.project(this.game.render.camera);
        el.style.transform = `translate(-50%,-50%) translate(${(proj.x * 0.5 + 0.5) * window.innerWidth}px, ${(-proj.y * 0.5 + 0.5) * window.innerHeight}px) scale(${(1.4 - t * 0.4).toFixed(2)})`;
        el.style.opacity = String(1 - t);
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /* ------------------------------------------------------------------ damage */

  protected onDamaged(info: DamageInfo, dealt: number) {
    // chance to block if facing the attacker and not attacking
    const from = info.from;
    if (from && this.rng() < this.def.blockChance && this.state !== 'windup' && this.state !== 'recover') {
      const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const to = new Vector3(from.x - this.pos.x, 0, from.z - this.pos.z).normalize();
      if (fwd.dot(to) > 0.2) {
        this.hp += dealt * 0.7;
        this.setState('block');
        this.blockTimer = 0.5 + this.rng() * 0.5;
        this.actor.anim.stopOverlay(0.1);
        this.game.vfx.sparks(this.centerPos.addScaledVector(to, 0.6), to, 8, '#cfe9ff');
        this.game.audio.play('block');
        return;
      }
    }
    // dodge chance
    if (info.amount > 0 && this.rng() < this.def.dodgeChance * 0.25 && this.state !== 'windup') {
      const away = new Vector3(this.pos.x - (from?.x ?? this.pos.x), 0, this.pos.z - (from?.z ?? this.pos.z)).normalize();
      this.dodgeDir.copy(away);
      this.setState('dodge');
      this.actor.anim.play('dodge', 0.06);
      return;
    }
    this.game.vfx.blood(this.centerPos, new Vector3(0, 0.4, 0), 10);
    this.game.vfx.damageNumber(this.centerPos, dealt, info.crit ? 'crit' : 'normal');
    if (this.staggerTimer > 0) {
      this.setState('stagger');
      this.actor.anim.play('hit', 0.06);
    } else if (dealt > this.maxHp * 0.12) {
      this.actor.anim.playOverlay('hit', 0.05);
    }
    this.aggroed = true;
    this.target = info.source ?? this.game.player;
    // phase check for bosses
    if (this.def.phases) {
      const frac = this.hp / this.maxHp;
      for (let i = this.def.phases.length - 1; i > this.phase; i--) {
        if (frac <= this.def.phases[i].at) {
          this.phase = i;
          this.poise = this.maxPoise;
          this.onPhaseChange(i);
          break;
        }
      }
    }
  }

  private onPhaseChange(phase: number) {
    this.releaseToken();
    this.currentAttack = null;
    this.setState('taunt');
    this.game.vfx.qi(this.centerPos, '#ff5a3c', 60, 8);
    this.game.vfx.ripple(this.pos.clone(), 1, 14, 0.8, '#ff5a3c', 0.9);
    this.game.vfx.shake(0.8);
    this.game.audio.play('bossRoar');
    bus.emit(EV.BOSS_STATE, { enemy: this, phase });
    bus.emit(EV.TOAST, { text: `${this.name} enters phase ${phase + 1}!`, kind: 'bad' });
  }

  protected onDeath(info?: DamageInfo) {
    this.releaseToken();
    this.deathTimer = 0;
    this.setState('dead');
    this.actor.anim.play('death', 0.18);
    this.actor.anim.stopOverlay(0.2);
    this.game.audio.play('enemyDeath');
    this.game.vfx.blood(this.centerPos, new Vector3(0, 0.5, 0), 22);
    this.game.onEnemyKilled(this);
  }

  private updateDead(dt: number) {
    this.deathTimer += dt;
    this.vel.x = damp(this.vel.x, 0, 6, dt);
    this.vel.z = damp(this.vel.z, 0, 6, dt);
    this.applyGravity(dt);
    this.moveAndCollide(dt);
    this.animate(dt);
    this.syncActor();
    if (this.deathTimer > 9 && !this.def.boss) {
      // sink and fade
      this.root.position.y -= dt * 0.6;
      if (this.deathTimer > 13) this.game.despawnEnemy(this);
    }
  }

  /* --------------------------------------------------------------- animation */

  private animate(dt: number) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let clip = 'idle';
    let speed = 1;
    switch (this.state) {
      case 'dead': clip = 'death'; break;
      case 'stagger': clip = 'hit'; break;
      case 'block': clip = 'block'; break;
      case 'dodge': clip = 'dodge'; break;
      case 'windup': case 'recover': case 'strafe': case 'chase': case 'alert': clip = 'combatIdle'; break;
      case 'taunt': clip = 'combatIdle'; break;
      default:
        if (sp > 3.2) { clip = 'run'; speed = clamp(sp / 5.4, 0.7, 1.3); }
        else if (sp > 0.3) { clip = 'walk'; speed = clamp(sp / 3.4, 0.6, 1.3); }
        else clip = 'idle';
    }
    if (this.actor.anim.current !== clip) this.actor.anim.play(clip, 0.25, speed);
    if (this.state === 'block' || this.state === 'windup' || this.state === 'recover') {
      // overlay clip already playing
    } else if (this.state !== 'dead') {
      this.actor.anim.stopOverlay(0.22);
    }
    this.actor.velocity.copy(this.vel);
    // weapon trail
    if (this.trail && this.actor.weapon) {
      this.game.vfx.updateTrail(this.trail,
        this.actor.weapon.tip.getWorldPosition(new Vector3()),
        this.actor.weapon.base.getWorldPosition(new Vector3()));
    }
    this.actor.update(dt, this.game.render.camera.position, this.game.env.wind, performance.now() / 1000);
  }

  dispose() {
    this.game.releaseAttackToken(this);
    this.actor?.dispose?.();
    this.root?.parent?.remove(this.root);
  }
}
