import { Vector3, Group, MathUtils, Object3D } from 'three';
import { Entity, DamageInfo } from '../Entity';
import { Actor } from '../character/Actor';
import { input, InputSystem } from '../core/Input';
import { physics } from '../core/Physics';
import { heightAt, terrainNormal, WORLD } from '../core/TerrainHeight';
import { clamp, clamp01, damp, lerpN } from '../core/Noise';
import { bus, EV } from '../core/Events';
import { ATTACKS, AttackDef, Combat } from '../combat/Combat';
import type { Progression } from '../rpg/Progression';
import type { VFX } from '../VFX';
import type { AudioEngine } from '../audio/Audio';
import type { Game } from '../Game';

export type PlayerState =
  | 'locomotion' | 'air' | 'dodge' | 'attack' | 'block' | 'parry'
  | 'hurt' | 'dead' | 'swim' | 'climb' | 'wallrun' | 'glide';

export class CameraRig {
  yaw = 0;
  pitch = 0.16;
  distance = 4.4;
  targetDistance = 4.4;
  height = 1.62;
  target = new Vector3();
  position = new Vector3();
  lockTarget: Entity | null = null;
  fov = 58;
  targetFov = 58;
  private game: Game;

  constructor(game: Game) { this.game = game; }

  update(dt: number, player: Player) {
    const sens = 0.0022 * input.sensitivity;
    const padx = input.padState.camX, pady = input.padState.camY;
    if (input.locked || padx || pady) {
      this.yaw -= (input.mouse.dx * sens + padx * dt * 2.2);
      this.pitch -= (input.mouse.dy * sens * (input.invertY ? -1 : 1) + pady * dt * 1.6);
    }
    this.pitch = clamp(this.pitch, -0.95, 1.15);

    // lock-on framing
    let lookYaw = this.yaw;
    if (this.lockTarget && this.lockTarget.alive) {
      const t = this.lockTarget;
      const want = Math.atan2(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
      const diff = MathUtils.euclideanModulo(want + Math.PI, Math.PI * 2) - Math.PI;
      const cur = MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.yaw = lerpN(cur, cur + diff * 0.0, 1) + (diff) * Math.min(1, dt * 6.0);
      lookYaw = this.yaw;
      const dist = player.pos.distanceTo(t.pos);
      this.targetDistance = clamp(3.2 + dist * 0.22, 3.4, 6.6);
    } else {
      this.targetDistance = 4.4 + (player.sprinting ? 0.7 : 0) + (player.inWater ? 0.6 : 0);
    }
    this.distance = damp(this.distance, this.targetDistance, 6, dt);

    const focusY = this.lockTarget && this.lockTarget.alive ? (player.pos.y + 1.35) * 0.55 + (this.lockTarget.pos.y + 1.2) * 0.45 : player.pos.y + 1.42;
    this.target.lerp(new Vector3(player.pos.x, focusY, player.pos.z), 1 - Math.exp(-14 * dt));

    // desired camera position
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const head = new Vector3(player.pos.x, player.pos.y + this.height, player.pos.z);
    const desired = head.clone().addScaledVector(dir, this.distance);

    // collision with geometry
    const rayDir = desired.clone().sub(head);
    const len = rayDir.length();
    rayDir.normalize();
    const hit = physics.raycast(head, rayDir, len + 0.2);
    let finalDist = len;
    if (hit.hit) finalDist = Math.max(0.7, hit.dist - 0.25);
    // also keep above terrain
    const groundAtCam = heightAt(desired.x, desired.z) + 0.6;
    const pos = head.clone().addScaledVector(rayDir, finalDist);
    if (pos.y < groundAtCam) pos.y = groundAtCam;

    this.position.lerp(pos, 1 - Math.exp(-18 * dt));

    // shake
    const tr = this.game.vfx.trauma;
    if (tr > 0.001) {
      const k = tr * tr;
      const t = performance.now() * 0.001;
      this.position.x += Math.sin(t * 47.3) * k * 0.32;
      this.position.y += Math.sin(t * 39.1 + 2.1) * k * 0.28;
      this.position.z += Math.sin(t * 53.7 + 4.3) * k * 0.32;
    }

    this.targetFov = 58 + (player.sprinting ? 7 : 0) + (player.state === 'dodge' ? 6 : 0) + (player.inWater ? -4 : 0);
    this.fov = damp(this.fov, this.targetFov, 5, dt);
    const cam = this.game.render.camera;
    cam.position.copy(this.position);
    cam.lookAt(this.target);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** Direction the player should move for a given input axis. */
  moveBasis(out = new Vector3()): Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  rightBasis(out = new Vector3()): Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}

export class Player extends Entity {
  declare actor: Actor;
  state: PlayerState = 'locomotion';
  stateTime = 0;
  camera: CameraRig;
  prog: Progression;
  game: Game;
  stamina = 100;
  maxStamina = 100;
  qi = 100;
  maxQi = 100;
  grounded = true;
  sprinting = false;
  inWater = false;
  submerged = false;
  swimming = false;
  climbing = false;
  wallRunning = false;
  drawWeapon = true;
  blocking = false;
  lockedTarget: Entity | null = null;
  attack: AttackDef | null = null;
  attackTime = 0;
  attackTrail: any = null;
  buffered: { type: 'light' | 'heavy' | 'special1' | 'special2'; time: number } | null = null;
  comboIndex = 0;
  comboId: string | null = null;
  iframe = 0;
  parryWindow = 0;
  counterWindow = 0;
  dodgeCooldown = 0;
  attackCooldowns: Record<string, number> = {};
  staminaRegenDelay = 0;
  wallNormal = new Vector3();
  wallRunTimer = 0;
  glideHeld = 0;
  skills: Set<string> = new Set();
  footstepTimer = 0;
  interactTarget: any = null;
  respawnPoint = new Vector3();
  deathTimer = 0;
  /** set by the game when the player is in a menu/cutscene */
  frozen = false;
  private _tmp = new Vector3();
  private _tmp2 = new Vector3();
  private _moveDir = new Vector3();
  private _lastGroundY = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private airJumps = 0;
  private hitFlashTimer = 0;

  constructor(game: Game) {
    super();
    this.game = game;
    this.faction = 'player';
    this.name = 'Wandering Sword';
    this.nameCN = '無名劍客';
    this.prog = game.prog;
    this.actor = new Actor({
      skin: '#e8c4a0', robe: '#eef2f7', robeDark: '#cdd6e0', trim: '#2f4f7a',
      sash: '#8c2b2b', hair: '#171317', leather: '#3d2c1e', metal: '#dfe6ee',
      hairStyle: 'topknot', sleeves: 'wide', skirt: 'long', height: 1.0, build: 'normal',
    }, { weapon: 'jian', weaponOpts: { length: 1.0 } });
    this.root = this.actor.root;
    this.root.name = 'player';
    this.camera = new CameraRig(game);
    this.maxHp = this.prog.stats.maxHp;
    this.hp = this.maxHp;
    this.maxStamina = this.prog.stats.maxStamina;
    this.stamina = this.maxStamina;
    this.attackPower = this.prog.stats.attack;
    this.defense = this.prog.stats.defense;
    this.actor.onFootstep = (p, running) => this.footstep(p, running);
    this.setSheathed(false);
  }

  attackPower = 20;
  critChance = 0.08;

  setSheathed(v: boolean) {
    this.drawWeapon = !v;
    this.actor.setSheathed(v);
  }

  /* --------------------------------------------------------------- spawning */

  spawnAt(pos: Vector3, yaw = 0) {
    this.pos.copy(pos);
    this.pos.y = heightAt(pos.x, pos.z) + 0.05;
    this.yaw = yaw;
    this.camera.yaw = yaw + Math.PI;
    this.vel.set(0, 0, 0);
    this.respawnPoint.copy(this.pos);
    this.alive = true;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.state = 'locomotion';
    this.root.visible = true;
    this.syncActor();
  }

  /* --------------------------------------------------------------- update */

  update(dt: number) {
    if (!this.actor) return;
    this.stateTime += dt;
    if (!this.alive) { this.updateDead(dt); return; }

    this.iframe = Math.max(0, this.iframe - dt);
    this.parryWindow = Math.max(0, this.parryWindow - dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - dt);
    for (const k in this.attackCooldowns) this.attackCooldowns[k] = Math.max(0, this.attackCooldowns[k] - dt);
    if (this.hitCooldown > 0) this.hitCooldown -= dt;

    const canAct = !this.frozen;

    // -------------------------------------------------- input axes
    let ix = 0, iz = 0;
    if (canAct) {
      ix = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + input.padState.x;
      iz = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) + input.padState.y;
      const m = Math.hypot(ix, iz);
      if (m > 1) { ix /= m; iz /= m; }
    }
    const fwd = this.camera.moveBasis(this._tmp);
    const right = this.camera.rightBasis(this._tmp2);
    const wish = new Vector3()
      .addScaledVector(fwd, iz)
      .addScaledVector(right, ix);
    if (wish.lengthSq() > 1) wish.normalize();
    const hasInput = wish.lengthSq() > 0.04;

    // -------------------------------------------------- state machine
    switch (this.state) {
      case 'attack': this.updateAttack(dt, hasInput, wish); break;
      case 'dodge': this.updateDodge(dt); break;
      case 'parry': this.updateParry(dt); break;
      case 'block': this.updateBlock(dt, wish); break;
      case 'hurt': this.updateHurt(dt); break;
      case 'climb': this.updateClimb(dt, wish); break;
      case 'wallrun': this.updateWallRun(dt, wish); break;
      case 'swim': this.updateSwim(dt, wish, canAct); break;
      case 'air': this.updateAir(dt, wish, canAct); break;
      default: this.updateLocomotion(dt, wish, hasInput, canAct); break;
    }

    if (this.state !== 'attack') this.attack = null;

    // -------------------------------------------------- physics
    this.physics(dt);

    // -------------------------------------------------- stamina regen
    if (this.staminaRegenDelay <= 0 && this.state !== 'block') {
      const rate = this.state === 'locomotion' && !this.sprinting ? 22 : 12;
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
    }
    this.qi = Math.min(this.maxQi, this.qi + 3.2 * dt);

    // -------------------------------------------------- animation
    this.updateAnimation(dt, hasInput);
    this.actor.velocity.copy(this.vel);
    this.actor.update(dt, this.game.render.camera.position, this.game.env.wind, performance.now() / 1000);
    this.syncActor();
    this.root.position.y += 0;

    // combat trail
    if (this.attackTrail && this.actor.weapon) {
      const tip = this.actor.weapon.tip.getWorldPosition(new Vector3());
      const base = this.actor.weapon.base.getWorldPosition(new Vector3());
      this.game.vfx.updateTrail(this.attackTrail, tip, base);
    } else this.attackTrail = null;

    // interaction prompt
    this.updateInteractionPrompt();
  }

  get speed(): number {
    if (this.state === 'block') return 1.9;
    if (this.state === 'attack') return 2.0;
    if (this.state === 'swim') return 4.2;
    if (this.state === 'climb') return 1.6;
    if (this.inWater && !this.swimming) return 3.0;
    if (this.sprinting) return 9.2;
    if (this.drawWeapon) return 5.6;
    return 4.2;
  }

  /* ---------------------------------------------------------- locomotion */

  private updateLocomotion(dt: number, wish: Vector3, hasInput: boolean, canAct: boolean) {
    this.sprinting = canAct && (input.down('dodge') || input.padState.camY > 0) && hasInput && this.stamina > 4 && this.grounded && !this.inWater;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 13 * dt);
      this.staminaRegenDelay = 0.35;
    }
    const sp = this.speed;
    const accel = this.grounded ? 16 : 6;
    this.vel.x = damp(this.vel.x, wish.x * sp, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z * sp, accel, dt);
    if (!this.grounded) { this.setState('air'); return; }

