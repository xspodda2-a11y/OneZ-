import {
  WebGLRenderer, Scene, PerspectiveCamera, Vector2, Vector3, Color, FogExp2,
  WebGLRenderTarget, HalfFloatType, ACESFilmicToneMapping, SRGBColorSpace,
  PCFSoftShadowMap,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type QualityName = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface QualityPreset {
  name: QualityName;
  pixelRatio: number;
  msaa: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  bloom: boolean;
  bloomStrength: number;
  ao: boolean;
  chunkRadius: number;
  grassDensity: number;
  grassDistance: number;
  vegetationDistance: number;
  particleScale: number;
  waterSegments: number;
  fogDensity: number;
  lodBias: number;
  ambientParticles: number;
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  LOW: {
    name: 'LOW', pixelRatio: 0.72, msaa: 0, shadows: true, shadowMapSize: 1024, shadowDistance: 70,
    bloom: false, bloomStrength: 0.35, ao: false, chunkRadius: 2, grassDensity: 0.25, grassDistance: 40,
    vegetationDistance: 150, particleScale: 0.4, waterSegments: 48, fogDensity: 1.0, lodBias: 1.35,
    ambientParticles: 90,
  },
  MEDIUM: {
    name: 'MEDIUM', pixelRatio: 1.0, msaa: 0, shadows: true, shadowMapSize: 2048, shadowDistance: 110,
    bloom: true, bloomStrength: 0.45, ao: false, chunkRadius: 3, grassDensity: 0.6, grassDistance: 70,
    vegetationDistance: 240, particleScale: 0.7, waterSegments: 96, fogDensity: 1.0, lodBias: 1.0,
    ambientParticles: 180,
  },
  HIGH: {
    name: 'HIGH', pixelRatio: Math.min(devicePixelRatio, 1.5), msaa: 4, shadows: true, shadowMapSize: 2048,
    shadowDistance: 150, bloom: true, bloomStrength: 0.55, ao: true, chunkRadius: 3, grassDensity: 1.0,
    grassDistance: 110, vegetationDistance: 340, particleScale: 1.0, waterSegments: 160, fogDensity: 1.0,
    lodBias: 1.0, ambientParticles: 320,
  },
  ULTRA: {
    name: 'ULTRA', pixelRatio: Math.min(devicePixelRatio, 2), msaa: 4, shadows: true, shadowMapSize: 4096,
    shadowDistance: 190, bloom: true, bloomStrength: 0.62, ao: true, chunkRadius: 4, grassDensity: 1.5,
    grassDistance: 150, vegetationDistance: 460, particleScale: 1.35, waterSegments: 220, fogDensity: 1.0,
    lodBias: 1.0, ambientParticles: 520,
  },
};

/** Final colour-grade / vignette / grain / chromatic-aberration pass. */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0016 },
    uTint: { value: new Color(1, 1, 1) },
    uLift: { value: new Color(0.015, 0.017, 0.026) },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 0.9, 0.85) },
    uUnderwater: { value: 0 },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uSaturation, uContrast, uGrain, uAberration, uFlash, uUnderwater, uExposure;
    uniform vec3 uTint, uLift, uFlashColor;
    varying vec2 vUv;

    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d,d);
      float ab = uAberration * (1.0 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ab).b;

      col *= uExposure;
      float lum = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(lum), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uTint;
      col += uLift;

      // vignette
      float v = smoothstep(0.95, 0.22, r2 * 1.9);
      col *= mix(1.0, v, uVignette);

      if (uUnderwater > 0.001) {
        vec3 uw = vec3(0.055,0.20,0.26);
        float caustic = 0.5 + 0.5 * sin(uv.x*28.0 + uTime*1.7) * sin(uv.y*22.0 - uTime*1.3);
        col = mix(col, col * uw * 2.1 + uw * caustic * 0.25, uUnderwater);
      }

      if (uFlash > 0.001) col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));

      // film grain
      float g = rand(uv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class RenderSystem {
  renderer: WebGLRenderer;
  composer!: EffectComposer;
  camera: PerspectiveCamera;
  scene: Scene;
  quality: QualityPreset = QUALITY.HIGH;
  bloomPass!: UnrealBloomPass;
  gradePass!: ShaderPass;
  gtao: GTAOPass | null = null;
  renderPass!: RenderPass;
  private _size = new Vector2(1, 1);
  fps = 60;
  private frameTimes: number[] = [];
  private lastTime = performance.now();
  /** auto quality: degrades resolution scale when fps is poor */
  adaptive = true;
  resolutionScale = 1.0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setClearColor(0x0a0d12, 1);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new Scene();
    this.scene.fog = new FogExp2(0xbfd0dd, 0.0016);
    this.camera = new PerspectiveCamera(58, 1, 0.1, 2400);
    this.camera.position.set(0, 30, 30);
    this.buildComposer();
    this.resize();
  }

  private buildComposer() {
    const size = this._size.clone();
    const rt = new WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(this.scene, this.camera, Math.max(2, size.x), Math.max(2, size.y));
    this.gtao.output = GTAOPass.OUTPUT.Default;
    (this.gtao as any).updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.0, scale: 1.1, samples: 12 });
    this.gtao.enabled = this.quality.ao;
    this.composer.addPass(this.gtao);

    this.bloomPass = new UnrealBloomPass(new Vector2(size.x, size.y), this.quality.bloomStrength, 0.7, 0.86);
    this.bloomPass.enabled = this.quality.bloom;
    this.composer.addPass(this.bloomPass);

    const out = new OutputPass();
    this.composer.addPass(out);

    this.gradePass = new ShaderPass(GradeShader as any);
    this.composer.addPass(this.gradePass);
  }

  setQuality(name: QualityName) {
    this.quality = QUALITY[name];
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.bloomPass.enabled = q.bloom;
    this.bloomPass.strength = q.bloomStrength;
    if (this.gtao) this.gtao.enabled = q.ao;
    this.gradePass.uniforms.uAberration.value = name === 'LOW' ? 0.0 : 0.0016;
    this.gradePass.uniforms.uGrain.value = name === 'LOW' ? 0.015 : 0.035;
    this.resize(true);
  }

  resize(force = false) {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._size.set(w, h);
    const dw = Math.max(2, Math.floor(w * pr)), dh = Math.max(2, Math.floor(h * pr));
    this.composer.setSize(w, h);
    if (this.gtao) this.gtao.setSize(dw, dh);
    this.bloomPass.setSize(dw, dh);
    if (force) this.renderer.setPixelRatio(pr);
  }

  setUnderwater(v: number) { this.gradePass.uniforms.uUnderwater.value = v; }
  flash(color: Color, amount: number) {
    this.gradePass.uniforms.uFlashColor.value.copy(color);
    this.gradePass.uniforms.uFlash.value = amount;
  }
  setExposure(e: number) { this.gradePass.uniforms.uExposure.value = e; }
  setTint(c: Color) { this.gradePass.uniforms.uTint.value.copy(c); }

  render(dt: number, time: number) {
    this.gradePass.uniforms.uTime.value = time;
    const f = this.gradePass.uniforms.uFlash.value as number;
    if (f > 0) this.gradePass.uniforms.uFlash.value = Math.max(0, f - dt * 3.2);
    this.composer.render(dt);

    // adaptive resolution
    const now = performance.now();
    const ms = now - this.lastTime;
    this.lastTime = now;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1000 / Math.max(0.01, avg);
    if (this.adaptive && this.frameTimes.length >= 60) {
      if (this.fps < 42 && this.resolutionScale > 0.6) {
        this.resolutionScale = Math.max(0.6, this.resolutionScale - 0.08);
        this.resize();
        this.frameTimes.length = 0;
      } else if (this.fps > 58 && this.resolutionScale < 1.0) {
        this.resolutionScale = Math.min(1.0, this.resolutionScale + 0.05);
        this.resize();
        this.frameTimes.length = 0;
      }
    }
  }

  get drawCalls() { return this.renderer.info.render.calls; }
  get triangles() { return this.renderer.info.render.triangles; }
}

export const _v3 = new Vector3();
