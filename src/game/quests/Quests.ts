import { Vector3 } from 'three';
import { bus, EV } from '../core/Events';
import { ITEMS } from '../rpg/Progression';
import type { Game } from '../Game';
import type { Npc } from '../npc/Npc';

export type ObjectiveType = 'talk' | 'kill' | 'collect' | 'reach' | 'boss' | 'free' | 'train';

export interface Objective {
  type: ObjectiveType;
  /** npc role / enemy kind / item id / poi id */
  target: string;
  count: number;
  text: string;
}

export interface QuestDef {
  id: string;
  name: string;
  nameCN: string;
  main: boolean;
  /** role of the NPC that offers it (matched loosely) */
  giver: string;
  giverPoi?: string;
  turnIn?: string;
  turnInPoi?: string;
  desc: string;
  introText: string;
  completeText: string;
  objectives: Objective[];
  rewards: { xp: number; gold: number; items?: { id: string; qty: number }[]; skill?: number };
  requires?: string[];
  next?: string;
  levelHint?: number;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'q1', name: 'The Road to Willow Bend', nameCN: '柳湾之路', main: true,
    giver: 'elder', giverPoi: 'willow', turnIn: 'elder', turnInPoi: 'willow',
    desc: 'You woke on the road with no memory of how you got here. The village elder may know why.',
    introText: 'You have the look of a man who lost something on the road. Stay a while — Willow Bend has need of a blade.',
    completeText: 'Then it is settled. Walk the old road and see what the bandits have left us.',
    objectives: [
      { type: 'talk', target: 'elder', count: 1, text: 'Speak with Elder Shen in Willow Bend' },
      { type: 'kill', target: 'bandit', count: 4, text: 'Drive off the Blackwood bandits' },
      { type: 'talk', target: 'elder', count: 1, text: 'Return to Elder Shen' },
    ],
    rewards: { xp: 140, gold: 90, items: [{ id: 'potion', qty: 3 }], skill: 1 },
    next: 'q2',
  },
  {
    id: 'q2', name: 'The Seal of Cloudsea', nameCN: '云海之印', main: true,
    giver: 'elder', turnIn: 'monk', turnInPoi: 'monastery',
    desc: 'The abbot of Cloudsea Monastery guards the mountain pass. Elder Shen asks you to carry word to him.',
    introText: 'Take this letter to Abbot Wuxin at Cloudsea. The mountain road is long — leave at dawn, or not at all.',
    completeText: 'The seal is yours, wanderer. The pass will open for you, and so will the truth you seek.',
    objectives: [
      { type: 'reach', target: 'monastery', count: 1, text: 'Travel to Cloudsea Monastery' },
      { type: 'talk', target: 'monk', count: 1, text: 'Speak with Abbot Wuxin' },
    ],
    rewards: { xp: 320, gold: 180, items: [{ id: 'silkRobe', qty: 1 }, { id: 'seal', qty: 1 }], skill: 1 },
    requires: ['q1'],
    next: 'q3',
  },
  {
    id: 'q3', name: 'Nine Heavens', nameCN: '九霄', main: true,
    giver: 'monk', giverPoi: 'monastery', turnIn: 'monk', turnInPoi: 'monastery',
    desc: 'Something stirs at the pagoda. The abbot asks you to test the Iron Guard who hold it.',
    introText: 'The pagoda has stood empty for a generation. Now Iron Guard elites drill beneath it. Find out why.',
    completeText: 'Then it is as I feared. The Black Mountain has stretched its shadow this far.',
    objectives: [
      { type: 'reach', target: 'pagoda', count: 1, text: 'Climb to the Nine Heavens Pagoda' },
      { type: 'kill', target: 'elite', count: 3, text: 'Defeat the Iron Guard elites' },
      { type: 'talk', target: 'monk', count: 1, text: 'Report back to Abbot Wuxin' },
    ],
    rewards: { xp: 700, gold: 420, items: [{ id: 'moonblade', qty: 1 }], skill: 2 },
    requires: ['q2'],
    next: 'q4',
  },
  {
    id: 'q4', name: 'The Black Mountain', nameCN: '黑山', main: true,
    giver: 'monk', giverPoi: 'monastery', turnIn: 'monk', turnInPoi: 'monastery',
    desc: 'Hei Shan holds Bloody Cliff with a company of cutthroats. End him, and the road is free.',
    introText: 'Hei Shan was once a brother of this temple. What he became, we must unmake. Go to Bloody Cliff.',
    completeText: 'It is done. The mountain is quiet again... and you are no longer nameless, wanderer.',
    objectives: [
      { type: 'reach', target: 'arena', count: 1, text: 'Reach Bloody Cliff' },
      { type: 'boss', target: 'heishan', count: 1, text: 'Defeat Hei Shan' },
    ],
    rewards: { xp: 2200, gold: 1500, items: [{ id: 'cloudweave', qty: 1 }], skill: 3 },
    requires: ['q3'],
  },
  // ----------------------------------------------------------------- side
  {
    id: 's1', name: 'Herbs for the Hermit', nameCN: '隐者之药', main: false,
    giver: 'hermit', giverPoi: 'hut', turnIn: 'hermit', turnInPoi: 'hut',
    desc: 'Hermit Mo needs green spirit herbs from the slopes near his hut.',
    introText: 'My joints ache and my apprentice ran off. Bring me three green spirit herbs and I will teach you something worth the walk.',
    completeText: 'Good. Good. Here — a tonic for the road, and a lesson: pain is just news from the body.',
    objectives: [{ type: 'collect', target: 'herb', count: 3, text: 'Gather 3 Green Spirit Herbs' }],
    rewards: { xp: 220, gold: 120, items: [{ id: 'bigPotion', qty: 2 }, { id: 'jadeRing', qty: 1 }] },
  },
  {
    id: 's2', name: 'The Lost Pendant', nameCN: '失落的玉佩', main: false,
    giver: 'merchant', giverPoi: 'willow', turnIn: 'merchant', turnInPoi: 'willow',
    desc: 'Merchant Lu lost a jade pendant — a keepsake from his sister. Bandits were seen with it.',
    introText: 'It is worth little to anyone else. To me it is everything. They say loot from the old battlefield turns up in bandit hands.',
    completeText: 'You found it... truly found it. Take what you like from the cart — on the house.',
    objectives: [
      { type: 'kill', target: 'bandit', count: 6, text: 'Search the bandits (6)' },
      { type: 'collect', target: 'pendant', count: 1, text: 'Recover the Jade Pendant' },
      { type: 'talk', target: 'merchant', count: 1, text: 'Return the pendant to Merchant Lu' },
    ],
    rewards: { xp: 380, gold: 260, items: [{ id: 'tigerTalisman', qty: 1 }] },
  },
  {
    id: 's3', name: 'Training with Master Bai', nameCN: '白师父的试炼', main: false,
    giver: 'master', giverPoi: 'willow', turnIn: 'master', turnInPoi: 'willow',
    desc: 'Master Bai will test your blade against wandering swordsmen.',
    introText: 'You swing like a farmer threshing rice. Fight three true swordsmen and come back — we will see what remains.',
    completeText: 'Better. Not good — better. The road will finish what I started.',
    objectives: [{ type: 'kill', target: 'swordsman', count: 3, text: 'Defeat 3 Jianghu swordsmen' }],
    rewards: { xp: 460, gold: 300, items: [{ id: 'cranePin', qty: 1 }], skill: 1 },
  },
  {
    id: 's4', name: 'The Captive Constable', nameCN: '被囚的捕头', main: false,
    giver: 'prisoner', giverPoi: 'camp', turnIn: 'prisoner', turnInPoi: 'camp',
    desc: 'Constable Zhou is held at Blackwood Camp. Cut him free.',
    introText: 'Cut these ropes and I will owe you more than coin.',
    completeText: 'Free at last. I will make for Cloudrest and send help. Take this — it belonged to a friend who did not make it.',
    objectives: [{ type: 'free', target: 'prisoner', count: 1, text: 'Free Constable Zhou' }],
    rewards: { xp: 300, gold: 200, items: [{ id: 'cuirass', qty: 1 }] },
  },
];

