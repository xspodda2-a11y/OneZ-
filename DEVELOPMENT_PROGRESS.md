# Development Progress — Winds of Eternity

Honest, working status log. Updated **2026-10-18**.

Current state: **the game is playable end-to-end.** The world generates, you can run, climb,
swim, fight, parry, level up, learn skills, talk to NPCs, accept and finish quests, buy and
equip gear, open chests, gather herbs, die and respawn, and save/load three slots. Everything
listed below exists in code and is executed by the test harnesses — there are no stubbed
features and no placeholder buttons.

---

## Milestones

### M1 — Foundation ✅
- Vite + TypeScript + React + three.js project, hot reload, strict-ish typecheck, production
  bundle (`npm run build` → ~1.15 MB / ~317 kB gzipped, almost all of it three.js).
- Core utilities: seeded PRNG, value/fbm noise, damping/clamping helpers, event bus, input
  system (keyboard, mouse with pointer lock, gamepad, rebindable actions).
- Height field as the single source of truth for the ground: `heightAt`, `terrainNormal`,
  `slopeAt`, `moistureAt`, `biomeAt`, `waterDepthAt`, `findStableGround`.
- Capsule physics: yaw-aligned boxes + vertical cylinders in a spatial grid, `resolveCapsule`,
  `supportHeight`, `raycast`, step-up and ground snapping.

### M2 — World ✅
- Chunked LOD terrain streaming (128 m chunks, 4 LOD tiers, per-quality radius, budgeted
  builds so a frame never stalls for more than a couple of chunk meshes).
- Instanced vegetation: 8 species × near/far pools + grass tufts, wind vertex shading, trunk
  colliders registered into physics, distance-scaled density.
- Procedural world generation: 13 points of interest placed on flat, dry sites (village,
  town, monastery, pagoda, bandit camp, arena, hermit hut, ruins, fishing dock, farm, two
  caverns, mountain shrine) plus painted dirt roads between them and a spawn table of
  enemies, NPCs, chests and resource nodes.
- 11 settlement builders that emit merged, vertex-coloured meshes (a whole village costs a
  handful of draw calls).

### M3 — Character & animation ✅
- Bespoke skeleton (48 bones), procedural body-part geometry merged into a single mesh per
  character, skinning, sockets for weapons and effects.
- 5 weapon types, scabbard/weapon swapping, Verlet cloth ribbons for sashes, capes and
  tassels.
- Custom animation system: ~30 hand-authored clips, layered locomotion (idle/walk/run/
  sprint/air/land/climb/swim/glide), additive overlays, combo-driven attack clips, hit
  reactions, death, emotes, footstep and whoosh events fired from clip timelines.

### M4 — Player & combat ✅
- Full character controller: walk/jog/sprint with stamina, jump, double jump (unlockable),
  air control, coyote time, glide, wall run on climbable geometry, ledge climbing, swimming
  and diving, water surface bobbing, footstep surfaces (dirt/stone/wood/water/snow).
- Third-person camera rig with collision, orbit damping, lock-on with target switching,
  combat framing, aim assist.
- Combat: 3-hit light chain, two heavy attacks, block with stamina drain and guard break,
  dodge rolls with i-frames, parry with a real timing window that opens a **counter finisher**,
  two qi specials (Whirlwind Lotus, Shadowless Step), poise/knockback/stagger, hitstop,
  weapon trails, screen shake, damage numbers, hit VFX.
- VFX library: particles, sparks, blood, dust, splashes, qi bursts, leaves, slash arcs,
  ripples, telegraphs, camera shake.

### M5 — Enemies & AI ✅
- 5 enemy archetypes (bandit, jianghu swordsman, spearman, Iron Guard elite, boss Hei Shan)
  with distinct looks, weapons, stats, loot and attack pools.
- Finite state machine: idle → patrol → alert → chase → strafe → windup → attack → recover,
  plus block, dodge, stagger, taunt, return and death, with line-of-sight, obstacle-avoidance
  steering, attack tokens (max two attackers on the player at once), separation forces and
  level scaling.
- Boss with three phases at 100 % / 62 % / 28 % health: new attack pools (whirlwind, ground
  slam, projectile fan, dash), speed and power ramps, phase-change roar and boss bar.

### M6 — RPG, NPCs & quests ✅
- Progression: XP curve, level-ups awarding skill points, 13-node martial-arts skill tree
  (gliding, double leap, qi circulation, parry mastery, bladestorm, sword mastery, stat
  nodes), derived stats recomputed from skills + equipment.
