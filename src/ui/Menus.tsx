import { useEffect, useState } from 'react';
import { useGame, useGame as store } from '../state/store';
import { game } from '../game/Game';
import { saves } from '../game/save/Save';
import { ControlsPanel } from './Panels';

/* -------------------------------------------------------------- main menu */

export function MainMenu({ onStart, onLoad }: { onStart: () => void; onLoad: (slot: number) => void }) {
  const [slots, setSlots] = useState<(any | null)[]>([null, null, null]);
  const [showLoad, setShowLoad] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showCredits, setShowCredits] = useState(false);

  useEffect(() => {
    saves.open().then(() => saves.list().then(setSlots));
  }, []);

  const any = slots.some(Boolean);

  if (showControls) return <Screen title="操作 · CONTROLS" onBack={() => setShowControls(false)}><ControlsPanel /></Screen>;
  if (showCredits) return <Screen title="题记 · CREDITS" onBack={() => setShowCredits(false)}><Credits /></Screen>;
  if (showSettings) return <Screen title="设置 · SETTINGS" onBack={() => setShowSettings(false)}><SettingsPanel /></Screen>;
  if (showLoad) return (
    <Screen title="读取 · LOAD" onBack={() => { setShowLoad(false); saves.list().then(setSlots); }}>
      <SlotList slots={slots} onLoad={onLoad} onRefresh={() => saves.list().then(setSlots)} />
    </Screen>
  );

  return (
    <div className="menu-screen">
      <div className="menu-mountains" />
      <div className="menu-seal">風永</div>
      <div className="menu-left">
        <h1 className="menu-title">WINDS OF<br />ETERNITY</h1>
        <div className="menu-title-cn">永劫長風</div>
        <div className="menu-sub">A Wuxia Open-World Action RPG</div>
        <div className="menu-buttons">
          <button className="primary" onClick={onStart}>Begin the Journey <span className="cn">入江湖</span></button>
          {any && <button onClick={() => setShowLoad(true)}>Continue <span className="cn">續前緣</span></button>}
          <button onClick={() => setShowControls(true)}>Controls <span className="cn">操作</span></button>
          <button onClick={() => setShowSettings(true)}>Settings <span className="cn">設置</span></button>
          <button onClick={() => setShowCredits(true)}>Credits <span className="cn">題記</span></button>
        </div>
      </div>
      <div className="menu-foot">
        Procedurally generated world · every mountain, village and melody is original. No downloaded assets.
      </div>
    </div>
  );
}

function Screen({ title, children, onBack }: { title: string; children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="menu-screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="menu-mountains" />
      <div className="panel" style={{ width: 'min(940px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', zIndex: 3 }}>
        <div className="panel-title"><span>{title}</span></div>
        <div className="panel-body">{children}</div>
        <div className="row" style={{ padding: '0 20px 18px', justifyContent: 'flex-end' }}>
          <button onClick={onBack}>Back <span className="cn">返回</span></button>
        </div>
      </div>
    </div>
  );
}

function SlotList({ slots, onLoad, onRefresh }: { slots: (any | null)[]; onLoad: (s: number) => void; onRefresh: () => void }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      {slots.map((m, i) => (
        <div key={i} className="row spread" style={{ border: '1px solid rgba(216,178,113,0.2)', padding: '12px 16px' }}>
          <div className="col">
            <b style={{ letterSpacing: 2 }}>Slot {i + 1} {m ? '' : <span className="dim">— empty —</span>}</b>
            {m && (
              <small className="dim" style={{ fontFamily: 'var(--ui-sans)' }}>
                Level {m.level} · {m.gold} 文 · {m.location} · {Math.floor((m.playTime ?? 0) / 60)}m played · {m.quest}
                <br />{new Date(m.time).toLocaleString()}
              </small>
            )}
          </div>
          <div className="row">
            {m && <button className="primary" onClick={() => onLoad(i)}>Load</button>}
            {m && <button className="ghost" onClick={async () => { await saves.remove(i); onRefresh(); }}>Delete</button>}
          </div>
        </div>
      ))}
      {!slots.some(Boolean) && <div className="dim">No saved journeys yet.</div>}
    </div>
  );
}

/* --------------------------------------------------------------- settings */

export function SettingsPanel() {
  const settings = useGame((s) => s.settings);
  const set = useGame((s) => s.setSettings);
  const apply = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    set(patch);
    if (game.started) game.applySettings(next as any);
  };
  const Slider = ({ label, value, onChange, min = 0, max = 1, step = 0.05, fmt }: any) => (
    <div className="setting">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <div className="val">{fmt ? fmt(value) : value.toFixed(2)}</div>
    </div>
  );
  const Switch = ({ label, value, onChange }: any) => (
    <div className="setting">
      <label>{label}</label>
      <div className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></div>
      <div className="val">{value ? 'on' : 'off'}</div>
    </div>
  );
  return (
    <div>
      <div className="setting">
        <label>Graphics preset</label>
        <div className="seg">
          {(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const).map((q) => (
            <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => apply({ quality: q })}>{q}</button>
          ))}
        </div>
        <div className="val">{settings.quality}</div>
      </div>
      <Slider label="Music" value={settings.music} onChange={(v: number) => apply({ music: v })} />
      <Slider label="Sound effects" value={settings.sfx} onChange={(v: number) => apply({ sfx: v })} />
      <Slider label="Mouse sensitivity" value={settings.sensitivity} min={0.2} max={2.5} step={0.05}
        onChange={(v: number) => apply({ sensitivity: v })} />
      <Switch label="Invert vertical look" value={settings.invertY} onChange={(v: boolean) => apply({ invertY: v })} />
      <Switch label="Show performance meter" value={settings.showFps} onChange={(v: boolean) => apply({ showFps: v })} />
      <Switch label="Adaptive resolution" value={settings.autoQuality}
        onChange={(v: boolean) => { apply({ autoQuality: v }); if (game.started) game.render.adaptive = v; }} />
      <div style={{ marginTop: 14, fontSize: 12.5, color: '#8a7d68', fontFamily: 'var(--ui-sans)', lineHeight: 1.7 }}>
        Adaptive resolution quietly lowers render scale if the frame rate drops below 42 FPS and restores it when
        there is headroom. Lower the preset if the world feels heavy.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- credits */

