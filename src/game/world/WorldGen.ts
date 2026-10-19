import {
  Group, Vector3, Mesh, Object3D, BoxGeometry, MeshStandardMaterial, Color, PointLight,
  Matrix4, TorusGeometry, CylinderGeometry, SphereGeometry, ConeGeometry,
} from 'three';
import { WORLD, heightAt, slopeAt, registerFlatten, clearFlattens, terrainNormal, biomeAt } from '../core/TerrainHeight';
import { makeRng, clamp01, lerpN, smoothstep } from '../core/Noise';
import { MeshBuilder } from './MeshBuilder';
import {
  PAL, PAL_TEMPLE, house, hall, pagoda, gate, bridge, cityWall, watchTower, shrine,
  marketStall, well, camp, dock, caveEntrance, statue, torii, platform, pillars, stairs,
  lantern, banner, curvedRoof, gableRoof,
} from './Structures';
import { physics } from '../core/Physics';
import { paintDisc, strokeLine, blurMasks, CH_PATH, CH_SETTLE, CH_FIELD, sampleMask } from './Masks';

export type POIType = 'village' | 'temple' | 'pagoda' | 'camp' | 'arena' | 'hut' | 'ruins' | 'dock' | 'cave' | 'shrine' | 'farm';

export interface POI {
  id: string;
  name: string;
  nameCN: string;
  type: POIType;
  pos: Vector3;
  radius: number;
  group: Group;
  discovered: boolean;
}

export interface SpawnPoint {
  pos: Vector3;
  kind: 'enemy' | 'npc' | 'chest' | 'boss' | 'node';
  type?: string;
  poi?: string;
  data?: any;
}

export interface RoadNode { pos: Vector3; poi: string; }

const _v = new Vector3();

/** Wall + floor + roof colliders so buildings can be entered. */
function buildingColliders(center: Vector3, w: number, d: number, h: number, rotY: number, opts: { floor?: number; doorWidth?: number; doorSide?: 'front' | 'none' } = {}) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const T = 0.28;
  const local = (lx: number, lz: number, out: Vector3) => out.set(center.x + lx * cs + lz * sn, 0, center.z - lx * sn + lz * cs);
  const wall = (lx: number, lz: number, sw: number, sd: number, sh: number, yOff: number) => {
    const p = local(lx, lz, new Vector3());
    p.y = center.y + yOff + sh / 2;
    physics.addBox(p, new Vector3(sw / 2, sh / 2, sd / 2), rotY, false, 'wall');
  };
  const doorW = opts.doorWidth ?? 1.5;
  if (opts.doorSide !== 'none') {
    const side = (d - doorW) / 2;
    wall(-(doorW + side) / 2, d / 2, side, T, h, 0);
    wall((doorW + side) / 2, d / 2, side, T, h, 0);
  } else {
    wall(0, d / 2, w, T, h, 0);
  }
  wall(0, -d / 2, w, T, h, 0);
  wall(-w / 2, 0, T, d, h, 0);
  wall(w / 2, 0, T, d, h, 0);
  // roof slab
  const rp = local(0, 0, new Vector3());
  rp.y = center.y + h + 0.25;
  physics.addBox(rp, new Vector3(w / 2 + 0.5, 0.3, d / 2 + 0.5), rotY, false, 'roof');
  // floor
  if (opts.floor !== undefined) {
    const fp = local(0, 0, new Vector3());
    fp.y = center.y + opts.floor;
    physics.addBox(fp, new Vector3(w / 2, 0.2, d / 2), rotY, false, 'floor');
  }
}

export class WorldGen {
  pois: POI[] = [];
  spawns: SpawnPoint[] = [];
  group = new Group();
  roads: RoadNode[] = [];
  startPos = new Vector3(0, 0, 0);
  private rng = makeRng(WORLD.seed);

  generate(): void {
    clearFlattens();
    this.group.name = 'world';
    this.locatePOIs();
    this.paintRoads();
    this.buildAll();
    blurMasks(1);
  }

