import {
  Scene, Mesh, SphereGeometry, ShaderMaterial, BackSide, Vector3, Color, DirectionalLight,
  HemisphereLight, AmbientLight, FogExp2, BufferGeometry, BufferAttribute, LineSegments,
  Points, PointsMaterial, AdditiveBlending, NormalBlending, MathUtils, Group, PointLight,
} from 'three';
import { NOISE_GLSL, SKY_FRAG, SKY_GLSL, SKY_VERT } from './SkyShader';
import { clamp, clamp01, damp, lerpN, smoothstep } from '../core/Noise';
import { softDot, streakSprite, petalSprite } from './Textures';
import type { RenderSystem } from './Renderer';

export const skyUniforms = {
  uSunDir: { value: new Vector3(0.4, 0.6, -0.3) },
  uMoonDir: { value: new Vector3(-0.4, -0.6, 0.3) },
  uSunColor: { value: new Color(1, 0.93, 0.82) },
  uMoonColor: { value: new Color(0.55, 0.66, 0.95) },
  uZenith: { value: new Color(0.24, 0.46, 0.80) },
  uHorizon: { value: new Color(0.76, 0.85, 0.94) },
  uHaze: { value: new Color(0.72, 0.80, 0.88) },
  uTime: { value: 0 },
  uCloudiness: { value: 0.35 },
  uNight: { value: 0 },
  uOvercast: { value: 0 },
  uWindDir: { value: new Vector3(1, 0, 0.35).normalize() },
  uRain: { value: 0 },
};

/** Wind shared with all vegetation shaders. */
export const windUniforms = {
  uTime: skyUniforms.uTime,
  uWind: { value: 0.7 },
  uWindDir: { value: new Vector3(0.8, 0, 0.6) },
  uGust: { value: 1.0 },
};

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'mist';

export class Environment {
  scene: Scene;
  render: RenderSystem;
  sky!: Mesh;
  sun!: DirectionalLight;
  moon!: DirectionalLight;
  hemi!: HemisphereLight;
  ambient!: AmbientLight;
  timeOfDay = 7.6;      // hours 0..24
  dayLength = 24 * 60;  // seconds for a full in-game day
  paused = false;
  weather: WeatherKind = 'clear';
  private weatherTimer = 40;
  private lightning = 0;
  private lightningTimer = 12;
  // smoothed weather values
  private w = { cloud: 0.3, rain: 0, snow: 0, fog: 0, wind: 0.6, overcast: 0.15 };
  private wTarget = { cloud: 0.3, rain: 0, snow: 0, fog: 0, wind: 0.6, overcast: 0.15 };
  wind = new Vector3(0.8, 0, 0.6);
  private fxGroup = new Group();
  private rain: LineSegments | null = null;
  private snow: Points | null = null;
  private motes: Points | null = null;
  private fireflies: Points | null = null;
  private rainCount = 0;
  private snowCount = 0;
  private moteCount = 0;
  private tmpColor = new Color();
  sunColor = new Color(1, 0.93, 0.82);
  /** current sun direction (public so vegetation / water can read it) */
  sunDir = new Vector3(0.4, 0.6, -0.3);
  fogColor = new Color(0.76, 0.85, 0.94);
  fogDensity = 0.0012;
  private shadowTarget = new Vector3();

  constructor(scene: Scene, render: RenderSystem) {
    this.scene = scene;
    this.render = render;
    this.buildSky();
    this.buildLights();
    this.scene.add(this.fxGroup);
    this.setWeather('clear', true);
  }

