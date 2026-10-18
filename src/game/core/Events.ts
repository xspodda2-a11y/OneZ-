type Handler = (...args: any[]) => void;

/** Tiny typed-ish event bus shared between the engine and the React UI. */
export class EventBus {
  private map = new Map<string, Set<Handler>>();
  on(evt: string, fn: Handler) {
    let s = this.map.get(evt);
    if (!s) { s = new Set(); this.map.set(evt, s); }
    s.add(fn);
    return () => { s!.delete(fn); };
  }
  off(evt: string, fn: Handler) {
    this.map.get(evt)?.delete(fn);
  }
  emit(evt: string, ...args: any[]) {
    const s = this.map.get(evt);
    if (!s) return;
    for (const fn of Array.from(s)) {
      try { fn(...args); } catch (e) { console.error('[bus]', evt, e); }
    }
  }
  clear() { this.map.clear(); }
}

export const bus = new EventBus();

/** Signals used across the game. */
export const EV = {
  PLAYER_STATS: 'player:stats',
  PLAYER_DIED: 'player:died',
  PLAYER_LEVELUP: 'player:levelup',
  ENEMY_HIT: 'enemy:hit',
  ENEMY_KILLED: 'enemy:killed',
  DAMAGE_PLAYER: 'player:damage',
  TOAST: 'ui:toast',
  DIALOGUE_OPEN: 'ui:dialogue',
  DIALOGUE_CLOSE: 'ui:dialogue:close',
  SHOP_OPEN: 'ui:shop',
  QUEST_UPDATE: 'quest:update',
  QUEST_COMPLETE: 'quest:complete',
  OBJECTIVE_PROGRESS: 'quest:objective',
  INTERACT_PROMPT: 'ui:interact',
  BOSS_SPAWN: 'boss:spawn',
  BOSS_STATE: 'boss:state',
  PAUSE: 'game:pause',
  RESUME: 'game:resume',
  SAVE_DONE: 'save:done',
  SCREEN: 'ui:screen',
  MINIMAP: 'ui:minimap',
  TUTORIAL: 'ui:tutorial',
  HUD_FLASH: 'ui:flash',
  LOCATION: 'world:location',
  CINEMATIC: 'ui:cinematic',
  ABILITY_READY: 'player:ability',
} as const;