export interface QuestState {
  id: string;
  progress: number[];
  objIndex: number;
  done: boolean;
  readyToTurnIn: boolean;
}

export class QuestSystem {
  game: Game;
  states: Record<string, QuestState> = {};
  completed = new Set<string>();
  private defs = new Map<string, QuestDef>();

  constructor(game: Game) {
    this.game = game;
    for (const q of QUESTS) this.defs.set(q.id, q);
  }

  def(id: string) { return this.defs.get(id); }
  all() { return QUESTS; }

  activeQuests(): { def: QuestDef; state: QuestState }[] {
    const out: { def: QuestDef; state: QuestState }[] = [];
    for (const id in this.states) {
      const st = this.states[id];
      const def = this.defs.get(id);
      if (def && !st.done) out.push({ def, state: st });
    }
    return out;
  }

  isAvailable(def: QuestDef): boolean {
    if (this.completed.has(def.id) || this.states[def.id]) return false;
    if (def.requires && !def.requires.every((r) => this.completed.has(r))) return false;
    return true;
  }

  /** The quest an NPC should offer right now (main quests take priority). */
  questOfferedBy(npc: Npc): QuestDef | null {
    let best: QuestDef | null = null;
    for (const q of QUESTS) {
      if (!this.isAvailable(q)) continue;
      if (q.giver !== npc.role) continue;
      if (q.giverPoi) {
        const poi = this.game.world.poiAt(npc.pos);
        if (!poi || poi.id !== q.giverPoi) continue;
      }
      if (!best || (q.main && !best.main)) best = q;
    }
    return best;
  }

