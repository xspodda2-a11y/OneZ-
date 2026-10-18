import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/store';
import { game } from '../game/Game';
import { ITEMS } from '../game/rpg/Progression';
import { WORLD } from '../game/core/TerrainHeight';

/* ------------------------------------------------------------------ minimap */

function Minimap() {
  const mm = useGame((s) => s.minimap);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const S = 176;
    c.width = S * 2; c.height = S * 2;
    g.scale(2, 2);
    g.clearRect(0, 0, S, S);
    const R = 130; // metres shown
    const toMap = (x: number, z: number) => {
      const dx = (x - mm.x) / R * (S / 2);
      const dz = (z - mm.z) / R * (S / 2);
      // rotate so the player's facing is up
      const cs = Math.cos(-mm.yaw), sn = Math.sin(-mm.yaw);
      return { x: S / 2 + (dx * cs - dz * sn), y: S / 2 + (dx * sn + dz * cs) };
    };
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();

    // ground
    g.fillStyle = 'rgba(28,24,19,0.55)';
    g.fillRect(0, 0, S, S);

    // terrain relief (cheap: sample a grid)
    const step = 16;
    for (let i = 0; i < S; i += step) {
      for (let j = 0; j < S; j += step) {
        const wx = mm.x + ((i - S / 2) / (S / 2)) * R * 1.9;
        const wz = mm.z + ((j - S / 2) / (S / 2)) * R * 1.9;
        const p = toMap(wx, wz);
        const h = (game as any).terrain ? (game as any).terrain.height(wx, wz) : 0;
        const t = Math.min(1, Math.max(0, h / 160));
        const water = h < WORLD.waterLevel;
        g.fillStyle = water
          ? `rgba(40,70,95,${0.5 + t})`
          : `rgba(${60 + t * 70},${58 + t * 52},${44 + t * 34},${0.45 + t * 0.4})`;
        g.fillRect(p.x - step / 2, p.y - step / 2, step, step);
      }
    }

    // pois
    for (const p of mm.pois) {
      const q = toMap(p.x, p.z);
      if (Math.hypot(q.x - S / 2, q.y - S / 2) > S / 2) continue;
      g.fillStyle = 'rgba(216,178,113,0.95)';
      g.beginPath(); g.arc(q.x, q.y, 2.6, 0, Math.PI * 2); g.fill();
      g.font = '7px sans-serif'; g.fillStyle = 'rgba(216,178,113,0.75)';
      g.textAlign = 'center'; g.fillText(p.name, q.x, q.y - 5);
    }
    // quest markers
    for (const q0 of mm.quests) {
      const q = toMap(q0.x, q0.z);
      const d = Math.hypot(q.x - S / 2, q.y - S / 2);
      const ang = Math.atan2(q.y - S / 2, q.x - S / 2);
      const ex = d > S / 2 - 6 ? S / 2 + Math.cos(ang) * (S / 2 - 6) : q.x;
      const ey = d > S / 2 - 6 ? S / 2 + Math.sin(ang) * (S / 2 - 6) : q.y;
      g.fillStyle = '#d0a4ee';
      g.beginPath(); g.moveTo(ex, ey - 4); g.lineTo(ex + 3.2, ey + 2.6); g.lineTo(ex - 3.2, ey + 2.6); g.closePath(); g.fill();
    }
    // npcs
    for (const n of mm.npcs) {
      const q = toMap(n.x, n.z);
      g.fillStyle = 'rgba(127,179,165,0.9)';
      g.fillRect(q.x - 1.4, q.y - 1.4, 2.8, 2.8);
    }
    // enemies
    for (const e of mm.enemies) {
      const q = toMap(e.x, e.z);
      g.fillStyle = e.hostile ? '#f0553f' : '#d06050';
      g.beginPath(); g.arc(q.x, q.y, 2.2, 0, Math.PI * 2); g.fill();
    }
    // player arrow
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(S / 2, S / 2 - 5); g.lineTo(S / 2 + 3.6, S / 2 + 4); g.lineTo(S / 2, S / 2 + 2); g.lineTo(S / 2 - 3.6, S / 2 + 4);
    g.closePath(); g.fill();
    g.restore();
  }, [mm]);
  return <div className="minimap-wrap"><canvas ref={ref} /><div className="compass">北 N</div></div>;
}

/* --------------------------------------------------------------------- HUD */

