import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { describe, fold, shown } from '../mods/omarchy-keys/describe.js';

test('names actions by type in plain English', () => {
  assert.deepEqual(describe('tab.select:3'), { group: 'Tabs', label: 'Go to tab 3' });
  assert.deepEqual(describe('pane.go:left'), { group: 'Panes', label: 'Focus pane left' });
  assert.deepEqual(describe('mod.open:omarchy-mod-manager'), { group: 'Dialogs', label: 'Open mod manager' });
  assert.deepEqual(describe('agent.next'), { group: 'Agents', label: 'Next agent' });
  assert.deepEqual(describe('send:\u0017'), { group: 'Terminal', label: 'Delete word before cursor' });
  assert.deepEqual(describe('send:x'), { group: 'Terminal', label: 'Send keys' });
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

test('names our own keys and the global ones Herdr ships', () => {
  assert.deepEqual(describe('omarchy-voice.toggle'), { group: 'Terminal', label: 'Start or stop dictation' });
  assert.deepEqual(describe('omarchy-pane.toggle'), { group: 'Panes', label: 'Switch pane between Chat and Terminal' });
  assert.deepEqual(describe('pr-flow.refresh'), { group: 'Git', label: 'Refresh pull requests' });
  assert.deepEqual(describe('omarchy-bar.fullscreen'), { group: 'Look', label: 'Enter or leave full screen' });
  assert.deepEqual(describe('mod.open:omarchy-backgrounds'), { group: 'Dialogs', label: 'Open wallpaper picker' });
  assert.deepEqual(describe('layout.toggle:topbar'), { group: 'Look', label: 'Show or hide top bar' });
  assert.deepEqual(describe('mod.open:equal-width'), { group: 'Panes', label: 'Make panes equal width' });
  assert.deepEqual(describe('app.quit'), { group: 'App', label: 'Quit Herdr' });
  assert.deepEqual(describe('app.reset'), { group: 'App', label: 'Reset to the default screen' });
});

test('every key in our keys.json has a label and a group', () => {
  const sections = JSON.parse(readFileSync(new URL('../keys.json', import.meta.url), 'utf8'));
  for (const [section, keys] of Object.entries(sections)) {
    for (const [key, action] of Object.entries(keys)) {
      const { group, label } = describe(action);
      assert.notEqual(group, 'Other', `${section} ${key} ${action}`);
      assert.notEqual(label, action, `${section} ${key} ${action}`);
    }
  }
});

test('folds super-alt-1..9 into one space row', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ keys: `super-alt-${n}`, action: `space.select:${n}` }));
  list.push({ keys: 'super-up', action: 'space.prev' }, { keys: 'super-down', action: 'space.next' });
  const out = fold(list);
  assert.deepEqual(out.map(k => [k.keys, describe(k.action).label]), [
    ['super-alt-1…9', 'Go to space 1…9'], ['super-up', 'Previous space'], ['super-down', 'Next space'],
  ]);
});

test('shows control bytes in caret notation', () => {
  assert.equal(shown('send:\u001bb'), 'send:^[b');
  assert.equal(shown('send:\u0015'), 'send:^U');
  assert.equal(shown('tab.select:1…9'), 'tab.select:1…9');
});
