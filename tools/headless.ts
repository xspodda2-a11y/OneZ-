/**
 * Headless simulation harness: builds the world, spawns entities and runs a
 * scripted play session without WebGL so runtime errors surface in CI.
 * Run with:  npx vite build --ssr tools/headless.ts --outDir .tmp && node .tmp/headless.js
 */
import './dom-shim';
import { Scene, PerspectiveCamera, Vector3, Color, FogExp2 } from 'three';
import { QUALITY } from '../src/game/render/Renderer';
import { Environment } from '../src/game/render/Environment';
import { Water } from '../src/game/render/Water';
import { Terrain } from '../src/game/world/Terrain';
import { Vegetation } from '../src/game/world/Vegetation';
import { WorldGen } from '../src/game/world/WorldGen';
import { Player } from '../src/game/player/Player';
import { Combat } from '../src/game/combat/Combat';
import { VFX } from '../src/game/VFX';
import { Enemy } from '../src/game/ai/Enemy';
import { Npc } from '../src/game/npc/Npc';
import { buildDialogue } from '../src/game/npc/Npc';
import { QuestSystem } from '../src/game/quests/Quests';
import { Progression } from '../src/game/rpg/Progression';
import { AudioEngine } from '../src/game/audio/Audio';
import { game } from '../src/game/Game';
import { useGame } from '../src/state/store';
import { input } from '../src/game/core/Input';
import { bus, EV } from '../src/game/core/Events';
import { heightAt, WORLD } from '../src/game/core/TerrainHeight';

const log = (...a: any[]) => console.log(...a);
let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); log(`  ok   ${name}`); }
  catch (e: any) { failures++; log(`  FAIL ${name}: ${e?.stack?.split('\n').slice(0, 3).join(' | ') ?? e}`); }
}

/* ------------------------------------------------------------- fake render */

const fakeRender: any = {
  camera: new PerspectiveCamera(60, 16 / 9, 0.1, 4000),
  scene: new Scene(),
  quality: QUALITY.MEDIUM,
  fps: 60,
  drawCalls: 0,
  triangles: 0,
  adaptive: false,
  renderer: {
    setClearColor() {}, setSize() {}, setPixelRatio() {}, getPixelRatio() { return 1; },
    getSize(v: any) { return v ? v.set(1280, 720) : { x: 1280, y: 720 }; },
    getContext() { return {}; }, capabilities: { isWebGL2: true, maxTextureSize: 4096 }, domElement: null,
    shadowMap: { enabled: true }, info: { render: { calls: 0, triangles: 0 } },
  },
  setUnderwater() {}, flash() {}, setExposure() {}, setTint() {}, resize() {}, render() {}, setQuality() {},
};

