/** Renders the React interface server-side in every state to catch render-time crashes. */
import './dom-shim';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/ui/App';
import { Hud } from '../src/ui/Hud';
import { DialogueBox, InventoryPanel, CharacterPanel, JournalPanel, ShopPanel, ControlsPanel } from '../src/ui/Panels';
import { MainMenu, LoadingScreen, PauseMenu, DeathScreen, SettingsPanel } from '../src/ui/Menus';
import { WorldMap } from '../src/ui/Map';
import { useGame } from '../src/state/store';

// react-dom/server reads zustand's *initial* snapshot, so seed that object.
const seed = (patch: Record<string, any>) => Object.assign((useGame as any).getInitialState(), patch);

let fails = 0;
function render(name: string, node: React.ReactElement, expect: string[] = []) {
  try {
    const html = renderToStaticMarkup(node);
    const missing = expect.filter((e) => !html.includes(e));
    if (missing.length) {
      fails++;
      console.log(`  FAIL ${name}: markup missing ${JSON.stringify(missing)} (${html.length} chars)`);
    } else {
      console.log(`  ok   ${name} (${html.length} chars)`);
    }
  } catch (e: any) {
    fails++;
    console.log(`  FAIL ${name}: ${e?.stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}

console.log('\n=== UI render smoke test ===\n');

seed({ screen: 'menu' });
render('App (menu)', <App />, ['WINDS OF', 'Begin the Journey']);

seed({ screen: 'loading' });
seed({ loading: { active: true, progress: 0.42, text: 'Raising the mountains…' } });
render('App (loading)', <App />, ['Raising the mountains', 'loading-bar']);

seed({ screen: 'playing' });
render('App (playing → hud)', <App />, ['hud-bars', 'minimap-wrap', 'hotbar']);

render('Hud', <Hud />, ['hud-bars', 'crosshair']);

seed({ boss: { name: 'Hei Shan', nameCN: '黑山', hp: 900, maxHp: 1500, phase: 2 } });
render('Hud + boss bar', <Hud />, ['boss-bar', 'Hei Shan']);
seed({ boss: null });

seed({ interact: { label: 'Talk to Elder Chen', key: 'E' } });
render('Hud + interact prompt', <Hud />, ['Talk to Elder Chen']);
seed({ interact: null });

seed({ trackers: [{
  questId: 'q1', name: 'The Road to Willow Bend', nameCN: '柳湾之路', main: true,
  objectives: [{ text: 'Speak with Elder Chen', value: 0, need: 1, done: false },
               { text: 'Drive off the bandits', value: 2, need: 4, done: false }],
}] });
render('Hud + quest tracker', <Hud />, ['柳湾之路', '2/4']);

seed({ toasts: [{ id: 1, text: 'Discovered: Willow Bend 柳湾村', kind: 'quest' }] });
render('Hud + toast', <Hud />, ['Discovered']);

seed({ dialogue: {
  speaker: 'Elder Chen', text: 'The road south is not safe, traveller.',
  options: [{ text: 'I will look into it.', action: 'quest:accept', data: 'q1' }, { text: 'Farewell.', action: 'close' }],
} });
render('DialogueBox', <DialogueBox />, ['Elder Chen', 'I will look into it.']);
render('App (dialogue open)', <App />, ['dlg-text']);

render('InventoryPanel', <InventoryPanel />, ['行囊']);
render('CharacterPanel', <CharacterPanel />, ['境界', 'skill-node']);
render('JournalPanel', <JournalPanel />, ['江湖录']);
render('ControlsPanel', <ControlsPanel />, ['Parry']);
render('SettingsPanel', <SettingsPanel />, ['Graphics preset']);
render('ShopPanel (no shop)', <ShopPanel />, []);

seed({ shop: {
  npc: 'Merchant Wu',
  items: [{ id: 'potion', name: 'Small Potion', price: 30, owned: 2, icon: '藥', desc: 'heals' }],
} });
render('ShopPanel', <ShopPanel />, ['Merchant Wu', 'Small Potion']);
seed({ shop: null });

render('WorldMap', <WorldMap onClose={() => {}} />, ['REALM CHART', 'map-legend']);
render('PauseMenu', <PauseMenu onResume={() => {}} onQuit={() => {}} />, ['PAUSED', 'Resume']);
render('DeathScreen', <DeathScreen />, ['YOU HAVE FALLEN', 'Rise again']);
render('LoadingScreen', <LoadingScreen />, ['WINDS OF ETERNITY']);
render('MainMenu', <MainMenu onStart={() => {}} onLoad={() => {}} />, ['Begin the Journey', '永劫長風']);

console.log(`\n=== ${fails === 0 ? 'ALL UI STATES RENDERED' : `${fails} UI FAILURE(S)`} ===\n`);
process.exit(fails === 0 ? 0 : 1);