  questTurnInBy(npc: Npc): QuestDef | null {
    for (const id in this.states) {
      const st = this.states[id];
      const def = this.defs.get(id);
      if (!def || st.done || !st.readyToTurnIn) continue;
      const turnInRole = def.turnIn ?? def.giver;
      if (turnInRole !== npc.role) continue;
      const poi = this.game.world.poiAt(npc.pos);
      if (def.turnInPoi && (!poi || poi.id !== def.turnInPoi)) continue;
      return def;
    }
    return null;
  }

  hintForNpc(npc: Npc): string | null {
    for (const { def, state } of this.activeQuests()) {
      const obj = def.objectives[state.objIndex];
      if (!obj) continue;
      if (obj.type === 'talk' && obj.target === npc.role) {
        const poi = this.game.world.poiAt(npc.pos);
        const needPoi = def.turnInPoi ?? def.giverPoi;
        if (needPoi && (!poi || poi.id !== needPoi)) continue;
        return def.id;
      }
    }
    return null;
  }

  start(id: string) {
    if (this.states[id]) return;
    this.states[id] = { id, progress: this.def(id)!.objectives.map(() => 0), objIndex: 0, done: false, readyToTurnIn: false };
    const def = this.def(id)!;
    bus.emit(EV.QUEST_UPDATE, { type: 'start', def });
    bus.emit(EV.TOAST, { text: `Quest: ${def.name}`, kind: 'quest' });
    this.game.audio.play('quest');
    this.evaluate();
  }

  /** Report gameplay progress: kill, collect, reach, talk, boss. */
  report(type: ObjectiveType, target: string, poiId?: string, amount = 1) {
    let changed = false;
    for (const id in this.states) {
      const st = this.states[id];
      const def = this.defs.get(id);
      if (!def || st.done) continue;
      const obj = def.objectives[st.objIndex];
      if (!obj) continue;
      if (obj.type !== type) continue;
      let match = obj.target === target;
      if (type === 'reach' && poiId) match = obj.target === poiId;
      if (!match) continue;
      st.progress[st.objIndex] = Math.min(obj.count, st.progress[st.objIndex] + amount);
      changed = true;
      bus.emit(EV.OBJECTIVE_PROGRESS, { def, index: st.objIndex, value: st.progress[st.objIndex], need: obj.count });
      if (st.progress[st.objIndex] >= obj.count) {
        st.objIndex++;
        if (st.objIndex >= def.objectives.length) {
          st.readyToTurnIn = true;
          bus.emit(EV.TOAST, { text: `Objective complete — return to report`, kind: 'quest' });
        } else {
          bus.emit(EV.TOAST, { text: `${def.name}: ${def.objectives[st.objIndex].text}`, kind: 'quest' });
        }
        bus.emit(EV.QUEST_UPDATE, { type: 'progress', def });
      }
    }
    if (changed) this.evaluate();
  }

  complete(id: string) {
    const st = this.states[id];
    const def = this.defs.get(id);
    if (!st || !def || st.done) return;
    st.done = true;
    this.completed.add(id);
    const p = this.game.prog;
    p.addXp(def.rewards.xp);
    p.addGold(def.rewards.gold);
    if (def.rewards.skill) p.stats.skillPoints += def.rewards.skill;
    for (const it of def.rewards.items ?? []) p.addItem(it.id, it.qty);
    bus.emit(EV.QUEST_COMPLETE, { def });
    bus.emit(EV.TOAST, { text: `${def.name} complete! +${def.rewards.xp} xp`, kind: 'good' });
    this.game.audio.play('questComplete');
    this.game.vfx.qi(this.game.player.centerPos, '#ffe9a8', 40, 5);
    // consume quest items
    for (const obj of def.objectives) {
      if (obj.type === 'collect' && obj.target !== 'herb') p.removeItem(obj.target, obj.count);
    }
    if (def.next && this.isAvailable(this.defs.get(def.next)!)) {
      // briefly delay so the player can talk again
      setTimeout(() => {
        bus.emit(EV.QUEST_UPDATE, { type: 'available', def: this.defs.get(def.next!) });
      }, 300);
    }
    this.game.saveGame(true);
  }

  private evaluate() {
    bus.emit(EV.QUEST_UPDATE, { type: 'changed' });
  }

  serialize() {
    return { states: this.states, completed: Array.from(this.completed) };
  }

  load(d: any) {
    if (!d) return;
    this.states = d.states ?? {};
    this.completed = new Set(d.completed ?? []);
  }
}
