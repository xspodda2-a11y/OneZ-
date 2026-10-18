import { bus, EV } from '../core/Events';

export interface Stats {
  level: number;
  xp: number;
  xpNext: number;
  skillPoints: number;
  maxHp: number;
  maxStamina: number;
  maxQi: number;
  attack: number;
  defense: number;
  critChance: number;
  moveSpeed: number;
  qiRegen: number;
}

export type ItemKind = 'weapon' | 'armor' | 'consumable' | 'material' | 'quest' | 'trinket';

export interface ItemDef {
  id: string;
  name: string;
  nameCN: string;
  kind: ItemKind;
  rarity: 'common' | 'fine' | 'rare' | 'legendary';
  icon: string;           // glyph used by the UI
  desc: string;
  value: number;
  stats?: Partial<Pick<Stats, 'attack' | 'defense' | 'maxHp' | 'maxStamina' | 'critChance'>>;
  heal?: number;
  stamina?: number;
  weapon?: 'jian' | 'dao' | 'spear' | 'staff' | 'twin';
  stack?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  // ---------------------------------------------------------- weapons
  ironSword: {
    id: 'ironSword', name: 'Iron Sword', nameCN: '铁剑', kind: 'weapon', rarity: 'common', icon: '劍',
    desc: 'A plain but well-balanced jian. Reliable in any duel.', value: 60, stats: { attack: 6 }, weapon: 'jian',
  },
  cloudSword: {
    id: 'cloudSword', name: 'Flowing Cloud Sword', nameCN: '流云剑', kind: 'weapon', rarity: 'fine', icon: '雲',
    desc: 'Light as a drifting cloud; strikes before the eye can follow.', value: 320, stats: { attack: 16, critChance: 0.04 }, weapon: 'jian',
  },
  moonblade: {
    id: 'moonblade', name: 'Moonlight Blade', nameCN: '明月刀', kind: 'weapon', rarity: 'rare', icon: '月',
    desc: 'Forged under a harvest moon. Its edge drinks the light.', value: 980, stats: { attack: 30, critChance: 0.07 }, weapon: 'dao',
  },
  heishanSaber: {
    id: 'heishanSaber', name: 'Black Mountain Sabre', nameCN: '黑山刀', kind: 'weapon', rarity: 'legendary', icon: '山',
    desc: 'Taken from the bandit lord Hei Shan. Heavy, cruel, unstoppable.', value: 2600, stats: { attack: 52, critChance: 0.1, maxHp: 20 }, weapon: 'dao',
  },
  jadeSpear: {
    id: 'jadeSpear', name: 'Jade Tassel Spear', nameCN: '玉穗枪', kind: 'weapon', rarity: 'fine', icon: '槍',
    desc: 'A red tassel hides the blood on its tip.', value: 340, stats: { attack: 18 }, weapon: 'spear',
  },
  // ---------------------------------------------------------- armour
  robe: {
    id: 'robe', name: 'Traveller Robe', nameCN: '行路袍', kind: 'armor', rarity: 'common', icon: '袍',
    desc: 'Simple layered robes. Easy to move in.', value: 50, stats: { defense: 4 },
  },
  silkRobe: {
    id: 'silkRobe', name: 'Cloudsilk Robe', nameCN: '云锦袍', kind: 'armor', rarity: 'fine', icon: '錦',
    desc: 'Woven in Cloudrest. Turns aside a careless blade.', value: 400, stats: { defense: 12, maxStamina: 15 },
  },
  cuirass: {
    id: 'cuirass', name: 'Iron-Lined Cuirass', nameCN: '铁衬甲', kind: 'armor', rarity: 'rare', icon: '甲',
    desc: 'Silk over riveted plates — the guard captain\'s choice.', value: 1100, stats: { defense: 26, maxHp: 40 },
  },
  cloudweave: {
    id: 'cloudweave', name: 'Cloudweave Mantle', nameCN: '织云氅', kind: 'armor', rarity: 'legendary', icon: '氅',
    desc: 'Said to be woven from mountain mist itself.', value: 2400, stats: { defense: 42, maxHp: 70, maxStamina: 30 },
  },
  // ---------------------------------------------------------- consumables
  potion: {
    id: 'potion', name: 'Health Potion', nameCN: '金创药', kind: 'consumable', rarity: 'common', icon: '藥',
    desc: 'Restores 45 health.', value: 30, heal: 45, stack: 99,
  },
  bigPotion: {
    id: 'bigPotion', name: 'Superior Elixir', nameCN: '上品丹药', kind: 'consumable', rarity: 'fine', icon: '丹',
    desc: 'Restores 120 health.', value: 90, heal: 120, stack: 99,
  },
  staminaElixir: {
    id: 'staminaElixir', name: 'Breath of Wind', nameCN: '御风散', kind: 'consumable', rarity: 'common', icon: '風',
    desc: 'Restores stamina instantly.', value: 40, stamina: 60, stack: 99,
  },
  jadePill: {
    id: 'jadePill', name: 'Jade Rebirth Pill', nameCN: '玉还丹', kind: 'consumable', rarity: 'rare', icon: '玉',
    desc: 'Fully restores health and qi.', value: 260, heal: 999, stack: 20,
  },
  // ---------------------------------------------------------- materials
  herb: { id: 'herb', name: 'Green Spirit Herb', nameCN: '青灵草', kind: 'material', rarity: 'common', icon: '草', desc: 'A common medicinal herb.', value: 8, stack: 99 },
  ore: { id: 'ore', name: 'Iron Ore', nameCN: '铁矿', kind: 'material', rarity: 'common', icon: '铁', desc: 'Raw smelting ore.', value: 14, stack: 99 },
  silk: { id: 'silk', name: 'Raw Silk', nameCN: '生丝', kind: 'material', rarity: 'common', icon: '丝', desc: 'Fine thread from Cloudrest.', value: 22, stack: 99 },
  hide: { id: 'hide', name: 'Beast Hide', nameCN: '兽皮', kind: 'material', rarity: 'common', icon: '皮', desc: 'Thick and weather-worn.', value: 12, stack: 99 },
  spiritStone: { id: 'spiritStone', name: 'Spirit Stone', nameCN: '灵石', kind: 'material', rarity: 'rare', icon: '灵', desc: 'Humms with inner energy.', value: 180, stack: 99 },
  // ---------------------------------------------------------- trinkets
  jadeRing: { id: 'jadeRing', name: 'Jade Ring', nameCN: '玉 ring', kind: 'trinket', rarity: 'fine', icon: '環', desc: 'Sharpens the senses. +5% critical chance.', value: 500, stats: { critChance: 0.05 } },
  tigerTalisman: { id: 'tigerTalisman', name: 'Tiger Talisman', nameCN: '虎符', kind: 'trinket', rarity: 'rare', icon: '符', desc: 'Grants +8 attack and courage.', value: 900, stats: { attack: 8, maxHp: 20 } },
  cranePin: { id: 'cranePin', name: 'Crane Hairpin', nameCN: '鹤簪', kind: 'trinket', rarity: 'fine', icon: '簪', desc: 'Lightens the step. +20 stamina.', value: 420, stats: { maxStamina: 20 } },
  // ---------------------------------------------------------- quest items
  letter: { id: 'letter', name: 'Sealed Letter', nameCN: '密信', kind: 'quest', rarity: 'common', icon: '信', desc: 'Addressed to someone in Cloudrest.', value: 0, stack: 1 },
  seal: { id: 'seal', name: 'Monastery Seal', nameCN: '寺印', kind: 'quest', rarity: 'rare', icon: '印', desc: 'The abbot\'s seal of passage.', value: 0, stack: 1 },
  pendant: { id: 'pendant', name: 'Jade Pendant', nameCN: '玉佩', kind: 'quest', rarity: 'rare', icon: '佩', desc: 'A keepsake from a lost sister.', value: 0, stack: 1 },
  herbsBundle: { id: 'herbsBundle', name: 'Bundle of Herbs', nameCN: '药草束', kind: 'quest', rarity: 'common', icon: '束', desc: 'Gathered for the hermit.', value: 0, stack: 5 },
  banditToken: { id: 'banditToken', name: 'Blackwood Token', nameCN: '黑木令', kind: 'quest', rarity: 'common', icon: '令', desc: 'Proof of a bandit\'s defeat.', value: 0, stack: 99 },
};

