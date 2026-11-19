import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function tooltip(mod, start, end, context) {
  const source = readFileSync(new URL(`../mods/omarchy-${mod}/main.js`, import.meta.url), 'utf8');
  const offset = source.indexOf(start);
  assert.notEqual(offset, -1);
  const limit = source.indexOf(end, offset);
  assert.notEqual(limit, -1);
  let label;
  const el = new Proxy({}, { get: (_, key) => (...args) => {
    if (key === 'tooltip') label = args[0];
    if (key === 'when' && args[0]) args[1](el);
    return el;
  } });
  vm.runInNewContext(source.slice(offset, limit) + (mod === 'tabs' ? '}; item(c, 0);' : ''), { div: () => el, h_flex: () => el, ...context });
  return label;
}

test('collapsed and expanded agent rows show the full core address even without truncation', () => {
  const context = {
    a: { address: 'vps/t7' }, label: () => 'Build', name: 'Build', machine: 'vps',
    more: null, also: null, cut: false,
  };
  assert.match(tooltip('agents', 'div()\n          .id(`ag-', '.when(a.focused', context) ?? '', /vps\/t7/);
  assert.match(tooltip('agents', 'h_flex()\n        .id(`ag-', '.relative()', context) ?? '', /vps\/t7/);
});

test('a child agent row shows its own core address', () => {
  const label = tooltip('agents', 'h_flex()\n      .id(`sub-', '.pl(24)', { k: { address: 't8' } });
  assert.equal(label, 't8');
});

test('tab hover shows all terminal panes but not mod panes or panes in other tabs', () => {
  const address = (terminal, tab = 'tab') => ({ terminal, tab, title: '', program: { name: terminal ? 'Shell' : 'Mod' } });
  const context = {
    c: { id: 'tab', name: '1' }, tabA: 190, tabW: 190, TAB_ICONS: 100,
    allPanes: [address('vps/t7'), address(null), address('vps/t8'), address('vps/t9', 'other')],
    allTerminals: [],
  };
  const label = tooltip('tabs', 'const item = (c, i) => {', '// The close button shows', context);
  assert.match(label, /vps\/t7/);
  assert.match(label, /vps\/t8/);
  assert.doesNotMatch(label, /null|undefined|vps\/t9/);
});
