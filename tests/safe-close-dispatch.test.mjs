import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const base = new URL('../mods/', import.meta.url).pathname;
const strip = source => source.replace(/^import .*;\n/gm, '');
test('UI request captures its original target before focus changes', () => {
  const state = {}, calls = [];
  let focus = { tab: 'original-tab', pane: 'original-pane' };
  const context = { focused: () => focus, shared: key => state[key], setShared: (key, value) => state[key] = value, run: (...args) => calls.push(args) };
  const source = strip(readFileSync(`${base}/omarchy-tabs/close.js`, 'utf8')).replace('export function requestClose', 'function requestClose');
  vm.runInNewContext(`${source}\nglobalThis.request = requestClose;`, context);
  context.request('tab.close');
  focus = { tab: 'different-tab', pane: 'different-pane' };
  assert.equal(state['omarchy-close.requests'][0].args.id, 'original-tab');
  assert.equal(calls[0][0], 'omarchy-close.process');
});
test('coordinator drains requests serially, including arrivals during close', async () => {
  const state = { 'omarchy-close.requests': [{ command: 'tab.close', args: { id: 'one' } }, { command: 'pane.close', args: { pane: 'two' } }] };
  const events = [];
  let task, next = 0;
  const context = {
    View: class {}, spaces() {}, panes() {}, focused() {}, exec() {}, notify() {},
    shared: key => state[key], setShared: (key, value) => state[key] = value,
    nextCommand: async () => { if (next++ === 0) return 'process'; throw new Error('test complete'); },
    closeSafely: async (command, args) => {
      events.push(`start:${command}`);
      if (args.id === 'one') state['omarchy-close.requests'].push({ command: 'terminal.kill', args: { terminal: 'three' } });
      await Promise.resolve();
      events.push(`end:${command}`);
    },
  };
  const source = strip(readFileSync(`${base}/omarchy-close/main.js`, 'utf8')).replace('export default class OmarchyClose', 'class OmarchyClose');
  vm.runInNewContext(`${source}\nglobalThis.Controller = OmarchyClose;`, context);
  new context.Controller().init({}, { spawn: fn => { task = fn({ sleep() {}, notify() {} }); } });
  await assert.rejects(task, /test complete/);
  assert.deepEqual(events, ['start:tab.close', 'end:tab.close', 'start:pane.close', 'end:pane.close', 'start:terminal.kill', 'end:terminal.kill']);
  assert.equal(state['omarchy-close.requests'].length, 0);
});