export interface SkillDef {
  id: string;
  name: string;
  nameCN: string;
  desc: string;
  cost: number;
  requires?: string[];
  col: number;
  row: number;
}

export const SKILLS: SkillDef[] = [
  { id: 'root', name: 'Way of the Sword', nameCN: '剑道', desc: 'The foundation of all technique.', cost: 0, col: 1, row: 0 },
  { id: 'vitality1', name: 'Iron Body I', nameCN: '铁身一', desc: '+25 maximum health.', cost: 1, requires: ['root'], col: 0, row: 1 },
  { id: 'power1', name: 'Sharp Edge I', nameCN: '锋锐一', desc: '+6 attack.', cost: 1, requires: ['root'], col: 1, row: 1 },
  { id: 'endurance1', name: 'Deep Breath I', nameCN: '吐纳一', desc: '+20 stamina.', cost: 1, requires: ['root'], col: 2, row: 1 },
  { id: 'lightness', name: 'Lightness Skill', nameCN: '轻功', desc: 'Hold SPACE while falling to glide on the wind.', cost: 2, requires: ['power1'], col: 0, row: 2 },
  { id: 'focus1', name: 'Focused Mind', nameCN: '凝神', desc: '+6% critical chance.', cost: 2, requires: ['power1'], col: 1, row: 2 },
  { id: 'doublejump', name: 'Double Leap', nameCN: '腾跃', desc: 'Leap a second time in mid-air.', cost: 2, requires: ['endurance1'], col: 2, row: 2 },
  { id: 'vitality2', name: 'Iron Body II', nameCN: '铁身二', desc: '+45 maximum health.', cost: 3, requires: ['vitality1'], col: 0, row: 3 },
  { id: 'shadowless', name: 'Shadowless Step', nameCN: '无影步', desc: 'R: a devastating closing strike.', cost: 3, requires: ['focus1'], col: 1, row: 3 },
  { id: 'qiMaster', name: 'Qi Circulation', nameCN: '运气', desc: 'Qi regenerates 80% faster.', cost: 3, requires: ['doublejump'], col: 2, row: 3 },
  { id: 'counterMaster', name: 'Returning Force', nameCN: '返劲', desc: 'Counter window lasts twice as long.', cost: 4, requires: ['shadowless'], col: 1, row: 4 },
  { id: 'bladestorm', name: 'Bladestorm', nameCN: '剑刃风暴', desc: 'Whirlwind Lotus deals +60% damage.', cost: 4, requires: ['shadowless'], col: 2, row: 4 },
  { id: 'mastery', name: 'Sword Mastery', nameCN: '剑心', desc: '+25 attack and +10% critical chance.', cost: 5, requires: ['counterMaster', 'bladestorm'], col: 1, row: 5 },
];

