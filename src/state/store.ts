import { create } from 'zustand';

export type Screen = 'boot' | 'loading' | 'menu' | 'playing' | 'paused' | 'dead';
export type Panel = 'none' | 'inventory' | 'character' | 'quests' | 'map' | 'settings' | 'controls' | 'credits' | 'shop';

export interface Toast { id: number; text: string; kind: 'info' | 'good' | 'bad' | 'warn' | 'quest' | 'npc'; }

export interface HudState {
  hp: number; maxHp: number;
  stamina: number; maxStamina: number;
  qi: number; maxQi: number;
  xp: number; xpNext: number; level: number;
  gold: number; potions: number; skillPoints: number;
  weapon: string; armor: string;
  time: string; weather: string; location: string;
  fps: number; drawCalls: number; tris: number;
  poisoned: boolean;
}

export interface Tracker {
  questId: string; name: string; nameCN: string; main: boolean;
  objectives: { text: string; value: number; need: number; done: boolean }[];
}

export interface DialogueOptionUI { text: string; action: string; data?: any; }
export interface DialogueUI { speaker: string; text: string; options: DialogueOptionUI[]; }

export interface BossUI { name: string; nameCN: string; hp: number; maxHp: number; phase: number; }

export interface ShopUI { npc: string; items: { id: string; name: string; price: number; owned: number; icon: string; desc: string }[]; }

export interface SettingsState {
  quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
  music: number; sfx: number; sensitivity: number; invertY: boolean;
  shadows: boolean; bloom: boolean; ao: boolean; showFps: boolean; autoQuality: boolean;
  mouseSmooth: number;
}

export interface MinimapState {
  x: number; z: number; yaw: number;
  pois: { id: string; x: number; z: number; name: string; type: string }[];
  enemies: { x: number; z: number; hostile: boolean }[];
  npcs: { x: number; z: number }[];
  quests: { x: number; z: number }[];
}

interface GameStore {
  screen: Screen;
  panel: Panel;
  loading: { active: boolean; progress: number; text: string };
  hud: HudState;
  trackers: Tracker[];
  toasts: Toast[];
  dialogue: DialogueUI | null;
  shop: ShopUI | null;
  boss: BossUI | null;
  interact: { label: string; key: string } | null;
  minimap: MinimapState;
  settings: SettingsState;
  saveSlots: (any | null)[];
  questLog: { def: any; state: any }[];
  hint: string | null;
  deathCount: number;

  setScreen: (s: Screen) => void;
  setPanel: (p: Panel) => void;
  setLoading: (l: Partial<GameStore['loading']>) => void;
  setHud: (h: Partial<HudState>) => void;
  setTrackers: (t: Tracker[]) => void;
  setQuestLog: (q: { def: any; state: any }[]) => void;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  removeToast: (id: number) => void;
  setDialogue: (d: DialogueUI | null) => void;
  setShop: (s: ShopUI | null) => void;
  setBoss: (b: BossUI | null) => void;
  setInteract: (i: { label: string; key: string } | null) => void;
  setMinimap: (m: MinimapState) => void;
  setSettings: (s: Partial<SettingsState>) => void;
  setSaveSlots: (s: (any | null)[]) => void;
  setHint: (h: string | null) => void;
}

let toastId = 1;

export const useGame = create<GameStore>((set, get) => ({
  screen: 'boot',
  panel: 'none',
  loading: { active: false, progress: 0, text: '' },
  hud: {
    hp: 120, maxHp: 120, stamina: 100, maxStamina: 100, qi: 100, maxQi: 100,
    xp: 0, xpNext: 100, level: 1, gold: 0, potions: 0, skillPoints: 0,
    weapon: 'Iron Sword', armor: 'Traveller Robe', time: '07:00', weather: 'Clear',
    location: 'Willow Bend', fps: 60, drawCalls: 0, tris: 0, poisoned: false,
  },
  trackers: [],
  toasts: [],
  dialogue: null,
  shop: null,
  boss: null,
  interact: null,
  minimap: { x: 0, z: 0, yaw: 0, pois: [], enemies: [], npcs: [], quests: [] },
  settings: {
    quality: 'HIGH', music: 0.7, sfx: 0.85, sensitivity: 1.0, invertY: false,
    shadows: true, bloom: true, ao: true, showFps: false, autoQuality: true, mouseSmooth: 0.5,
  },
  saveSlots: [null, null, null],
  questLog: [],
  hint: null,
  deathCount: 0,

  setScreen: (screen) => set({ screen }),
  setPanel: (panel) => set({ panel }),
  setLoading: (l) => set((s) => ({ loading: { ...s.loading, ...l } })),
  setHud: (h) => set((s) => ({ hud: { ...s.hud, ...h } })),
  setTrackers: (trackers) => set({ trackers }),
  setQuestLog: (questLog) => set({ questLog }),
  pushToast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setDialogue: (dialogue) => set({ dialogue }),
  setShop: (shop) => set({ shop }),
  setBoss: (boss) => set({ boss }),
  setInteract: (interact) => set({ interact }),
  setMinimap: (minimap) => set({ minimap }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setSaveSlots: (saveSlots) => set({ saveSlots }),
  setHint: (hint) => set({ hint }),
}));

export const toast = (text: string, kind: Toast['kind'] = 'info') => useGame.getState().pushToast(text, kind);
