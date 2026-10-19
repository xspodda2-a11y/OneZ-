import {
  Mesh, PlaneGeometry, MeshStandardMaterial, Group, Vector3, Color, BufferGeometry,
  ShaderChunk, Texture, RepeatWrapping, Vector2,
} from 'three';
import { WORLD, heightAt, terrainNormal } from '../core/TerrainHeight';
import { grassTexture, dirtTexture, rockTexture, sandTexture, snowTexture, pathTexture } from '../render/Textures';
import { getMaskTexture } from './Masks';
import { windUniforms } from '../render/Environment';
import { QualityPreset } from '../render/Renderer';

interface Chunk {
  key: string;
  cx: number; cz: number;
  mesh: Mesh;
  segs: number;
  dist: number;
}

const NOISE_GLSL_SIMPLE = /* glsl */`
float thash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float tnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(thash(i), thash(i+vec2(1,0)), u.x), mix(thash(i+vec2(0,1)), thash(i+vec2(1,1)), u.x), u.y);
}
float tfbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*tnoise(p); p*=2.03; a*=0.5;} return s; }
`;

export class Terrain {
  group = new Group();
  material: MeshStandardMaterial;
  private chunks = new Map<string, Chunk>();
  private pending: { cx: number; cz: number; segs: number }[] = [];
  private building = false;
  private lastCx = NaN;
  private lastCz = NaN;
  private radius = 3;
  /** texture tiling scale */
  private uvScale = 0.055;

