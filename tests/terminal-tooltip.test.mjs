import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function render(mod, start, end, context, invoke = '') {
  const source = readFileSync(new URL(`../mods/omarchy-${mod}/main.js`, import.meta.url), 'utf8');
  const offset = source.indexOf(start);
  assert.notEqual(offset, -1);
  const limit = source.indexOf(end, offset);
  assert.notEqual(limit, -1);
  let tooltip;
  const children = [];
  const el = new Proxy({}, { get: (_, key) => (...args) => {
    if (key === 'tooltip') tooltip = args[0];
    if (key === 'child') children.push(args[0]);
    if (key === 'when' && args[0]) args[1](el);
    return el;
  } });
  vm.runInNewContext(source.slice(offset, limit) + invoke, { div: () => el, h_flex: () => el, svg: () => el, ...context });
  return { tooltip, children };
}

test('agent rows render local IDs and remote addresses, keeping the expanded remote badge', () => {
  for (const collapsed of [false, true]) {
    for (const address of ['t7', 'vps/t7']) {
      const result = render('agents', 'const row = (a, i, subs = []) => {', '\n    };', {
        agent: { address, space_name: 'Build' }, collapsed, t: {}, detail: new Map(),
        icon: () => null, label: () => 'Build', place: () => 'Build', room: () => 100,
        since: () => null, status: () => null, pinner: () => null, squeezed: false, byPriority: false,
        rankOf: () => 0, RANK: { idle: 0 },
      }, '}; row(agent, 0);');
      assert.equal(result.tooltip, `Build · ${address}`);
      assert.equal(result.children.includes('vps'), !collapsed && address.startsWith('vps/'));
    }
  }
});

test('a child agent row shows its own core address', () => {
  const result = render('agents', 'h_flex()\n      .id(`sub-', '.pl(24)', { k: { address: 't8' } });
  assert.equal(result.tooltip, 't8');
});

test('tab hover shows all terminal panes but not mod panes or panes in other tabs', () => {
  const address = (terminal, tab = 'tab') => ({ terminal, tab, title: '', program: { name: terminal ? 'Shell' : 'Mod' } });
  const context = {
    c: { id: 'tab', name: '1' }, tabA: 190, tabW: 190, TAB_ICONS: 100,
    allPanes: [address('vps/t7'), address(null), address('vps/t8'), address('vps/t9', 'other')],
    allTerminals: [], parked: [],
  };
  const { tooltip: label } = render('tabs', 'const item = (c, i) => {', '// The close button shows', context, '}; item(c, 0);');
  assert.match(label, /vps\/t7/);
  assert.match(label, /vps\/t8/);
  assert.doesNotMatch(label, /null|undefined|vps\/t9/);
});

test('tab hover also names the agents shown as Chat in that tab, which have no pane of their own', () => {
  const context = {
    c: { id: 'tab', name: '1' }, tabA: 190, tabW: 190, TAB_ICONS: 100,
    allPanes: [{ pane: 'chat1', terminal: null, mod: 'chat', tab: 'tab', title: '' }],
    allTerminals: [], parked: [{ address: 't10', tab: 'tab' }, { address: 't11', tab: 'other' }],
  };
  const { tooltip: label } = render('tabs', 'const item = (c, i) => {', '// The close button shows', context, '}; item(c, 0);');
  assert.match(label, /t10/);
  assert.doesNotMatch(label, /null|undefined|t11/);
});
