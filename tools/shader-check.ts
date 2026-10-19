import './dom-shim';
import { FogExp2 } from 'three';
import { parser } from '@shaderfrog/glsl-parser';
import { Scene, PerspectiveCamera } from 'three';
import { QUALITY } from '../src/game/render/Renderer';
import { Water, makeWaterfallMaterial } from '../src/game/render/Water';
import { Environment } from '../src/game/render/Environment';
import { Terrain } from '../src/game/world/Terrain';
import { Vegetation } from '../src/game/world/Vegetation';
import { VFX } from '../src/game/VFX';
import { GradeShader } from '../src/game/render/Renderer';
import { Actor } from '../src/game/character/Actor';

const shaders: { name: string; vs?: string; fs?: string }[] = [];
const add = (name: string, mat: any) => {
  if (!mat || (!mat.vertexShader && !mat.fragmentShader)) return;
  shaders.push({ name, vs: mat.vertexShader, fs: mat.fragmentShader });
};

const scene = new Scene();
scene.fog = new FogExp2(0x9fb0be, 0.0012);
const fake: any = {
  camera: new PerspectiveCamera(), scene, quality: QUALITY.MEDIUM,
  renderer: { setClearColor() {}, getPixelRatio: () => 1, shadowMap: {}, info: { render: { calls: 0, triangles: 0 } } },
  setUnderwater() {}, flash() {},
};
// pull materials out of the real systems
const water = new Water(scene);
add('water', water.material);
add('waterfall', (makeWaterfallMaterial() as any).material ?? makeWaterfallMaterial());
const env = new Environment(scene, fake);
env.setQuality();
env.setTimeOfDay(9);
env.setWeather('rain', true);
scene.traverse((o: any) => { if (o.material) add('env:' + (o.name || o.type), o.material); });
const terrain = new Terrain();
add('terrain', terrain.material);
const veg = new Vegetation();
veg.group.traverse((o: any) => { if (o.material) add('veg:' + (o.name || o.type), o.material); });
const vfx = new VFX(scene);
scene.traverse((o: any) => { if (o.material && o.material.isShaderMaterial) add('vfx:' + (o.name || o.type), o.material); });

add('grade', GradeShader as any);
const actor = new Actor({}, { weapon: 'jian' });
actor.root.traverse((o: any) => { if (o.material) add('actor:' + (o.name || o.type), o.material); });

let bad = 0, checked = 0;
const strip = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
for (const s of shaders) {
  for (const [kind, src] of [['vert', s.vs], ['frag', s.fs]] as any) {
    if (!src) continue;
    checked++;
    try {
      parser.parse(strip(src), { quiet: true });
    } catch (e: any) {
      bad++;
      const line = e?.location?.start?.line;
      console.log(`FAIL ${s.name} ${kind}${line ? ` (line ${line})` : ''}: ${String(e.message).split('\n')[0]}`);
      if (line) {
        const arr = strip(src).split('\n');
        for (let i = Math.max(0, line - 3); i < Math.min(arr.length, line + 2); i++) console.log(`   ${i + 1}| ${arr[i]}`);
      }
    }
  }
}
console.log(`\nchecked ${checked} shader stages across ${shaders.length} materials — ${bad} syntax error(s)`);
