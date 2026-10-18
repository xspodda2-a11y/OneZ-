import {
  Mesh, PlaneGeometry, ShaderMaterial, Vector3, Color, DoubleSide, Vector2, Scene, Color as C,
  MeshStandardMaterial, AdditiveBlending, RepeatWrapping,
} from 'three';
import { NOISE_GLSL, SKY_GLSL } from './SkyShader';
import { skyUniforms } from './Environment';
import { WORLD } from '../core/TerrainHeight';
import { getHeightTexture } from '../world/HeightMap';
import { waterNormalTexture } from './Textures';

export class Water {
  mesh: Mesh;
  material: ShaderMaterial;
  private size = 1600;
  private segs = 160;
  private normals = waterNormalTexture();

  constructor(scene: Scene) {
    const geo = new PlaneGeometry(this.size, this.size, this.segs, this.segs);
    geo.rotateX(-Math.PI / 2);
    const { tex } = getHeightTexture();
    this.material = new ShaderMaterial({
      uniforms: {
        uHeightTex: { value: tex },
        uWorldHalf: { value: WORLD.half },
        uWorldSize: { value: WORLD.size },
        uLevel: { value: WORLD.waterLevel },
        uTime: skyUniforms.uTime,
        uDeep: { value: new Color(0.024, 0.115, 0.145) },
        uShallow: { value: new Color(0.10, 0.34, 0.33) },
        uFoam: { value: new Color(0.92, 0.97, 1.0) },
        uFogColor: { value: new Color(0.7, 0.8, 0.9) },
        uFogDensity: { value: 0.0015 },
        uNormalTex: { value: this.normals },
        uVisible: { value: 520 },
        uCam: { value: new Vector3() },
        uWind: { value: 0.7 },
        uSunColor: skyUniforms.uSunColor,
        uSunDir: skyUniforms.uSunDir,
        uMoonDir: skyUniforms.uMoonDir,
        uMoonColor: skyUniforms.uMoonColor,
        uZenith: skyUniforms.uZenith,
        uHorizon: skyUniforms.uHorizon,
        uHaze: skyUniforms.uHaze,
        uCloudiness: skyUniforms.uCloudiness,
        uNight: skyUniforms.uNight,
        uOvercast: skyUniforms.uOvercast,
        uRain: skyUniforms.uRain,
      },
      vertexShader: /* glsl */`
        uniform sampler2D uHeightTex;
        uniform float uWorldHalf, uWorldSize, uLevel, uTime, uVisible, uWind;
        uniform vec3 uCam;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying float vTerrainH;
        varying float vCrest;
        varying vec2 vUvW;

        float terrainH(vec2 p){
          vec2 uv = (p + uWorldHalf) / uWorldSize;
          return texture2D(uHeightTex, clamp(uv, 0.0, 1.0)).r;
        }

        // 4 gerstner waves
        void waves(vec2 p, out float height, out vec3 nrm, out float crest){
          height = 0.0; crest = 0.0;
          vec2 d = normalize(vec2(0.82, 0.57));
          vec3 acc = vec3(0.0);
          float amp[4]; float len[4]; float spd[4]; vec2 dir[4];
          amp[0]=0.26; len[0]=23.0; spd[0]=1.05; dir[0]=normalize(vec2(0.9,0.44));
          amp[1]=0.15; len[1]=11.0; spd[1]=1.45; dir[1]=normalize(vec2(0.5,-0.86));
          amp[2]=0.075; len[2]=5.5; spd[2]=2.1; dir[2]=normalize(vec2(-0.7,0.72));
          amp[3]=0.04; len[3]=2.6; spd[3]=3.0; dir[3]=normalize(vec2(0.2,0.98));
          float a = 0.35 + uWind * 0.9;
          for(int i=0;i<4;i++){
            float k = 6.28318 / len[i];
            float f = k * dot(dir[i], p) - spd[i] * uTime * 1.6;
            float A = amp[i] * a;
            height += sin(f) * A;
            crest += max(0.0, sin(f)) * A;
            acc.x += dir[i].x * k * A * cos(f);
            acc.z += dir[i].y * k * A * cos(f);
          }
          nrm = normalize(vec3(-acc.x, 1.0, -acc.z));
        }

        void main(){
          vec3 pos = position;
          vec4 wp4 = modelMatrix * vec4(pos, 1.0);
          vec2 p = wp4.xz;
          float th = terrainH(p);
          float h; vec3 n; float crest;
          waves(p, h, n, crest);
          // flatten close to shore
          float depth = max(0.0, uLevel - th);
          float shoreFade = smoothstep(0.0, 2.2, depth);
          vec3 world = vec3(p.x, uLevel + h * shoreFade, p.z);
          vWorld = world;
          vNormalW = normalize(mix(vec3(0.0,1.0,0.0), n, shoreFade));
          vTerrainH = th;
          vCrest = crest * shoreFade;
          vUvW = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        ${NOISE_GLSL}
        ${SKY_GLSL}
        uniform vec3 uDeep, uShallow, uFoam, uCam;
        uniform float uLevel, uTime, uVisible, uFogDensity, uWind;
        uniform sampler2D uNormalTex;
        uniform vec3 uFogColor;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying float vTerrainH;
        varying float vCrest;
        varying vec2 vUvW;

        void main(){
          float depth = uLevel - vTerrainH;
          if (depth <= 0.05) discard;

          vec3 V = normalize(uCam - vWorld);
          // detail ripples from two scrolling normal samples
          vec2 uv1 = vUvW * 0.055 + vec2(uTime * 0.012, uTime * 0.008);
          vec2 uv2 = vUvW * 0.13 - vec2(uTime * 0.02, uTime * 0.016);
          vec3 tn1 = texture2D(uNormalTex, uv1).xyz * 2.0 - 1.0;
          vec3 tn2 = texture2D(uNormalTex, uv2).xyz * 2.0 - 1.0;
          vec3 N = normalize(vNormalW + vec3(tn1.x + tn2.x, 0.0, tn1.z + tn2.z) * 0.42);
          if (dot(N, V) < 0.0) N = -N;

          float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);

          vec3 R = reflect(-V, N);
          R.y = abs(R.y) * 0.9 + 0.02;
          vec3 refl = skyColor(normalize(R));
          float cover;
          vec3 cc = cloudColor(normalize(R), cover);
          refl = mix(refl, cc, clamp(cover, 0.0, 1.0));

          // body colour by depth
          float dk = clamp(depth / 7.0, 0.0, 1.0);
          vec3 body = mix(uShallow, uDeep, dk);
          body *= (0.55 + 0.45 * max(dot(N, normalize(uSunDir)), 0.0));

          vec3 col = mix(body, refl, clamp(fres * 1.15, 0.0, 1.0));

          // sun / moon specular glitter
          vec3 H = normalize(normalize(uSunDir) + V);
          float spec = pow(max(dot(N, H), 0.0), 420.0);
          col += uSunColor * spec * 2.6 * (1.0 - uOvercast * 0.8);
          vec3 Hm = normalize(normalize(uMoonDir) + V);
          col += uMoonColor * pow(max(dot(N, Hm), 0.0), 300.0) * 1.6 * uNight;

          // wave crest highlights
          col += vec3(0.85, 0.95, 1.0) * smoothstep(0.16, 0.34, vCrest) * 0.16;

          // shoreline foam
          float shore = 1.0 - smoothstep(0.0, 1.5, depth);
          float foamNoise = fbm(vUvW * 1.6 + vec2(uTime * 0.35, -uTime * 0.22));
          float foam = smoothstep(0.35, 0.75, foamNoise + shore * 0.55 + sin(uTime * 2.2 + vUvW.x * 0.6) * 0.12);
          col = mix(col, uFoam, foam * smoothstep(0.0, 0.9, depth) * 0.85);

          // distance fade into fog
          float dist = length(uCam - vWorld);
          float fade = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fade, 0.0, 1.0));
          float alpha = mix(1.0, 0.86, dk);
          alpha *= smoothstep(uVisible, uVisible * 0.72, dist);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: DoubleSide,
      depthWrite: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  setQuality(segments: number) {
    if (segments === this.segs) return;
    this.segs = segments;
    this.mesh.geometry.dispose();
    const geo = new PlaneGeometry(this.size, this.size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.mesh.geometry = geo;
  }

  update(cameraPos: Vector3, fogColor: Color, fogDensity: number) {
    // keep the plane centred on the camera, snapped to the vertex grid to avoid swimming
    const step = this.size / this.segs;
    const x = Math.round(cameraPos.x / step) * step;
    const z = Math.round(cameraPos.z / step) * step;
    this.mesh.position.set(x, 0, z);
    (this.material.uniforms.uCam.value as Vector3).copy(cameraPos);
    (this.material.uniforms.uFogColor.value as Color).copy(fogColor);
    this.material.uniforms.uFogDensity.value = fogDensity;
  }
}

/** Scrolling waterfall / stream material used by world props. */
export function makeWaterfallMaterial(width = 4, height = 20, speed = 1.0, tint = new C(0.72, 0.88, 0.95)) {
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: skyUniforms.uTime,
      uSpeed: { value: speed },
      uTint: { value: tint.clone() },
      uFogColor: { value: new Color(0.7, 0.8, 0.9) },
      uFogDensity: { value: 0.0015 },
      uCam: { value: new Vector3() },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      ${NOISE_GLSL}
      uniform float uTime, uSpeed, uFogDensity;
      uniform vec3 uTint, uFogColor, uCam;
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        float t = uTime * uSpeed;
        vec2 uv = vec2(vUv.x * 1.6, vUv.y * 3.0 - t * 1.6);
        float streaks = fbm(uv * vec2(3.0, 1.2));
        float streaks2 = fbm(uv * vec2(7.0, 2.0) + 5.0);
        float foam = smoothstep(0.42, 0.85, streaks * 0.7 + streaks2 * 0.4);
        float edge = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);
        float top = smoothstep(0.0, 0.06, 1.0 - vUv.y);
        vec3 col = mix(uTint * 0.55, vec3(1.0), foam);
        float a = (0.55 + foam * 0.45) * edge * mix(1.0, 0.75, top);
        float dist = length(uCam - vWorld);
        float fade = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, clamp(fade, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return mat;
}