export interface InvSlot { id: string; qty: number; }

export class Progression {
  stats: Stats = {
    level: 1, xp: 0, xpNext: 100, skillPoints: 0,
    maxHp: 120, maxStamina: 100, maxQi: 100,
    attack: 22, defense: 6, critChance: 0.08, moveSpeed: 1, qiRegen: 3.2,
  };
  gold = 120;
  inventory: InvSlot[] = [
    { id: 'ironSword', qty: 1 },
    { id: 'robe', qty: 1 },
    { id: 'potion', qty: 3 },
  ];
  equipped: { weapon: string | null; armor: string | null; trinket: string | null } = { weapon: 'ironSword', armor: 'robe', trinket: null };
  skills: string[] = ['root'];
  kills: Record<string, number> = {};
  playTime = 0;

  constructor() { this.recalc(); }

  recalc() {
    const s = this.stats;
    s.maxHp = 120; s.maxStamina = 100; s.maxQi = 100; s.attack = 22; s.defense = 6; s.critChance = 0.08; s.qiRegen = 3.2;
    if (this.has('vitality1')) s.maxHp += 25;
    if (this.has('vitality2')) s.maxHp += 45;
    if (this.has('power1')) s.attack += 6;
    if (this.has('endurance1')) s.maxStamina += 20;
    if (this.has('focus1')) s.critChance += 0.06;
    if (this.has('qiMaster')) s.qiRegen *= 1.8;
    if (this.has('mastery')) { s.attack += 25; s.critChance += 0.10; }
    for (const key of ['weapon', 'armor', 'trinket'] as const) {
      const id = this.equipped[key];
      if (!id) continue;
      const it = ITEMS[id];
      if (!it?.stats) continue;
      if (it.stats.attack) s.attack += it.stats.attack;
      if (it.stats.defense) s.defense += it.stats.defense;
      if (it.stats.maxHp) s.maxHp += it.stats.maxHp;
      if (it.stats.maxStamina) s.maxStamina += it.stats.maxStamina;
      if (it.stats.critChance) s.critChance += it.stats.critChance;
    }
    s.maxHp = Math.round(s.maxHp);
    s.attack = Math.round(s.attack);
  }