  private buildSky() {
    const geo = new SphereGeometry(1, 48, 32);
    const mat = new ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      name: 'SkyDome',
    });
    this.sky = new Mesh(geo, mat);
    this.sky.scale.setScalar(1200);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.name = 'sky';
    this.scene.add(this.sky);
  }

  private buildLights() {
    this.sun = new DirectionalLight(0xfff1dd, 2.4);
    this.sun.castShadow = true;
    const q = this.render.quality;
    const s = q.shadowDistance;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 1; cam.far = s * 4 + 200;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.055;
    this.sun.shadow.radius = 2.2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new DirectionalLight(0x8fa8ff, 0.0);
    this.moon.castShadow = false;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.hemi = new HemisphereLight(0x9fc0e8, 0x4a4232, 0.55);
    this.scene.add(this.hemi);
    this.ambient = new AmbientLight(0x50607a, 0.22);
    this.scene.add(this.ambient);
  }

  setQuality() {
    const q = this.render.quality;
    const s = q.shadowDistance;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 1; cam.far = s * 4 + 200;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.buildPrecipitation(this.rainCount, this.snowCount, this.moteCount);
  }

  setTimeOfDay(hours: number) {
    this.timeOfDay = ((hours % 24) + 24) % 24;
  }

  /** 0..1 progress of the day (used by UI clock). */
  get dayProgress() { return this.timeOfDay / 24; }
  get isNight() { return skyUniforms.uNight.value > 0.5; }

  setWeather(kind: WeatherKind, instant = false) {
    this.weather = kind;
    const t = this.wTarget;
    switch (kind) {
      case 'clear': t.cloud = 0.22; t.rain = 0; t.snow = 0; t.fog = 0; t.wind = 0.55; t.overcast = 0.10; break;
      case 'cloudy': t.cloud = 0.72; t.rain = 0; t.snow = 0; t.fog = 0.25; t.wind = 0.8; t.overcast = 0.55; break;
      case 'rain': t.cloud = 0.92; t.rain = 0.75; t.snow = 0; t.fog = 0.45; t.wind = 1.1; t.overcast = 0.85; break;
      case 'storm': t.cloud = 1.0; t.rain = 1.0; t.snow = 0; t.fog = 0.55; t.wind = 1.7; t.overcast = 1.0; break;
      case 'snow': t.cloud = 0.85; t.rain = 0; t.snow = 1.0; t.fog = 0.5; t.wind = 0.5; t.overcast = 0.9; break;
      case 'mist': t.cloud = 0.5; t.rain = 0; t.snow = 0; t.fog = 1.0; t.wind = 0.25; t.overcast = 0.6; break;
    }
    if (instant) { Object.assign(this.w, t); this.applyWeather(0); }
  }

  private pickWeather() {
    const r = Math.random();
    const night = this.isNight;
    if (r < 0.36) this.setWeather('clear');
    else if (r < 0.56) this.setWeather('cloudy');
    else if (r < 0.72) this.setWeather(night ? 'mist' : 'rain');
    else if (r < 0.80) this.setWeather('mist');
    else if (r < 0.88) this.setWeather('storm');
    else this.setWeather('snow');
  }

  private applyWeather(dt: number) {
    const w = this.w;
    skyUniforms.uCloudiness.value = w.cloud;
    skyUniforms.uOvercast.value = w.overcast;
    skyUniforms.uRain.value = w.rain;
    windUniforms.uWind.value = w.wind;
    this.wind.set(this.wind.x, 0, this.wind.z).normalize().multiplyScalar(w.wind);
    const fogColor = this.tmpColor.copy(skyUniforms.uHorizon.value).lerp(new Color(0x9fb0be), 0.35);
    const base = 0.0012 * this.render.quality.fogDensity;
    const density = base + w.fog * 0.0062 * this.render.quality.fogDensity + w.rain * 0.0016;
    const fog = this.scene.fog as FogExp2;
    fog.color.lerp(fogColor, dt > 0 ? 1 - Math.exp(-2 * dt) : 1);
    fog.density = dt > 0 ? damp(fog.density, density, 1.2, dt) : density;
    this.fogColor.copy(fog.color);
    this.fogDensity = fog.density;
    this.render.renderer.setClearColor(fog.color, 1);
  }

  /** Build / rebuild precipitation particle systems for the current quality. */
  buildPrecipitation(rainCount: number, snowCount: number, moteCount: number) {
    this.disposeFX();
    this.rainCount = rainCount;
    this.snowCount = snowCount;
    this.moteCount = moteCount;

    // ---- rain (line segments) ----
    if (rainCount > 0) {
      const g = new BufferGeometry();
      const B = 60;
      const pos = new Float32Array(rainCount * 2 * 3);
      const seed = new Float32Array(rainCount * 2);
      const end = new Float32Array(rainCount * 2);
      for (let i = 0; i < rainCount; i++) {
        const x = Math.random() * B, y = Math.random() * B, z = Math.random() * B;
        for (let k = 0; k < 2; k++) {
          const j = (i * 2 + k) * 3;
          pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
          seed[i * 2 + k] = Math.random();
          end[i * 2 + k] = k;
        }
      }
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new BufferAttribute(seed, 1));
      g.setAttribute('aEnd', new BufferAttribute(end, 1));
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: skyUniforms.uTime,
          uCam: { value: new Vector3() },
          uWindDir: { value: new Vector3(0.8, 0, 0.6) },
          uAmount: { value: 0 },
          uBox: { value: B },
          uColor: { value: new Color(0.72, 0.82, 0.95) },
        },
        vertexShader: /* glsl */`
          attribute float aSeed; attribute float aEnd;
          uniform float uTime; uniform vec3 uCam; uniform vec3 uWindDir; uniform float uBox;
          varying float vA;
          void main(){
            float speed = 26.0 + aSeed * 22.0;
            vec3 p;
            p.x = uCam.x - uBox*0.5 + mod(position.x - uCam.x + uWindDir.x * uTime * 9.0, uBox);
            p.z = uCam.z - uBox*0.5 + mod(position.z - uCam.z + uWindDir.z * uTime * 9.0, uBox);
            p.y = uCam.y - uBox*0.35 + mod(position.y - uTime * speed - uCam.y, uBox);
            vec3 vel = normalize(vec3(uWindDir.x * 0.45, -1.0, uWindDir.z * 0.45));
            p += vel * aEnd * (1.1 + aSeed * 0.9);
            vA = aEnd;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */`
          uniform vec3 uColor; uniform float uAmount; varying float vA;
          void main(){
            float a = mix(0.55, 0.0, vA) * uAmount;
            gl_FragColor = vec4(uColor, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      this.rain = new LineSegments(g, mat);
      this.rain.frustumCulled = false;
      this.rain.visible = false;
      this.fxGroup.add(this.rain);
    }

    // ---- snow (points) ----
    if (snowCount > 0) {
      const g = new BufferGeometry();
      const B = 55;
      const pos = new Float32Array(snowCount * 3);
      const seed = new Float32Array(snowCount);
      for (let i = 0; i < snowCount; i++) {
        pos[i * 3] = Math.random() * B;
        pos[i * 3 + 1] = Math.random() * B;
        pos[i * 3 + 2] = Math.random() * B;
        seed[i] = Math.random();
      }
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new BufferAttribute(seed, 1));
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: skyUniforms.uTime,
          uCam: { value: new Vector3() },
          uBox: { value: B },
          uAmount: { value: 0 },
          uMap: { value: softDot() },
          uPx: { value: window.innerHeight * 0.5 },
        },
        vertexShader: /* glsl */`
          attribute float aSeed;
          uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uPx;
          varying float vA;
          void main(){
            float speed = 1.6 + aSeed * 1.8;
            vec3 p;
            p.y = uCam.y - uBox*0.35 + mod(position.y - uTime*speed - uCam.y, uBox);
            float sway = sin(uTime * 0.9 + aSeed * 30.0) * 1.4;
            p.x = uCam.x - uBox*0.5 + mod(position.x + sway - uCam.x, uBox);
            p.z = uCam.z - uBox*0.5 + mod(position.z + cos(uTime*0.7 + aSeed*22.0)*1.2 - uCam.z, uBox);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (2.0 + aSeed*3.5) * uPx / max(1.0, -mv.z) * 0.06;
            vA = 1.0;
          }
        `,
        fragmentShader: /* glsl */`
          uniform sampler2D uMap; uniform float uAmount; varying float vA;
          void main(){
            vec4 t = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(vec3(1.0), t.a * uAmount * 0.85);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      this.snow = new Points(g, mat);
      this.snow.frustumCulled = false;
      this.snow.visible = false;
      this.fxGroup.add(this.snow);
    }

    // ---- floating motes / petals (day) ----
    if (moteCount > 0) {
      const g = new BufferGeometry();
      const B = 70;
      const pos = new Float32Array(moteCount * 3);
      const seed = new Float32Array(moteCount);
      for (let i = 0; i < moteCount; i++) {
        pos[i * 3] = Math.random() * B;
        pos[i * 3 + 1] = Math.random() * B * 0.6;
        pos[i * 3 + 2] = Math.random() * B;
        seed[i] = Math.random();
      }
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new BufferAttribute(seed, 1));
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: skyUniforms.uTime,
          uCam: { value: new Vector3() },
          uBox: { value: B },
          uAmount: { value: 1 },
          uMap: { value: petalSprite() },
          uPx: { value: window.innerHeight * 0.5 },
          uNight: skyUniforms.uNight,
        },
        vertexShader: /* glsl */`
          attribute float aSeed;
          uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uPx; uniform float uNight;
          varying float vA; varying float vSeed;
          void main(){
            vec3 p;
            float fall = 0.5 + aSeed * 1.4;
            p.y = uCam.y - uBox*0.25 + mod(position.y - uTime*fall - uCam.y, uBox);
            p.x = uCam.x - uBox*0.5 + mod(position.x + sin(uTime*0.8 + aSeed*24.0)*2.2 - uCam.x, uBox);
            p.z = uCam.z - uBox*0.5 + mod(position.z + cos(uTime*0.6 + aSeed*17.0)*2.0 - uCam.z, uBox);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (6.0 + aSeed*10.0) * uPx / max(1.0, -mv.z) * 0.09 * (1.0 - uNight*0.65);
            vA = 1.0; vSeed = aSeed;
          }
        `,
        fragmentShader: /* glsl */`
          uniform sampler2D uMap; uniform float uAmount; uniform float uNight;
          varying float vA; varying float vSeed;
          void main(){
            vec4 t = texture2D(uMap, gl_PointCoord);
            float a = t.a * uAmount * (1.0 - uNight * 0.8) * (0.35 + 0.65 * vSeed);
            if (a < 0.01) discard;
            gl_FragColor = vec4(t.rgb, a);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      this.motes = new Points(g, mat);
      this.motes.frustumCulled = false;
      this.fxGroup.add(this.motes);
    }

    // ---- fireflies (night) ----
    {
      const n = Math.floor(this.render.quality.ambientParticles * 0.5);
      const g = new BufferGeometry();
      const B = 60;
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = Math.random() * B;
        pos[i * 3 + 1] = Math.random() * 8;
        pos[i * 3 + 2] = Math.random() * B;
        seed[i] = Math.random();
      }
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new BufferAttribute(seed, 1));
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: skyUniforms.uTime,
          uCam: { value: new Vector3() },
          uBox: { value: B },
          uNight: skyUniforms.uNight,
          uMap: { value: softDot() },
          uPx: { value: window.innerHeight * 0.5 },
        },
        vertexShader: /* glsl */`
          attribute float aSeed;
          uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uPx; uniform float uNight;
          varying float vA;
          void main(){
            vec3 p;
            p.y = uCam.y - 4.0 + mod(position.y + sin(uTime*0.5+aSeed*30.0)*1.2 - uCam.y, uBox*0.35);
            p.x = uCam.x - uBox*0.5 + mod(position.x + sin(uTime*0.35 + aSeed*40.0)*3.0 - uCam.x, uBox);
            p.z = uCam.z - uBox*0.5 + mod(position.z + cos(uTime*0.29 + aSeed*33.0)*3.0 - uCam.z, uBox);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (2.0 + aSeed*3.0) * uPx / max(1.0, -mv.z) * 0.22;
            vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (1.5 + aSeed*3.0) + aSeed * 60.0));
          }
        `,
        fragmentShader: /* glsl */`
          uniform sampler2D uMap; uniform float uNight; varying float vA;
          void main(){
            vec4 t = texture2D(uMap, gl_PointCoord);
            float a = t.a * vA * uNight * 0.9;
            if (a < 0.01) discard;
            gl_FragColor = vec4(1.0, 0.92, 0.45, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      this.fireflies = new Points(g, mat);
      this.fireflies.frustumCulled = false;
      this.fxGroup.add(this.fireflies);
    }
  }

  private disposeFX() {
    for (const o of [this.rain, this.snow, this.motes, this.fireflies]) {
      if (!o) continue;
      this.fxGroup.remove(o);
      o.geometry.dispose();
      (o.material as any).dispose();
    }
    this.rain = this.snow = this.motes = this.fireflies = null;
  }

  update(dt: number, playerPos: Vector3, cameraPos: Vector3) {
    if (!this.paused) {
      this.timeOfDay += (dt / this.dayLength) * 24;
      if (this.timeOfDay >= 24) this.timeOfDay -= 24;
    }
    const t = this.timeOfDay;
    // sun / moon position on the celestial arc
    const ang = ((t - 6) / 12) * Math.PI;
    const sunDir = skyUniforms.uSunDir.value.set(Math.cos(ang), Math.sin(ang), -0.36).normalize();
    this.sunDir.copy(sunDir);
    skyUniforms.uMoonDir.value.copy(sunDir).negate();
    skyUniforms.uTime.value += dt;

    // ---- colour grading of the sky by sun elevation ----
    const elev = sunDir.y;
    const night = smoothstep(0.10, -0.14, elev);
    skyUniforms.uNight.value = night;
    const golden = clamp01(1 - Math.abs(elev) * 3.4) * (1 - night);
    const dayW = clamp01(smoothstep(-0.05, 0.35, elev));

    const dayZenith = new Color(0.20, 0.42, 0.80);
    const dayHorizon = new Color(0.74, 0.84, 0.94);
    const setZenith = new Color(0.19, 0.24, 0.50);
    const setHorizon = new Color(1.0, 0.55, 0.30);
    const nightZenith = new Color(0.015, 0.025, 0.075);
    const nightHorizon = new Color(0.05, 0.075, 0.145);

    const zen = dayZenith.clone().lerp(setZenith, golden).lerp(nightZenith, night);
    const hor = dayHorizon.clone().lerp(setHorizon, golden * 0.9).lerp(nightHorizon, night);
    skyUniforms.uZenith.value.lerp(zen, 0.15);
    skyUniforms.uHorizon.value.lerp(hor, 0.15);
    skyUniforms.uHaze.value.copy(hor).lerp(dayHorizon, 0.4);

    const sunCol = new Color(1.0, 0.93, 0.82).lerp(new Color(1.0, 0.44, 0.16), golden * 0.95)
      .lerp(new Color(0.35, 0.30, 0.42), night);
    skyUniforms.uSunColor.value.lerp(sunCol, 0.15);
    this.sunColor.copy(skyUniforms.uSunColor.value);

    // ---- lighting ----
    const overcast = this.w.overcast;
    const sunI = Math.max(0, elev) * 3.1 * (1 - overcast * 0.72) + 0.02;
    this.sun.intensity = lerpN(this.sun.intensity, sunI, 0.2);
    this.sun.color.copy(skyUniforms.uSunColor.value);
    this.sun.visible = this.sun.intensity > 0.02;

    const moonI = night * 0.55 * (1 - overcast * 0.8);
    this.moon.intensity = lerpN(this.moon.intensity, moonI, 0.2);
    this.moon.color.copy(skyUniforms.uMoonColor.value);
    this.moon.visible = this.moon.intensity > 0.01;

    const hemiI = (0.30 + 0.55 * dayW) * (1 - night * 0.72) + night * 0.14;
    this.hemi.intensity = lerpN(this.hemi.intensity, hemiI + overcast * 0.18, 0.2);
    (this.hemi.color as Color).lerp(dayHorizon.clone().lerp(nightHorizon, night), 0.08);
    this.ambient.intensity = lerpN(this.ambient.intensity, 0.16 + night * 0.06 + overcast * 0.10, 0.2);

    // directional light rig follows the player so shadows stay crisp
    this.shadowTarget.copy(playerPos);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(sunDir, this.render.quality.shadowDistance * 1.6 + 60);
    this.moon.target.position.copy(this.shadowTarget);
    this.moon.position.copy(this.shadowTarget).addScaledVector(skyUniforms.uMoonDir.value, 160);

    // ---- weather transitions ----
    const k = dt > 0 ? 1 - Math.exp(-0.35 * dt) : 1;
    this.w.cloud = lerpN(this.w.cloud, this.wTarget.cloud, k);
    this.w.rain = lerpN(this.w.rain, this.wTarget.rain, k);
    this.w.snow = lerpN(this.w.snow, this.wTarget.snow, k);
    this.w.fog = lerpN(this.w.fog, this.wTarget.fog, k);
    this.w.wind = lerpN(this.w.wind, this.wTarget.wind, k);
    this.w.overcast = lerpN(this.w.overcast, this.wTarget.overcast, k);
    this.applyWeather(dt);

    if (!this.paused) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) { this.weatherTimer = 70 + Math.random() * 130; this.pickWeather(); }
    }

    // lightning during storms
    if (this.w.rain > 0.7) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 14;
        this.lightning = 1;
      }
    }
    if (this.lightning > 0) {
      this.lightning = Math.max(0, this.lightning - dt * 3.4);
      const f = this.lightning * this.lightning;
      this.ambient.intensity += f * 1.6;
      this.sun.intensity += f * 3.0;
      if (f > 0.85) this.render.flash(new Color(0.85, 0.9, 1.0), f * 0.5);
    }

    // ---- fx transforms ----
    if (this.rain) {
      const u = (this.rain.material as ShaderMaterial).uniforms;
      u.uCam.value.copy(cameraPos);
      u.uAmount.value = this.w.rain;
      (u.uWindDir.value as Vector3).set(this.wind.x, 0, this.wind.z);
      this.rain.visible = this.w.rain > 0.02;
    }
    if (this.snow) {
      const u = (this.snow.material as ShaderMaterial).uniforms;
      u.uCam.value.copy(cameraPos);
      u.uAmount.value = clamp01(this.w.snow);
      this.snow.visible = this.w.snow > 0.02;
    }
    if (this.motes) {
      const u = (this.motes.material as ShaderMaterial).uniforms;
      u.uCam.value.copy(cameraPos);
      u.uAmount.value = 0.75;
      u.uPx.value = window.innerHeight * 0.5 * this.render.renderer.getPixelRatio();
    }
    if (this.fireflies) {
      const u = (this.fireflies.material as ShaderMaterial).uniforms;
      u.uCam.value.copy(cameraPos);
      u.uPx.value = window.innerHeight * 0.5 * this.render.renderer.getPixelRatio();
    }

    // wind direction slowly rotates
    const wa = skyUniforms.uTime.value * 0.017;
    const wd = this.wind.set(Math.cos(wa) * 0.85 + 0.2, 0, Math.sin(wa * 0.7) * 0.85).normalize().multiplyScalar(this.w.wind);
    windUniforms.uWindDir.value.set(wd.x, 0, wd.z);
    skyUniforms.uWindDir.value.set(wd.x, 0, wd.z).normalize();
    windUniforms.uGust.value = 0.75 + 0.35 * Math.sin(skyUniforms.uTime.value * 0.23)
      + 0.18 * Math.sin(skyUniforms.uTime.value * 0.71);
  }

  get rainAmount() { return this.w.rain; }
  get snowAmount() { return this.w.snow; }
  get fogAmount() { return this.w.fog; }

  timeString(): string {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