  constructor() {
    const grass = grassTexture(), dirt = dirtTexture(), rock = rockTexture(), sand = sandTexture(), snow = snowTexture(), path = pathTexture();
    for (const t of [grass, dirt, rock, sand, snow, path]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(1, 1);
      t.anisotropy = 8;
    }
    this.material = new MeshStandardMaterial({
      color: 0xffffff, roughness: 0.94, metalness: 0.0, name: 'terrain',
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrass = { value: grass };
      shader.uniforms.uDirt = { value: dirt };
      shader.uniforms.uRock = { value: rock };
      shader.uniforms.uSand = { value: sand };
      shader.uniforms.uSnow = { value: snow };
      shader.uniforms.uPath = { value: path };
      shader.uniforms.uMask = { value: getMaskTexture() };
      shader.uniforms.uWorldHalf = { value: WORLD.half };
      shader.uniforms.uWorldSize = { value: WORLD.size };
      shader.uniforms.uWaterLevel = { value: WORLD.waterLevel };
      shader.uniforms.uUvScale = { value: this.uvScale };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          varying vec3 vWPos;
          varying vec3 vWNormal;
          varying float vPath;
          varying float vSettle;
          varying float vField;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * normal);
          vec2 muv = (vWPos.xz + uWorldHalf) / uWorldSize;
          vec4 mk = texture2D(uMask, clamp(muv, 0.0, 1.0));
          vPath = mk.r; vSettle = mk.g; vField = mk.b;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform sampler2D uGrass, uDirt, uRock, uSand, uSnow, uPath, uMask;
          uniform float uWaterLevel, uUvScale;
          varying vec3 vWPos;
          varying vec3 vWNormal;
          varying float vPath;
          varying float vSettle;
          varying float vField;
          ${NOISE_GLSL_SIMPLE}
        `)
        .replace('#include <map_fragment>', `
          vec2 uvG = vWPos.xz * uUvScale;
          vec2 uvG2 = vWPos.xz * uUvScale * 7.0;
          float h = vWPos.y;
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          float macro = tfbm(vWPos.xz * 0.0035);
          float macro2 = tfbm(vWPos.xz * 0.02);

          vec3 cGrass = texture2D(uGrass, uvG).rgb;
          vec3 cGrass2 = texture2D(uGrass, uvG2 * 0.3).rgb;
          cGrass = mix(cGrass, cGrass2, 0.35);
          vec3 cDirt = texture2D(uDirt, uvG * 0.9).rgb;
          vec3 cRock = texture2D(uRock, uvG * 0.55).rgb;
          vec3 cSand = texture2D(uSand, uvG * 1.1).rgb;
          vec3 cSnow = texture2D(uSnow, uvG * 0.8).rgb;
          vec3 cPath = texture2D(uPath, uvG * 1.6).rgb;

          float wDirt = smoothstep(0.35, 0.62, macro) * 0.55 + smoothstep(0.25, 0.55, slope) * 0.3;
          float wSand = smoothstep(uWaterLevel + 3.4, uWaterLevel + 0.3, h);
          float wRock = smoothstep(0.34, 0.62, slope) * 0.9 + smoothstep(95.0, 145.0, h) * 0.75;
          float wSnow = smoothstep(112.0, 152.0, h) * (1.0 - smoothstep(0.5, 0.75, slope) * 0.6);
          float wField = vField * 0.85;
          float wPath = smoothstep(0.25, 0.6, vPath);

          vec3 col = cGrass;
          col = mix(col, cDirt, clamp(wDirt, 0.0, 1.0));
          col = mix(col, mix(cDirt, cSand, 0.6), wField);
          col = mix(col, cSand, wSand);
          col = mix(col, cRock, clamp(wRock, 0.0, 1.0));
          col = mix(col, cSnow, clamp(wSnow, 0.0, 1.0));
          col = mix(col, cPath, wPath * 0.92);

          // macro variation to break up tiling
          col *= 0.86 + macro * 0.26;
          col *= 0.94 + macro2 * 0.12;
          // slight darkening in hollows
          col *= 0.88 + 0.12 * smoothstep(0.2, 0.8, tfbm(vWPos.xz * 0.008));
          // wet sand near the waterline
          col = mix(col, col * 0.72, smoothstep(uWaterLevel + 1.6, uWaterLevel, h) * 0.7);

          diffuseColor.rgb *= col;
        `);
    };
    this.material.customProgramCacheKey = () => 'terrainSplat';
    this.group.name = 'terrain';
  }

  private lodFor(dist: number): number {
    if (dist <= 1) return 64;
    if (dist <= 2) return 32;
    return 16;
  }

  update(playerPos: Vector3, quality: QualityPreset, budget = 2) {
    const cs = WORLD.chunk;
    const pcx = Math.floor(playerPos.x / cs), pcz = Math.floor(playerPos.z / cs);
    this.radius = quality.chunkRadius;
    if (pcx !== this.lastCx || pcz !== this.lastCz) {
      this.lastCx = pcx; this.lastCz = pcz;
      // queue required chunks
      const wanted = new Set<string>();
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        for (let dx = -this.radius; dx <= this.radius; dx++) {
          const cx = pcx + dx, cz = pcz + dz;
          const dist = Math.max(Math.abs(dx), Math.abs(dz));
          if (Math.hypot(dx, dz) > this.radius + 0.35) continue;
          const key = `${cx},${cz}`;
          wanted.add(key);
          const existing = this.chunks.get(key);
          const segs = this.lodFor(dist);
          if (!existing) {
            this.pending.push({ cx, cz, segs });
          } else if (existing.segs !== segs && dist <= 1) {
            this.pending.push({ cx, cz, segs });
          }
        }
      }
      // unload
      for (const [key, ch] of Array.from(this.chunks)) {
        if (!wanted.has(key)) {
          this.group.remove(ch.mesh);
          ch.mesh.geometry.dispose();
          this.chunks.delete(key);
        }
      }
      // sort pending by distance
      this.pending.sort((a, b) => {
        const da = Math.hypot(a.cx - pcx, a.cz - pcz);
        const db = Math.hypot(b.cx - pcx, b.cz - pcz);
        return da - db;
      });
    }
    // build a few per frame
    let built = 0;
    while (this.pending.length && built < budget) {
      const job = this.pending.shift()!;
      this.buildChunk(job.cx, job.cz, job.segs);
      built++;
    }
  }

  private buildChunk(cx: number, cz: number, segs: number) {
    const key = `${cx},${cz}`;
    const size = WORLD.chunk;
    const ox = cx * size, oz = cz * size;
    const old = this.chunks.get(key);
    if (old && old.segs === segs) return;
    const geo = new PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as any;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
      pos.setX(i, x);
      pos.setZ(i, z);
      pos.setY(i, heightAt(x, z));
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius *= 1.5;
    let mesh: Mesh;
    if (old) {
      mesh = old.mesh;
      mesh.geometry.dispose();
      mesh.geometry = geo;
      old.segs = segs;
    } else {
      mesh = new Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = 'chunk_' + key;
      this.chunks.set(key, { key, cx, cz, mesh, segs, dist: 0 });
      this.group.add(mesh);
    }
  }

  /** Height + normal helper used by gameplay (delegates to the height field). */
  height(x: number, z: number) { return heightAt(x, z); }

  dispose() {
    for (const ch of this.chunks.values()) { ch.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.material.dispose();
  }
}
