import './dom-shim';
import { Scene, PerspectiveCamera, Vector3, FogExp2 } from 'three';
import { QUALITY } from '../src/game/render/Renderer';
import { Environment } from '../src/game/render/Environment';
import { Terrain } from '../src/game/world/Terrain';
import { WorldGen } from '../src/game/world/WorldGen';
import { Player } from '../src/game/player/Player';
import { Combat } from '../src/game/combat/Combat';
import { VFX } from '../src/game/VFX';
import { QuestSystem } from '../src/game/quests/Quests';
import { AudioEngine } from '../src/game/audio/Audio';
import { game } from '../src/game/Game';
import { input } from '../src/game/core/Input';
import { physics } from '../src/game/core/Physics';
import { heightAt } from '../src/game/core/TerrainHeight';

const fakeRender: any = {
  camera: new PerspectiveCamera(60, 16 / 9, 0.1, 4000),
  scene: new Scene(),
  quality: QUALITY.MEDIUM,
  fps: 60, drawCalls: 0, triangles: 0, adaptive: false,
  renderer: {
    setClearColor() {}, setSize() {}, setPixelRatio() {}, getPixelRatio() { return 1; },
    shadowMap: {}, info: { render: { calls: 0, triangles: 0 } },
  },
  setUnderwater() {}, flash() {}, setExposure() {}, setTint() {}, resize() {}, render() {}, setQuality() {},
};

game.render = fakeRender;
game.scene = fakeRender.scene;
game.scene.fog = new FogExp2(0x9fb0be, 0.0012);
game.env = new Environment(game.scene, fakeRender);
game.env.setQuality();
game.terrain = new Terrain();
game.world = new WorldGen();
game.world.generate();
game.vfx = new VFX(game.scene);
game.combat = new Combat((a, d) => game.getTargets(a, d));
game.quests = new QuestSystem(game);
game.audio = new AudioEngine();
game.player = new Player(game);
game.scene.add(game.player.root);
game.player.refreshStats();
(game as any).buildProps();

function run(label: string, start: Vector3, keys: string[], frames: number) {
  game.player.spawnAt(start.clone(), 0);
  const p0 = game.player.pos.clone();
  for (let i = 0; i < frames; i++) {
    (input as any).keys.clear();
    (input as any).pressedThisFrame.clear();
    for (const k of keys) (input as any).keys.add(k);
    game.player.update(1 / 60);
    input.endFrame();
  }
  const p1 = game.player.pos.clone();
  const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  console.log(`${label}: moved ${dist.toFixed(2)}m  ${p0.x.toFixed(1)},${p0.z.toFixed(1)} -> ${p1.x.toFixed(1)},${p1.z.toFixed(1)}  state=${game.player.state} grounded=${game.player.grounded}`);
  return dist;
}

console.log('startPos', game.world.startPos.toArray().map((n) => n.toFixed(1)).join(','));
const near = physics.query(game.player.pos.x, game.player.pos.z, 3);
console.log('colliders within 3m of start:', near.length, near.slice(0, 4).map((c: any) => `${c.type}@${c.cx?.toFixed(1)},${c.cz?.toFixed(1)}`));

// open ground far from POIs
const open = new Vector3(0, 0, 0);
let found = null as Vector3 | null;
for (let r = 200; r < 900 && !found; r += 40) {
  for (let a = 0; a < 12; a++) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (physics.query(x, z, 6).length === 0 && heightAt(x, z) > 10 && heightAt(x, z) < 90) { found = new Vector3(x, 0, z); break; }
  }
}
if (found) {
  found.y = heightAt(found.x, found.z);
  console.log('open test spot', found.toArray().map((n) => n.toFixed(1)).join(','));
  run('open terrain W   ', found, ['KeyW'], 180);
  run('open terrain W+D ', found, ['KeyW', 'KeyD'], 180);
  run('open terrain S+A ', found, ['KeyS', 'KeyA'], 180);
}
run('village start W   ', game.world.startPos, ['KeyW'], 180);
run('village start W+D ', game.world.startPos, ['KeyW', 'KeyD'], 180);
run('village start S   ', game.world.startPos, ['KeyS'], 180);

// what is blocking?
const p = game.player.pos;
const list = (physics as any).query(p.x, p.z, 4) as any[];
console.log('blocking colliders near player:', list.map((c) => `${c.type} c=(${c.cx.toFixed(1)},${c.cy.toFixed(1)},${c.cz.toFixed(1)}) h=(${c.hx?.toFixed(2) ?? c.radius?.toFixed(2)},${c.hy?.toFixed(2) ?? c.halfHeight?.toFixed(2)},${c.hz?.toFixed(2) ?? '-'}) climb=${c.climbable}`));
