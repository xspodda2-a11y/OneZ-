# Asset Credits & Provenance

**Winds of Eternity · 永劫長風** ships **zero third-party art, audio, models, textures or fonts**.
Every pixel you see and every sound you hear is produced at runtime by the TypeScript in this
repository. This file records exactly where each thing comes from, and licences the libraries
that make it possible.

---

## 1. Everything in the game is procedural

| Asset class | Where it comes from | Source |
| --- | --- | --- |
| Terrain (mountains, valleys, lakes, riverbeds) | Fractal Brownian motion value noise + domain warping, evaluated on demand | `src/game/core/Noise.ts`, `TerrainHeight.ts` |
| Terrain meshes | Chunked LOD mesh builder with vertex colours from slope/altitude/moisture | `src/game/world/Terrain.ts`, `HeightMap.ts`, `Masks.ts` |
| Water (rivers, lakes, waterfalls) | Gerstner-wave vertex shader with fresnel + depth-fade; procedural waterfall scroll material | `src/game/render/Water.ts` |
| Sky, sun, moon, clouds, stars | Analytic sky shader with Rayleigh-ish gradient, sun disc, cloud fbm, night sky | `src/game/render/SkyShader.ts` |
| Weather (rain, snow, petals, fireflies, mist) | GPU point/line systems driven by instanced attributes, seeded per particle | `src/game/render/Environment.ts` |
| Trees, bamboo, pines, bushes, reeds, grass, flowers | Geometry built from primitives and merged per species; instanced with per-instance colour/scale/phase and a wind vertex shader | `src/game/world/Vegetation.ts` |
| Buildings, walls, roofs, bridges, docks, pagodas, statues, cave furniture | A procedural settlement generator that emits transformed primitives into merged, vertex-coloured meshes | `src/game/world/Structures.ts`, `MeshBuilder.ts`, `WorldGen.ts` |
| Character bodies (player, enemies, NPCs) | Bespoke skeleton + body-part geometry, merged into a single skinned mesh per character; materials carry skin/robe/trim/sash colours | `src/game/character/Skeleton.ts`, `Parts.ts`, `CharacterRig.ts`, `Weapons.ts`, `Cloth.ts` |
| Animations | Hand-authored keyframe curves (idle, walk, run, jump, fall, land, climb, swim, glide, attacks, blocks, parries, hit reactions, death, emotes) blended by a custom animator | `src/game/character/Clips.ts`, `Animator.ts` |
| Cloth (sashes, ribbons, capes, tassels) | Verlet-simulated camera-facing ribbons | `src/game/character/Cloth.ts` |
| Surface textures (wood grain, plaster, stone, roof tiles, fabric, paper, ground detail) | Painted into offscreen `<canvas>` 2D contexts at load time, then uploaded as `CanvasTexture` | `src/game/render/Textures.ts` |
| Particles, slashes, ripples, trails, damage numbers | Procedural point sprites + ring/crescent meshes built in code | `src/game/VFX.ts` |
| **Music** | Original adaptive score generated live: pentatonic (D) modal improvisation over a chord pad, with guqin-style pluck, erhu-style bow, dizi-style flute and taiko-style drum voices. Moods: menu, explore, combat, boss, sad | `src/game/audio/Audio.ts` |
| **Sound effects** | Every cue (swings, impacts, blocks, parries, footsteps on every surface, splashes, jumps, level-up, quest stingers, boss roar, thunder, UI clicks, coins, chests…) is synthesised from oscillators and noise buffers | `src/game/audio/Audio.ts` |
| Ambience | Wind, water and birdsong/insects scheduled procedurally from weather, time of day and proximity to water | `src/game/audio/Audio.ts` |
| Fonts | No webfonts are downloaded. The interface requests locally installed CJK serif families (`Songti SC`, `STSong`, `Noto Serif SC`, `Source Han Serif SC`) and falls back to `Georgia`/serif | `src/styles/ui.css` |
| UI ornament (panelling, seals, borders, minimap, realm chart) | CSS gradients/masks plus a canvas-rendered height-map chart | `src/styles/ui.css`, `src/ui/Map.tsx` |
| Writing (quests, dialogue, lore, item names) | Original prose written for this project | `src/game/quests/Quests.ts`, `src/game/npc/Npc.ts`, `src/game/rpg/Progression.ts` |

Nothing was scraped, extracted, ripped, downloaded or converted from another game, and no
generative-AI image or audio model was used to produce assets — the "AI" here is the
deterministic, seeded code in `src/`.

## 2. Determinism and originality

The world is generated from the fixed seed **`20241018`** (`WORLD.seed` in
`src/game/core/TerrainHeight.ts`) using a seeded PRNG (`makeRng`, a mulberry32 variant written
for this project). The same seed always produces the same mountains, the same villages and the
same loot tables, so the game is reproducible and no content is stored.

## 3. Third-party libraries (all MIT-licensed)

| Library | Version | Licence | Use |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | WebGL2 rendering, maths, geometry; post-processing addons (`EffectComposer`, `RenderPass`, `GTAOPass`, `UnrealBloomPass`, `OutputPass`, `ShaderPass`) |
| [React](https://github.com/facebook/react) | 19.3.1 | MIT | Interface components |
| [react-dom](https://github.com/facebook/react) | 19.3.1 | MIT | DOM rendering, server rendering in tests |
| [Zustand](https://github.com/pmndrs/zustand) | 5.0.15 | MIT | Game → UI state bridge |
| [GSAP](https://github.com/greensock/GSAP) | 3.15.0 | Standard "no charge" licence / MIT for core | Tweening helper (available to the UI layer) |
| [Vite](https://github.com/vitejs/vite) | 8.3.4 | MIT | Dev server and bundler |
| [TypeScript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 | Type checking |
| [@shaderfrog/glsl-parser](https://github.com/shaderfrog/glsl-parser) | 5.x | MIT | Dev-only: parses custom shaders in the test harness |

None of these libraries contribute artwork, audio or data to the game; they are engines and
tooling only. Their licences permit commercial and non-commercial redistribution, and this
project's MIT licence header applies to the original code in `src/`.

### Deliberate deviations from the suggested stack

- **Rapier** was replaced by `src/game/core/Physics.ts` — a purpose-built capsule controller
  (yaw-aligned boxes + vertical cylinders in a 32 m spatial grid) over the height field. For a
  single character controller plus static props it is faster, deterministic and adds ~0 kB
  instead of a WASM blob.
- **React Three Fiber** is not used; the renderer is driven directly by `src/game/Game.ts` and
  React is used only for the overlay UI. This keeps per-frame allocation out of React's hands.
- **Howler.js** is not used because there are no audio files to load; the whole score and SFX
  set is synthesised in `src/game/audio/Audio.ts`.
- **postprocessing** (pmndrs) is not used; the post stack is composed from three.js's own
  addon passes (GTAO → bloom → output → custom grade).

## 4. Attribution for ideas, not assets

The game is inspired by public-domain wuxia tropes and by the landscape tradition of Chinese
ink painting (shanshui), and by martial-arts cinema generally. No protected character, story,
logo, melody or artwork from any specific work is reproduced. Place names, item names and the
Chinese calligraphic labels are original compositions for this project.

## 5. Contributing assets

If you contribute, keep it procedural or bring an asset with a licence compatible with MIT
(CC0 / CC-BY / MIT / public domain) and add a row below.

| Asset | Author | Licence | Source |
| --- | --- | --- | --- |
| — | — | — | (no external assets yet) |