- 20 items across weapons/armour/trinkets/consumables/materials/quest items; inventory with
  stacks, equip/unequip, use, discard; gold; two shop stocks.
- 10 NPC archetypes with wander behaviour, turn-to-face, greetings, lore lines, shops,
  training, rest-until-dawn and a training dummy.
- Quest system with 4 main + 4 side quests, sequential objectives of type
  talk / kill / collect / reach / boss / free, prerequisite chaining, POI gating, rewards of
  XP, gold, items and skill points, automatic save on completion and a UI tracker.

### M7 — Presentation ✅
- Renderer: WebGL2 with GTAO, bloom, output pass and a custom grade pass (exposure, tint,
  vignette, grain, chromatic aberration, underwater and hit-flash), MSAA, adaptive
  resolution, 4 quality presets.
- Analytic sky, sun/moon, six weather states with smooth transitions, GPU rain/snow/petals/
  fireflies, volumetric-ish fog, day/night cycle with a clock.
- Gerstner water with fresnel, depth fade, reflections tint and underwater grading.
- Procedural Web Audio engine: original adaptive score in a D-pentatonic mode
  (menu / explore / combat / boss / sad) with guqin/erhu/dizi/taiko voices, ~60 synthesised
  SFX, wind/water ambience and scheduled birdsong and insects.
- Ink-wash interface: title screen, loading screen with tips, HUD (health/stamina/qi/XP,
  portrait, level, rotating minimap, clock/weather/location, quest tracker, boss bar,
  hotbar, toasts, interact prompts, FPS meter), dialogue box, pack, cultivation sheet with
  the skill tree, journal, realm chart, shop, pause, settings, controls, credits, death
  screen.

### M8 — Persistence & verification ✅
- Three save slots in IndexedDB (localStorage fallback) holding progression, quests,
  inventory, position, time of day, weather, opened chests and statistics; autosave every
  90 s, on level-up, on quest completion and on chest opening; settings persist separately.
- `tools/headless.ts` — builds the real world, spawns entities and runs 600 simulated frames
  of scripted play, then exercises kill → XP/gold/loot/quest reporting, corpse despawn,
  long-distance streaming, save serialisation and death → respawn. **0 errors.**
- `tools/ui-smoke.tsx` — renders every interface state (menu, loading, HUD with and without
  boss/interact/tracker/toast, dialogue, all five panels, world map, pause, death, credits)
  through `react-dom/server`. **All 22 states render.**
- `tools/shader-check.ts` — parses all 22 custom GLSL stages. **0 syntax errors.**
- `npx tsc --noEmit` — **0 errors.** `npx vite build` — succeeds.

### M9 — Deployment ⏳
- Source pushed to `arena/ddc596df-onez`, PR opened against `main`.
- GitHub Pages workflow builds `dist/` and publishes it on every push to `main`.
- *Pending:* the Pages URL only goes live after the PR is merged and the workflow is enabled
  for the repository (needs a repository setting I cannot change from here). Until then the
  game runs from the live preview of `npm run dev`.

---

## Known limitations (deliberate, not bugs)

- **Desktop-first.** Mouse + keyboard and gamepad; there are no touch controls yet.
- **Single region.** One continuous 2.56 km² map rather than multiple provinces; fast travel
  between discovered POIs is not implemented yet (resting at a temple or monastery teleports
  time, not place).
- **Save slots are manual.** Autosave writes to the slot you are playing; there are three.
- **No multiplayer, no voice acting, no cinematic cutscenes.** Quest presentation is
  dialogue + tracker, in the style of a classic RPG.
- **Audio requires a click** to start (browser autoplay policy) — the title screen button is
  that gesture.
- The score is algorithmic, not recorded: melodies are generated from the current mood each
  time you play, so it never loops identically.

## Bug fixes worth remembering

- Rolldown (Vite 8) rejects the object form of `manualChunks`; removed it.
- Post-processing passes are **not** re-exported from the `three` barrel: import them from
  `three/examples/jsm/postprocessing/*.js`.
- `mergeGeometries` requires every input to share index-ness. Hand-built non-indexed geometry
  mixed with `BoxGeometry`/`CylinderGeometry` silently dropped whole villages, trees and
  character meshes; every merge site now normalises to non-indexed first.
- Wall probing now requires a wall to be ≥1.5 m tall before the player can climb or wall-run,
  which stopped the character from scaling pebbles.
