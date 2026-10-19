import { clamp } from './Noise';

export type ActionName =
  | 'moveX' | 'moveY'
  | 'sprint' | 'jump' | 'dodge' | 'light' | 'heavy' | 'parry' | 'block'
  | 'special' | 'lockOn' | 'interact' | 'inventory' | 'character' | 'quests'
  | 'map' | 'pause' | 'potion' | 'sheath' | 'switchTarget' | 'ability2' | 'crouch';

export interface InputState {
  mouseDX: number;
  mouseDY: number;
  mouseWheel: number;
  look: { x: number; y: number };
}

const DEFAULT_BINDINGS: Record<string, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dodge: ['ShiftLeft', 'ShiftRight'],
  light: [], // mouse 0
  heavy: [], // mouse 2
  block: ['Mouse2'],
  parry: ['KeyF'],
  special: ['KeyQ'],
  ability2: ['KeyR'],
  lockOn: ['Tab'],
  interact: ['KeyE'],
  inventory: ['KeyI'],
  character: ['KeyC'],
  quests: ['KeyJ'],
  map: ['KeyM'],
  pause: ['Escape'],
  potion: ['KeyH'],
  sheath: ['KeyB'],
  crouch: ['ControlLeft'],
};

export class InputSystem {
  keys = new Set<string>();
  pressedThisFrame = new Set<string>();
  releasedThisFrame = new Set<string>();
  mouse = { dx: 0, dy: 0, wheel: 0 };
  mouseButtons = [false, false, false];
  mouseJustPressed = [false, false, false];
  sensitivity = 1.0;
  invertY = false;
  enabled = true;
  locked = false;
  private el: HTMLElement | null = null;
  private onLockChange?: (locked: boolean) => void;
  bindings: Record<string, string[]> = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  gamepadIndex: number | null = null;
  padState = { x: 0, y: 0, camX: 0, camY: 0 };

  attach(el: HTMLElement, onLockChange?: (locked: boolean) => void) {
    this.el = el;
    this.onLockChange = onLockChange;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('gamepadconnected', this.onPadConnected as any);
    window.addEventListener('gamepaddisconnected', this.onPadDisconnected as any);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: Event) => e.preventDefault();
  private onPadConnected = (e: GamepadEvent) => { this.gamepadIndex = e.gamepad.index; };
  private onPadDisconnected = () => { this.gamepadIndex = null; };

  private onBlur = () => {
    this.keys.clear();
    this.mouseButtons = [false, false, false];
  };

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.el;
    if (this.onLockChange) this.onLockChange(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.releasedThisFrame.add(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button < 3) {
      if (!this.mouseButtons[e.button]) this.mouseJustPressed[e.button] = true;
      this.mouseButtons[e.button] = true;
      this.pressedThisFrame.add('Mouse' + e.button);
      this.keys.add('Mouse' + e.button);
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button < 3) {
      this.mouseButtons[e.button] = false;
      this.keys.delete('Mouse' + e.button);
      this.releasedThisFrame.add('Mouse' + e.button);
    }
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    this.mouse.dx += e.movementX || 0;
    this.mouse.dy += e.movementY || 0;
  };
  private onWheel = (e: WheelEvent) => {
    this.mouse.wheel += Math.sign(e.deltaY);
  };

  requestLock() {
    if (this.el && document.pointerLockElement !== this.el) {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : pads[0];
    if (!pad) { this.padState = { x: 0, y: 0, camX: 0, camY: 0 }; return; }
    const dz = (v: number) => (Math.abs(v) > 0.18 ? v : 0);
    this.padState.x = dz(pad.axes[0] ?? 0);
    this.padState.y = -dz(pad.axes[1] ?? 0);
    this.padState.camX = dz(pad.axes[2] ?? 0);
    this.padState.camY = dz(pad.axes[3] ?? 0);
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const map: Record<number, string> = { 0: 'Space', 1: 'ShiftLeft', 2: 'KeyF', 3: 'KeyQ', 4: 'KeyE', 5: 'KeyR', 8: 'KeyM', 9: 'Escape', 12: 'KeyW', 13: 'KeyS', 14: 'KeyA', 15: 'KeyD' };
    for (const k in map) {
      const code = map[k];
      if (btn(+k)) {
        if (!this.keys.has(code)) this.pressedThisFrame.add(code);
        this.keys.add(code);
      } else this.keys.delete(code);
    }
    if (btn(7)) { if (!this.keys.has('Mouse0')) this.pressedThisFrame.add('Mouse0'); this.keys.add('Mouse0'); }
    else this.keys.delete('Mouse0');
    if (btn(6)) { if (!this.keys.has('Mouse2')) this.pressedThisFrame.add('Mouse2'); this.keys.add('Mouse2'); }
    else this.keys.delete('Mouse2');
  }

  /** Axis in [-1,1]: keyboard + gamepad merged. */
  axis(neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of neg) if (this.keys.has(k)) v -= 1;
    for (const k of pos) if (this.keys.has(k)) v += 1;
    return clamp(v, -1, 1);
  }

  down(action: string): boolean {
    const codes = this.bindings[action];
    if (codes) for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }
  pressed(action: string): boolean {
    const codes = this.bindings[action];
    if (codes) for (const c of codes) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }
  released(action: string): boolean {
    const codes = this.bindings[action];
    if (codes) for (const c of codes) if (this.releasedThisFrame.has(c)) return true;
    return false;
  }

  /** Raw code helpers for mouse-driven actions. */
  mouseDown(b: number) { return this.mouseButtons[b]; }
  mousePressed(b: number) { return this.mouseJustPressed[b]; }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouseJustPressed = [false, false, false];
  }
}

export const input = new InputSystem();
