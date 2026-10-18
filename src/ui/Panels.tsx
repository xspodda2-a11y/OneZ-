import { useMemo, useState } from 'react';
import { useGame } from '../state/store';
import { game } from '../game/Game';
import { ITEMS, SKILLS, ItemDef } from '../game/rpg/Progression';

/* --------------------------------------------------------------- dialogue */

export function DialogueBox() {
  const d = useGame((s) => s.dialogue);
  if (!d) return null;
  return (
    <div className="dialogue fade-in">
      <div className="dlg-name">{d.speaker}</div>
      <div className="dlg-text">{d.text}</div>
      <div className="dlg-opts">
        {d.options.map((o, i) => (
          <div key={i} className="dlg-opt" onClick={() => game.chooseDialogue(o)}>
            <span>{o.text}</span><span className="mark">▸</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- inventory */

const KIND_LABEL: Record<string, string> = {
  weapon: 'Weapon', armor: 'Armour', trinket: 'Trinket',
  consumable: 'Consumable', material: 'Material', quest: 'Quest',
};

function ItemDetail({ def, qty }: { def: ItemDef; qty: number }) {
  const st = game.prog.stats;
  return (
    <div className="item-detail">
      <div className="spread">
        <h3>{def.name} <span className="cn" style={{ color: '#8a7d68', fontSize: 14 }}>{def.nameCN}</span></h3>
        <span className="kind">{def.rarity}</span>
      </div>
      <div className="kind" style={{ marginBottom: 8 }}>{KIND_LABEL[def.kind]} · {qty} held · value {def.value} 文</div>
      <p>{def.desc}</p>
      {def.stats && (
        <div className="stats">
          {Object.entries(def.stats).map(([k, v]) => (
            <div key={k}>{k}: +{(v as number) < 1 ? `${Math.round((v as number) * 100)}%` : v}</div>
          ))}
        </div>
      )}
      {def.heal ? <div className="stats">Restores {def.heal} health</div> : null}
      <div style={{ marginTop: 10, fontSize: 12, color: '#8a7d68', fontFamily: 'var(--ui-sans)' }}>
        Your attack {st.attack} · defence {st.defense} · crit {Math.round(st.critChance * 100)}%
      </div>
    </div>
  );
}

export function InventoryPanel() {
  const [, force] = useState(0);
  const hud = useGame((s) => s.hud);
  const [sel, setSel] = useState<string | null>(null);
  const inv = game.prog.inventory;
  const def = sel ? ITEMS[sel] : null;
  const qty = sel ? game.prog.count(sel) : 0;
  const refresh = () => { game.updateHud(true); force((n) => n + 1); };

  const equipped = new Set(Object.values(game.prog.equipped).filter(Boolean) as string[]);

  return (
    <div className="two-col">
      <div>
        <div className="panel-title" style={{ padding: '0 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
          <span>行囊 · PACK</span><small>{inv.length} / 24</small>
        </div>
        <div className="inv-grid" style={{ marginTop: 10, maxHeight: 470, overflowY: 'auto' }}>
          {inv.map((s) => {
            const d = ITEMS[s.id];
            if (!d) return null;
            return (
              <div
                key={s.id}
                className={`item ${d.rarity === 'rare' ? 'rare' : ''} ${d.rarity === 'legendary' ? 'legendary' : ''} ${equipped.has(s.id) ? 'equipped' : ''} ${sel === s.id ? '' : ''}`}
                style={sel === s.id ? { borderColor: '#d8b271', background: 'rgba(80,60,40,0.6)' } : undefined}
                onClick={() => setSel(s.id)}
              >
                <div className="icon">{d.icon}</div>
                <div className="nm">{d.name}</div>
                {s.qty > 1 && <div className="qty">{s.qty}</div>}
              </div>
            );
          })}
        </div>
        <div className="spread" style={{ marginTop: 12 }}>
          <span className="dim" style={{ fontSize: 13 }}>Gold</span>
          <span style={{ color: 'var(--gold)' }}>{hud.gold} 文</span>
        </div>
      </div>
      <div className="col" style={{ gap: 12 }}>
        {def ? <ItemDetail def={def} qty={qty} /> : <div className="item-detail dim">Select an item.</div>}
        <div className="row">
          {def && (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket') && (
            <button className="primary" onClick={() => { game.equipItem(def.id); refresh(); }}>
              {equipped.has(def.id) ? 'Unequip' : 'Equip'}
            </button>
          )}
          {def && def.kind === 'consumable' && (
            <button className="primary" onClick={() => { game.useItem(def.id); refresh(); }}>Use</button>
          )}
          {def && (
            <button className="ghost" onClick={() => { game.dropItem(def.id); refresh(); setSel(null); }}>Discard</button>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="panel-title" style={{ padding: '0 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
            <span>装备 · EQUIPPED</span>
          </div>
          {(['weapon', 'armor', 'trinket'] as const).map((slot) => {
            const id = game.prog.equipped[slot];
            const d = id ? ITEMS[id] : null;
            return (
              <div className="stat-line" key={slot}>
                <span>{slot[0].toUpperCase() + slot.slice(1)}</span>
                <span style={{ color: d ? 'var(--gold)' : '#6f6558' }}>{d ? `${d.icon} ${d.name}` : '— empty —'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- character */

export function CharacterPanel() {
  const [, force] = useState(0);
  const hud = useGame((s) => s.hud);
  const st = game.prog.stats;

  const owned = new Set(game.prog.skills);
  const node = (id: string) => SKILLS.find((s) => s.id === id)!;
  const canLearn = (id: string) => {
    const d = node(id);
    return !owned.has(id) && (d.requires ?? []).every((r) => owned.has(r)) && st.skillPoints >= d.cost;
  };

  return (
    <div className="two-col">
      <div>
        <div className="panel-title" style={{ padding: '0 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
          <span>境界 · CULTIVATION</span><small>Lv {st.level}</small>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="stat-line"><span>Level</span><span>{st.level}</span></div>
          <div className="stat-line"><span>Experience</span><span>{st.xp} / {st.xpNext}</span></div>
          <div className="stat-line"><span>Skill points</span><span style={{ color: st.skillPoints ? 'var(--jade)' : undefined }}>{st.skillPoints}</span></div>
          <div className="stat-line"><span>Health</span><span>{st.maxHp}</span></div>
          <div className="stat-line"><span>Stamina</span><span>{st.maxStamina}</span></div>
          <div className="stat-line"><span>Qi</span><span>{st.maxQi}</span></div>
          <div className="stat-line"><span>Attack</span><span>{st.attack}</span></div>
          <div className="stat-line"><span>Defence</span><span>{st.defense}</span></div>
          <div className="stat-line"><span>Critical</span><span>{Math.round(st.critChance * 100)}%</span></div>
          <div className="stat-line"><span>Qi regen</span><span>{st.qiRegen.toFixed(1)}/s</span></div>
          <div className="stat-line"><span>Gold</span><span>{hud.gold} 文</span></div>
          <div className="stat-line"><span>Play time</span><span>{Math.floor(game.playTime / 60)}m {Math.floor(game.playTime % 60)}s</span></div>
          <div className="stat-line"><span>Fallen</span><span>{game.deaths}</span></div>
        </div>
        <div style={{ marginTop: 14, fontSize: 12.5, color: '#8a7d68', lineHeight: 1.7, fontFamily: 'var(--ui-sans)' }}>
          Spend skill points to open new techniques. The blade remembers what the body learns.
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div className="panel-title" style={{ padding: '0 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
          <span>武学 · MARTIAL ARTS</span><small>{owned.size - 1} / {SKILLS.length - 1} opened</small>
        </div>
        <div className="skill-tree" style={{ height: 500 }}>
          <svg width="100%" height="500" style={{ position: 'absolute', inset: 0 }}>
            {SKILLS.map((s) => (s.requires ?? []).map((r) => {
              const a = node(r);
              const x1 = 105 + a.col * 150, y1 = 42 + a.row * 82;
              const x2 = 105 + s.col * 150, y2 = 42 + s.row * 82;
              const lit = owned.has(r) && owned.has(s.id);
              return <line key={r + s.id} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={lit ? 'rgba(216,178,113,0.75)' : 'rgba(216,178,113,0.16)'} strokeWidth={lit ? 1.6 : 1} />;
            }))}
          </svg>
          {SKILLS.map((s) => {
            const isOwned = owned.has(s.id);
            const open = canLearn(s.id);
            return (
              <div
                key={s.id}
                className={`skill-node ${isOwned ? 'owned' : open ? 'avail' : ''}`}
                style={{ left: 105 + s.col * 150, top: 42 + s.row * 82 }}
                title={`${s.desc} (${s.cost} pt)`}
                onClick={() => {
                  if (game.learnSkill(s.id)) { game.updateHud(true); force((n) => n + 1); }
                }}
              >
                <div className="orb">{s.nameCN[0]}</div>
                <div className="nm">{s.name}</div>
                <div className="cost">{isOwned ? 'learned' : `${s.cost} pt`}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- journal */

export function JournalPanel() {
  const log = useGame((s) => s.questLog);
  const done = Array.from(game.quests?.completed ?? []);
  return (
    <div style={{ maxHeight: '100%', overflowY: 'auto' }}>
      <div className="panel-title" style={{ padding: '0 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
        <span>江湖录 · JOURNAL</span><small>{log.length} active · {done.length} complete</small>
      </div>
      {log.length === 0 && <div className="dim" style={{ padding: '24px 0' }}>No tasks. Seek out the villagers of Willow Bend.</div>}
      {log.map(({ def, state }) => (
        <div className="quest-item" key={def.id}>
          <h4>{def.name}<span className="cn">{def.nameCN}</span>
            {def.main ? <span className="tag main">MAIN</span> : <span className="tag">SIDE</span>}
            {state.readyToTurnIn && <span className="tag" style={{ borderColor: 'var(--jade)', color: 'var(--jade)' }}>READY</span>}
          </h4>
          <p>{def.desc}</p>
          {def.objectives.map((o: any, i: number) => (
            <div className={`obj ${(state.progress[i] ?? 0) >= o.count ? 'done' : ''}`} key={i}>
              {(state.progress[i] ?? 0) >= o.count ? '✓' : '·'} {o.text}
              {o.count > 1 && `  (${Math.min(state.progress[i] ?? 0, o.count)}/${o.count})`}
            </div>
          ))}
          <div className="reward">
            Reward: {def.rewards.xp} xp · {def.rewards.gold} 文
            {def.rewards.items?.map((it: any) => ` · ${ITEMS[it.id]?.name ?? it.id} ×${it.qty}`)}
          </div>
          {def.giver && <div className="dim" style={{ fontSize: 11.5, marginTop: 4, fontFamily: 'var(--ui-sans)' }}>
            {state.readyToTurnIn ? `Return to ${def.giver}.` : `Given by ${def.giver}.`}
          </div>}
        </div>
      ))}
      {done.length > 0 && (
        <>
          <div className="panel-title" style={{ padding: '18px 0 8px', borderBottom: '1px solid rgba(216,178,113,0.2)', fontSize: 15 }}>
            <span>已了 · CLOSED</span>
          </div>
          {done.map((id) => {
            const def = game.quests?.def(id);
            if (!def) return null;
            return <div className="quest-item" key={id} style={{ opacity: 0.7 }}>
              <h4>{def.name}<span className="cn">{def.nameCN}</span></h4>
              <p style={{ margin: 0 }}>{def.completeText}</p>
            </div>;
          })}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- shop */

export function ShopPanel() {
  const shop = useGame((s) => s.shop);
  const hud = useGame((s) => s.hud);
  const [, force] = useState(0);
  if (!shop) return null;
  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="dim">Trading with <b style={{ color: 'var(--gold)' }}>{shop.npc}</b></span>
        <span style={{ color: 'var(--gold)' }}>Your purse: {hud.gold} 文</span>
      </div>
      <div className="inv-grid">
        {shop.items.map((it) => (
          <div key={it.id} className="item" onClick={() => { game.buyItem(it.id, it.price); force((n) => n + 1); }}>
            <div className="icon">{it.icon}</div>
            <div className="nm">{it.name}</div>
            <div className="qty" style={{ color: hud.gold >= it.price ? 'var(--gold)' : '#a05040' }}>{it.price}文</div>
          </div>
        ))}
      </div>
      <div className="dim" style={{ marginTop: 16, fontSize: 12.5, fontFamily: 'var(--ui-sans)' }}>
        Click an item to buy it. Press ESC to leave the stall.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

export function ControlsPanel() {
  const rows: [string, string][] = [
    ['W A S D', 'Move'],
    ['Mouse', 'Camera'],
    ['Left click', 'Light attack (chains ×3)'],
    ['Right click', 'Heavy attack / hold to block'],
    ['Shift + direction', 'Dodge roll'],
    ['Space', 'Jump · hold to glide (once learned)'],
    ['F', 'Parry — strike just before the blow lands'],
    ['Q', 'Whirlwind Lotus (qi)'],
    ['R', 'Shadowless Step (qi, once learned)'],
    ['Tab', 'Lock on / switch target'],
    ['E', 'Interact — talk, open, gather'],
    ['H', 'Drink a potion'],
    ['B', 'Sheathe / draw the sword'],
    ['I / C / J / M', 'Pack · Cultivation · Journal · Map'],
    ['ESC', 'Pause'],
  ];
  return (
    <div>
      <div className="three-col">
        {[0, 1, 2].map((c) => (
          <div key={c}>
            {rows.filter((_, i) => i % 3 === c).map(([k, v]) => (
              <div className="stat-line" key={k}>
                <span><span className="key">{k}</span></span>
                <span style={{ color: '#cbbb9e', fontFamily: 'var(--ui-sans)', fontSize: 12.5, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, fontSize: 13, color: '#9a8d78', lineHeight: 1.8 }}>
        Combat tips: a parry (F) at the moment of impact breaks an enemy's guard and opens a counter window —
        press light attack during the flash for a devastating riposte. Blocking drains stamina; when it breaks you
        are staggered. Enemies telegraph unblockable blows with a red ripple — dodge those.
      </div>
    </div>
  );
}
