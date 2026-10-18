/**
 * Headless DOM shim — lets the game's non-WebGL systems run under Node so the
 * simulation can be smoke-tested in CI-ish fashion. Not shipped to the browser.
 */

class FakeGradient {
  addColorStop() {}
}

class FakeCtx {
  canvas: any;
  fillStyle: any = '#000';
  strokeStyle: any = '#000';
  lineWidth = 1;
  font = '';
  textAlign = '';
  textBaseline = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  shadowBlur = 0;
  shadowColor = '';
  lineCap = 'butt';
  lineJoin = 'miter';
  filter = 'none';
  constructor(canvas: any) { this.canvas = canvas; }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  ellipse() {}
  rect() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  fill() {}
  stroke() {}
  fillRect() {}
  strokeRect() {}
  clearRect() {}
  fillText() {}
  strokeText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  drawImage() {}
  clip() {}
  createLinearGradient() { return new FakeGradient(); }
  createRadialGradient() { return new FakeGradient(); }
  createPattern() { return null; }
  createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) };
  }
  putImageData() {}
  measureText() { return { width: 10 }; }
}

class FakeElement {
  tagName: string;
  width = 300;
  height = 150;
  style: any = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  _ctx: FakeCtx | null = null;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  getContext(kind: string) {
    if (kind === '2d') { if (!this._ctx) this._ctx = new FakeCtx(this); return this._ctx; }
    return null;
  }
  appendChild(c: any) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c: any) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }; }
  requestPointerLock() {}
  focus() {}
  get classList() {
    return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  set className(_v: string) {}
  get className() { return ''; }
  set innerHTML(_v: string) {}
  get innerHTML() { return ''; }
  set textContent(_v: string) {}
  get textContent() { return ''; }
  set id(_v: string) {}
  get id() { return 'fake'; }
}

const registry = new Map<string, FakeElement>();

const doc: any = {
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  getElementById: (id: string) => {
    if (!registry.has(id)) registry.set(id, new FakeElement('div'));
    return registry.get(id)!;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: new FakeElement('body'),
  documentElement: new FakeElement('html'),
  pointerLockElement: null,
  exitPointerLock: () => {},
};

const win: any = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(performance.now()), 16),
  cancelAnimationFrame: (id: any) => clearTimeout(id),
  document: doc,
  navigator: { userAgent: 'node', getGamepads: () => [] },
  location: { href: 'http://localhost/' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  localStorage: {
    _m: new Map<string, string>(),
    getItem(k: string) { return this._m.has(k) ? this._m.get(k)! : null; },
    setItem(k: string, v: string) { this._m.set(k, v); },
    removeItem(k: string) { this._m.delete(k); },
  },
  AudioContext: undefined,
  webkitAudioContext: undefined,
};

(globalThis as any).window = win;
(globalThis as any).document = doc;
try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch (e) { /* ignore */ }
(globalThis as any).localStorage = win.localStorage;
(globalThis as any).HTMLElement = FakeElement;
(globalThis as any).HTMLCanvasElement = FakeElement;
(globalThis as any).ImageData = class {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
};
(globalThis as any).requestAnimationFrame = win.requestAnimationFrame;
(globalThis as any).cancelAnimationFrame = win.cancelAnimationFrame;
(globalThis as any).self = win;
(globalThis as any).devicePixelRatio = 1;
(globalThis as any).screen = { width: 1280, height: 720, availWidth: 1280, availHeight: 720 };
(globalThis as any).indexedDB = undefined;

export default doc;
