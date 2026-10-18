import {
  Scene, Group, Vector3, Object3D, Mesh, BoxGeometry, CylinderGeometry,
  SphereGeometry, MeshStandardMaterial, Color, Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending, MathUtils,
} from 'three';
import { RenderSystem } from './render/Renderer';
import { Environment } from './render/Environment';
import { Water } from './render/Water';
import { Terrain } from './world/Terrain';
import { Vegetation } from './world/Vegetation';
import { WorldGen, SpawnPoint } from './world/WorldGen';
import { Player } from './player/Player';
import { Combat } from './combat/Combat';
import { VFX } from './VFX';
import { Entity } from './Entity';
import { Enemy, EnemyKind } from './ai/Enemy';
import { Npc, NpcRole, buildDialogue, NPC_DEFS } from './npc/Npc';
import { Progression, ITEMS, SKILLS } from './rpg/Progression';
import { QuestSystem } from './quests/Quests';
import { AudioEngine } from './audio/Audio';
import { bus, EV } from './core/Events';
import { input } from './core/Input';
import { WORLD, heightAt, findStableGround } from './core/TerrainHeight';
import { physics } from './core/Physics';
import { saves } from './save/Save';
import { useGame, toast } from '../state/store';
import { makeRng, clamp, clamp01 } from './core/Noise';

export interface Chest {
  id: number; pos: Vector3; mesh: Group; opened: boolean;
  loot: { id: string; chance: number; min: number; max: number }[]; gold: number;
}
export interface ResNode {
  id: number; pos: Vector3; kind: 'herb' | 'ore'; mesh: Object3D; depleted: number;
}
export interface Projectile {
  pos: Vector3; vel: Vector3; life: number; radius: number; damage: number;
  source: Entity | null; mesh: Mesh; color: number; gravity: number;
}

interface SpawnRecord {
  point: SpawnPoint;
  ent: Enemy | Npc | null;
  dead: boolean;
  respawn: number;
}

const ACTIVATE_ENEMY = 95;
const DEACTIVATE_ENEMY = 165;
const ACTIVATE_NPC = 115;
const DEACTIVATE_NPC = 185;

export class Game {
  render!: RenderSystem;
  scene!: Scene;
  env!: Environment;
  water!: Water;
  terrain!: Terrain;
  veg!: Vegetation;
  world!: WorldGen;
  player!: Player;
  combat!: Combat;
  vfx!: VFX;
  audio = new AudioEngine();
  prog = new Progression();
  quests!: QuestSystem;

  entityGroup = new Group();
  propGroup = new Group();
  enemies: Enemy[] = [];
  npcs: Npc[] = [];
  records: SpawnRecord[] = [];
  chests: Chest[] = [];
  nodes: ResNode[] = [];
  projectiles: Projectile[] = [];
  tokens = new Set<Enemy>();

  paused = false;
  started = false;
  running = false;
  time = 0;
  deaths = 0;
  playTime = 0;
  slot = 0;
  private hudTimer = 0;
  private mapTimer = 0;
  private saveTimer = 60;
  private musicTimer = 0;
  private combatMusic = 0;
  private lastTs = 0;
  private raf = 0;
  private respawnPoint = new Vector3();
  private dialogueNpc: Npc | null = null;
  private shopNpc: Npc | null = null;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private accum = 0;

  /* --------------------------------------------------------------- loading */

  async init(canvas: HTMLCanvasElement, quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA') {
    const step = (t: string, p: number) => {
      useGame.getState().setLoading({ text: t, progress: p, active: true });
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    };

    await step('Preparing the ink and paper…', 0.04);
    this.render = new RenderSystem(canvas);
    this.scene = this.render.scene;
    this.render.setQuality(quality);

    await step('Hanging the sky…', 0.12);
    this.env = new Environment(this.scene, this.render);
    this.env.setQuality();
    this.env.setTimeOfDay(7.4);
    this.env.setWeather('clear', true);

    await step('Filling the rivers…', 0.2);
    this.water = new Water(this.scene);
    this.water.setQuality(this.render.quality.waterSegments ?? 128);

    await step('Raising the mountains…', 0.3);
    this.terrain = new Terrain();
    this.scene.add(this.terrain.group);

    await step('Planting a thousand pines…', 0.42);
    this.veg = new Vegetation();
    this.scene.add(this.veg.group);

    await step('Building villages and temples…', 0.52);
    this.world = new WorldGen();
    this.world.generate();
    this.scene.add(this.world.group);

    await step('Lighting the lanterns…', 0.72);
    this.scene.add(this.entityGroup);
    this.scene.add(this.propGroup);
    this.vfx = new VFX(this.scene);
    this.buildProps();

    await step('Sharpening the blade…', 0.82);
    this.combat = new Combat((attacker, def) => this.getTargets(attacker, def));
    this.quests = new QuestSystem(this);

    await step('Waking the jianghu…', 0.92);
    this.player = new Player(this);
    this.scene.add(this.player.root);
    this.player.refreshStats();
    this.player.spawnAt(this.world.startPos.clone(), Math.PI);
    this.respawnPoint.copy(this.world.startPos);

    this.bindEvents();
    await step('Ready', 1);
    this.started = true;
  }