    if (canAct) {
      if (input.pressed('jump')) this.jumpBuffer = 0.16;
      if (this.jumpBuffer > 0) { this.jumpBuffer -= dt; this.doJump(); return; }
      if (input.mousePressed(0)) this.tryAttack('light');
      else if (input.mousePressed(2)) this.tryAttack('heavy');
      else if (input.pressed('special')) this.tryAttack('special1');
      else if (input.pressed('ability2')) this.tryAttack('special2');
      else if (input.pressed('parry')) this.startParry();
      else if (input.mouseDown(2)) this.setState('block');
      else if (input.pressed('dodge') && !hasInput) this.startDodge(new Vector3(0, 0, -1));
      if (input.pressed('dodge') && hasInput) this.startDodge(new Vector3(this.vel.x, 0, this.vel.z).normalize());
      if (input.pressed('sheath')) this.toggleWeapon();
      if (input.pressed('lockOn')) this.toggleLockOn();
      if (input.pressed('interact')) this.game.tryInteract();
      if (input.pressed('potion')) this.game.usePotion();
    }

    // entering water
    if (this.checkSwim()) return;
    // facing
    if (hasInput && this.state === 'locomotion') this.faceDir(wish, dt, this.lockedTarget ? 16 : 11);
  }

  private updateAir(dt: number, wish: Vector3, canAct: boolean) {
    this.sprinting = false;
    const accel = 5.5;
    this.vel.x = damp(this.vel.x, wish.x * this.speed, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z * this.speed, accel, dt);
    this.vel.y -= 26 * dt;
    if (this.vel.y < -38) this.vel.y = -38;

    // glide (lightness skill)
    if (canAct && this.skills.has('lightness') && input.down('jump') && this.vel.y < -1.5) {
      this.glideHeld += dt;
      this.vel.y = damp(this.vel.y, -3.2, 3.5, dt);
      this.setState('glide');
      if (Math.random() < dt * 6) this.game.vfx.qi(this.centerPos.add(new Vector3(0, -0.6, 0)), '#aef0ff', 1, 0.6);
    }
    // air dash
    if (canAct && input.pressed('dodge') && this.airJumps > 0 && this.stamina > 18) {
      this.airJumps--;
      this.stamina -= 18;
      this.staminaRegenDelay = 0.5;
      const dir = wish.lengthSq() > 0.1 ? wish.clone().normalize() : new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.vel.set(dir.x * 13, 3.4, dir.z * 13);
      this.iframe = 0.22;
      this.game.vfx.qi(this.centerPos, '#bfe7ff', 22, 4);
      this.game.audio.play('dash');
      this.actor.anim.play('jump', 0.1);
      return;
    }
    // wall detection
    const wall = this.probeWall();
    if (canAct && wall && wall.climbable && this.state !== 'wallrun') {
      if (Math.hypot(this.vel.x, this.vel.z) > 4.2) { this.startWallRun(wall.normal); return; }
      if (input.down('jump') || wish.lengthSq() > 0.2) { this.setState('climb'); return; }
    }
    if (this.grounded && this.vel.y <= 0) {
      const impact = this._lastGroundY - this.pos.y;
      this.onLand(impact);
    }
    if (this.checkSwim()) return;
    if (this.vel.y < 0 && this.state === 'glide' && !input.down('jump')) this.setState('air');
  }

  private updateSwim(dt: number, wish: Vector3, canAct: boolean) {
    this.vel.y = damp(this.vel.y, 0, 3, dt);
    const sp = this.speed;
    this.vel.x = damp(this.vel.x, wish.x * sp, 7, dt);
    this.vel.z = damp(this.vel.z, wish.z * sp, 7, dt);
    if (canAct && (input.down('jump') || input.padState.camY > 0)) {
      this.vel.y = damp(this.vel.y, 3.4, 6, dt);
      if (Math.random() < dt * 3) this.game.vfx.burst(this.centerPos, '#cfe9f5', 2, 1.2, 0.3, 0.5, -1);
    } else if (canAct && (input.down('crouch'))) {
      this.vel.y = damp(this.vel.y, -3.0, 6, dt);
    } else {
      this.vel.y = damp(this.vel.y, -0.35, 3, dt);
    }
    if (wish.lengthSq() > 0.05) this.faceDir(wish, dt, 5);
    if (canAct && input.mousePressed(0)) {
      // swim attack (reduced)
      this.tryAttack('light');
    }
    const depth = WORLD.waterLevel - heightAt(this.pos.x, this.pos.z);
    if (depth < 1.1 || this.pos.y > WORLD.waterLevel - 0.35) {
      this.swimming = false;
      this.setState('locomotion');
    }
  }

  private updateClimb(dt: number, wish: Vector3) {
    this.vel.x = damp(this.vel.x, wish.x * 1.4, 8, dt);
    this.vel.z = damp(this.vel.z, wish.z * 1.4, 8, dt);
    this.vel.y = damp(this.vel.y, 1.9, 8, dt);
    this.stamina = Math.max(0, this.stamina - 6 * dt);
    this.staminaRegenDelay = 0.4;
    const wall = this.probeWall();
    if (!wall || !wall.climbable || this.stamina < 1) {
      this.setState('air');
      return;
    }
    this.wallNormal.copy(wall.normal);
    if (input.pressed('jump')) {
      this.vel.set(-wall.normal.x * 5.5, 7.4, -wall.normal.z * 5.5);
      this.setState('air');
      this.game.vfx.dust(this.centerPos, 6, 0.5);
      return;
    }
    if (this.grounded && this.stateTime > 0.5) this.setState('locomotion');
  }

  private updateWallRun(dt: number, wish: Vector3) {
    this.wallRunTimer -= dt;
    const n = this.wallNormal;
    // run along the wall
    const along = new Vector3(-n.z, 0, n.x);
    const sign = along.dot(this.vel) >= 0 ? 1 : -1;
    const target = along.clone().multiplyScalar(sign * 8.5);
    this.vel.x = damp(this.vel.x, target.x, 6, dt);
    this.vel.z = damp(this.vel.z, target.z, 6, dt);
    this.vel.y = damp(this.vel.y, 1.4, 3, dt);
    this.stamina = Math.max(0, this.stamina - 9 * dt);
    this.staminaRegenDelay = 0.4;
    if (Math.random() < dt * 12) this.game.vfx.dust(this.centerPos.addScaledVector(n, -0.4), 2, 0.4, 0.4);
    const wall = this.probeWall();
    if (!wall || !wall.climbable || this.wallRunTimer <= 0 || this.stamina < 2) {
      this.setState('air');
      return;
    }
    if (input.pressed('jump')) {
      this.vel.set(n.x * 5.0, 8.2, n.z * 5.0);
      this.airJumps = Math.max(this.airJumps, 1);
      this.setState('air');
      this.game.vfx.qi(this.centerPos, '#bfe7ff', 14, 3);
      this.game.audio.play('jump');
    }
  }

  private updateBlock(dt: number, wish: Vector3) {
    this.blocking = true;
    const sp = 2.0;
    this.vel.x = damp(this.vel.x, wish.x * sp, 10, dt);
    this.vel.z = damp(this.vel.z, wish.z * sp, 10, dt);
    if (this.lockedTarget) this.faceDir(new Vector3(this.lockedTarget.pos.x - this.pos.x, 0, this.lockedTarget.pos.z - this.pos.z), dt, 12);
    else if (wish.lengthSq() > 0.05) this.faceDir(wish, dt, 5);
    if (!input.mouseDown(2) || this.stamina <= 0) {
      this.blocking = false;
      this.setState('locomotion');
      return;
    }
    if (input.mousePressed(0)) { this.tryAttack('light'); }
    if (input.pressed('dodge')) this.startDodge(wish.lengthSq() > 0.1 ? wish.clone().normalize() : new Vector3(0, 0, -1));
    if (input.pressed('parry')) this.startParry();
  }

  private updateParry(dt: number) {
    const sp = 1.2;
    this.vel.x = damp(this.vel.x, 0, 12, dt);
    this.vel.z = damp(this.vel.z, 0, 12, dt);
    if (this.lockedTarget) this.faceDir(new Vector3(this.lockedTarget.pos.x - this.pos.x, 0, this.lockedTarget.pos.z - this.pos.z), dt, 14);
    if (this.parryWindow <= 0 && this.stateTime > 0.5) {
      this.setState('locomotion');
    }
    // buffer an attack out of the parry
    if (this.buffered && this.stateTime > 0.18) {
      const b = this.buffered; this.buffered = null;
      this.startAttack(b.type === 'light' ? 'light1' : b.type === 'heavy' ? 'heavy1' : b.type);
    }
  }

  private updateAttack(dt: number, hasInput: boolean, wish: Vector3) {
    const a = this.attack;
    this.attackTime += dt;
    if (!a) { this.setState('locomotion'); return; }

    // rotate toward the locked target during the windup
    if (this.lockedTarget && this.attackTime < a.activeStart) {
      this.faceDir(new Vector3(this.lockedTarget.pos.x - this.pos.x, 0, this.lockedTarget.pos.z - this.pos.z), dt, 14);
    }
    // forward root motion
    const moveSpeed = (a.moveSpeed ?? 0) * (this.attackTime < a.activeStart + 0.12 ? 1 : 0.25);
    const dir = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.x = damp(this.vel.x, dir.x * moveSpeed, 10, dt);
    this.vel.z = damp(this.vel.z, dir.z * moveSpeed, 10, dt);
    if (!this.grounded) this.vel.y -= 20 * dt;

    // slash VFX at the start of the active window
    if (!this.attackSlashDone && this.attackTime >= a.activeStart) {
      this.attackSlashDone = true;
      this.spawnAttackFx(a);
      this.game.audio.play(a.sfx ?? 'swing');
      this.game.vfx.shake(a.shake);
    }
    // combo buffering
    if (this.attackTime > a.activeEnd && this.buffered) {
      const b = this.buffered;
      this.buffered = null;
      const next = b.type === 'light' ? (a.next ?? 'light1') : b.type === 'heavy' ? (a.next ?? 'heavy1') : b.type;
      this.startAttack(next);
      return;
    }
    if (this.attackTime >= a.dur * 0.92) {
      this.setState(this.grounded ? 'locomotion' : 'air');
    }
    // dodge cancels the recovery
    if (this.attackTime > a.activeEnd + 0.05 && input.pressed('dodge') && this.stamina > 20) {
      this.startDodge(wish.lengthSq() > 0.1 ? wish.clone().normalize() : new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    }
  }
  private attackSlashDone = false;

  private updateDodge(dt: number) {
    const t = this.stateTime;
    const dir = this.dodgeDir;
    const speedCurve = t < 0.12 ? 14 : t < 0.42 ? 11 : t < 0.62 ? 6 : 2;
    this.vel.x = damp(this.vel.x, dir.x * speedCurve, 18, dt);
    this.vel.z = damp(this.vel.z, dir.z * speedCurve, 18, dt);
    if (!this.grounded) this.vel.y -= 22 * dt;
    if (t > 0.1 && t < 0.5) this.iframe = Math.max(this.iframe, 0.02);
    if (Math.random() < dt * 22) this.game.vfx.dust(this.pos.clone().add(new Vector3(0, 0.1, 0)), 2, 0.45, 0.5);
    if (t >= 0.72) {
      this.setState(this.grounded ? 'locomotion' : 'air');
      if (this.buffered) {
        const b = this.buffered; this.buffered = null;
        this.startAttack(b.type === 'light' ? 'light1' : b.type === 'heavy' ? 'heavy1' : b.type);
      }
    }
  }

  private updateHurt(dt: number) {
    this.vel.x = damp(this.vel.x, 0, 8, dt);
    this.vel.z = damp(this.vel.z, 0, 8, dt);
    if (!this.grounded) this.vel.y -= 24 * dt;
    if (this.stateTime > 0.42) this.setState('locomotion');
  }

  private updateDead(dt: number) {
    this.deathTimer += dt;
    this.vel.set(0, this.vel.y, 0);
    this.vel.y -= 24 * dt;
    this.physics(dt);
    this.actor.update(dt, this.game.render.camera.position, this.game.env.wind, performance.now() / 1000);
    this.syncActor();
  }

  /* ------------------------------------------------------------- actions */

  setState(s: PlayerState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  doJump() {
    if (!this.grounded && this.coyote <= 0 && this.airJumps <= 0) return;
    let v = 8.6;
    if (!this.grounded && this.coyote <= 0) { this.airJumps--; v = 7.8; }
    this.vel.y = v;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.setState('air');
    this.actor.anim.play('jump', 0.08);
    this.game.audio.play('jump');
    this.game.vfx.dust(this.pos.clone(), 5, 0.5, 0.8);
  }

  startDodge(dirIn: Vector3) {
    if (this.dodgeCooldown > 0 || this.stamina < 18 || this.state === 'dodge') return;
    const dir = dirIn.lengthSq() > 0.1 ? dirIn.clone().normalize() : new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.dodgeDir.copy(dir);
    this.stamina -= 18;
    this.staminaRegenDelay = 0.5;
    this.dodgeCooldown = 0.28;
    this.setState('dodge');
    this.iframe = 0.45;
    this.actor.anim.play('dodge', 0.06);
    this.game.audio.play('dodge');
    this.faceDir(dir, 1, 30);
    this.game.vfx.dust(this.pos.clone(), 8, 0.6, 0.7);
  }
  private dodgeDir = new Vector3(0, 0, 1);

  startParry() {
    if (this.stamina < 12) return;
    this.stamina -= 12;
    this.staminaRegenDelay = 0.6;
    this.setState('parry');
    this.parryWindow = 0.30;
    this.actor.anim.playOverlay('parry', 0.05);
    this.game.audio.play('parryReady');
    this.game.vfx.qi(this.centerPos, '#cfe9ff', 6, 1.2);
  }

  toggleWeapon() {
    this.setSheathed(this.drawWeapon);
    this.actor.anim.playOverlay('draw', 0.1);
    this.game.audio.play('draw');
  }

  toggleLockOn() {
    if (this.lockedTarget) {
      this.lockedTarget = null;
      this.camera.lockTarget = null;
      this.game.audio.play('uiClick');
      return;
    }
    const t = this.game.findLockTarget(this.pos, this.camera.yaw, 26);
    if (t) {
      this.lockedTarget = t;
      this.camera.lockTarget = t;
      this.game.audio.play('lockon');
    }
  }

  tryAttack(kind: 'light' | 'heavy' | 'special1' | 'special2') {
    if (this.state === 'attack') {
      if (this.attackTime > (this.attack?.activeStart ?? 0) * 0.6) this.buffered = { type: kind, time: 0 };
      return;
    }
    if (this.state === 'dodge' || this.state === 'hurt') { this.buffered = { type: kind, time: 0 }; return; }
    let id = 'light1';
    if (kind === 'heavy') id = 'heavy1';
    if (kind === 'special1') id = 'special1';
    if (kind === 'special2') id = 'special2';
    if (!this.drawWeapon) { this.toggleWeapon(); return; }
    this.startAttack(id);
  }

  startAttack(id: string) {
    const def = ATTACKS[id];
    if (!def) return;
    if (def.unlock && !this.skills.has(def.unlock)) {
      bus.emit(EV.TOAST, { text: 'Ability not learned yet', kind: 'warn' });
      return;
    }
    if ((this.attackCooldowns[id] ?? 0) > 0) return;
    if (this.stamina < def.stamina) {
      bus.emit(EV.TOAST, { text: 'Not enough stamina', kind: 'warn' });
      return;
    }
    if (def.qi && this.qi < def.qi) {
      bus.emit(EV.TOAST, { text: 'Not enough qi', kind: 'warn' });
      return;
    }
    // counter-attack opportunity
    if (this.counterWindow > 0 && (def.kind === 'light' || def.kind === 'special')) {
      id = 'counter';
      this.counterWindow = 0;
      this.game.audio.play('counter');
    }
    const d2 = ATTACKS[id];
    this.stamina -= d2.stamina;
    this.staminaRegenDelay = 0.55;
    if (d2.qi) this.qi -= d2.qi;
    if (d2.cooldown) this.attackCooldowns[id] = d2.cooldown;
    this.attack = d2;
    this.attackTime = 0;
    this.attackSlashDone = false;
    this.setState('attack');
    this.actor.anim.playOverlay(d2.clip, 0.05);
    if (d2.trail) this.attackTrail = this.game.vfx.startTrail(d2.trail.color, d2.trail.width, Math.max(0.3, d2.activeEnd - d2.activeStart + 0.22));
    // start the combat hitbox
    this.game.combat.startAttack(this, d2);
    // face the target
    if (this.lockedTarget) this.faceDir(new Vector3(this.lockedTarget.pos.x - this.pos.x, 0, this.lockedTarget.pos.z - this.pos.z), 1, 40);
    bus.emit(EV.ABILITY_READY, { id });
  }

  private spawnAttackFx(def: AttackDef) {
    const yaw = this.yaw;
    const p = this.pos.clone().add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(def.range * 0.55));
    p.y += def.slash?.y ?? 1.1;
    if (def.slash) {
      this.game.vfx.slash(p, yaw, {
        color: def.slash.color, scale: def.slash.scale, arc: def.slash.arc, tilt: def.slash.tilt, life: 0.24,
      });
    }
    if (def.aoe) {
      this.game.vfx.ripple(this.pos.clone(), 0.5, def.aoe * 1.6, 0.42, def.slash?.color ?? '#fff', 0.7);
      this.game.vfx.shake(def.shake * 0.6);
    }
    if (def.kind === 'special') {
      this.game.vfx.qi(this.centerPos, def.slash?.color ?? '#9ff0ff', 26, 5);
    }
  }

  /* ------------------------------------------------------------- combat rx */

  protected onDamaged(info: DamageInfo, dealt: number) {
    // blocking?
    const src = info.from;
    let blocked = false;
    if (this.state === 'block' && src) {
      const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const to = new Vector3(src.x - this.pos.x, 0, src.z - this.pos.z).normalize();
      if (fwd.dot(to) > 0.25) {
        blocked = true;
        const reduce = 0.24;
        this.hp += dealt * (1 - reduce);
        this.stamina -= 14 + dealt * 0.35;
        this.staminaRegenDelay = 0.8;
        this.game.audio.play('block');
        this.game.vfx.sparks(this.centerPos.addScaledVector(to, 0.5), to, 10, '#cfe9ff');
        this.game.vfx.shake(0.12);
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.blocking = false;
          this.setState('hurt');
          this.actor.anim.play('hit', 0.05);
          bus.emit(EV.TOAST, { text: 'Guard broken!', kind: 'bad' });
        }
        bus.emit(EV.DAMAGE_PLAYER, { amount: dealt * reduce, blocked: true });
        this.game.vfx.damageNumber(this.centerPos, Math.round(dealt * reduce), 'normal');
        return;
      }
    }
    // parry?
    if (this.parryWindow > 0) {
      this.parryWindow = 0;
      this.hp += dealt;
      this.counterWindow = 1.0;
      this.game.combat.requestHitStop(0.16, 0.03);
      this.game.audio.play('parry');
      this.game.vfx.sparks(this.centerPos.add(new Vector3(0, 0.2, 0)), new Vector3(0, 1, 0), 26, '#fff0b0');
      this.game.vfx.ripple(this.pos.clone(), 0.4, 3.2, 0.4, '#ffe9a8', 0.9);
      this.game.vfx.shake(0.3);
      this.game.vfx.damageNumber(this.centerPos, 0, 'crit');
      bus.emit(EV.TOAST, { text: 'Perfect Parry! Light attack to counter', kind: 'good' });
      if (info.source) {
        (info.source as any).staggerTimer = 0.9;
        (info.source as any).parried = true;
      }
      return;
    }
    // iframe dodge
    if (this.iframe > 0) {
      this.hp += dealt;
      this.counterWindow = 0.9;
      this.game.combat.requestHitStop(0.1, 0.05);
      this.game.audio.play('dodgePerfect');
      bus.emit(EV.TOAST, { text: 'Perfect Dodge!', kind: 'good' });
      this.game.vfx.qi(this.centerPos, '#bfe7ff', 14, 3);
      return;
    }
    this.game.vfx.blood(this.centerPos, new Vector3(0, 0.6, 0), 8);
    this.game.vfx.damageNumber(this.centerPos, dealt, 'player');
    this.game.vfx.shake(0.35);
    this.game.audio.play('playerHurt');
    this.setState('hurt');
    this.actor.anim.play('hit', 0.05);
    this.staminaRegenDelay = 0.9;
    bus.emit(EV.DAMAGE_PLAYER, { amount: dealt, blocked: false });
    if (info.knockback && info.from) {
      const dir = new Vector3(this.pos.x - info.from.x, 0, this.pos.z - info.from.z).normalize();
      this.vel.addScaledVector(dir, info.knockback);
      this.vel.y = Math.max(this.vel.y, 1.6);
    }
  }

  protected onDeath() {
    this.setState('dead');
    this.deathTimer = 0;
    this.actor.anim.play('death', 0.2);
    this.game.audio.play('playerDeath');
    this.game.audio.setMusic('sad');
    bus.emit(EV.PLAYER_DIED, {});
  }

  /* ------------------------------------------------------------- physics */

  private physics(dt: number) {
    const prevY = this.pos.y;
    // horizontal move + collision
    const step = this._tmp.copy(this.vel).multiplyScalar(dt);
    this.pos.x += step.x;
    this.pos.z += step.z;
    this.pos.y += step.y * dt;

    const res = physics.resolveCapsule(this.pos, 0.38, this.height * 0.95);
    if (res.hit) {
      // cancel velocity into the wall
      if (res.wallNormal) {
        const dot = this.vel.x * res.wallNormal.x + this.vel.z * res.wallNormal.z;
        if (dot < 0) { this.vel.x -= res.wallNormal.x * dot; this.vel.z -= res.wallNormal.z * dot; }
      }
    }

    // ground
    const support = physics.supportHeight(this.pos.x, this.pos.z, this.pos.y, 0.38, 0.55);
    const groundY = support.y;
    const wasGrounded = this.grounded;
    if (this.pos.y <= groundY + 0.02 && this.vel.y <= 0.01) {
      this.pos.y = groundY;
      if (this.vel.y < -12) this.game.vfx.dust(this.pos.clone(), 8, 0.7, 0.6);
      this.vel.y = 0;
      this.grounded = true;
      this.coyote = 0.12;
      this.airJumps = this.skills.has('doublejump') ? 1 : 0;
      this._lastGroundY = groundY;
    } else {
      if (wasGrounded) this.coyote = 0.12;
      this.coyote = Math.max(0, this.coyote - dt);
      this.grounded = false;
    }

    // slope sliding
    if (this.grounded && this.state !== 'climb' && this.state !== 'wallrun') {
      const n = terrainNormal(this.pos.x, this.pos.z, this._tmp2);
      if (n.y < 0.62) {
        const slide = (0.62 - n.y) * 26;
        this.vel.x += n.x * slide * dt;
        this.vel.z += n.z * slide * dt;
      }
    }

    // water
    const depth = WORLD.waterLevel - heightAt(this.pos.x, this.pos.z);
    this.inWater = depth > 0.15 && this.pos.y < WORLD.waterLevel + 0.05;
    this.submerged = this.inWater && this.pos.y < WORLD.waterLevel - 0.85;
    if (this.inWater && depth > 1.4 && !this.swimming && this.state !== 'swim') {
      this.swimming = true;
      this.setState('swim');
      this.game.vfx.splash(new Vector3(this.pos.x, WORLD.waterLevel, this.pos.z), 18);
      this.game.audio.play('splash');
    }
    if (this.swimming && this.state === 'swim') {
      const surface = WORLD.waterLevel - 0.45;
      if (this.pos.y > surface + 0.9) this.pos.y = damp(this.pos.y, surface + 0.4, 6, dt);
    }
    if (this.inWater) {
      this.vel.multiplyScalar(1 - 1.6 * dt);
      if (this.pos.y < WORLD.waterLevel - 0.4 && this.vel.y < 0) this.vel.y = damp(this.vel.y, 0.4, 4, dt);
    }

    // world bounds
    const lim = WORLD.half - 30;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = clamp(this.pos.x, -lim, lim); this.vel.x = 0; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = clamp(this.pos.z, -lim, lim); this.vel.z = 0; }
  }

  private probeWall(): { normal: Vector3; collider: any; climbable: boolean } | null {
    const r = 0.5;
    const probes = [0, 0.6, -0.6];
    for (const off of probes) {
      const dir = new Vector3(Math.sin(this.yaw + off), 0, Math.cos(this.yaw + off));
      const test = this._tmp.copy(this.pos).addScaledVector(dir, r + 0.1);
      test.y += 0.9;
      const list = physics.query(test.x, test.z, 1.2);
      for (const c of list) {
        if (c.type === 'box') {
          const dx = test.x - c.cx, dz = test.z - c.cz;
          const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
          const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          if (Math.abs(lx) <= c.hx + r && Math.abs(lz) <= c.hz + r && test.y > c.cy - c.hy && test.y < c.cy + c.hy) {
            if (c.cy + c.hy - this.pos.y < 1.5) continue; // too short to climb
            const nlx = Math.abs(c.hx + r - Math.abs(lx)) < Math.abs(c.hz + r - Math.abs(lz)) ? Math.sign(lx) : 0;
            const nlz = nlx === 0 ? Math.sign(lz) : 0;
            const ci = Math.cos(c.yaw), si = Math.sin(c.yaw);
            return { normal: new Vector3(nlx * ci - nlz * si, 0, nlx * si + nlz * ci).normalize(), collider: c, climbable: c.climbable };
          }
        } else {
          const dx = test.x - c.cx, dz = test.z - c.cz;
          const d = Math.hypot(dx, dz);
          if (d < c.radius + r && test.y > c.cy - c.halfHeight && test.y < c.cy + c.halfHeight) {
            if (c.cy + c.halfHeight - this.pos.y < 1.5) continue;
            return { normal: new Vector3(dx / (d || 1), 0, dz / (d || 1)).normalize(), collider: c, climbable: c.climbable };
          }
        }
      }
    }
    return null;
  }

  private startWallRun(normal: Vector3) {
    this.wallNormal.copy(normal);
    this.wallRunTimer = 1.7;
    this.setState('wallrun');
    this.actor.anim.play('wallrun', 0.1);
    this.airJumps = Math.max(this.airJumps, 1);
    this.game.audio.play('wallrun');
  }

  private checkSwim(): boolean {
    const depth = WORLD.waterLevel - heightAt(this.pos.x, this.pos.z);
    if (depth > 1.4 && this.pos.y < WORLD.waterLevel - 0.35) {
      this.swimming = true;
      this.setState('swim');
      return true;
    }
    return false;
  }

  private onLand(impact: number) {
    this.airJumps = this.skills.has('doublejump') ? 1 : 0;
    if (this.state === 'swim') return;
    if (impact > 3.5) {
      this.actor.anim.play('land', 0.06);
      this.game.vfx.dust(this.pos.clone(), 10, 0.8, 0.5);
      this.game.audio.play('land');
      this.game.vfx.shake(clamp01(impact / 18) * 0.25);
      if (impact > 16) {
        const dmg = (impact - 14) * 4;
        this.takeDamage({ amount: dmg, type: 'physical' });
      }
    }
    if (this.state === 'air' || this.state === 'glide') this.setState('locomotion');
  }

  private faceDir(dir: Vector3, dt: number, rate: number) {
    if (dir.lengthSq() < 0.001) return;
    const want = Math.atan2(dir.x, dir.z);
    const diff = MathUtils.euclideanModulo(want - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    this.yaw += diff * Math.min(1, rate * dt);
  }

  private footstep(pos: Vector3, running: boolean) {
    const now = performance.now() / 1000;
    if (now - this.footstepTimer < (running ? 0.22 : 0.34)) return;
    this.footstepTimer = now;
    if (!this.grounded) return;
    const depth = WORLD.waterLevel - heightAt(pos.x, pos.z);
    if (depth > 0) { this.game.audio.play('footstepWater'); this.game.vfx.splash(new Vector3(pos.x, WORLD.waterLevel, pos.z), 5); }
    else { this.game.audio.play(Math.random() < 0.5 ? 'footstep' : 'footstep2'); }
    this.game.vfx.dust(pos.clone(), 2, 0.3, 0.3);
  }

  private updateInteractionPrompt() {
    const t = this.game.findInteractable(this.pos);
    this.interactTarget = t;
    bus.emit(EV.INTERACT_PROMPT, t ? { label: t.label ?? 'Interact', key: 'E' } : null);
  }

  private updateAnimation(dt: number, hasInput: boolean) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let clip = 'idle';
    switch (this.state) {
      case 'swim': clip = 'swim'; break;
      case 'climb': clip = 'climb'; break;
      case 'wallrun': clip = 'wallrun'; break;
      case 'air': clip = 'air'; break;
      case 'glide': clip = 'air'; break;
      case 'dodge': clip = 'dodge'; break;
      case 'hurt': clip = 'hit'; break;
      case 'block': clip = 'block'; break;
      case 'attack': clip = 'combatIdle'; break;
      default:
        if (this.inWater) clip = sp > 0.5 ? 'walk' : 'idle';
        else if (!this.drawWeapon) clip = sp > 3.0 ? 'run' : sp > 0.35 ? 'walk' : 'idle';
        else if (this.sprinting) clip = 'sprint';
        else if (sp > 3.0) clip = 'run';
        else if (sp > 0.35) clip = 'walk';
        else clip = 'combatIdle';
    }
    if (this.state === 'attack' || this.state === 'parry') clip = 'combatIdle';
    if (this.actor.anim.current !== clip && this.state !== 'hurt' && this.state !== 'dodge') {
      this.actor.anim.play(clip, clip === 'idle' || clip === 'combatIdle' ? 0.28 : 0.16,
        clip === 'walk' ? clamp(sp / 4.2, 0.6, 1.4) : clip === 'run' ? clamp(sp / 5.6, 0.7, 1.35) : clip === 'sprint' ? clamp(sp / 9.2, 0.8, 1.3) : 1);
    }
    if (this.state !== 'attack' && this.state !== 'parry' && this.state !== 'hurt' && this.state !== 'dodge') {
      this.actor.anim.stopOverlay(0.2);
    }
  }

  /* --------------------------------------------------------------- helpers */

  get isBlocking() { return this.state === 'block' && this.stamina > 0; }

  addSkill(id: string) { this.skills.add(id); }

  refreshStats() {
    const s = this.prog.stats;
    const prevMax = this.maxHp;
    this.maxHp = s.maxHp;
    this.maxStamina = s.maxStamina;
    this.maxQi = s.maxQi ?? 100;
    this.attackPower = s.attack;
    this.defense = s.defense;
    this.critChance = s.critChance;
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - prevMax));
    this.stamina = Math.min(this.stamina, this.maxStamina);
  }
}