  has(id: string) { return this.skills.includes(id); }

  addXp(n: number) {
    this.stats.xp += n;
    let leveled = 0;
    while (this.stats.xp >= this.stats.xpNext) {
      this.stats.xp -= this.stats.xpNext;
      this.stats.level++;
      this.stats.skillPoints++;
      this.stats.xpNext = Math.round(this.stats.xpNext * 1.45 + 40);
      leveled++;
      this.recalc();
    }
    if (leveled) bus.emit(EV.PLAYER_LEVELUP, { level: this.stats.level });
    return leveled;
  }

  addGold(n: number) { this.gold = Math.max(0, this.gold + n); }

  addItem(id: string, qty = 1): boolean {
    const def = ITEMS[id];
    if (!def) return false;
    const maxStack = def.stack ?? 1;
    if (maxStack > 1) {
      const slot = this.inventory.find((s) => s.id === id && s.qty < maxStack);
      if (slot) { slot.qty = Math.min(maxStack, slot.qty + qty); return true; }
    }
    this.inventory.push({ id, qty });
    return true;
  }

  removeItem(id: string, qty = 1): boolean {
    const i = this.inventory.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const slot = this.inventory[i];
    if (slot.qty <= qty) this.inventory.splice(i, 1);
    else slot.qty -= qty;
    return true;
  }

  count(id: string): number {
    return this.inventory.filter((s) => s.id === id).reduce((a, b) => a + b.qty, 0);
  }

  equip(id: string): boolean {
    const def = ITEMS[id];
    if (!def) return false;
    if (def.kind === 'weapon') this.equipped.weapon = id;
    else if (def.kind === 'armor') this.equipped.armor = id;
    else if (def.kind === 'trinket') this.equipped.trinket = id;
    else return false;
    this.recalc();
    return true;
  }

  unequip(slot: 'weapon' | 'armor' | 'trinket') {
    this.equipped[slot] = null;
    this.recalc();
  }

  learn(id: string): boolean {
    const def = SKILLS.find((s) => s.id === id);
    if (!def || this.has(id)) return false;
    if (def.requires && !def.requires.every((r) => this.has(r))) return false;
    if (this.stats.skillPoints < def.cost) return false;
    this.stats.skillPoints -= def.cost;
    this.skills.push(id);
    this.recalc();
    return true;
  }

  serialize() {
    return {
      stats: this.stats, gold: this.gold, inventory: this.inventory,
      equipped: this.equipped, skills: this.skills, kills: this.kills, playTime: this.playTime,
    };
  }

  load(d: any) {
    if (!d) return;
    Object.assign(this.stats, d.stats ?? {});
    this.gold = d.gold ?? 0;
    this.inventory = d.inventory ?? [];
    this.equipped = d.equipped ?? { weapon: null, armor: null, trinket: null };
    this.skills = d.skills ?? ['root'];
    this.kills = d.kills ?? {};
    this.playTime = d.playTime ?? 0;
    this.recalc();
  }
}
