import { Vector3 } from 'three';
import { WORLD, heightAt } from '../core/TerrainHeight';
import { clamp, clamp01, lerpN } from '../core/Noise';

export type MusicState = 'menu' | 'explore' | 'combat' | 'boss' | 'sad' | 'none';

/**
 * Every sound in Winds of Eternity is synthesised at runtime with the Web Audio
 * API: no audio files, zero download weight, fully original score.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  comp!: DynamicsCompressorNode;
  ready = false;
  musicVolume = 0.7;
  sfxVolume = 0.85;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private nextNoteTime = 0;
  private step = 0;
  private music: MusicState = 'none';
  private targetMusic: MusicState = 'none';
  private crossfade = 0;
  private musicTimer = 0;
  private birdTimer = 6;
  private currentMusicNodes: AudioNode[] = [];
  private state: 'menu' | 'explore' | 'combat' | 'boss' | 'sad' = 'explore';

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume * 0.75;
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.6;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

    // noise buffer (2s brown-ish noise)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2 + white * 0.35;
    }

    this.buildAmbient();
    this.ready = true;
  }

  private buildAmbient() {
    const ctx = this.ctx!;
    // wind
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.06;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.ambBus);
    src.start();

    // water stream
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noiseBuf;
    src2.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    src2.connect(bp); bp.connect(hp); hp.connect(this.waterGain);
    this.waterGain.connect(this.ambBus);
    src2.start();

    // slow LFO on the wind filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(this.windFilter.frequency);
    lfo.start();
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ready) return;
    this.musicBus.gain.value = music * 0.5;
    this.sfxBus.gain.value = sfx * 0.75;
  }

  /* -------------------------------------------------------------- helpers */

  private noise(duration: number, gain: number, filter: BiquadFilterType, freq: number, q = 1, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    if (sweepTo !== undefined) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    }
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + duration + 0.05);
    return g;
  }

  private tone(
    freq: number, duration: number, gain: number, type: OscillatorType = 'sine',
    opts: { sweepTo?: number; attack?: number; detune?: number; filter?: number; vibrato?: number } = {},
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      o.connect(f);
      node = f;
    }
    if (opts.sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t + duration);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.vibrato;
      const lg = ctx.createGain();
      lg.gain.value = freq * 0.012;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + duration + 0.05);
    }
    node.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + duration + 0.05);
    return g;
  }

  /* ------------------------------------------------------------------ sfx */

  play(name: string, volume = 1) {
    if (!this.ready || !this.ctx) return;
    const v = volume;
    switch (name) {
      case 'swing':
        this.noise(0.22, 0.5 * v, 'bandpass', 900, 1.6, 3200);
        this.tone(420, 0.12, 0.06 * v, 'triangle', { sweepTo: 900 });
        break;
      case 'swingHeavy':
        this.noise(0.36, 0.6 * v, 'bandpass', 500, 1.2, 2400);
        this.tone(220, 0.24, 0.09 * v, 'sawtooth', { sweepTo: 620, filter: 1400 });
        break;
      case 'swingWindup':
        this.noise(0.3, 0.18 * v, 'bandpass', 300, 2.0, 1100);
        break;
      case 'thrust':
        this.noise(0.26, 0.42 * v, 'highpass', 900, 1.0, 2600);
        break;
      case 'hit':
        this.noise(0.16, 0.55 * v, 'lowpass', 1400, 1, 300);
        this.tone(120, 0.16, 0.35 * v, 'sine', { sweepTo: 60 });
        break;
      case 'hitWood':
        this.tone(280, 0.14, 0.3 * v, 'square', { sweepTo: 150, filter: 900 });
        this.noise(0.1, 0.3 * v, 'bandpass', 1200, 2);
        break;
      case 'impact':
        this.noise(0.18, 0.4 * v, 'lowpass', 2200, 1, 400);
        this.tone(180, 0.22, 0.22 * v, 'triangle', { sweepTo: 90 });
        break;
      case 'block':
        this.tone(1800, 0.24, 0.14 * v, 'square', { sweepTo: 900, filter: 4200 });
        this.tone(2400, 0.2, 0.09 * v, 'sine', { sweepTo: 1200 });
        this.noise(0.14, 0.35 * v, 'bandpass', 2600, 3);
        break;
      case 'parry':
        this.tone(2400, 0.5, 0.18 * v, 'sine', { sweepTo: 1800 });
        this.tone(3600, 0.42, 0.11 * v, 'sine', { sweepTo: 2400 });
        this.tone(1200, 0.6, 0.09 * v, 'triangle');
        this.noise(0.22, 0.3 * v, 'highpass', 3000);
        break;
      case 'parryReady':
        this.tone(1400, 0.14, 0.07 * v, 'triangle', { sweepTo: 2000 });
        break;
      case 'dodge':
        this.noise(0.3, 0.3 * v, 'bandpass', 700, 0.9, 2200);
        break;
      case 'dodgePerfect':
        this.tone(1800, 0.35, 0.12 * v, 'sine', { sweepTo: 2600 });
        this.noise(0.2, 0.16 * v, 'highpass', 2000);
        break;
      case 'counter':
        this.tone(300, 0.4, 0.22 * v, 'sawtooth', { sweepTo: 1400, filter: 3000 });
        this.noise(0.3, 0.4 * v, 'bandpass', 1600, 1.4, 4200);
        break;
      case 'footstep':
        this.noise(0.09, 0.16 * v, 'lowpass', 700 + Math.random() * 200, 1.2);
        break;
      case 'footstep2':
        this.noise(0.08, 0.14 * v, 'lowpass', 500 + Math.random() * 200, 1.4);
        break;
      case 'footstepWater':
        this.noise(0.22, 0.24 * v, 'bandpass', 1400, 0.8, 600);
        break;
      case 'jump':
        this.noise(0.16, 0.16 * v, 'lowpass', 800, 1, 1600);
        this.tone(220, 0.14, 0.08 * v, 'sine', { sweepTo: 400 });
        break;
      case 'land':
        this.noise(0.22, 0.3 * v, 'lowpass', 500, 1, 180);
        this.tone(90, 0.2, 0.2 * v, 'sine', { sweepTo: 50 });
        break;
      case 'wallrun':
        this.noise(0.5, 0.12 * v, 'bandpass', 900, 1.2, 1800);
        break;
      case 'dash':
        this.noise(0.34, 0.35 * v, 'bandpass', 500, 1.1, 3000);
        this.tone(400, 0.2, 0.06 * v, 'triangle', { sweepTo: 1200 });
        break;
      case 'draw':
        this.tone(1600, 0.5, 0.14 * v, 'sine', { sweepTo: 3200 });
        this.tone(2400, 0.4, 0.08 * v, 'sine', { sweepTo: 4200 });
        this.noise(0.3, 0.14 * v, 'highpass', 2600);
        break;
      case 'splash':
        this.noise(0.6, 0.4 * v, 'bandpass', 1600, 0.6, 400);
        break;
      case 'swim':
        this.noise(0.4, 0.16 * v, 'bandpass', 900, 0.7, 500);
        break;
      case 'playerHurt':
        this.tone(160, 0.3, 0.26 * v, 'sawtooth', { sweepTo: 80, filter: 900 });
        this.noise(0.24, 0.3 * v, 'lowpass', 900, 1, 300);
        break;
      case 'enemyDeath':
        this.tone(300, 0.5, 0.16 * v, 'sawtooth', { sweepTo: 70, filter: 1200 });
        this.noise(0.4, 0.2 * v, 'lowpass', 1200, 1, 200);
        break;
      case 'playerDeath':
        this.tone(200, 1.4, 0.3 * v, 'sine', { sweepTo: 45, filter: 700 });
        this.tone(134, 1.6, 0.2 * v, 'triangle', { sweepTo: 40 });
        break;
      case 'enemyAlert':
        this.tone(500, 0.16, 0.14 * v, 'square', { sweepTo: 800, filter: 2200 });
        this.tone(760, 0.2, 0.1 * v, 'square', { sweepTo: 1000, filter: 2400 });
        break;
      case 'npcHurt':
        this.tone(420, 0.2, 0.12 * v, 'triangle', { sweepTo: 260 });
        break;
      case 'levelup':
        [0, 0.08, 0.16, 0.28].forEach((t, i) => {
          setTimeout(() => this.tone([523, 587, 698, 880][i], 0.5, 0.13 * v, 'triangle', { vibrato: 5 }), t * 1000);
        });
        break;
      case 'quest':
        this.tone(660, 0.3, 0.1 * v, 'sine');
        setTimeout(() => this.tone(880, 0.4, 0.1 * v, 'sine'), 120);
        break;
      case 'questComplete':
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, 0.12 * v, 'triangle', { vibrato: 5 }), i * 110));
        break;
      case 'pickup':
        this.tone(880, 0.12, 0.09 * v, 'sine');
        setTimeout(() => this.tone(1320, 0.2, 0.08 * v, 'sine'), 70);
        break;
      case 'coin':
        this.tone(1500, 0.1, 0.07 * v, 'square', { filter: 3000 });
        setTimeout(() => this.tone(2100, 0.14, 0.06 * v, 'square', { filter: 3000 }), 60);
        break;
      case 'uiClick':
        this.tone(720, 0.06, 0.06 * v, 'sine');
        break;
      case 'uiHover':
        this.tone(520, 0.04, 0.03 * v, 'sine');
        break;
      case 'uiBack':
        this.tone(420, 0.09, 0.05 * v, 'sine');
        break;
      case 'uiError':
        this.tone(180, 0.16, 0.08 * v, 'square', { filter: 900 });
        break;
      case 'chest':
        this.noise(0.4, 0.2 * v, 'bandpass', 700, 1.2, 1600);
        [660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 0.1 * v, 'sine'), i * 90));
        break;
      case 'heal':
        this.tone(660, 0.5, 0.1 * v, 'sine', { sweepTo: 990 });
        this.tone(990, 0.6, 0.06 * v, 'sine');
        break;
      case 'special1':
        this.noise(0.8, 0.4 * v, 'bandpass', 600, 0.8, 2600);
        this.tone(180, 0.7, 0.14 * v, 'sawtooth', { sweepTo: 700, filter: 2000 });
        break;
      case 'special2':
        this.noise(0.5, 0.45 * v, 'bandpass', 800, 1.0, 3600);
        this.tone(1200, 0.5, 0.16 * v, 'triangle', { sweepTo: 200 });
        break;
      case 'telegraph':
        this.tone(140, 0.5, 0.16 * v, 'sawtooth', { sweepTo: 90, filter: 600 });
        break;
      case 'slam':
        this.tone(70, 0.7, 0.4 * v, 'sine', { sweepTo: 35 });
        this.noise(0.6, 0.4 * v, 'lowpass', 700, 1, 120);
        break;
      case 'bossRoar':
        this.tone(90, 1.6, 0.3 * v, 'sawtooth', { sweepTo: 150, filter: 500 });
        this.tone(140, 1.4, 0.16 * v, 'square', { sweepTo: 200, filter: 700 });
        this.noise(1.2, 0.2 * v, 'lowpass', 500, 0.8, 160);
        break;
      case 'thunder':
        this.noise(2.4, 0.5 * v, 'lowpass', 900, 0.6, 90);
        this.tone(50, 2.0, 0.28 * v, 'sine', { sweepTo: 28 });
        break;
      case 'fire':
        this.noise(0.6, 0.1 * v, 'bandpass', 900, 0.5, 400);
        break;
      case 'lockon':
        this.tone(1200, 0.08, 0.06 * v, 'sine');
        break;
      case 'craft':
        this.tone(300, 0.3, 0.1 * v, 'triangle', { sweepTo: 600 });
        this.noise(0.3, 0.14 * v, 'bandpass', 1600, 2);
        break;
      default:
        this.tone(500, 0.1, 0.05 * v, 'sine');
    }
  }

  /* ---------------------------------------------------------------- music */

  setMusic(state: MusicState) {
    if (this.targetMusic === state) return;
    this.targetMusic = state;
    this.crossfade = 0;
  }

  /** D-pentatonic scale (Hz) spanning three octaves. */
  private scale = [146.83, 164.81, 196.00, 220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];

  private noteFor(step: number, mood: string): number | null {
    const idx = [0, 2, 4, 7, 9, 11, 12, 14, 16];
    const s = this.step;
    if (mood === 'menu') {
      if (s % 8 === 0) return this.scale[3 + (s % 3)];
      if (s % 8 === 4) return this.scale[2];
      return null;
    }
    if (mood === 'explore') {
      if (s % 4 === 0) return this.scale[idx[(s / 4) % idx.length] % this.scale.length];
      if (s % 8 === 6) return this.scale[5 + (s % 4)];
      return null;
    }
    if (mood === 'combat') {
      if (s % 2 === 0) return this.scale[idx[(s / 2) % idx.length] % this.scale.length];
      return null;
    }
    if (mood === 'boss') {
      if (s % 2 === 0) return this.scale[idx[(s / 2) % idx.length] % this.scale.length];
      if (s % 8 === 5) return this.scale[1] / 2;
      return null;
    }
    if (mood === 'sad') {
      if (s % 8 === 0) return this.scale[idx[(s / 8) % idx.length] % this.scale.length];
      return null;
    }
    return null;
  }

  private tempo(mood: string) {
    return mood === 'combat' ? 0.20 : mood === 'boss' ? 0.17 : mood === 'sad' ? 0.72 : mood === 'menu' ? 0.62 : 0.46;
  }

  private pluck(freq: number, time: number, gain = 0.16, dur = 1.6, bright = 2600) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq * 2.005;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(bright, time);
    f.frequency.exponentialRampToValueAtTime(400, time + dur);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    o.connect(f); o2.connect(g2); g2.connect(f);
    f.connect(g); g.connect(this.musicBus);
    o.start(time); o2.start(time);
    o.stop(time + dur + 0.1); o2.stop(time + dur + 0.1);
  }

  private bow(freq: number, time: number, dur: number, gain = 0.09) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.value = freq * 0.014;
    lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + dur * 0.28);
    g.gain.setValueAtTime(gain, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(time); lfo.start(time);
    o.stop(time + dur + 0.1); lfo.stop(time + dur + 0.1);
  }

  private flute(freq: number, time: number, dur: number, gain = 0.1) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.4;
    const lg = ctx.createGain();
    lg.gain.value = freq * 0.008;
    lfo.connect(lg); lg.connect(o.frequency);
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuf;
    breath.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2;
    bp.Q.value = 1.2;
    const bg = ctx.createGain();
    bg.gain.value = 0.03;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.12);
    g.gain.setValueAtTime(gain, time + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    breath.connect(bp); bp.connect(bg); bg.connect(g);
    g.connect(this.musicBus);
    o.start(time); lfo.start(time); breath.start(time);
    o.stop(time + dur); lfo.stop(time + dur); breath.stop(time + dur);
  }

  private drum(time: number, gain = 0.24, low = 62) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(low * 2.4, time);
    o.frequency.exponentialRampToValueAtTime(low, time + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    o.connect(g); g.connect(this.musicBus);
    o.start(time); o.stop(time + 0.4);
  }

  private pad(time: number, dur: number, root: number) {
    const ctx = this.ctx!;
    for (const mul of [1, 1.5, 2]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = root * mul;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.035, time + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      o.connect(f); f.connect(g); g.connect(this.musicBus);
      o.start(time); o.stop(time + dur + 0.1);
    }
  }

  private updateMusic(dt: number) {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx;
    // crossfade states
    if (this.crossfade < 1) {
      this.crossfade = Math.min(1, this.crossfade + dt * 0.5);
      if (this.crossfade >= 1) { this.music = this.targetMusic; this.step = 0; }
    }
    const mood = this.music === 'none' ? '' : this.music;
    if (!mood) return;
    const now = ctx.currentTime;
    if (this.nextNoteTime < now) this.nextNoteTime = now + 0.05;
    while (this.nextNoteTime < now + 0.3) {
      const step = this.step;
      const t = this.nextNoteTime;
      const bar = Math.floor(step / 8);
      if (step % 8 === 0) {
        this.pad(t, this.tempo(mood) * 8, this.scale[[0, 2, 3, 1][bar % 4]]);
      }
      const n = this.noteFor(step, mood);
      if (n) {
        if (mood === 'explore' || mood === 'menu') {
          this.pluck(n, t, mood === 'menu' ? 0.12 : 0.15, 1.9, mood === 'menu' ? 1800 : 2800);
          if (step % 16 === 8) this.flute(n * 2, t, this.tempo(mood) * 5, 0.055);
        } else if (mood === 'combat') {
          this.pluck(n, t, 0.14, 1.0, 3200);
          if (step % 4 === 0) this.bow(n / 2, t, this.tempo(mood) * 3, 0.06);
        } else if (mood === 'boss') {
          this.pluck(n, t, 0.15, 0.85, 3600);
          this.bow(n / 2, t, this.tempo(mood) * 2.5, 0.07);
        } else if (mood === 'sad') {
          this.flute(n, t, this.tempo(mood) * 4, 0.07);
        }
      }
      // percussion
      if (mood === 'combat' && step % 2 === 0) this.drum(t, step % 8 === 0 ? 0.3 : 0.14);
      if (mood === 'boss' && step % 2 === 0) this.drum(t, step % 4 === 0 ? 0.36 : 0.18, 55);
      if (mood === 'explore' && step % 16 === 0) this.drum(t, 0.1, 70);
      this.step++;
      this.nextNoteTime += this.tempo(mood);
    }
  }

  /* -------------------------------------------------------------- ambient */

  private birdChirp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = 1800 + Math.random() * 1600;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + i * 0.09);
      o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.7), t + i * 0.09 + 0.07);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.035, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.09);
      o.connect(g); g.connect(this.ambBus);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.12);
    }
  }

  private insect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200 + Math.random() * 2000;
    bp.Q.value = 22;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.05);
    g.gain.setValueAtTime(0.02, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(bp); bp.connect(g); g.connect(this.ambBus);
    src.start(t); src.stop(t + 1);
  }

  update(dt: number, playerPos: Vector3, isNight: boolean, windAmount: number, rainAmount: number) {
    if (!this.ready) return;
    this.updateMusic(dt);
    if (!this.windGain) return;
    const t = this.ctx!.currentTime;
    const wind = clamp01(0.08 + windAmount * 0.22 + rainAmount * 0.2);
    this.windGain.gain.setTargetAtTime(wind, t, 0.6);
    this.windFilter.frequency.setTargetAtTime(300 + windAmount * 700 + rainAmount * 1200, t, 0.8);

    // water proximity
    let waterProx = 0;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const x = playerPos.x + Math.cos(a) * 22, z = playerPos.z + Math.sin(a) * 22;
      const h = heightAt(x, z);
      if (h < WORLD.waterLevel - 0.4) waterProx = Math.max(waterProx, clamp01((WORLD.waterLevel - h) / 6));
    }
    this.waterGain.gain.setTargetAtTime(waterProx * 0.09, t, 0.5);

    // birds by day, insects by night
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 12;
      if (!isNight && Math.random() < 0.7 && playerPos.y < 140) this.birdChirp();
      else if (isNight && Math.random() < 0.5) this.insect();
    }
  }

  thunder() {
    if (!this.ready) return;
    setTimeout(() => this.play('thunder'), 200 + Math.random() * 900);
  }
}