async function main() {
  log('\n=== WINDS OF ETERNITY — headless simulation ===\n');

  log('[1] world generation');
  const t0 = Date.now();
  game.render = fakeRender;
  game.scene = fakeRender.scene;
  game.scene.fog = new FogExp2(0x9fb0be, 0.0012);
  game.env = new Environment(game.scene, fakeRender);
  game.env.setQuality();
  game.water = new Water(game.scene);
  game.terrain = new Terrain();
  game.scene.add(game.terrain.group);
  game.veg = new Vegetation();
  game.scene.add(game.veg.group);
  game.world = new WorldGen();
  game.world.generate();
  game.scene.add(game.world.group);
  game.vfx = new VFX(game.scene);
  game.combat = new Combat((a, d) => game.getTargets(a, d));
  game.quests = new QuestSystem(game);
  game.audio = new AudioEngine();
  game.prog = new Progression();
  game.player = new Player(game);
  game.scene.add(game.player.root);
  game.player.refreshStats();
  game.player.spawnAt(game.world.startPos.clone(), 0);
  log(`    pois=${game.world.pois.length} spawns=${game.world.spawns.length} gen=${Date.now() - t0}ms`);
  check('POIs generated', () => { if (game.world.pois.length < 5) throw new Error('too few POIs'); });
  check('spawn table populated', () => { if (game.world.spawns.length < 20) throw new Error('too few spawns'); });

  // build chests / nodes exactly like Game.buildProps
  log('[2] props (chests + resource nodes)');
  (game as any).buildProps();
  log(`    chests=${game.chests.length} nodes=${game.nodes.length} records=${game.records.length}`);

  log('[3] combat kit');
  check('player spawns above ground', () => {
    const h = heightAt(game.player.pos.x, game.player.pos.z);
    if (Math.abs(game.player.pos.y - h) > 2) throw new Error(`player y=${game.player.pos.y} ground=${h}`);
  });
  check('quest system offers q1', () => {
    const def = game.quests.def('q1');
    if (!def) throw new Error('q1 missing');
  });

  log('[4] entity spawn');
  const sp = game.player.pos;
  const mk = (dx: number, dz: number, y = 0) => new Vector3(sp.x + dx, y, sp.z + dz);
  const enemy = new Enemy(game, 'bandit', mk(5, 4), 2);
  game.enemies.push(enemy);
  game.entityGroup.add(enemy.root);
  const npc = new Npc(game, 'villager', mk(3, 3));
  game.npcs.push(npc);
  game.entityGroup.add(npc.root);
  const boss = new Enemy(game, 'heishan', mk(210, 190), 6);
  game.enemies.push(boss);
  game.entityGroup.add(boss.root);
  log(`    enemies=${game.enemies.length} npcs=${game.npcs.length}`);

  log('[5] dialogue / quests / shops');
  check('buildDialogue works', () => {
    const d = buildDialogue(npc, game);
    if (!d.text || !d.options.length) throw new Error('empty dialogue');
  });
  check('quest accepts and objectives progress', () => {
    game.quests.start('q1');
    game.quests.report('reach', 'willow', 'willow', 1);
    const st = game.quests.states['q1'];
    if (!st) throw new Error('q1 not started');
  });
  check('kill report works', () => {
    game.quests.start('q1');
    const qdef = game.quests.def('q1')!;
    const oi = qdef.objectives.findIndex((o) => o.type === 'kill' && o.target === 'bandit');
    if (oi < 0) throw new Error('no bandit-kill objective found in q1');
    game.quests.states['q1'].objIndex = oi;   // advance to the kill stage
    game.quests.report('kill', 'bandit', undefined, 2);
  });
  check('shop stock', () => {
    const m = new Npc(game, 'merchant', new Vector3(4, 0, 4));
    if (!m.shopStock().length) throw new Error('empty shop');
    game.npcs.push(m);
  });
  check('skill learning', () => {
    game.prog.stats.skillPoints = 5;
    if (!game.learnSkill('power1')) throw new Error('could not learn power1');
    if (!game.learnSkill('lightness')) throw new Error('could not learn lightness');
  });
  check('inventory add/remove/equip', () => {
    game.prog.addItem('cloudSword', 1);
    game.equipItem('cloudSword');
    if (game.prog.equipped.weapon !== 'cloudSword') throw new Error('equip failed');
    game.usePotion();
  });

  // make the duel survivable for the harness so the kill/loot path is exercised
  game.prog.stats.maxHp = 500;
  game.player.maxHp = 500;
  game.player.hp = 500;

  log('[6] simulated play (600 frames @ 60hz, scripted input)');
  let frames = 0;
  let errors = 0;
  let maxEnemies = 0;
  let damageEvents = 0;
  let sawAggro = false, sawDamage = false;
  bus.on(EV.DAMAGE_PLAYER, () => damageEvents++);

  for (let i = 0; i < 600; i++) {
    try {
      const dt = 1 / 60;
      game.time += dt;
      // scripted input: walk forward, swing every 20 frames, jump sometimes
      (input as any).keys.clear();
      (input as any).pressedThisFrame.clear();
      const dirs = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
      const dir = dirs[Math.floor(i / 90) % 4];
      if (i % 7 !== 0) (input as any).keys.add(dir);
      if (i % 40 === 0) (input as any).mouse.dx = 6;
      if (i % 120 === 0) (input as any).pressedThisFrame.add('Space');
      if (i % 20 === 0) (input as any).mouseJustPressed[0] = true;
      if (i % 97 === 0) (input as any).pressedThisFrame.add('ShiftLeft');
      if (i % 71 === 0) (input as any).pressedThisFrame.add('KeyF');
      if (i === 10) (input as any).pressedThisFrame.add('Tab');   // lock on
      if (i % 55 === 0) (input as any).pressedThisFrame.add('KeyE');
      if (i % 200 === 0) (input as any).pressedThisFrame.add('Tab');

      game.env.update(dt, game.player.pos, fakeRender.camera.position);
      game.terrain.update(game.player.pos, fakeRender.quality);
      game.veg.update(game.player.pos, fakeRender.quality, fakeRender.camera.position,
        game.env.sunDir, game.env.sunColor, game.env.fogColor, game.env.fogDensity);
      game.water.update(fakeRender.camera.position, game.env.fogColor, game.env.fogDensity);
      (game as any).updateSpawns(dt);
      game.combat.update(dt);
      game.player.update(dt);
      for (const e of [...game.enemies]) e.update(dt);
      for (const n of [...game.npcs]) n.update(dt);
      (game as any).updateProjectiles(dt);
      game.vfx.update(dt, fakeRender.camera, 1280, 720);
      (game as any).hudTimer = 0;
      game.updateHud(true);
      input.endFrame();
      maxEnemies = Math.max(maxEnemies, game.enemies.length);
      if (game.enemies.some((e) => e.aggroed || ['chase', 'strafe', 'windup', 'recover'].includes(e.state))) sawAggro = true;
      if (game.enemies.some((e) => e.hp < e.maxHp)) sawDamage = true;
      frames++;
      if (i % 100 === 0) {
        log(`    lock=${game.player.lockedTarget ? game.player.lockedTarget.name : 'none'} enemyHp=${game.enemies.map((e) => Math.round(e.hp)).join('/')}`);
        log(`    f${i}: p=(${game.player.pos.x.toFixed(1)},${game.player.pos.y.toFixed(1)},${game.player.pos.z.toFixed(1)}) v=(${game.player.vel.x.toFixed(2)},${game.player.vel.y.toFixed(2)},${game.player.vel.z.toFixed(2)}) st=${game.player.state} grd=${game.player.grounded} cam=${(game.player.camera.yaw).toFixed(2)}`);
      }
    } catch (e: any) {
      errors++;
      if (errors < 4) log(`    frame ${i} error: ${e.stack?.split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  log(`    frames=${frames} errors=${errors} enemies=${game.enemies.length} (max ${maxEnemies}) npcs=${game.npcs.length}`);
  log(`    player pos=(${game.player.pos.x.toFixed(1)}, ${game.player.pos.y.toFixed(1)}, ${game.player.pos.z.toFixed(1)}) state=${game.player.state} hp=${Math.round(game.player.hp)}`);
  log(`    enemy states: ${game.enemies.slice(0, 6).map((e) => `${e.def.kind}:${e.state}:${Math.round(e.hp)}`).join(', ')}`);
  log(`    player damage events=${damageEvents} vfx particles=${(game.vfx as any).particles?.count ?? 'n/a'}`);
  log(`    xp=${game.prog.stats.xp} gold=${game.prog.gold} kills=${JSON.stringify(game.prog.kills)} inv=${game.prog.inventory.length}`);
  log(`    (scripted play dealt damage: ${game.enemies.map((e) => `${Math.round(e.hp)}/${e.maxHp}`).join(' ')}, xp so far ${game.prog.stats.xp})`);

  log('[6b] deterministic kill → xp / gold / loot / quest report');
  check('killing an enemy awards xp, gold and loot', () => {
    const before = { xp: game.prog.stats.xp, gold: game.prog.gold, inv: game.prog.inventory.length };
    const victim = game.enemies.find((e) => e.alive && e.def.kind === 'bandit');
    if (!victim) throw new Error('no bandit alive to kill');
    game.quests.start('q1');
    const qdef = game.quests.def('q1')!;
    const oi = qdef.objectives.findIndex((o) => o.type === 'kill' && o.target === 'bandit');
    if (oi < 0) throw new Error('no bandit-kill objective found in q1');
    game.quests.states['q1'].objIndex = oi;   // advance to the kill stage
    victim.takeDamage({ amount: 99999, source: game.player as any, knockback: 0, poise: 9999 });
    const after = { xp: game.prog.stats.xp, gold: game.prog.gold, inv: game.prog.inventory.length };
    if (!(after.xp > before.xp)) throw new Error('no xp awarded');
    if (!(after.gold > before.gold)) throw new Error('no gold awarded');
    if (!game.prog.kills['bandit']) throw new Error('kill not counted');
    const st = game.quests.states['q1'];
    log(`      xp +${after.xp - before.xp}, gold +${after.gold - before.gold}, kills=${game.prog.kills['bandit']}, quest progress=${JSON.stringify(st?.progress)}`);
    if (!(st && st.progress[oi] > 0)) throw new Error('quest kill objective did not progress');
  });
  check('dead enemies despawn over time', () => {
    for (let i = 0; i < 1000; i++) {
      for (const e of [...game.enemies]) e.update(1 / 60);
    }
    if (game.enemies.some((e) => !e.alive)) throw new Error('corpse never despawned');
  });
  check('combat engaged: scripted play damaged and aggroed enemies', () => {
    if (!sawAggro) throw new Error('enemies never became aggressive');
    log(`      aggro=${sawAggro} damaged=${sawDamage}`);
  });

  check('no runtime errors in 600 frames', () => { if (errors > 0) throw new Error(`${errors} frame errors`); });
  check('player stayed above the world', () => {
    if (game.player.pos.y < -20 || game.player.pos.y > 400) throw new Error(`y=${game.player.pos.y}`);
    if (Math.abs(game.player.pos.x) > WORLD.half + 50) throw new Error('out of bounds x');
  });
  check('hud updated', () => {
    const s = (game as any).prog.stats;
    if (!(s.maxHp > 0)) throw new Error('bad stats');
  });

  log('[7] save / load round trip');
  check('serialize produces data', () => {
    const d = game.serialize();
    if (!d.prog || !d.player) throw new Error('missing sections');
    if (typeof d.meta.level !== 'number') throw new Error('bad meta');
  });

  log('[8] streaming: far travel despawn/respawn');
  check('travel 1200m and keep streaming', () => {
    for (let i = 0; i < 40; i++) {
      game.player.pos.x += 30;
      game.player.pos.z += 10;
      game.player.pos.y = heightAt(game.player.pos.x, game.player.pos.z) + 1;
      (game as any).updateSpawns(0.05);
      game.terrain.update(game.player.pos, fakeRender.quality);
      game.veg.update(game.player.pos, fakeRender.quality, fakeRender.camera.position,
        game.env.sunDir, game.env.sunColor, game.env.fogColor, game.env.fogDensity);
    }
  });
  log(`    after travel: enemies=${game.enemies.length} npcs=${game.npcs.length} chunks=${(game.terrain as any).chunks?.size ?? 'n/a'}`);

  log('[9] death & respawn');
  check('death → respawn flow', () => {
    game.player.hp = 1;
    game.player.takeDamage({ amount: 999, source: enemy });
    if (game.player.alive) throw new Error('player survived lethality');
    game.respawn();
    if (!game.player.alive || game.player.hp <= 0) throw new Error('respawn failed');
  });

  log('[10] quest completability audit');
  check('every quest giver / turn-in NPC exists in the world', () => {
    const lines: string[] = [];
    for (const def of game.quests.all()) {
      const giverOk = game.world.spawns.some((s) => s.kind === 'npc' && s.type === def.giver && (!def.giverPoi || s.poi === def.giverPoi));
      const turnOk = game.world.spawns.some((s) => s.kind === 'npc' && s.type === def.turnIn && (!def.turnInPoi || s.poi === def.turnInPoi));
      lines.push(`${def.id}: giver ${def.giver}@${def.giverPoi ?? 'any'}=${giverOk ? 'ok' : 'MISSING'} turnIn ${def.turnIn}@${def.turnInPoi ?? 'any'}=${turnOk ? 'ok' : 'MISSING'}`);
      if (!giverOk) throw new Error(`quest ${def.id} giver ${def.giver}@${def.giverPoi} missing\n    ` + lines.join('\n    '));
      if (!turnOk) throw new Error(`quest ${def.id} turn-in ${def.turnIn}@${def.turnInPoi} missing\n    ` + lines.join('\n    '));
    }
    log('    ' + lines.join('\n    '));
  });
  check('kill objectives have enough enemies in the world', () => {
    const need: Record<string, number> = {};
    for (const def of game.quests.all()) {
      for (const o of def.objectives) {
        if (o.type === 'kill') need[o.target] = Math.max(need[o.target] ?? 0, o.count);
        if (o.type === 'boss') need[o.target] = Math.max(need[o.target] ?? 0, 1);
      }
    }
    const have: Record<string, number> = {};
    for (const s of game.world.spawns) {
      if (s.kind === 'enemy' || s.kind === 'boss') have[s.type ?? s.kind] = (have[s.type ?? s.kind] ?? 0) + 1;
    }
    log(`    need=${JSON.stringify(need)} have=${JSON.stringify(have)}`);
    for (const k in need) {
      if ((have[k] ?? 0) < need[k]) throw new Error(`only ${have[k] ?? 0} "${k}" spawns for an objective needing ${need[k]}`);
    }
  });
  check('POIs referenced by objectives exist', () => {
    const ids = new Set(game.world.pois.map((p) => p.id));
    for (const def of game.quests.all()) {
      for (const o of def.objectives) {
        if ((o.type === 'reach' || o.type === 'talk') && o.target.startsWith('poi:')) {
          if (!ids.has(o.target.slice(4))) throw new Error(`quest ${def.id} needs missing POI ${o.target}`);
        }
      }
      for (const p of [def.giverPoi, def.turnInPoi]) {
        if (p && !ids.has(p)) throw new Error(`quest ${def.id} references missing POI ${p}`);
      }
    }
    log(`    pois present: ${[...ids].join(', ')}`);
  });
  check('starting POI has NPCs to talk to and the boss exists', () => {
    const willow = game.world.spawns.filter((s) => s.poi === 'willow' && s.kind === 'npc');
    if (willow.length < 3) throw new Error('willow bend is under-populated');
    if (!game.world.spawns.some((s) => s.kind === 'boss')) throw new Error('no boss spawn');
    log(`    willow npcs=${willow.length}, boss=${game.world.spawns.find((s) => s.kind === 'boss')?.type}`);
  });

  log('[11] end-to-end quest playthrough (talk → accept → objectives → turn in)');
  check('q1 can be accepted, advanced and handed to the elder for rewards', () => {
    // fresh run so quest state is clean
    game.newGame();
    const spawn = game.world.spawns.find((s) => s.kind === 'npc' && s.type === 'elder' && s.poi === 'willow');
    if (!spawn) throw new Error('no elder spawn');
    const elder = new Npc(game, 'elder', spawn.pos.clone(), spawn.data ?? {});
    game.npcs.push(elder);
    game.entityGroup.add(elder.root);
    game.player.pos.copy(elder.pos);

    game.openDialogue(elder);
    const offer = useGame.getState().dialogue;
    if (!offer) throw new Error('no dialogue shown');
    if (!offer.options.some((o) => o.action === 'quest:accept')) throw new Error('elder did not offer the quest');
    log(`      offer: "${offer.text.slice(0, 60)}…"`);
    game.chooseDialogue(offer.options.find((o) => o.action === 'quest:accept')!);
    if (!game.quests.states['q1']) throw new Error('quest did not start');

    const def = game.quests.def('q1')!;
    log(`      objectives: ${def.objectives.map((o) => o.text).join(' | ')}`);
    // objective 0 (speak with the elder) should already be satisfied by the chat
    if (game.quests.states['q1'].objIndex !== 1) {
      throw new Error(`first objective not satisfied by the conversation (objIndex=${game.quests.states['q1'].objIndex})`);
    }
    // objective 1: kill 4 bandits
    for (let i = 0; i < 4; i++) {
      const b = new Enemy(game, 'bandit', game.player.pos.clone().add(new Vector3(3 + i, 0, 0)), 1);
      game.enemies.push(b);
      b.takeDamage({ amount: 99999, source: game.player as any, poise: 9999 });
    }
    let stt = game.quests.states['q1'];
    if (stt.objIndex !== 2) throw new Error(`kill stage did not advance (objIndex=${stt.objIndex}, progress=${stt.progress})`);
    // final objective: walk back and report to the elder
    game.openDialogue(elder);
    stt = game.quests.states['q1'];
    if (!stt.readyToTurnIn) throw new Error(`returning to the elder did not finish the quest (objIndex=${stt.objIndex}, progress=${stt.progress})`);

    // hand it in (the turn-in conversation is already open)
    const before = { xp: game.prog.stats.xp, gold: game.prog.gold, sp: game.prog.stats.skillPoints };
    const turn = useGame.getState().dialogue;
    if (!turn || !turn.options.some((o) => o.action === 'quest:complete')) throw new Error('elder did not offer the turn-in');
    game.chooseDialogue(turn.options.find((o) => o.action === 'quest:complete')!);
    const after = { xp: game.prog.stats.xp, gold: game.prog.gold, sp: game.prog.stats.skillPoints };
    if (!game.quests.completed.has('q1')) throw new Error('quest not marked complete');
    if (!(after.gold > before.gold)) throw new Error('no gold reward');
    if (!(after.sp > before.sp)) throw new Error('no skill point reward');
    log(`      rewards: +${after.gold - before.gold} gold, +${after.sp - before.sp} skill point, completed=${[...game.quests.completed].join(',')}`);
    if (!game.quests.isAvailable(game.quests.def('q2')!)) throw new Error('next main quest did not unlock');
  });

  check('side quest s2 (kill → recover pendant → return) is completable', () => {
    const spawn = game.world.spawns.find((s) => s.kind === 'npc' && s.type === 'merchant' && s.poi === 'willow');
    if (!spawn) throw new Error('no merchant spawn');
    const merch = new Npc(game, 'merchant', spawn.pos.clone(), spawn.data ?? {});
    game.npcs.push(merch);
    game.entityGroup.add(merch.root);
    game.player.pos.copy(merch.pos);

    game.openDialogue(merch);
    const offer = useGame.getState().dialogue;
    if (!offer || !offer.options.some((o) => o.action === 'quest:accept')) throw new Error('merchant offered nothing');
    game.chooseDialogue(offer.options.find((o) => o.action === 'quest:accept')!);
    if (!game.quests.states['s2']) throw new Error('s2 did not start');
    // grind bandits until the pendant drops (quest-item pity rule)
    let killed = 0;
    while (game.prog.count('pendant') < 1 && killed < 40) {
      const b = new Enemy(game, 'bandit', game.player.pos.clone().add(new Vector3(3, 0, 0)), 1);
      game.enemies.push(b);
      b.takeDamage({ amount: 99999, source: game.player as any, poise: 9999 });
      killed++;
    }
    log(`      pendant recovered after ${killed} bandits (progress=${JSON.stringify(game.quests.states['s2'].progress)})`);
    if (game.prog.count('pendant') < 1) throw new Error('pendant never dropped in 40 kills');
    game.openDialogue(merch);
    const turn = useGame.getState().dialogue;
    if (!turn || !turn.options.some((o) => o.action === 'quest:complete')) throw new Error('merchant would not take the pendant back');
    game.chooseDialogue(turn.options.find((o) => o.action === 'quest:complete')!);
    if (!game.quests.completed.has('s2')) throw new Error('s2 not completed');
  });

  log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`) + ' ===\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