export function Hud() {
  const hud = useGame((s) => s.hud);
  const trackers = useGame((s) => s.trackers);
  const toasts = useGame((s) => s.toasts);
  const boss = useGame((s) => s.boss);
  const prompt = useGame((s) => s.interact);
  const hint = useGame((s) => s.hint);
  const showFps = useGame((s) => s.settings.showFps);
  const [hpLag, setHpLag] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setHpLag(Math.max(hud.hp / Math.max(1, hud.maxHp), 0)), 420);
    return () => clearTimeout(t);
  }, [hud.hp, hud.maxHp]);

  const pct = (a: number, b: number) => Math.max(0, Math.min(1, a / Math.max(1, b)));

  return (
    <div className="hud">
      {boss && (
        <div className="boss-bar fade-in">
          <div className="name">{boss.name}<span className="cn">{boss.nameCN}</span></div>
          <div className="bar"><i style={{ transform: `scaleX(${pct(boss.hp, boss.maxHp)})` }} /></div>
          <div className="phase">PHASE {boss.phase} · {Math.ceil(boss.hp)} / {boss.maxHp}</div>
        </div>
      )}

      <div className="hud-bars">
        <div className="bar hp">
          <i style={{ transform: `scaleX(${pct(hud.hp, hud.maxHp)})` }} />
          <div className="lag" style={{ transform: `scaleX(${hpLag})` }} />
          <div className="txt">{Math.ceil(hud.hp)} / {hud.maxHp}</div>
        </div>
        <div className="bar stam">
          <i style={{ transform: `scaleX(${pct(hud.stamina, hud.maxStamina)})` }} />
          <div className="txt" style={{ opacity: 0.85 }}>{Math.ceil(hud.stamina)}</div>
        </div>
        <div className="bar qi">
          <i style={{ transform: `scaleX(${pct(hud.qi, hud.maxQi)})` }} />
          <div className="txt" style={{ opacity: 0.85 }}>{Math.ceil(hud.qi)}</div>
        </div>
        <div className="bar xp">
          <i style={{ transform: `scaleX(${pct(hud.xp, hud.xpNext)})` }} />
        </div>
      </div>

      <div className="hud-portrait">俠</div>
      <div className="hud-level">Lv <b>{hud.level}</b>{hud.skillPoints > 0 && <span style={{ color: '#7fb3a5' }}> · +{hud.skillPoints}</span>}</div>

      <div className="hud-right">
        <Minimap />
        <div className="hud-meta">
          <div><b>{hud.location}</b> · {hud.time}</div>
          <div style={{ textTransform: 'capitalize' }}>{hud.weather} · {hud.gold} <span style={{ color: '#d8b271' }}>文</span></div>
        </div>
      </div>

      <div className="hud-tracker">
        {trackers.map((t) => (
          <div className="tracker-q" key={t.questId}>
            <h4>{t.name}<span className="cn">{t.nameCN}</span>{t.main && <span className="tag main">MAIN</span>}</h4>
            <ul style={{ margin: 0, padding: 0 }}>
              {t.objectives.map((o, i) => (
                <li key={i} className={o.done ? 'done' : ''}>
                  {o.done ? '✓ ' : '· '}{o.text} {o.need > 1 && `(${o.value}/${o.need})`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="crosshair" />

      {prompt && (
        <div className="prompt"><span className="key">{prompt.key}</span>{prompt.label}</div>
      )}

      {hint && <div className="hud-hint">{hint}</div>}

      <div className="hotbar">
        <div className={`slot ${hud.potions > 0 ? '' : 'empty'}`} onClick={() => game.usePotion()}>
          <span>藥</span><span className="k">H</span><span className="qty">{hud.potions}</span>
        </div>
        <div className="slot"><span>{ITEMS[game.prog.equipped.weapon as string]?.icon ?? '拳'}</span><span className="k">B</span></div>
        <div className="slot"><span>{ITEMS[game.prog.equipped.armor as string]?.icon ?? '衣'}</span><span className="k">C</span></div>
        <div className="slot"><span>卷</span><span className="k">J</span></div>
        <div className="slot"><span>图</span><span className="k">M</span></div>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>

      {showFps && (
        <div className="fps">{hud.fps} FPS · {hud.drawCalls} calls · {(hud.tris / 1000).toFixed(0)}k tris</div>
      )}
    </div>
  );
}
