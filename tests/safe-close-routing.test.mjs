import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('Omarchy owns the close coordinator and overrides pane/tab close keys', () => {
  const layout = JSON.parse(read('layouts/omarchy.json'));
  assert.ok(layout.children.some(block => block.content?.mod === 'omarchy-close'));
  const keys = JSON.parse(read('keys.json'))['layout:omarchy'];
  assert.equal(keys['super-w'], 'omarchy-close.pane');
  assert.equal(keys['ctrl-shift-w'], 'omarchy-close.tab');
  assert.equal(keys['ctrl-shift-x'], 'omarchy-close.pane');
});
test('every Omarchy close surface uses the coordinator', () => {
  for (const name of ['tabs', 'pane', 'agents', 'palette']) {
    assert.match(read(`mods/omarchy-${name}/main.js`), /requestClose\(/, name);
    assert.match(read(`mods/omarchy-${name}/close.js`), /omarchy-close.process/, name);
  }
  assert.match(read('mods/omarchy-tabs/pane.js'), /requestClose\(command, args\)/);
});
test('every close surface carries the same close.js', () => {
  for (const name of ['pane', 'agents', 'palette']) assert.equal(read(`mods/omarchy-${name}/close.js`), read('mods/omarchy-tabs/close.js'), name);
});