  /** Find a flat, dry spot matching loose constraints. */
  private findSite(opts: {
    cx: number; cz: number; search: number; minFlat?: number; maxSlope?: number;
    minH?: number; maxH?: number; nearWater?: boolean; tries?: number;
  }): Vector3 | null {
    const rng = this.rng;
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < (opts.tries ?? 400); i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.6) * opts.search;
      const x = opts.cx + Math.cos(a) * r;
      const z = opts.cz + Math.sin(a) * r;
      if (Math.abs(x) > WORLD.half - 120 || Math.abs(z) > WORLD.half - 120) continue;
      const h = heightAt(x, z);
      if (h < (opts.minH ?? WORLD.waterLevel + 2.5)) continue;
      if (h > (opts.maxH ?? 145)) continue;
      // flatness over the footprint
      let minH = Infinity, maxH = -Infinity;
      const R = opts.minFlat ?? 14;
      for (let k = 0; k < 8; k++) {
        const aa = (k / 8) * Math.PI * 2;
        const hh = heightAt(x + Math.cos(aa) * R, z + Math.sin(aa) * R);
        minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
      }
      const flat = maxH - minH;
      if (flat > (opts.maxSlope ?? 4.5)) continue;
      let score = flat;
      const dw = WORLD.waterLevel + 3;
      if (opts.nearWater) score += Math.abs(h - dw) * 2.0;
      score += Math.hypot(x - opts.cx, z - opts.cz) * 0.02;
      if (score < bestScore) { bestScore = score; best = new Vector3(x, h, z); }
    }
    return best;
  }

  private locatePOIs() {
    const R = this.rng;
    const add = (id: string, name: string, nameCN: string, type: POIType, pos: Vector3, radius: number) => {
      const p: POI = { id, name, nameCN, type, pos, radius, group: new Group(), discovered: false };
      this.pois.push(p);
      this.group.add(p.group);
      return p;
    };

    // ---- starting village: find a gentle spot near the origin
    let start = this.findSite({ cx: 0, cz: 0, search: 220, minFlat: 20, maxSlope: 3.2, minH: WORLD.waterLevel + 4, maxH: 60, tries: 900 });
    if (!start) start = new Vector3(0, heightAt(0, 0), 0);
    this.startPos = new Vector3(start.x, start.y, start.z);
    add('willow', 'Willow Bend', '柳湾村', 'village', start.clone(), 46);

    // ---- other settlements at spread-out bearings
    const spots: [string, string, string, POIType, number, number, number][] = [
      ['cloudrest', 'Cloudrest Town', '云栖镇', 'village', 0.9, 620, 60],
      ['monastery', 'Cloudsea Monastery', '云海寺', 'temple', 3.4, 780, 120],
      ['pagoda', 'Nine Heavens Pagoda', '九霄塔', 'pagoda', 5.0, 700, 150],
      ['camp', 'Blackwood Camp', '黑木寨', 'camp', 2.1, 520, 40],
      ['arena', 'Bloody Cliff', '血崖', 'arena', 4.0, 900, 130],
      ['hut', 'Hermit\'s Hut', '隐者草庐', 'hut', 1.6, 380, 30],
      ['ruins', 'Old Battlefield', '古战场', 'ruins', 5.7, 640, 50],
      ['dock', 'Reedwharf Village', '芦渡村', 'dock', 2.8, 700, 12],
      ['farm', 'Millvale Farm', '磨坊谷', 'farm', 3.9, 480, 40],
      ['cave1', 'Whispering Cavern', '低语洞', 'cave', 1.1, 560, 40],
      ['cave2', 'Jade Grotto', '玉髓洞', 'cave', 3.3, 820, 90],
      ['shrine', 'Mountain Shrine', '山神庙', 'shrine', 0.2, 420, 80],
    ];
    for (const [id, name, cn, type, bearing, dist, elev] of spots) {
      const cx = Math.cos(bearing) * dist, cz = Math.sin(bearing) * dist;
      const site = this.findSite({
        cx, cz, search: 260, minFlat: type === 'arena' ? 22 : 16,
        maxSlope: type === 'arena' ? 6 : 4.2, minH: WORLD.waterLevel + 3,
        maxH: Math.max(60, elev + 70), tries: 700,
      });
      if (!site) continue;
      if (type === 'dock') {
        // look for a shoreline nearby
        let best: Vector3 | null = null, bestD = Infinity;
        for (let i = 0; i < 300; i++) {
          const a = R() * Math.PI * 2, r = R() * 160;
          const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
          const h = heightAt(x, z);
          const d = Math.abs(h - (WORLD.waterLevel + 1.6));
          if (d < bestD && h > WORLD.waterLevel + 0.8 && slopeAt(x, z) < 0.35) { bestD = d; best = new Vector3(x, h, z); }
        }
        if (best) site.copy(best);
      }
      add(id, name, cn, type, site.clone(), type === 'village' ? 48 : type === 'arena' ? 40 : 34);
    }
  }

  private paintRoads() {
    const byId = new Map(this.pois.map((p) => [p.id, p]));
    const links: [string, string][] = [
      ['willow', 'farm'], ['willow', 'camp'], ['farm', 'cloudrest'], ['willow', 'dock'],
      ['cloudrest', 'monastery'], ['monastery', 'pagoda'], ['cloudrest', 'ruins'],
      ['camp', 'arena'], ['cloudrest', 'shrine'], ['willow', 'cave1'], ['monastery', 'cave2'],
    ];
    for (const [a, b] of links) {
      const A = byId.get(a), B = byId.get(b);
      if (!A || !B) continue;
      this.road(A.pos, B.pos);
    }
  }

  /** Winding trail between two points, snapped to gentle terrain. */
  private road(a: Vector3, b: Vector3) {
    const steps = Math.max(12, Math.floor(a.distanceTo(b) / 12));
    const rng = makeRng(Math.floor(a.x * 13 + b.z * 7 + 991));
    let prev = a.clone();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = lerpN(a.x, b.x, t), pz = lerpN(a.z, b.z, t);
      const jitter = Math.sin(t * Math.PI) * 34;
      const nx = px + (rng() - 0.5) * jitter;
      const nz = pz + (rng() - 0.5) * jitter;
      // pull toward flat ground
      let bx = nx, bz = nz, best = Infinity;
      for (let k = 0; k < 6; k++) {
        const jx = nx + (rng() - 0.5) * 26, jz = nz + (rng() - 0.5) * 26;
        const s = slopeAt(jx, jz) + Math.abs(heightAt(jx, jz) - WORLD.waterLevel) * 0.004;
        if (s < best) { best = s; bx = jx; bz = jz; }
      }
      const cur = new Vector3(bx, heightAt(bx, bz), bz);
      strokeLine(prev.x, prev.z, cur.x, cur.z, 4.2, CH_PATH, 1);
      prev = cur;
    }
  }

  /* ------------------------------------------------------------------ build */

  private buildAll() {
    for (const poi of this.pois) {
      switch (poi.type) {
        case 'village': this.buildVillage(poi); break;
        case 'temple': this.buildTemple(poi); break;
        case 'pagoda': this.buildPagoda(poi); break;
        case 'camp': this.buildCamp(poi); break;
        case 'arena': this.buildArena(poi); break;
        case 'hut': this.buildHut(poi); break;
        case 'ruins': this.buildRuins(poi); break;
        case 'dock': this.buildDock(poi); break;
        case 'farm': this.buildFarm(poi); break;
        case 'cave': this.buildCave(poi); break;
        case 'shrine': this.buildShrine(poi); break;
      }
    }
  }

  private commit(b: MeshBuilder, poi: POI) {
    const meshes = b.build();
    for (const m of meshes) poi.group.add(m);
  }

  private flatten(poi: POI, radius: number, feather = 12) {
    registerFlatten({ x: poi.pos.x, z: poi.pos.z, radius, inner: radius * 0.35, height: poi.pos.y, feather });
    paintDisc(poi.pos.x, poi.pos.z, radius * 0.85, CH_SETTLE, 1, 0.7);
  }

  /* --------------------------------------------------------------- village */

  private buildVillage(poi: POI) {
    this.flatten(poi, Math.max(38, poi.radius));
    const b = new MeshBuilder();
    const rng = makeRng(Math.floor(poi.pos.x * 3 + poi.pos.z * 7 + 11));
    // central plaza + well
    const c = poi.pos;
    well(b, new Vector3(c.x, c.y, c.z));
    physics.addCylinder(new Vector3(c.x, c.y + 0.5, c.z), 1.0, 0.6, false, 'well');
    // main street along +Z
    const footprints: { x: number; z: number; w: number; d: number }[] = [];
    const fits = (x: number, z: number, w: number, d: number) => {
      for (const f of footprints) {
        if (Math.abs(f.x - x) < (f.w + w) / 2 + 2.2 && Math.abs(f.z - z) < (f.d + d) / 2 + 2.2) return false;
      }
      return true;
    };
    const placeHouse = (x: number, z: number, w: number, d: number, rotY: number, opts: any = {}) => {
      const y = heightAt(x, z);
      const p = new Vector3(x, y, z);
      footprints.push({ x, z, w: Math.max(w, d), d: Math.max(w, d) });
      house(b, p, { w, d, rotY, ...opts });
      buildingColliders(new Vector3(x, y + 0.35, z), w, d, 3.0, rotY, { floor: 0.0 });
      b.add(new BoxGeometry(0.6, 0.5, 0.6), '#ffb060', new Matrix4().setPosition(new Vector3(x, y + 2.2, z)), 'glow');
    };
    const nHouses = poi.id === 'willow' ? 11 : 8;
    let placed = 0, guard = 0;
    while (placed < nHouses && guard++ < 300) {
      const a = rng() * Math.PI * 2;
      const r = 8 + Math.pow(rng(), 0.7) * (poi.radius - 10);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const w = 5 + rng() * 2.5, d = 4.5 + rng() * 2;
      if (!fits(x, z, w, d)) continue;
      const rotY = Math.atan2(c.x - x, c.z - z) + (rng() - 0.5) * 0.5;
      placeHouse(x, z, w, d, rotY, { fence: rng() < 0.5 });
      placed++;
    }
    // village hall
    const hallPos = new Vector3(c.x, heightAt(c.x + 6, c.z - 14), c.z - 14);
    hallPos.y = heightAt(hallPos.x, hallPos.z);
    hall(b, hallPos, { w: 13, d: 9, h: 4.6, rotY: 0 });
    buildingColliders(new Vector3(hallPos.x, hallPos.y + 0.7, hallPos.z), 13, 9, 4.6, 0, { floor: 0.0, doorWidth: 4 });
    // shrine
    shrine(b, new Vector3(c.x - 16, heightAt(c.x - 16, c.z + 6), c.z + 6));
    // gate on the road side
    gate(b, new Vector3(c.x, heightAt(c.x, c.z + poi.radius * 0.7), c.z + poi.radius * 0.7), { w: 7 });
    // market stalls
    for (let i = 0; i < 3; i++) {
      const x = c.x + 6 + i * 5, z = c.z + 4;
      marketStall(b, new Vector3(x, heightAt(x, z), z), PAL, rng() * 0.6);
    }
    // fields around the village
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2, r = poi.radius + 12 + rng() * 22;
      paintDisc(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 14 + rng() * 10, CH_FIELD, 1, 0.8);
    }
    // lanterns along the plaza
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      lantern(b, new Vector3(c.x + Math.cos(a) * 12, c.y + 3.4, c.z + Math.sin(a) * 12), 1.1);
    }
    this.commit(b, poi);

    // ---- spawns
    const isWillow = poi.id === 'willow';
    this.spawns.push({ pos: new Vector3(c.x + 2, c.y, c.z + 6), kind: 'npc', type: 'elder', poi: poi.id, data: { name: 'Elder Shen', nameCN: '沈老丈' } });
    this.spawns.push({ pos: new Vector3(c.x + 6, c.y, c.z + 2), kind: 'npc', type: 'merchant', poi: poi.id, data: { name: 'Merchant Lu', nameCN: '货郎陆' } });
    this.spawns.push({ pos: new Vector3(c.x + 9, c.y, c.z - 4), kind: 'npc', type: 'master', poi: poi.id, data: { name: 'Master Bai', nameCN: '白师父' } });
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2, r = 8 + rng() * (poi.radius - 6);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'npc', type: 'villager', poi: poi.id, data: { name: 'Villager', nameCN: '村民' } });
    }
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2, r = poi.radius * 0.6;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'npc', type: 'guard', poi: poi.id, data: { name: 'Guard', nameCN: '乡勇' } });
    }
    if (isWillow) {
      // a couple of practice dummies outside town
      for (let i = 0; i < 2; i++) {
        const x = c.x - 18 - i * 3, z = c.z - 10;
        this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'npc', type: 'dummy', poi: poi.id, data: { name: 'Training Dummy', nameCN: '木人桩' } });
      }
    }
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2, r = poi.radius + 20 + rng() * 30;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: 'bandit', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x - 20, heightAt(c.x - 20, c.z + 18), c.z + 18), kind: 'chest', poi: poi.id, data: { tier: 1 } });
  }

  /* ---------------------------------------------------------------- temple */

  private buildTemple(poi: POI) {
    this.flatten(poi, 40, 16);
    const b = new MeshBuilder();
    const c = poi.pos;
    const pal = PAL_TEMPLE;
    // terrace levels climbing the hill
    let z = c.z + 30;
    stairs(b, new Vector3(c.x, heightAt(c.x, z), z), 9, 8, 0.35, 1.1, pal);
    gate(b, new Vector3(c.x, heightAt(c.x, c.z + 26), c.z + 26), { w: 9, h: 7 });
    torii(b, new Vector3(c.x, heightAt(c.x, c.z + 16), c.z + 16), pal);
    // courtyard
    platform(b, new Vector3(c.x, c.y, c.z), 34, 34, 0.5, pal);
    for (let i = 0; i < 4; i++) {
      const x = c.x + (i < 2 ? -13 : 13), zz = c.z + (i % 2 ? -11 : 11);
      statue(b, new Vector3(x, heightAt(x, zz), zz), pal, (i % 2) * 0.6, 'guardian');
    }
    well(b, new Vector3(c.x - 12, heightAt(c.x - 12, c.z), c.z));
    // main hall
    hall(b, new Vector3(c.x, c.y + 0.5, c.z - 6), { w: 16, d: 11, h: 5.4, pal });
    buildingColliders(new Vector3(c.x, c.y + 1.2, c.z - 6), 16, 11, 5.4, 0, { floor: 0.0, doorWidth: 5 });
    // side halls
    for (const s of [-1, 1]) {
      const x = c.x + s * 15, zz = c.z + 2;
      house(b, new Vector3(x, heightAt(x, zz), zz), { w: 7, d: 6, h: 3.4, rotY: s > 0 ? -1.57 : 1.57, pal });
      buildingColliders(new Vector3(x, heightAt(x, zz) + 0.35, zz), 7, 6, 3.4, s > 0 ? -1.57 : 1.57, { floor: 0 });
    }
    // pagoda behind
    pagoda(b, new Vector3(c.x, heightAt(c.x, c.z - 30), c.z - 30), { tiers: 5, base: 8, pal });
    physics.addCylinder(new Vector3(c.x, heightAt(c.x, c.z - 30) + 6, c.z - 30), 4.5, 12, false, 'pagoda');
    // bell tower
    const bx = c.x + 20, bz = c.z - 8;
    watchTower(b, new Vector3(bx, heightAt(bx, bz), bz), 8, pal);
    physics.addBox(new Vector3(bx, heightAt(bx, bz) + 4, bz), new Vector3(2.6, 4, 2.6), 0, false, 'tower');
    this.commit(b, poi);

    this.spawns.push({ pos: new Vector3(c.x, c.y + 0.5, c.z + 6), kind: 'npc', type: 'monk', poi: poi.id, data: { name: 'Abbot Wuxin', nameCN: '無心方丈' } });
    this.spawns.push({ pos: new Vector3(c.x + 4, c.y + 0.5, c.z + 8), kind: 'npc', type: 'master', poi: poi.id, data: { name: 'Master Jian', nameCN: '剑痴' } });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      const x = c.x + Math.cos(a) * 12, zz = c.z + Math.sin(a) * 12;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, zz), zz), kind: 'npc', type: 'monk', poi: poi.id, data: { name: 'Monk', nameCN: '僧人' } });
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6 + 0.4;
      const x = c.x + Math.cos(a) * 30, zz = c.z + Math.sin(a) * 30;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, zz), zz), kind: 'enemy', type: 'swordsman', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x + 13, c.y + 0.5, c.z - 12), kind: 'chest', poi: poi.id, data: { tier: 2 } });
  }

  private buildPagoda(poi: POI) {
    this.flatten(poi, 26, 14);
    const b = new MeshBuilder();
    const c = poi.pos;
    platform(b, c, 26, 26, 0.6, PAL_TEMPLE);
    pagoda(b, new Vector3(c.x, c.y + 0.6, c.z), { tiers: 7, base: 10, pal: PAL_TEMPLE });
    physics.addCylinder(new Vector3(c.x, c.y + 8, c.z), 5.5, 16, false, 'pagoda');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.7;
      const x = c.x + Math.cos(a) * 17, z = c.z + Math.sin(a) * 17;
      shrine(b, new Vector3(x, heightAt(x, z), z), PAL_TEMPLE, a);
      lantern(b, new Vector3(c.x + Math.cos(a) * 11, c.y + 2.6, c.z + Math.sin(a) * 11), 1.2);
    }
    stairs(b, new Vector3(c.x, heightAt(c.x, c.z + 16), c.z + 16), 6, 5, 0.4, 1.0, PAL_TEMPLE);
    this.commit(b, poi);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.2;
      const x = c.x + Math.cos(a) * 20, z = c.z + Math.sin(a) * 20;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: 'elite', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x + 8, c.y, c.z + 8), kind: 'chest', poi: poi.id, data: { tier: 3 } });
  }

  private buildCamp(poi: POI) {
    this.flatten(poi, 30, 12);
    const b = new MeshBuilder();
    const c = poi.pos;
    camp(b, c, PAL, 0.4);
    // palisade
    const pts: Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 26;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      pts.push(new Vector3(x, heightAt(x, z), z));
      // wooden stakes
      b.box('#5d3b26', new Vector3(x, heightAt(x, z) + 1.4, z), new Vector3(0.28, 2.8, 0.28), a);
      if (i % 3 === 0) physics.addCylinder(new Vector3(x, heightAt(x, z) + 1.4, z), 0.2, 1.4, false, 'stake');
    }
    // watch tower
    watchTower(b, new Vector3(c.x + 18, heightAt(c.x + 18, c.z + 10), c.z + 10), 8, PAL);
    physics.addBox(new Vector3(c.x + 18, heightAt(c.x + 18, c.z + 10) + 4, c.z + 10), new Vector3(2.6, 4, 2.6), 0, false, 'tower');
    // cages + banners
    for (let i = 0; i < 3; i++) {
      const a = 1 + i * 2;
      banner(b, new Vector3(c.x + Math.cos(a) * 14, heightAt(c.x + Math.cos(a) * 14, c.z + Math.sin(a) * 14) + 4.6, c.z + Math.sin(a) * 14), 2.6, 0.8, '#5a2a2a', a);
    }
    this.commit(b, poi);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      const x = c.x + Math.cos(a) * (8 + (i % 3) * 5), z = c.z + Math.sin(a) * (8 + (i % 3) * 5);
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: i % 3 === 0 ? 'spearman' : 'bandit', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x + 3, c.y, c.z + 3), kind: 'chest', poi: poi.id, data: { tier: 2 } });
    this.spawns.push({ pos: new Vector3(c.x - 6, c.y, c.z - 4), kind: 'npc', type: 'prisoner', poi: poi.id, data: { name: 'Captive Zhou', nameCN: '周捕头' } });
  }

  private buildArena(poi: POI) {
    this.flatten(poi, 34, 14);
    const b = new MeshBuilder();
    const c = poi.pos;
    platform(b, c, 52, 52, 0.5, PAL);
    // stone pillars around the rim
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = c.x + Math.cos(a) * 22, z = c.z + Math.sin(a) * 22;
      const y = heightAt(x, z);
      b.add(new BoxGeometry(1.2, 5.5, 1.2), '#6f6c66', new Matrix4().setPosition(new Vector3(x, y + 2.75, z)), 'opaque', 0.5);
      b.add(new BoxGeometry(1.6, 0.5, 1.6), '#8c2b2b', new Matrix4().setPosition(new Vector3(x, y + 5.7, z)), 'opaque', 0.5);
      physics.addBox(new Vector3(x, y + 2.75, z), new Vector3(0.7, 2.75, 0.7), 0, false, 'pillar');
      // brazier
      if (i % 2 === 0) b.add(new ConeGeometry(0.5, 1.2, 7), '#ff7a2c', new Matrix4().setPosition(new Vector3(x, y + 6.7, z)), 'glow');
    }
    // skull gate
    gate(b, new Vector3(c.x, heightAt(c.x, c.z + 30), c.z + 30), { w: 8, h: 6.5, pal: { ...PAL, wood: '#4a3a30', red: '#7a2020' } });
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x, c.y + 0.5, c.z), kind: 'boss', type: 'heishan', poi: poi.id, data: { name: 'Hei Shan', nameCN: '黑山' } });
  }

  private buildHut(poi: POI) {
    this.flatten(poi, 16, 10);
    const b = new MeshBuilder();
    const c = poi.pos;
    house(b, c, { w: 6, d: 5, h: 2.9, rotY: 0.6, fence: true });
    buildingColliders(new Vector3(c.x, c.y + 0.35, c.z), 6, 5, 2.9, 0.6, { floor: 0 });
    // herb garden
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = c.x + Math.cos(a) * 5.5, z = c.z + Math.sin(a) * 5.5;
      b.add(new SphereGeometry(0.22, 6, 5), i % 2 ? '#7fae4a' : '#c8a24a', new Matrix4().setPosition(new Vector3(x, heightAt(x, z) + 0.2, z)));
    }
    well(b, new Vector3(c.x + 7, heightAt(c.x + 7, c.z + 4), c.z + 4));
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x + 2, c.y, c.z + 4), kind: 'npc', type: 'hermit', poi: poi.id, data: { name: 'Hermit Mo', nameCN: '墨隐翁' } });
    for (let i = 0; i < 3; i++) {
      const x = c.x + (i - 1) * 4, z = c.z + 7;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'node', type: 'herb' });
    }
  }

  private buildRuins(poi: POI) {
    this.flatten(poi, 26, 12);
    const b = new MeshBuilder();
    const c = poi.pos;
    const rng = makeRng(Math.floor(c.x + c.z * 3 + 71));
    // broken walls
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2, r = 8 + rng() * 18;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const y = heightAt(x, z);
      const w = 3 + rng() * 5, h = 1 + rng() * 3.5;
      b.box('#8a857c', new Vector3(x, y + h / 2, z), new Vector3(w, h, 0.8), a, 'opaque', 0.5);
      physics.addBox(new Vector3(x, y + h / 2, z), new Vector3(w / 2, h / 2, 0.5), a, false, 'ruin');
    }
    // toppled columns
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, r = 6 + rng() * 20;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const y = heightAt(x, z);
      const m = new Matrix4();
      m.makeRotationZ(1.2 + rng() * 0.5);
      m.setPosition(new Vector3(x, y + 0.35, z));
      b.add(new CylinderGeometry(0.45, 0.5, 3.2, 10), '#9a978d', m, 'opaque', 0.5);
    }
    // stele
    statue(b, new Vector3(c.x, c.y, c.z), PAL, 0.4, 'master');
    torii(b, new Vector3(c.x, heightAt(c.x, c.z + 14), c.z + 14), { ...PAL, red: '#6a2a22' });
    this.commit(b, poi);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      const x = c.x + Math.cos(a) * 14, z = c.z + Math.sin(a) * 14;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: i % 2 ? 'spearman' : 'bandit', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x + 4, c.y, c.z - 4), kind: 'chest', poi: poi.id, data: { tier: 2 } });
  }

  private buildDock(poi: POI) {
    this.flatten(poi, 30, 12);
    const b = new MeshBuilder();
    const c = poi.pos;
    // find the water direction
    let wx = 0, wz = 0, best = Infinity;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const x = c.x + Math.cos(a) * 40, z = c.z + Math.sin(a) * 40;
      const h = heightAt(x, z);
      if (h < best) { best = h; wx = Math.cos(a); wz = Math.sin(a); }
    }
    const waterDir = new Vector3(wx, 0, wz).normalize();
    const rotY = Math.atan2(waterDir.x, waterDir.z);
    // houses on the land side
    const rng = makeRng(Math.floor(c.x * 5 + c.z + 33));
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const r = 8 + rng() * 20;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (new Vector3(x - c.x, 0, z - c.z).normalize().dot(waterDir) > 0.2) continue;
      const w = 5 + rng() * 2, d = 4.5 + rng() * 1.5;
      house(b, new Vector3(x, heightAt(x, z), z), { w, d, rotY: Math.atan2(-waterDir.x, -waterDir.z) + (rng() - 0.5) });
      buildingColliders(new Vector3(x, heightAt(x, z) + 0.35, z), w, d, 3.0, 0, { floor: 0 });
    }
    // docks reaching into the water
    for (let i = -1; i <= 1; i++) {
      const perp = new Vector3(-waterDir.z, 0, waterDir.x).multiplyScalar(i * 14);
      const start = new Vector3(c.x + waterDir.x * 12 + perp.x, 0, c.z + waterDir.z * 12 + perp.z);
      start.y = heightAt(start.x, start.z);
      const end = new Vector3(start.x + waterDir.x * 24, 0, start.z + waterDir.z * 24);
      end.y = start.y;
      dock(b, new Vector3((start.x + end.x) / 2, Math.max(start.y, WORLD.waterLevel + 0.6), (start.z + end.z) / 2), 26, 4.5, PAL, rotY);
      // walkable deck collider
      physics.addBox(new Vector3((start.x + end.x) / 2, Math.max(start.y, WORLD.waterLevel + 0.6) - 0.15, (start.z + end.z) / 2),
        new Vector3(2.4, 0.25, 13), rotY, false, 'dock');
    }
    well(b, new Vector3(c.x - 9, heightAt(c.x - 9, c.z - 9), c.z - 9));
    for (let i = 0; i < 3; i++) {
      marketStall(b, new Vector3(c.x + (i - 1) * 6, heightAt(c.x + (i - 1) * 6, c.z + 8), c.z + 8), PAL, 0.2 * i);
    }
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x, c.y, c.z + 6), kind: 'npc', type: 'merchant', poi: poi.id, data: { name: 'Fisherman Yan', nameCN: '渔翁严' } });
    this.spawns.push({ pos: new Vector3(c.x + 5, c.y, c.z - 4), kind: 'npc', type: 'villager', poi: poi.id, data: { name: 'Villager', nameCN: '村民' } });
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2, r = 30 + rng() * 30;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: 'bandit', poi: poi.id });
    }
    this.spawns.push({ pos: new Vector3(c.x - 14, heightAt(c.x - 14, c.z + 12), c.z + 12), kind: 'chest', poi: poi.id, data: { tier: 1 } });
  }

  private buildFarm(poi: POI) {
    this.flatten(poi, 24, 12);
    const b = new MeshBuilder();
    const c = poi.pos;
    const rng = makeRng(Math.floor(c.x * 2 + c.z * 9 + 5));
    house(b, c, { w: 7, d: 6, h: 3.1, rotY: 0.2 });
    buildingColliders(new Vector3(c.x, c.y + 0.35, c.z), 7, 6, 3.1, 0.2, { floor: 0 });
    // barn
    const bx = c.x + 12, bz = c.z + 4;
    house(b, new Vector3(bx, heightAt(bx, bz), bz), { w: 9, d: 7, h: 3.6, rotY: -0.5, pal: { ...PAL, plaster: '#d8cbb0' } });
    buildingColliders(new Vector3(bx, heightAt(bx, bz) + 0.35, bz), 9, 7, 3.6, -0.5, { floor: 0 });
    // mill wheel
    const mx = c.x - 10, mz = c.z + 8;
    const wheel = new TorusGeometry(2.2, 0.18, 6, 16);
    b.add(wheel, '#7a5a34', new Matrix4().setPosition(new Vector3(mx, heightAt(mx, mz) + 2.2, mz)), 'opaque', 0.5);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.box('#8a5a3a', new Vector3(mx + Math.cos(a) * 1.2, heightAt(mx, mz) + 2.2 + Math.sin(a) * 1.2, mz), new Vector3(0.14, 2.4, 0.14), a);
    }
    // crop fields
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, r = 18 + rng() * 26;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      paintDisc(x, z, 12 + rng() * 8, CH_FIELD, 1, 0.8);
      for (let k = 0; k < 14; k++) {
        const px = x + (rng() - 0.5) * 20, pz = z + (rng() - 0.5) * 20;
        const py = heightAt(px, pz);
        b.add(new ConeGeometry(0.12, 0.7, 4), '#c8a24a', new Matrix4().setPosition(new Vector3(px, py + 0.35, pz)));
      }
    }
    well(b, new Vector3(c.x + 4, heightAt(c.x + 4, c.z - 8), c.z - 8));
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x + 3, c.y, c.z + 5), kind: 'npc', type: 'farmer', poi: poi.id, data: { name: 'Farmer Guo', nameCN: '农人郭' } });
    for (let i = 0; i < 2; i++) this.spawns.push({ pos: new Vector3(c.x + (i - 1) * 6, c.y, c.z - 6), kind: 'npc', type: 'villager', poi: poi.id, data: { name: 'Farmhand', nameCN: '佃农' } });
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2, r = 30 + rng() * 25;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: 'bandit', poi: poi.id });
    }
  }

  private buildCave(poi: POI) {
    const b = new MeshBuilder();
    const c = poi.pos;
    // orient the mouth downhill / toward open ground
    let bestA = 0, bestH = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const h = heightAt(c.x + Math.cos(a) * 22, c.z + Math.sin(a) * 22);
      if (h < bestH) { bestH = h; bestA = a; }
    }
    registerFlatten({ x: c.x, z: c.z, radius: 12, inner: 6, height: c.y, feather: 8 });
    caveEntrance(b, c, bestA, 1.15);
    for (let i = 0; i < 5; i++) {
      const a = bestA + (i - 2) * 0.35;
      const x = c.x + Math.cos(a) * 7, z = c.z + Math.sin(a) * 7;
      b.add(new SphereGeometry(1.0 + (i % 2) * 0.5, 8, 6), '#6a6660', new Matrix4().setPosition(new Vector3(x, heightAt(x, z) + 0.4, z)), 'opaque', 0.5);
    }
    // glowing crystals inside
    for (let i = 0; i < 6; i++) {
      const a = bestA + Math.PI + (i - 3) * 0.18;
      const x = c.x + Math.cos(a) * (2 + (i % 3)), z = c.z + Math.sin(a) * (2 + (i % 3));
      b.add(new ConeGeometry(0.22, 1.1, 5), '#6ad0e8', new Matrix4().setPosition(new Vector3(x, c.y + 0.55, z)), 'glow');
    }
    physics.addCylinder(new Vector3(c.x, c.y + 2, c.z), 3.6, 2.6, false, 'cave');
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x + Math.cos(bestA + Math.PI) * 3.5, c.y, c.z + Math.sin(bestA + Math.PI) * 3.5), kind: 'chest', poi: poi.id, data: { tier: 3 } });
    for (let i = 0; i < 2; i++) {
      const a = bestA + (i ? 1 : -1) * 0.6;
      const x = c.x + Math.cos(a) * 12, z = c.z + Math.sin(a) * 12;
      this.spawns.push({ pos: new Vector3(x, heightAt(x, z), z), kind: 'enemy', type: 'bandit', poi: poi.id });
    }
  }

  private buildShrine(poi: POI) {
    this.flatten(poi, 18, 12);
    const b = new MeshBuilder();
    const c = poi.pos;
    platform(b, c, 16, 16, 0.5, PAL_TEMPLE);
    stairs(b, new Vector3(c.x, heightAt(c.x, c.z + 12), c.z + 12), 5, 6, 0.35, 0.9, PAL_TEMPLE);
    torii(b, new Vector3(c.x, c.y + 0.5, c.z + 8), PAL_TEMPLE);
    shrine(b, new Vector3(c.x, c.y + 0.5, c.z), PAL_TEMPLE);
    statue(b, new Vector3(c.x, c.y + 0.5, c.z - 4), PAL_TEMPLE, 0, 'guardian');
    for (const s of [-1, 1]) lantern(b, new Vector3(c.x + s * 4, c.y + 3.0, c.z + 3), 1.2);
    this.commit(b, poi);
    this.spawns.push({ pos: new Vector3(c.x + 3, c.y, c.z + 4), kind: 'npc', type: 'master', poi: poi.id, data: { name: 'Master Yun', nameCN: '云真人' } });
    this.spawns.push({ pos: new Vector3(c.x - 4, c.y, c.z - 2), kind: 'chest', poi: poi.id, data: { tier: 2 } });
  }

  /* ---------------------------------------------------------------- helpers */

  poiAt(pos: Vector3): POI | null {
    for (const p of this.pois) if (pos.distanceTo(p.pos) < p.radius) return p;
    return null;
  }

  nearestPOI(pos: Vector3): POI | null {
    let best: POI | null = null, bd = Infinity;
    for (const p of this.pois) {
      const d = pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