function Credits() {
  return (
    <div style={{ lineHeight: 1.9, fontSize: 14.5 }}>
      <p><b style={{ color: 'var(--gold)' }}>Winds of Eternity · 永劫長風</b> — an original wuxia action RPG built for the browser.</p>
      <p className="dim" style={{ fontFamily: 'var(--ui-sans)', fontSize: 13 }}>
        Every asset in this game is generated at runtime by code you are running right now:
        the mountains from fractal noise, the villages and temples from a procedural settlement generator,
        the characters from a bespoke skeletal rig and hand-authored animation curves,
        the textures from canvas painting routines, and the entire score and sound design
        from Web Audio oscillators. There is not a single downloaded image, model or audio file.
      </p>
      <div className="stat-line"><span>Engine</span><span>Three.js r0.186 (WebGL2)</span></div>
      <div className="stat-line"><span>Interface</span><span>React 19 · Zustand</span></div>
      <div className="stat-line"><span>Build</span><span>Vite · TypeScript</span></div>
      <div className="stat-line"><span>Physics</span><span>Custom capsule controller</span></div>
      <p className="dim" style={{ fontSize: 13, fontFamily: 'var(--ui-sans)' }}>
        Inspired by the landscapes and martial-arts cinema of the jianghu tradition; it copies no existing game.
        See <b>ASSET_CREDITS.md</b> in the repository for the full provenance statement.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- loading */

export function LoadingScreen() {
  const loading = useGame((s) => s.loading);
  const tips = [
    'Parry (F) at the instant a blow lands to break an enemy’s guard.',
    'Hold SPACE while falling — once the Lightness Skill is learned, you can ride the wind.',
    'Red ripples mean unblockable. Roll, do not guard.',
    'Talk to everyone. The jianghu rewards curiosity.',
    'Rest at a temple or monastery to heal and pass the night.',
    'High places hide spirit stones. So do bandit camps.',
  ];
  const [tip] = useState(() => tips[Math.floor(Math.random() * tips.length)]);
  return (
    <div className="loading-screen">
      <div className="loading-inner">
        <div className="loading-title">WINDS OF ETERNITY</div>
        <div className="loading-cn">永 劫 長 風</div>
        <div className="loading-bar"><i style={{ width: `${Math.round(loading.progress * 100)}%` }} /></div>
        <div className="loading-text">{loading.text}</div>
        <div className="loading-tip">{tip}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pause */

export function PauseMenu({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  const [show, setShow] = useState<'root' | 'settings' | 'controls' | 'load'>('root');
  const [slots, setSlots] = useState<(any | null)[]>([null, null, null]);
  useEffect(() => { if (show === 'load') saves.list().then(setSlots); }, [show]);
  return (
    <div className="screen-center">
      <div className="panel" style={{ width: 'min(880px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-title">
          <span>{show === 'root' ? '暂停 · PAUSED' : show === 'settings' ? '设置 · SETTINGS' : show === 'controls' ? '操作 · CONTROLS' : '读取 · LOAD'}</span>
          <small>Winds of Eternity</small>
        </div>
        <div className="panel-body">
          {show === 'root' && (
            <div className="col" style={{ gap: 12, maxWidth: 320 }}>
              <button className="primary" onClick={onResume}>Resume <span className="cn">繼續</span></button>
              <button onClick={async () => { await game.saveGame(false); }}>Save game <span className="cn">存檔</span></button>
              <button onClick={() => setShow('load')}>Load game <span className="cn">讀檔</span></button>
              <button onClick={() => setShow('settings')}>Settings <span className="cn">設置</span></button>
              <button onClick={() => setShow('controls')}>Controls <span className="cn">操作</span></button>
              <button className="ghost" onClick={onQuit}>Quit to title <span className="cn">回到標題</span></button>
            </div>
          )}
          {show === 'settings' && <SettingsPanel />}
          {show === 'controls' && <ControlsPanel />}
          {show === 'load' && <SlotList slots={slots} onLoad={(i) => game.loadGame(i).then(() => onResume())}
            onRefresh={() => saves.list().then(setSlots)} />}
        </div>
        {show !== 'root' && (
          <div className="row" style={{ padding: '0 20px 18px', justifyContent: 'flex-end' }}>
            <button onClick={() => setShow('root')}>Back <span className="cn">返回</span></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ death */

export function DeathScreen() {
  return (
    <div className="death-screen">
      <div className="death-inner">
        <h1>身死道消</h1>
        <h2>YOU HAVE FALLEN</h2>
        <p>The wind does not mourn. It waits.</p>
        <div style={{ marginTop: 26 }}>
          <button className="primary" onClick={() => game.respawn()}>Rise again <span className="cn">再起</span></button>
        </div>
        <p style={{ marginTop: 18, fontSize: 12 }}>You will awaken at the last settlement you visited, minus a fifth of your coin.</p>
      </div>
    </div>
  );
}
