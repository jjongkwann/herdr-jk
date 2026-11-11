import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, fold } from '../mods/omarchy-keys/describe.js';

test('names actions by type in plain English', () => {
  assert.deepEqual(describe('tab.select:3'), { group: 'Tabs', label: 'Go to tab 3' });
  assert.deepEqual(describe('pane.go:left'), { group: 'Panes', label: 'Focus pane left' });
  assert.deepEqual(describe('mod.open:omarchy-mod-manager'), { group: 'Dialogs', label: 'Open mod manager' });
  assert.deepEqual(describe('agent.next'), { group: 'Agents', label: 'Next agent' });
  assert.deepEqual(describe('send:\u0017'), { group: 'Terminal', label: 'Send keys' });
  assert.deepEqual(describe('something.new'), { group: 'Other', label: 'something.new' });
});

test('folds numbered runs into one row and leaves the rest', () => {
  const list = [1, 2, 3].map(n => ({ section: 's', keys: `alt-${n}`, action: `tab.select:${n}` }));
  list.push({ section: 's', keys: 'alt-left', action: 'tab.prev' }, { section: 's', keys: 'alt-5', action: 'tab.select:5' });
  const out = fold(list);
  assert.deepEqual(out.map(k => [k.keys, k.action]), [
    ['alt-1…3', 'tab.select:1…3'], ['alt-left', 'tab.prev'], ['alt-5', 'tab.select:5'],
  ]);
  assert.equal(describe(out[0].action).label, 'Go to tab 1…3');
});

test('does not fold keys whose number differs from the action', () => {
  const out = fold([{ keys: 'ctrl-1', action: 'tab.select:2' }, { keys: 'ctrl-2', action: 'tab.select:3' }]);
  assert.equal(out.length, 2);
});