  private buildProps() {
    let cid = 0, nid = 0;
    for (const s of this.world.spawns) {
      this.records.push({ point: s, ent: null, dead: false, respawn: 0 });
      if (s.kind === 'chest') {
        const g = this.makeChest();
        g.position.copy(s.pos);
        g.rotation.y = (cid * 1.7) % (Math.PI * 2);
        this.propGroup.add(g);
        this.chests.push({
          id: cid, pos: s.pos.clone(), mesh: g, opened: false,
          loot: [
            { id: 'potion', chance: 0.7, min: 1, max: 2 },
            { id: 'herb', chance: 0.5, min: 1, max: 3 },
            { id: 'ore', chance: 0.35, min: 1, max: 2 },
            { id: 'silk', chance: 0.25, min: 1, max: 2 },
            { id: 'spiritStone', chance: 0.12, min: 1, max: 1 },
            { id: 'jadeRing', chance: 0.05, min: 1, max: 1 },
            { id: 'tigerTalisman', chance: 0.03, min: 1, max: 1 },
          ],
          gold: 40 + Math.floor(Math.random() * 120),
        });
        physics.addOrientedBox(s.pos, new Vector3(1.0, 0.5, 0.7), g.rotation.y);
        cid++;
      } else if (s.kind === 'node') {
        const kind: 'herb' | 'ore' = s.type === 'ore' ? 'ore' : 'herb';
        const m = kind === 'herb' ? this.makeHerb() : this.makeOre();
        m.position.copy(s.pos);
        this.propGroup.add(m);
        this.nodes.push({ id: nid, pos: s.pos.clone(), kind, mesh: m, depleted: 0 });
        nid++;
      }
    }
  }

