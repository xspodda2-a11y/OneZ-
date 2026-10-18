import { Vector3 } from 'three';
import { Entity, DamageInfo } from '../Entity';
import { Actor } from '../character/Actor';
import { heightAt, WORLD } from '../core/TerrainHeight';
import { clamp, damp, makeRng } from '../core/Noise';
import { bus, EV } from '../core/Events';
import type { Game } from '../Game';
import type { CharacterLook } from '../character/CharacterRig';
import type { WeaponType } from '../character/Weapons';
import { ITEMS } from '../rpg/Progression';

export type NpcRole =
  | 'villager' | 'guard' | 'merchant' | 'master' | 'elder' | 'monk'
  | 'hermit' | 'farmer' | 'prisoner' | 'dummy';

export interface NpcDef {
  role: NpcRole;
  look: Partial<CharacterLook>;
  weapon?: WeaponType;
  label: string;
  greeting: string[];
  hint?: string;
}

export const NPC_DEFS: Record<string, NpcDef> = {
  villager: {
    role: 'villager', label: 'Villager',
    look: { robe: '#b9a887', robeDark: '#9a8a6c', trim: '#5a4a34', sash: '#7a6a4a', skin: '#d8ae86', hairStyle: 'bun', sleeves: 'normal', skirt: 'short' },
    greeting: [
      'Have you eaten yet? The road is long on an empty belly.',
      'Strange times. The bandits grow bolder every season.',
      'If you seek trouble, it is waiting up the mountain.',
    ],
  },
  farmer: {
    role: 'farmer', label: 'Farmer',
    look: { robe: '#8a9468', robeDark: '#6d7550', trim: '#4a5236', sash: '#8a6a3a', skin: '#c99a6a', hairStyle: 'topknot', hat: 'straw', sleeves: 'normal', skirt: 'short' },
    greeting: [
      'The millet comes in well this year — if the bandits leave it be.',
      'Mind the irrigation ditches, they are deeper than they look.',
    ],
  },
  guard: {
    role: 'guard', label: 'Village Guard',
    look: { robe: '#4a5566', robeDark: '#39434f', trim: '#8c2b2b', sash: '#2b2b33', skin: '#d8ae86', hairStyle: 'topknot', hat: 'helm', sleeves: 'normal', skirt: 'short', shoulderPads: true },
    weapon: 'dao',
    greeting: [
      'Keep your blade sheathed inside the village, wanderer.',
      'Trouble? Speak plainly. I have little patience for riddles.',
    ],
  },
  merchant: {
    role: 'merchant', label: 'Merchant',
    look: { robe: '#6a4a7a', robeDark: '#52385e', trim: '#c8a24a', sash: '#8c2b2b', skin: '#e0b892', hairStyle: 'bun', sleeves: 'wide', skirt: 'long' },
    greeting: [
      'Good wares, fair prices! Well... fair-ish.',
      'Coin first, then conversation. No, the other way round — conversation sells.',
    ],
  },
  master: {
    role: 'master', label: 'Martial Artist',
    look: { robe: '#e8e4d8', robeDark: '#c4c0b0', trim: '#2f4f7a', sash: '#8c2b2b', skin: '#e0b892', hairStyle: 'ponytail', sleeves: 'wide', skirt: 'long' },
    weapon: 'jian',
    greeting: [
      'Your stance betrays you. Feet first, then hands.',
      'A blade is only as sharp as the intent behind it.',
      'The wind does not fight the mountain; it flows around it. Be the wind.',
    ],
  },
  elder: {
    role: 'elder', label: 'Village Elder',
    look: { robe: '#8a8f7a', robeDark: '#6b705e', trim: '#4a4536', sash: '#6a5a8a', skin: '#d8b48e', hairStyle: 'bun', sleeves: 'wide', skirt: 'long', build: 'slim' },
    greeting: [
      'You have the look of someone running from a name.',
      'Willow Bend has stood for three hundred years. It will outlast the bandits too.',
      'The old road to Cloudsea is dangerous now. Take care.',
    ],
  },
  monk: {
    role: 'monk', label: 'Monk',
    look: { robe: '#c8902f', robeDark: '#a06e22', trim: '#7a4a1a', sash: '#6a3a1a', skin: '#d8ae86', hairStyle: 'bald', sleeves: 'wide', skirt: 'long' },
    greeting: [
      'The mountain does not hurry, yet it arrives.',
      'Breathe. Then speak.',
    ],
  },
  hermit: {
    role: 'hermit', label: 'Hermit',
    look: { robe: '#7a8a6a', robeDark: '#5e6b50', trim: '#3a4630', sash: '#8a7a4a', skin: '#d0a880', hairStyle: 'wild', sleeves: 'wide', skirt: 'long', build: 'slim' },
    greeting: [
      'Hmph. Another seeker. Very well — speak, but be brief.',
      'I left the jianghu because it never stops talking.',
    ],
  },
  prisoner: {
    role: 'prisoner', label: 'Captive',
    look: { robe: '#8a7a6a', robeDark: '#6a5c4e', trim: '#4a4036', sash: '#5a4a3a', skin: '#c99a72', hairStyle: 'wild', sleeves: 'normal', skirt: 'short', build: 'slim' },
    greeting: [
      'By the ancestors — cut these ropes!',
      'They took everything. My sword, my coin, my dignity.',
    ],
  },
  dummy: {
    role: 'dummy', label: 'Training Dummy',
    look: { robe: '#8a6a42', robeDark: '#6a4e30', trim: '#4a3524', sash: '#7a2b22', skin: '#a07a52', hairStyle: 'bald', sleeves: 'none', skirt: 'short' },
    greeting: ['(a weathered wooden practice post, scarred by a thousand strikes)'],
  },
};

