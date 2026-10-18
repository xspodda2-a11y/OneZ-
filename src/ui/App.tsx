import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../state/store';
import { game } from '../game/Game';
import { input } from '../game/core/Input';
import { saves } from '../game/save/Save';
import { Hud } from './Hud';
import { DialogueBox, InventoryPanel, CharacterPanel, JournalPanel, ShopPanel, ControlsPanel } from './Panels';
import { MainMenu, LoadingScreen, PauseMenu, DeathScreen, SettingsPanel } from './Menus';
import { WorldMap } from './Map';
import type { Panel } from '../state/store';

const PANEL_TITLES: Record<Panel, [string, string]> = {
  none: ['', ''],
  inventory: ['行囊 · PACK', 'I'],
  character: ['修行 · CULTIVATION', 'C'],
  quests: ['江湖录 · JOURNAL', 'J'],
  map: ['天下舆图 · MAP', 'M'],
  settings: ['设置 · SETTINGS', 'ESC'],
  controls: ['操作 · CONTROLS', 'ESC'],
  credits: ['题记 · CREDITS', 'ESC'],
  shop: ['市集 · TRADE', 'ESC'],
};

export default function App() {
  const screen = useGame((s) => s.screen);
  const panel = useGame((s) => s.panel);
  const dialogue = useGame((s) => s.dialogue);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [booted, setBooted] = useState(false);

  /* ------------------------------------------------------------- lifecycle */

  useEffect(() => {
    const stored = saves.loadSettings();
    if (stored) useGame.getState().setSettings(stored);
    const onResize = () => { if (game.started) game.render.resize(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const openPanel = useCallback((p: Panel) => {
    input.enabled = false;
    input.releaseLock();
    useGame.getState().setPanel(p);
  }, []);

  const closePanel = useCallback(() => {
    useGame.getState().setPanel('none');
    useGame.getState().setShop(null);
    input.enabled = true;
  }, []);

  const startGame = useCallback(async (slot: number | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = useGame.getState();
    // World already built (returning from the title screen): just start a run.
    if (game.started) {
      if (slot != null) await game.loadGame(slot); else game.newGame();
      st.setScreen('playing');
      st.setPanel('none');
      game.setPaused(false);
      input.enabled = true;
      game.audio.setMusic('explore');
      game.start();
      return;
    }
    st.setLoading({ active: true, progress: 0, text: 'Waking the jianghu…' });
    st.setScreen('loading');
    game.audio.init();
    game.audio.setVolumes(st.settings.music, st.settings.sfx);
    await game.init(canvas, st.settings.quality);
    input.sensitivity = st.settings.sensitivity;
    input.invertY = st.settings.invertY;
    input.attach(canvas, (locked) => {
      if (!locked && useGame.getState().screen === 'playing' && useGame.getState().panel === 'none' && !useGame.getState().dialogue) {
        useGame.getState().setScreen('paused');
        game.setPaused(true);
      }
    });
    if (slot != null) {
      const ok = await game.loadGame(slot);
      if (!ok) game.newGame();
    } else {
      game.newGame();
    }
    game.audio.setMusic('explore');
    st.setScreen('playing');
    st.setPanel('none');
    input.enabled = true;
    game.start();
    game.refreshQuestUI();
    setBooted(true);
    setTimeout(() => useGame.getState().setHint('WASD to move · LMB light · RMB heavy/block · F to parry · E to interact'), 900);
    setTimeout(() => useGame.getState().setHint(null), 11000);
  }, []);

  /* ----------------------------------------------------------------- input */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useGame.getState();
      if (st.screen !== 'playing') return;
      if (e.code === 'Escape') {
        if (st.dialogue) { game.chooseDialogue({ text: '', action: 'close' }); return; }
        if (st.panel !== 'none') { closePanel(); return; }
        st.setScreen('paused');
        game.setPaused(true);
        game.audio.play('uiBack');
        return;
      }
      if (st.dialogue) return;
      if (st.panel !== 'none') return;
      switch (e.code) {
        case 'KeyI': openPanel('inventory'); game.audio.play('uiClick'); break;
        case 'KeyC': openPanel('character'); game.audio.play('uiClick'); break;
        case 'KeyJ': openPanel('quests'); game.audio.play('uiClick'); break;
        case 'KeyM': openPanel('map'); game.audio.play('uiClick'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPanel, closePanel]);

  const onCanvasClick = () => {
    const st = useGame.getState();
    if (st.screen !== 'playing' || st.panel !== 'none' || st.dialogue) return;
    if (!input.locked) input.requestLock();
  };

  /* ---------------------------------------------------------------- render */

  const body = (): React.ReactNode => {
    const [title] = PANEL_TITLES[panel];
    let content: React.ReactNode = null;
    if (panel === 'inventory') content = <InventoryPanel />;
    else if (panel === 'character') content = <CharacterPanel />;
    else if (panel === 'quests') content = <JournalPanel />;
    else if (panel === 'settings') content = <SettingsPanel />;
    else if (panel === 'controls') content = <ControlsPanel />;
    else if (panel === 'shop') content = <ShopPanel />;

    return (
      <div className="ui-root">
        {screen === 'playing' && <Hud />}
        {screen === 'playing' && dialogue && <DialogueBox />}
        {screen === 'playing' && panel === 'map' && <WorldMap onClose={closePanel} />}
        {screen === 'playing' && panel !== 'none' && panel !== 'map' && (
          <div className="modal" onClick={closePanel}>
            <div className="panel modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-title">
                <span>{title}</span><small>ESC to close</small>
              </div>
              <div className="panel-body" style={{ flex: 1 }}>{content}</div>
            </div>
          </div>
        )}
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'menu' && (
          <MainMenu
            onStart={() => { void startGame(null); }}
            onLoad={(slot) => { void startGame(slot); }}
          />
        )}
        {screen === 'paused' && (
          <PauseMenu
            onResume={() => {
              useGame.getState().setScreen('playing');
              game.setPaused(false);
              input.enabled = true;
              game.audio.play('uiClick');
            }}
            onQuit={() => {
              game.stop();
              game.setPaused(true);
              useGame.getState().setScreen('menu');
              game.audio.setMusic('menu');
            }}
          />
        )}
        {screen === 'dead' && <DeathScreen />}
      </div>
    );
  };

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" onClick={onCanvasClick} />
      <div id="dmg-layer" />
      {body()}
    </>
  );
}