  private makeChest(): Group {
    const g = new Group();
    const wood = new MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85, metalness: 0.05 });
    const iron = new MeshStandardMaterial({ color: 0x4a4038, roughness: 0.5, metalness: 0.7 });
    const body = new Mesh(new BoxGeometry(0.9, 0.55, 0.6), wood);
    body.position.y = 0.28;
    body.castShadow = true; body.receiveShadow = true;
    const lid = new Mesh(new BoxGeometry(0.94, 0.18, 0.64), wood);
    lid.position.y = 0.62;
    lid.castShadow = true;
    const band1 = new Mesh(new BoxGeometry(0.06, 0.6, 0.64), iron);
    band1.position.set(-0.3, 0.3, 0);
    const band2 = band1.clone(); band2.position.x = 0.3;
    const lock = new Mesh(new BoxGeometry(0.14, 0.16, 0.06), iron);
    lock.position.set(0, 0.5, 0.32);
    g.add(body, lid, band1, band2, lock);
    (g as any).lid = lid;
    return g;
  }

  private makeHerb(): Object3D {
    const g = new Group();
    const soil = new Mesh(new CylinderGeometry(0.42, 0.5, 0.12, 8), new MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }));
    soil.position.y = 0.06;
    g.add(soil);
    const rng = makeRng(7);
    for (let i = 0; i < 7; i++) {
      const h = 0.3 + rng() * 0.3;
      const leaf = new Mesh(
        new BoxGeometry(0.05, h, 0.02),
        new MeshStandardMaterial({ color: new Color().setHSL(0.28 + rng() * 0.06, 0.5, 0.32), roughness: 0.8 }),
      );
      leaf.position.set((rng() - 0.5) * 0.5, h / 2, (rng() - 0.5) * 0.5);
      leaf.rotation.set((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6);
      g.add(leaf);
    }
    const bud = new Mesh(new SphereGeometry(0.09, 8, 6), new MeshStandardMaterial({ color: 0xd8e070, emissive: 0x445510, roughness: 0.6 }));
    bud.position.y = 0.5;
    g.add(bud);
    return g;
  }

  private makeOre(): Object3D {
    const g = new Group();
    const rock = new Mesh(new CylinderGeometry(0.55, 0.75, 0.7, 6), new MeshStandardMaterial({ color: 0x6a6258, roughness: 0.95, flatShading: true }));
    rock.position.y = 0.34;
    rock.castShadow = true;
    g.add(rock);
    for (let i = 0; i < 4; i++) {
      const v = new Mesh(
        new SphereGeometry(0.1, 6, 5),
        new MeshStandardMaterial({ color: 0xb0a0c0, metalness: 0.5, roughness: 0.3, emissive: 0x1a1428 }),
      );
      const a = (i / 4) * Math.PI * 2;
      v.position.set(Math.cos(a) * 0.36, 0.45 + (i % 2) * 0.16, Math.sin(a) * 0.36);
      g.add(v);
    }
    return g;
  }

  /* ---------------------------------------------------------------- events */

  private bindEvents() {
    bus.on(EV.TOAST, (p: any) => toast(p.text, p.kind ?? 'info'));
    bus.on(EV.PLAYER_LEVELUP, (p: any) => {
      this.audio.play('levelup');
      this.vfx.qi(this.player.pos.clone().add(new Vector3(0, 1, 0)), '#ffe9a0', 40, 4);
      toast(`Level ${p.level} — +1 skill point`, 'good');
      this.player.refreshStats();
      this.player.hp = this.prog.stats.maxHp;
      this.updateHud(true);
      this.saveGame(true);
    });
    bus.on(EV.DAMAGE_PLAYER, (p: any) => {
      this.render.flash(new Color(0xff2a1a), Math.min(0.5, 0.12 + p.amount / 260));
      this.vfx.shake(0.22 + Math.min(0.4, p.amount / 200));
      if (p.amount > 0) this.audio.play('playerHurt');
      this.hudTimer = 0;
      this.updateHud(true);
    });
    bus.on(EV.PLAYER_DIED, () => {
      this.deaths++;
      this.audio.play('playerDeath');
      this.audio.setMusic('sad');
      const lost = Math.floor(this.prog.gold * 0.2);
      this.prog.addGold(-lost);
      useGame.getState().setScreen('dead');
      toast(`You fell. ${lost} gold scattered on the road.`, 'bad');
      input.releaseLock();
    });
    bus.on(EV.QUEST_UPDATE, (p: any) => {
      this.audio.play('quest');
      this.refreshQuestUI();
    });
    bus.on(EV.QUEST_COMPLETE, (p: any) => {
      this.audio.play('questComplete');
      this.refreshQuestUI();
      this.saveGame(true);
    });
    bus.on(EV.OBJECTIVE_PROGRESS, () => this.refreshQuestUI());
    bus.on(EV.BOSS_STATE, (p: any) => this.onBossEngaged(p.enemy));
    bus.on(EV.INTERACT_PROMPT, (p: any) => {
      if (p && p.label) useGame.getState().setInteract({ label: p.label, key: 'E' });
      else useGame.getState().setInteract(null);
    });
  }

  /* ----------------------------------------------------------------- loop */

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      if (dt > 0.1) dt = 0.1;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setPaused(v: boolean) {
    this.paused = v;
    this.env.paused = v;
    if (v) input.releaseLock();
  }

  private frame(dt: number) {
    input.pollGamepad();
    const st = useGame.getState();
    if (this.paused || st.screen === 'dead' || st.panel !== 'none' || st.dialogue) {
      // still animate the world slowly behind menus
      if (st.screen === 'playing') {
        this.env.update(dt * 0.15, this.player.pos, this.render.camera.position);
        this.player.actor.update(dt * 0.2, this.render.camera.position, this.env.wind, this.time);
        this.vfx.update(dt, this.render.camera, window.innerWidth, window.innerHeight);
        this.render.render(dt, this.time);
        input.endFrame();
      }
      return;
    }
    this.time += dt;
    this.playTime += dt;
    this.prog.playTime += dt;

    // ---- world
    this.env.update(dt, this.player.pos, this.render.camera.position);
    this.terrain.update(this.player.pos, this.render.quality);
    this.veg.update(this.player.pos, this.render.quality, this.render.camera.position,
      this.env.sunDir, this.env.sunColor, this.env.fogColor, this.env.fogDensity);
    this.water.update(this.render.camera.position, this.env.fogColor, this.env.fogDensity);

    // ---- combat / entities
    this.updateSpawns(dt);
    this.combat.update(dt);
    this.player.update(dt);
    for (const e of this.enemies) e.update(dt);
    for (const n of this.npcs) n.update(dt);
    this.updateProjectiles(dt);
    this.updateChests(dt);

    // ---- camera & fx
    this.vfx.update(dt, this.render.camera, window.innerWidth, window.innerHeight);
    this.audio.update(dt, this.player.pos, this.env.timeOfDay < 6 || this.env.timeOfDay > 19,
      clamp01(this.env.wind.length()), this.env.rainAmount);
    this.updateMusic(dt);

    // underwater grade
    const headY = this.player.pos.y + 1.5;
    const under = headY < WORLD.waterLevel ? clamp01((WORLD.waterLevel - headY) / 1.4) : 0;
    this.render.setUnderwater(under);

    // ---- streaming / ui
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.1; this.updateHud(false); }
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) { this.mapTimer = 0.35; this.updateMinimap(); }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) { this.saveTimer = 90; this.saveGame(true); }

    this.checkQuestTriggers();
    this.updateInteractPrompt();

    this.render.render(dt, this.time);
    input.endFrame();
  }

  /* -------------------------------------------------------------- spawning */

  private updateSpawns(dt: number) {
    const p = this.player.pos;
    for (const r of this.records) {
      const k = r.point.kind;
      if (k !== 'enemy' && k !== 'npc' && k !== 'boss') continue;
      const d = Math.hypot(r.point.pos.x - p.x, r.point.pos.z - p.z);
      if (r.dead) {
        r.respawn -= dt;
        if (r.respawn <= 0) r.dead = false;
        continue;
      }
      if (!r.ent) {
        const range = k === 'npc' ? ACTIVATE_NPC : ACTIVATE_ENEMY;
        if (d > range) continue;
        if (k === 'npc' && this.npcs.length > 14) continue;
        if (k !== 'npc' && this.enemies.length > 12) continue;
        this.activate(r);
      } else {
        const out = k === 'npc' ? DEACTIVATE_NPC : DEACTIVATE_ENEMY;
        if (d > out) this.deactivate(r);
      }
    }
  }

  private activate(r: SpawnRecord) {
    const s = r.point;
    if (s.kind === 'npc') {
      const role = (s.type ?? 'villager') as NpcRole;
      if (!NPC_DEFS[role]) return;
      const n = new Npc(this, role, s.pos.clone());
      n.data.role = role;
      this.npcs.push(n);
      this.entityGroup.add(n.root);
      r.ent = n;
    } else {
      const kind = (s.kind === 'boss' ? (s.type ?? 'heishan') : (s.type ?? 'bandit')) as EnemyKind;
      const lvl = Math.max(1, this.prog.stats.level + (s.kind === 'boss' ? 1 : Math.floor(Math.hypot(s.pos.x, s.pos.z) / 420)));
      const e = new Enemy(this, kind, s.pos.clone(), lvl);
      this.enemies.push(e);
      this.entityGroup.add(e.root);
      r.ent = e;
    }
  }

  private deactivate(r: SpawnRecord) {
    const e = r.ent;
    if (!e) return;
    if (e instanceof Enemy) {
      if (e.aggroed && e.alive) return; // don't pop out while fighting
      this.releaseAttackToken(e);
      this.enemies = this.enemies.filter((x) => x !== e);
    } else {
      this.npcs = this.npcs.filter((x) => x !== e);
    }
    this.entityGroup.remove(e.root);
    e.dispose();
    r.ent = null;
  }

  /* --------------------------------------------------------- combat helpers */

  getTargets(attacker: Entity, def: any): Entity[] {
    const out: Entity[] = [];
    if (attacker === (this.player as Entity)) {
      for (const e of this.enemies) if (e.alive) out.push(e);
      for (const n of this.npcs) if (n.alive && n.role !== 'dummy') out.push(n);
    } else {
      out.push(this.player as Entity);
    }
    return out;
  }

  requestAttackToken(e: Enemy): boolean {
    if (this.tokens.has(e)) return true;
    if (this.tokens.size >= 2) return false;
    this.tokens.add(e);
    return true;
  }

  releaseAttackToken(e: Enemy) {
    this.tokens.delete(e);
    if (e.attackToken) e.attackToken = false;
  }

  separationForce(e: Entity, radius: number): Vector3 {
    const f = this.tmp2.set(0, 0, 0);
    const list = e.faction === 'enemy' ? this.enemies : this.npcs;
    for (const o of list) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const r = radius + o.radius;
      if (d2 > r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (1 - d / r) * 2.2;
      f.x += (dx / d) * push;
      f.z += (dz / d) * push;
    }
    const dx = e.pos.x - this.player.pos.x, dz = e.pos.z - this.player.pos.z;
    const d2 = dx * dx + dz * dz;
    const r = radius + this.player.radius;
    if (d2 < r * r && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (1 - d / r) * 2.6;
      f.x += (dx / d) * push;
      f.z += (dz / d) * push;
    }
    return f;
  }

  spawnProjectile(o: {
    pos: Vector3; dir: Vector3; speed: number; life?: number; radius?: number;
    color?: number; damage?: number; source?: Entity | null; gravity?: number;
  }): Projectile {
    const mesh = new Mesh(
      new SphereGeometry(o.radius ?? 0.18, 8, 6),
      new MeshStandardMaterial({
        color: o.color ?? 0x88e0ff, emissive: o.color ?? 0x88e0ff,
        emissiveIntensity: 2.2, roughness: 0.4,
      }),
    );
    mesh.position.copy(o.pos);
    this.scene.add(mesh);
    const p: Projectile = {
      pos: o.pos.clone(),
      vel: o.dir.clone().normalize().multiplyScalar(o.speed),
      life: o.life ?? 3,
      radius: o.radius ?? 0.18,
      damage: o.damage ?? 10,
      source: o.source ?? null,
      mesh,
      color: o.color ?? 0x88e0ff,
      gravity: o.gravity ?? 0,
    };
    this.projectiles.push(p);
    return p;
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      let hit = false;
      // terrain
      if (p.pos.y < heightAt(p.pos.x, p.pos.z) + 0.12) {
        hit = true;
        this.vfx.burst(p.pos, new Color(p.color), 10, 3, 0.3, 0.4);
      }
      // entities
      if (!hit) {
        if (p.source && p.source !== (this.player as Entity) && p.source.faction !== 'player') {
          const d = this.player.pos.clone(); d.y += 0.9;
          if (d.distanceTo(p.pos) < p.radius + this.player.radius + 0.2) {
            this.player.takeDamage({
              amount: p.damage, source: p.source ?? undefined, from: p.pos.clone(),
              knockback: 2, poise: 12, type: 'physical',
            });
            hit = true;
          }
        } else {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const c = e.pos.clone(); c.y += 0.9;
            if (c.distanceTo(p.pos) < p.radius + e.radius + 0.25) {
              e.takeDamage({
                amount: p.damage, source: this.player as Entity, from: p.pos.clone(),
                knockback: 2, poise: 14, type: 'physical',
              });
              hit = true;
              break;
            }
          }
        }
      }
      if (hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as MeshStandardMaterial).dispose();
        p.mesh.geometry.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  findLockTarget(pos: Vector3, yaw: number, range = 16): Entity | null {
    let best: Entity | null = null;
    let bestScore = 1e9;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = (dx / (d || 1)) * fx + (dz / (d || 1)) * fz;
      if (dot < 0.25) continue;
      const score = d * (1.8 - dot);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  /* ------------------------------------------------------------- interaction */

  private interactTarget: { kind: 'npc' | 'chest' | 'node'; ref: any; label: string } | null = null;

  findInteractable(pos: Vector3): { kind: string; ref: any; label: string } | null {
    let best: any = null;
    let bestD = 3.4;
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const d = n.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = { kind: 'npc', ref: n, label: `Talk to ${n.name}` }; }
    }
    for (const c of this.chests) {
      if (c.opened) continue;
      const d = c.pos.distanceTo(pos);
      if (d < Math.min(2.6, bestD)) { bestD = d; best = { kind: 'chest', ref: c, label: 'Open chest' }; }
    }
    for (const n of this.nodes) {
      if (n.depleted > 0) continue;
      const d = n.pos.distanceTo(pos);
      if (d < Math.min(2.4, bestD)) { bestD = d; best = { kind: 'node', ref: n, label: n.kind === 'herb' ? 'Gather herb' : 'Mine ore' }; }
    }
    return best;
  }

  private updateInteractPrompt() {
    const t = this.findInteractable(this.player.pos);
    this.interactTarget = t as any;
    if (t) useGame.getState().setInteract({ label: t.label, key: 'E' });
    else useGame.getState().setInteract(null);
  }

  tryInteract() {
    const t = this.interactTarget ?? this.findInteractable(this.player.pos);
    if (!t) return;
    this.audio.play('uiClick');
    if (t.kind === 'npc') this.openDialogue(t.ref as Npc);
    else if (t.kind === 'chest') this.openChest(t.ref as Chest);
    else if (t.kind === 'node') this.gatherNode(t.ref as ResNode);
  }

  openDialogue(npc: Npc) {
    if (npc.role === 'dummy') {
      toast('The post creaks. It has heard worse.', 'npc');
      return;
    }
    this.dialogueNpc = npc;
    const node = buildDialogue(npc, this);
    npc.npcState = 'talk';
    useGame.getState().setDialogue({
      speaker: node.speaker, text: node.text,
      options: node.options.map((o) => ({ text: o.text, action: o.action ?? 'close', data: o.data })),
    });
    input.releaseLock();
    this.audio.play('uiClick');
  }

  chooseDialogue(opt: { text: string; action: string; data?: any }) {
    const npc = this.dialogueNpc;
    const st = useGame.getState();
    switch (opt.action) {
      case 'close':
        st.setDialogue(null);
        this.dialogueNpc = null;
        break;
      case 'quest:accept':
        this.quests.start(opt.data);
        st.setDialogue(null);
        this.dialogueNpc = null;
        this.refreshQuestUI();
        break;
      case 'quest:complete':
        this.quests.complete(opt.data);
        st.setDialogue(null);
        this.dialogueNpc = null;
        this.refreshQuestUI();
        break;
      case 'shop':
        this.shopNpc = npc;
        st.setDialogue(null);
        this.openShop(npc!);
        break;
      case 'lore': {
        const lines = (window as any).__LORE ?? null;
        st.setDialogue({
          speaker: npc?.name ?? 'Stranger',
          text: this.randomLore(),
          options: [{ text: 'Tell me more.', action: 'lore' }, { text: 'Farewell.', action: 'close' }],
        });
        break;
      }
      case 'hint':
        st.setDialogue({
          speaker: npc?.name ?? 'Stranger', text: opt.data,
          options: [{ text: 'I will look.', action: 'close' }],
        });
        break;
      case 'rest': {
        st.setDialogue(null);
        this.dialogueNpc = null;
        const hours = (6 + ((24 - this.env.timeOfDay + 7) % 24)) % 24;
        this.env.setTimeOfDay((this.env.timeOfDay + 6) % 24);
        this.player.hp = this.prog.stats.maxHp;
        this.player.stamina = this.prog.stats.maxStamina;
        this.player.qi = this.prog.stats.maxQi;
        toast('You rest. Dawn finds you whole.', 'good');
        this.audio.play('heal');
        this.saveGame(true);
        break;
      }
      case 'train':
        st.setDialogue(null);
        this.dialogueNpc = null;
        st.setPanel('character');
        break;
      case 'free': {
        st.setDialogue(null);
        this.dialogueNpc = null;
        this.quests.report('free', 'prisoner', this.world.poiAt(npc.pos)?.id, 1);
        if (npc) { npc.say('Free! I owe you my life.'); npc.npcState = 'bow'; }
        break;
      }
      default:
        st.setDialogue(null);
        this.dialogueNpc = null;
    }
  }

  private loreIndex = 0;
  private randomLore() {
    const lines = [
      'They say Hei Shan was once a general who refused to surrender. The mountain took his name, and his mercy.',
      'Blackwood Camp sits on the old trade road. Nothing passes it untaxed these days.',
      'The monks of Cloudsea keep the pass. They open the gate for a friend of the abbot.',
      'Nine Heavens Pagoda — seven tiers, and something old sleeping on the top of it.',
      'A swordmaster once told me: strike only when the wind holds its breath.',
      'The hermit of the north ridge knows herbs. He knows other things too, but he will not say.',
      'Mind the mist on the high road. It hides more than rocks.',
      'Steel is cheap. A teacher is not.',
    ];
    this.loreIndex = (this.loreIndex + 1) % lines.length;
    return lines[this.loreIndex];
  }

  openShop(npc: Npc) {
    const stock = npc.shopStock();
    useGame.getState().setShop({
      npc: npc.name,
      items: stock.map((s) => {
        const def = ITEMS[s.id as keyof typeof ITEMS];
        return {
          id: s.id, name: def?.name ?? s.id, price: s.price,
          owned: this.prog.count(s.id), icon: def?.icon ?? '?', desc: def?.desc ?? '',
        };
      }),
    });
    useGame.getState().setPanel('shop');
    this.audio.play('uiClick');
  }

  buyItem(id: string, price: number) {
    if (this.prog.gold < price) { toast('Not enough coin.', 'bad'); this.audio.play('uiError'); return; }
    if (!this.prog.addItem(id, 1)) { toast('Your pack is full.', 'bad'); this.audio.play('uiError'); return; }
    this.prog.addGold(-price);
    this.audio.play('coin');
    toast(`Bought 1 × ${ITEMS[id as keyof typeof ITEMS]?.name ?? id}`, 'good');
    this.updateHud(true);
    if (this.shopNpc) this.openShop(this.shopNpc);
  }

  private openChest(c: Chest) {
    c.opened = true;
    this.audio.play('chest');
    const lid = (c.mesh as any).lid as Mesh | undefined;
    if (lid) lid.rotation.x = -1.1;
    let got: string[] = [];
    for (const l of c.loot) {
      if (Math.random() < l.chance) {
        const qty = l.min + Math.floor(Math.random() * (l.max - l.min + 1));
        if (this.prog.addItem(l.id, qty)) got.push(`${ITEMS[l.id as keyof typeof ITEMS]?.name ?? l.id} ×${qty}`);
      }
    }
    this.prog.addGold(c.gold);
    got.push(`${c.gold} gold`);
    const top = c.pos.clone(); top.y += 0.9;
    this.vfx.burst(top, '#ffd873', 22, 2.6, 0.3, 0.9, -3);
    this.vfx.ripple(top, 0.2, 2.2, 0.7, '#ffd873', 0.8);
    toast(got.join(', '), 'good');
    this.quests.report('collect', 'chest', this.world.poiAt(c.pos)?.id, 1);
    this.updateHud(true);
    this.saveGame(true);
  }

  private gatherNode(n: ResNode) {
    n.depleted = 180;
    n.mesh.visible = false;
    const id = n.kind === 'herb' ? 'herb' : 'ore';
    const qty = 1 + Math.floor(Math.random() * 2);
    this.prog.addItem(id, qty);
    this.audio.play('pickup');
    this.vfx.burst(n.pos.clone().add(new Vector3(0, 0.5, 0)), n.kind === 'herb' ? '#9fe07a' : '#b0a0c0', 12, 2, 0.25, 0.6);
    toast(`+${qty} ${ITEMS[id].name}`, 'good');
    this.quests.report('collect', id, this.world.poiAt(n.pos)?.id, qty);
    this.updateHud(true);
  }

  private updateChests(dt: number) {
    for (const n of this.nodes) {
      if (n.depleted > 0) {
        n.depleted -= dt;
        if (n.depleted <= 0) n.mesh.visible = true;
      }
    }
  }

  usePotion() {
    if (this.prog.count('potion') <= 0) { toast('No potions left.', 'warn'); return; }
    if (this.player.hp >= this.prog.stats.maxHp) { toast('Already at full health.', 'warn'); return; }
    this.prog.removeItem('potion', 1);
    this.player.heal(60);
    this.audio.play('heal');
    this.vfx.qi(this.player.pos.clone().add(new Vector3(0, 1, 0)), '#8ff0b0', 16, 2.2);
    this.updateHud(true);
  }

  /* -------------------------------------------------------------- inventory */

  equipItem(id: string) {
    const def = ITEMS[id as keyof typeof ITEMS];
    if (!def) return;
    const slot: 'weapon' | 'armor' | 'trinket' =
      def.kind === 'weapon' ? 'weapon' : def.kind === 'armor' ? 'armor' : 'trinket';
    if (this.prog.equipped[slot] === id) {
      this.prog.unequip(slot);
      this.player.refreshStats();
      toast(`Unequipped ${def.name}`, 'info');
    } else if (this.prog.equip(id)) {
      this.player.refreshStats();
      this.audio.play('draw');
      toast(`Equipped ${def.name}`, 'good');
    } else return;
    this.updateHud(true);
  }

  useItem(id: string) {
    const def = ITEMS[id as keyof typeof ITEMS];
    if (!def || def.kind !== 'consumable') return;
    if (this.prog.count(id) <= 0) return;
    let used = false;
    if (id === 'potion') { used = this.player.hp < this.prog.stats.maxHp; this.player.heal(60); }
    else if (id === 'bigPotion') { used = this.player.hp < this.prog.stats.maxHp; this.player.heal(150); }
    else if (id === 'staminaElixir') { used = true; this.player.stamina = this.prog.stats.maxStamina; }
    else if (id === 'jadePill') { used = true; this.player.qi = this.prog.stats.maxQi; }
    if (!used) { toast('No need of that just now.', 'warn'); return; }
    this.prog.removeItem(id, 1);
    this.audio.play('heal');
    this.vfx.qi(this.player.pos.clone().add(new Vector3(0, 1, 0)), '#8ff0b0', 14, 2);
    toast(`Used ${def.name}`, 'good');
    this.updateHud(true);
  }

  dropItem(id: string) {
    const def = ITEMS[id as keyof typeof ITEMS];
    if (!def || def.kind === 'quest') { toast('That cannot be discarded.', 'warn'); return; }
    if (this.prog.removeItem(id, 1)) {
      toast(`Dropped ${def.name}`, 'info');
      this.player.refreshStats();
      this.updateHud(true);
    }
  }

  /* ------------------------------------------------------------------ kills */

  onEnemyKilled(e: Enemy) {
    const rec = this.records.find((r) => r.ent === e);
    if (rec) { rec.dead = true; rec.respawn = 240; rec.ent = null; }
    this.releaseAttackToken(e);
    this.prog.addXp(e.xp);
    this.prog.addGold(e.goldValue);
    this.prog.kills[e.def.kind] = (this.prog.kills[e.def.kind] ?? 0) + 1;
    for (const l of e.def.loot ?? []) {
      if (Math.random() < (l.chance ?? 1)) {
        const qty = (l.min ?? 1) + Math.floor(Math.random() * ((l.max ?? 1) - (l.min ?? 1) + 1));
        this.prog.addItem(l.id, qty);
        toast(`Loot: ${ITEMS[l.id as keyof typeof ITEMS]?.name ?? l.id} ×${qty}`, 'good');
      }
    }
    this.quests.report('kill', e.def.kind, this.world.poiAt(e.pos)?.id, 1);
    if (e.def.kind === 'bandit' || e.def.kind === 'swordsman') this.prog.addItem('banditToken', 1);
    this.vfx.burst(e.pos.clone().add(new Vector3(0, 1, 0)), '#ffb066', 26, 3.4, 0.4, 1.0);
    this.audio.play('enemyDeath');
    if (e.bossBar) {
      useGame.getState().setBoss(null);
      this.audio.setMusic('explore');
      this.combatMusic = 0;
      toast(`${e.name} falls. The mountain is quiet.`, 'good');
      this.saveGame(true);
    }
    this.updateHud(true);
    this.refreshQuestUI();
  }

  despawnEnemy(e: Enemy) {
    this.enemies = this.enemies.filter((x) => x !== e);
    this.entityGroup.remove(e.root);
    const rec = this.records.find((r) => r.ent === e);
    if (rec) rec.ent = null;
    e.dispose();
  }

  onBossEngaged(e: Enemy) {
    if (!e) return;
    useGame.getState().setBoss({
      name: e.name, nameCN: e.nameCN, hp: e.hp, maxHp: e.maxHp, phase: e.phase + 1,
    });
    this.audio.setMusic('boss');
    this.audio.play('bossRoar');
    this.vfx.shake(0.8);
    this.render.flash(new Color(0x882222), 0.35);
    toast(`${e.name} — ${e.nameCN}`, 'bad');
  }

  /* ------------------------------------------------------------------ quests */

  private questTimer = 0;
  private checkQuestTriggers() {
    this.questTimer -= 0.1;
    if (this.questTimer > 0) return;
    this.questTimer = 0.5;
    const poi = this.world.poiAt(this.player.pos);
    if (poi) {
      if (!poi.discovered) {
        poi.discovered = true;
        toast(`Discovered: ${poi.name} ${poi.nameCN}`, 'quest');
        this.audio.play('quest');
      }
      this.quests.report('reach', poi.id, poi.id, 1);
      this.respawnPoint.copy(poi.pos);
    }
  }

  refreshQuestUI() {
    const act = this.quests.activeQuests();
    const trackers = act.slice(0, 3).map(({ def, state }) => ({
      questId: def.id, name: def.name, nameCN: def.nameCN, main: def.main,
      objectives: def.objectives.map((o, i) => ({
        text: o.text, value: Math.min(state.progress[i] ?? 0, o.count), need: o.count,
        done: (state.progress[i] ?? 0) >= o.count,
      })),
    }));
    useGame.getState().setTrackers(trackers);
    useGame.getState().setQuestLog(act.map((a) => ({ def: a.def, state: a.state })));
  }

  /* ------------------------------------------------------------------- hud */

  updateHud(force = false) {
    const s = this.prog.stats;
    const st = useGame.getState();
    const poi = this.world.poiAt(this.player.pos) ?? this.world.nearestPOI(this.player.pos);
    st.setHud({
      hp: Math.max(0, Math.round(this.player.hp)),
      maxHp: Math.round(s.maxHp),
      stamina: Math.round(this.player.stamina),
      maxStamina: Math.round(s.maxStamina),
      qi: Math.round(this.player.qi),
      maxQi: Math.round(s.maxQi),
      xp: s.xp, xpNext: s.xpNext, level: s.level,
      gold: this.prog.gold,
      potions: this.prog.count('potion'),
      skillPoints: s.skillPoints,
      weapon: ITEMS[this.prog.equipped.weapon as keyof typeof ITEMS]?.name ?? 'Bare hands',
      armor: ITEMS[this.prog.equipped.armor as keyof typeof ITEMS]?.name ?? 'Traveller Robe',
      time: this.env.timeString(),
      weather: this.env.weather,
      location: poi ? poi.name : 'The wilds',
      fps: Math.round(this.render.fps),
      drawCalls: this.render.drawCalls,
      tris: this.render.triangles,
    });
    const boss = useGame.getState().boss;
    if (boss) {
      const e = this.enemies.find((x) => x.bossBar && x.alive);
      if (e) useGame.getState().setBoss({ ...boss, hp: Math.max(0, e.hp), maxHp: e.maxHp, phase: e.phase + 1 });
      else useGame.getState().setBoss(null);
    }
  }

  private updateMinimap() {
    const p = this.player.pos;
    const st = useGame.getState();
    const pois = this.world.pois.filter((q) => q.discovered || Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < 260)
      .map((q) => ({ id: q.id, x: q.pos.x, z: q.pos.z, name: q.name, type: q.type }));
    const enemies = this.enemies.filter((e) => e.alive && e.flatDistanceTo(p) < 120)
      .map((e) => ({ x: e.pos.x, z: e.pos.z, hostile: e.aggroed }));
    const npcs = this.npcs.filter((n) => n.alive && n.flatDistanceTo(p) < 120).map((n) => ({ x: n.pos.x, z: n.pos.z }));
    const quests: { x: number; z: number }[] = [];
    for (const { def, state } of this.quests.activeQuests()) {
      const o = def.objectives[state.objIndex];
      if (!o) continue;
      const target = this.world.pois.find((q) => q.id === o.target);
      if (target) quests.push({ x: target.pos.x, z: target.pos.z });
    }
    st.setMinimap({ x: p.x, z: p.z, yaw: this.player.yaw, pois, enemies, npcs, quests });
  }

  private updateMusic(dt: number) {
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.5;
    let threat = 0, boss = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.flatDistanceTo(this.player.pos);
      if (d < 26 && e.aggroed) { threat++; if (e.bossBar) boss = true; }
    }
    this.combatMusic = threat > 0 ? 6 : Math.max(0, this.combatMusic - 0.5);
    const st = useGame.getState().screen;
    if (st !== 'playing') return;
    if (boss) this.audio.setMusic('boss');
    else if (this.combatMusic > 0) this.audio.setMusic('combat');
    else this.audio.setMusic('explore');
  }

  /* ------------------------------------------------------------------- save */

  serialize() {
    return {
      version: 1,
      meta: {
        slot: this.slot,
        time: Date.now(),
        level: this.prog.stats.level,
        gold: this.prog.gold,
        location: this.world.poiAt(this.player.pos)?.name ?? 'The wilds',
        playTime: Math.round(this.playTime),
        quest: this.quests.activeQuests()[0]?.def.name ?? '—',
      },
      player: {
        pos: [this.player.pos.x, this.player.pos.y, this.player.pos.z],
        yaw: this.player.yaw,
        hp: this.player.hp,
        respawn: [this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.z],
      },
      prog: this.prog.serialize(),
      quests: this.quests.serialize(),
      world: {
        timeOfDay: this.env.timeOfDay,
        weather: this.env.weather,
        openedChests: this.chests.filter((c) => c.opened).map((c) => c.id),
      },
      deaths: this.deaths,
    };
  }

  async saveGame(auto = false) {
    if (!this.started) return;
    const data = this.serialize();
    try {
      await saves.save(this.slot, data);
      if (!auto) toast('Game saved.', 'good');
    } catch (e) {
      console.warn('save failed', e);
      if (!auto) toast('Could not save.', 'bad');
    }
  }

  async loadGame(slot: number) {
    const d = await saves.load(slot);
    if (!d) return false;
    this.slot = slot;
    this.prog.load(d.prog ?? {});
    this.quests.load(d.quests ?? {});
    this.deaths = d.deaths ?? 0;
    this.playTime = d.meta?.playTime ?? 0;
    if (d.world) {
      if (typeof d.world.timeOfDay === 'number') this.env.setTimeOfDay(d.world.timeOfDay);
      if (d.world.weather) this.env.setWeather(d.world.weather, true);
      const opened: number[] = d.world.openedChests ?? [];
      for (const c of this.chests) {
        if (opened.includes(c.id)) {
          c.opened = true;
          const lid = (c.mesh as any).lid as Mesh | undefined;
          if (lid) lid.rotation.x = -1.1;
        }
      }
    }
    const p = d.player?.pos;
    if (p) {
      this.player.pos.set(p[0], p[1], p[2]);
      this.player.spawnAt(new Vector3(p[0], p[1], p[2]), d.player.yaw ?? 0);
      if (d.player.respawn) this.respawnPoint.set(d.player.respawn[0], d.player.respawn[1], d.player.respawn[2]);
    }
    this.player.hp = d.player?.hp ?? this.prog.stats.maxHp;
    this.player.refreshStats();
    this.updateHud(true);
    this.refreshQuestUI();
    return true;
  }

  respawn() {
    const g = findStableGround(this.respawnPoint.x, this.respawnPoint.z, 40);
    const p = g ? new Vector3(g.x, g.y, g.z) : this.respawnPoint.clone();
    this.player.hp = this.prog.stats.maxHp;
    this.player.stamina = this.prog.stats.maxStamina;
    this.player.qi = this.prog.stats.maxQi;
    this.player.spawnAt(p, this.player.yaw);
    this.player.alive = true;
    useGame.getState().setScreen('playing');
    this.audio.setMusic('explore');
    toast('You rise again.', 'good');
    this.updateHud(true);
  }

  /** Wipe progress and begin a fresh journey on the already-built world. */
  newGame() {
    for (const e of [...this.enemies]) this.despawnEnemy(e);
    for (const n of [...this.npcs]) { this.entityGroup.remove(n.root); n.dispose(); }
    this.npcs = [];
    for (const r of this.records) { r.ent = null; r.dead = false; r.respawn = 0; }
    for (const c of this.chests) {
      c.opened = false;
      const lid = (c.mesh as any).lid as Mesh | undefined;
      if (lid) lid.rotation.x = 0;
    }
    for (const n of this.nodes) { n.depleted = 0; n.mesh.visible = true; }
    for (const q of this.world.pois) q.discovered = false;
    this.prog = new Progression();
    this.player.prog = this.prog;
    this.quests = new QuestSystem(this);
    this.deaths = 0;
    this.playTime = 0;
    this.slot = 0;
    this.tokens.clear();
    this.projectiles.forEach((p) => { this.scene.remove(p.mesh); });
    this.projectiles = [];
    this.env.setTimeOfDay(7.4);
    this.env.setWeather('clear', true);
    this.player.refreshStats();
    this.player.spawnAt(this.world.startPos.clone(), Math.PI);
    this.respawnPoint.copy(this.world.startPos);
    this.updateHud(true);
    this.refreshQuestUI();
    toast('A new journey begins.', 'quest');
  }

  /* -------------------------------------------------------------- settings */

  applySettings(s: {
    quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'; music: number; sfx: number;
    sensitivity: number; invertY: boolean; showFps: boolean; autoQuality: boolean;
  }) {
    this.render.setQuality(s.quality);
    this.render.adaptive = s.autoQuality;
    this.env.setQuality();
    this.water.setQuality(this.render.quality.waterSegments ?? 128);
    this.audio.setVolumes(s.music, s.sfx);
    input.sensitivity = s.sensitivity;
    input.invertY = s.invertY;
    useGame.getState().setSettings({ showFps: s.showFps });
    saves.saveSettings(s);
  }

  /** Learn a skill node; returns true when learned. */
  learnSkill(id: string): boolean {
    const def = SKILLS.find((s) => s.id === id);
    if (!def) return false;
    if (this.prog.has(id)) return false;
    for (const r of def.requires) if (!this.prog.has(r)) { toast('Prerequisites not met.', 'warn'); return false; }
    if (this.prog.stats.skillPoints < def.cost) { toast('Not enough skill points.', 'warn'); return false; }
    if (!this.prog.learn(id)) return false;
    const map: Record<string, string> = {
      lightness: 'lightness', doublejump: 'doublejump', shadowless: 'shadowless',
      qiMaster: 'qiMaster', mastery: 'mastery', counterMaster: 'counterMaster', bladestorm: 'bladestorm',
    };
    if (map[id]) {
      this.player.skills.add(map[id]);
      if (id === 'lightness') this.player.skills.add('glide');
    }
    this.player.refreshStats();
    this.audio.play('levelup');
    toast(`Learned: ${def.name} ${def.nameCN}`, 'good');
    this.updateHud(true);
    return true;
  }
}

export const game = new Game();