export type NpcState = 'idle' | 'walk' | 'sit' | 'talk' | 'bow';

export class Npc extends Entity {
  role: NpcRole;
  def: NpcDef;
  declare actor: Actor;
  game: Game;
  npcState: NpcState = 'idle';
  stateTime = 0;
  waypoints: Vector3[] = [];
  wpIndex = 0;
  home = new Vector3();
  grounded = true;
  facingYaw = 0;
  data: any = {};
  interactLabel = 'Talk';
  rng: () => number;

  constructor(game: Game, role: NpcRole, pos: Vector3, data: any = {}) {
    super();
    this.game = game;
    this.role = role;
    this.def = NPC_DEFS[role] ?? NPC_DEFS.villager;
    this.data = data;
    this.name = data?.name ?? this.def.label;
    this.nameCN = data?.nameCN ?? '';
    this.faction = 'neutral';
    this.rng = makeRng(Math.floor(pos.x * 13 + pos.z * 7 + role.length));
    this.maxHp = role === 'dummy' ? 60 : 100;
    this.hp = this.maxHp;
    this.defense = role === 'dummy' ? 0 : 8;
    this.radius = 0.42;
    this.actor = new Actor(this.def.look, {
      weapon: this.def.weapon ?? 'fists',
      weaponOpts: { length: 0.95 },
    });
    this.root = this.actor.root;
    this.root.name = 'npc_' + role;
    this.pos.copy(pos);
    this.home.copy(pos);
    this.yaw = this.rng() * Math.PI * 2;
    if (this.def.weapon) this.actor.setSheathed(true);
    for (let i = 0; i < 2 + Math.floor(this.rng() * 3); i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 4 + this.rng() * 9;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      this.waypoints.push(new Vector3(x, heightAt(x, z), z));
    }
    if (role === 'dummy') { this.waypoints = []; this.npcState = 'idle'; }
  }

  get greeting(): string {
    const g = this.def.greeting;
    return g[Math.floor(this.rng() * g.length)];
  }

  update(dt: number) {
    this.stateTime += dt;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (!this.alive) {
      this.vel.set(0, 0, 0);
      this.actor.update(dt, this.game.render.camera.position, this.game.env.wind, performance.now() / 1000);
      this.syncActor();
      return;
    }
    const player = this.game.player;
    const dist = this.pos.distanceTo(player.pos);

    switch (this.npcState) {
      case 'idle':
        this.vel.x = damp(this.vel.x, 0, 6, dt);
        this.vel.z = damp(this.vel.z, 0, 6, dt);
        if (this.waypoints.length && this.stateTime > 3 + this.rng() * 5) this.npcState = 'walk';
        break;
      case 'walk': {
        const t = this.waypoints[this.wpIndex % this.waypoints.length];
        const d = this.flatDistanceTo(t);
        if (d < 0.6) { this.wpIndex++; this.npcState = 'idle'; this.stateTime = 0; break; }
        const dir = new Vector3(t.x - this.pos.x, 0, t.z - this.pos.z).normalize();
        const sp = 1.5;
        this.vel.x = damp(this.vel.x, dir.x * sp, 4, dt);
        this.vel.z = damp(this.vel.z, dir.z * sp, 4, dt);
        const want = Math.atan2(dir.x, dir.z);
        let diff = want - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * Math.min(1, 5 * dt);
        if (this.stateTime > 22) { this.npcState = 'idle'; this.stateTime = 0; }
        break;
      }
      case 'talk':
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
        if (player) {
          const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          let diff = want - this.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          this.yaw += diff * Math.min(1, 6 * dt);
        }
        break;
      case 'bow':
        this.vel.set(0, 0, 0);
        if (this.stateTime > 2.2) { this.npcState = 'idle'; }
        break;
      case 'sit':
        this.vel.set(0, 0, 0);
        break;
    }

    // look at a nearby player
    if (dist < 4 && this.npcState !== 'talk' && this.npcState !== 'bow') {
      const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      let diff = want - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, 3 * dt);
    }

    if (!this.grounded || this.vel.y !== 0) this.vel.y -= 24 * dt;
    const res = this.moveAndCollide(dt);
    this.grounded = res.grounded;

    // animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let clip = 'idle';
    if (this.npcState === 'bow') clip = 'bow';
    else if (this.npcState === 'sit') clip = 'sit';
    else if (sp > 1.6) clip = 'run';
    else if (sp > 0.2) clip = 'walk';
    if (this.actor.anim.current !== clip) this.actor.anim.play(clip, 0.4, clip === 'walk' ? clamp(sp / 2.4, 0.7, 1.2) : 1);
    this.actor.velocity.copy(this.vel);
    this.actor.update(dt, this.game.render.camera.position, this.game.env.wind, performance.now() / 1000);
    this.syncActor();
  }

  protected onDamaged(info: DamageInfo, dealt: number) {
    this.actor.flash(0xffaaaa, 0.8, 0.16);
    this.game.vfx.blood(this.centerPos, new Vector3(0, 0.4, 0), 8);
    this.game.vfx.damageNumber(this.centerPos, dealt, 'normal');
    if (this.role === 'dummy') {
      this.game.vfx.dust(this.centerPos, 6, 0.4, 0.6);
      this.game.audio.play('hitWood');
      this.hp = this.maxHp;
      return;
    }
    this.aggroOnPlayer(info);
  }

  private aggroOnPlayer(info: DamageInfo) {
    // NPCs don't fight, but they cry out
    this.game.audio.play('npcHurt');
    bus.emit(EV.TOAST, { text: `${this.name} is under attack!`, kind: 'bad' });
    if (this.role === 'guard') {
      this.npcState = 'talk';
      this.actor.setSheathed(false);
    }
  }

  protected onDeath() {
    this.actor.anim.play('death', 0.2);
    this.game.audio.play('enemyDeath');
  }

  say(text: string) {
    bus.emit(EV.TOAST, { text: `${this.name}: ${text}`, kind: 'npc' });
  }

  /** Shops stock depends on the role. */
  shopStock(): { id: string; price: number }[] {
    if (this.role === 'merchant' || this.role === 'farmer') {
      return [
        { id: 'potion', price: 30 }, { id: 'bigPotion', price: 90 },
        { id: 'staminaElixir', price: 40 }, { id: 'silkRobe', price: 420 },
        { id: 'cloudSword', price: 340 }, { id: 'moonblade', price: 1020 },
        { id: 'jadeSpear', price: 360 }, { id: 'cranePin', price: 440 },
      ];
    }
    return [{ id: 'potion', price: 30 }, { id: 'herb', price: 8 }];
  }

  dispose() {
    this.actor?.dispose?.();
    this.root?.parent?.remove(this.root);
  }
}

export interface DialogueOption {
  text: string;
  next?: string;
  action?: string;
  data?: any;
}

export interface DialogueNode {
  text: string;
  speaker: string;
  options: DialogueOption[];
}

/** Builds a dialogue node for the given NPC, quest-aware. */
export function buildDialogue(npc: Npc, game: Game): DialogueNode {
  const q = game.quests;
  const options: DialogueOption[] = [];
  let text = npc.greeting;

  // quest-driven lines take priority
  const offer = q.questOfferedBy(npc);
  if (offer) {
    text = offer.introText;
    options.push({ text: `I accept. (${offer.name})`, action: 'quest:accept', data: offer.id });
    options.push({ text: 'Perhaps another time.', action: 'close' });
    return { text, speaker: npc.name, options };
  }
  const turnIn = q.questTurnInBy(npc);
  if (turnIn) {
    text = turnIn.completeText;
    options.push({ text: 'Hand it over.', action: 'quest:complete', data: turnIn.id });
    options.push({ text: 'Not yet.', action: 'close' });
    return { text, speaker: npc.name, options };
  }

  switch (npc.role) {
    case 'merchant':
    case 'farmer':
      options.push({ text: 'Let me see your wares.', action: 'shop' });
      break;
    case 'master':
      options.push({ text: 'Teach me. (Spend a skill point)', action: 'train' });
      options.push({ text: 'Tell me of the jianghu.', action: 'lore' });
      break;
    case 'elder':
    case 'monk':
    case 'hermit':
      options.push({ text: 'What news from the road?', action: 'lore' });
      if (npc.role === 'monk' || npc.role === 'elder') options.push({ text: 'Rest here till dusk.', action: 'rest' });
      break;
    case 'guard':
      options.push({ text: 'Any trouble about?', action: 'lore' });
      break;
    case 'prisoner':
      options.push({ text: 'Hold still.', action: 'free' });
      break;
    default:
      options.push({ text: 'Any rumours?', action: 'lore' });
  }
  const hints = q.hintForNpc(npc);
  if (hints) options.push({ text: 'About my task...', action: 'hint', data: hints });
  options.push({ text: 'Farewell.', action: 'close' });
  return { text, speaker: npc.name, options };
}

export const LORE_LINES: string[] = [
  'They say Hei Shan was once a general who refused to surrender. The mountain took his name, and his mercy.',
  'Blackwood Camp sits on the old trade road. Nothing passes it untaxed these days.',
  'The monks of Cloudsea keep the pass. They will open the gate for a friend of the abbot.',
  'Nine Heavens Pagoda — seven tiers, and something old sleeping at the top of it.',
  'Reedwharf trades fish downstream. Cheap wine, cheaper rumours.',
  'The hermit up north knows herbs. He knows other things too, but he will not say.',
  'Mind the mist on the high road. It hides more than rocks.',
  'A swordmaster once told me: strike only when the wind holds its breath.',
];
