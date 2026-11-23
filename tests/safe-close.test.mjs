import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = new URL('../mods/omarchy-close/safe-close.js', import.meta.url);
const { closeSafely } = await import(`data:text/javascript;base64,${Buffer.from(readFileSync(source, 'utf8')).toString('base64')}`);
function fixture() {
  const state = {
    spaces: [{ id: 'space', folder: '/repo', tabs: [{ id: 'tab' }] }],
    panes: [{ pane: 'pane', tab: 'tab', terminal: 'terminal', cwd: '/repo/sub' }],
    focus: { space: 'space', tab: 'tab', pane: 'pane' }, calls: [], notices: [], sleeps: [],
  };
  const api = {
    spaces: () => state.spaces, panes: () => state.panes, focused: () => state.focus,
    notify: message => state.notices.push(message),
    sleep: async ms => state.sleeps.push(ms),
    command: async (command, args) => {
      state.calls.push([command, args]);
      if (command === 'tab.new') {
        const created = { space: args.space, tab: 'replacement', terminal: 'shell' };
        const space = state.spaces.find(s => s.id === args.space);
        space.tabs.push({ id: created.tab });
        state.panes.push({ pane: 'replacement-pane', tab: created.tab, terminal: created.terminal, cwd: args.folder });
        state.focus = { space: args.space, tab: created.tab, pane: 'replacement-pane' };
        return created;
      }
      return {};
    },
  };
  return { state, api };
}
test('last tab gets a verified replacement shell before close', async () => {
  const { state, api } = fixture();
  await closeSafely('tab.close', {}, api);
  assert.deepEqual(state.calls, [['tab.new', { space: 'space', folder: '/repo/sub' }], ['tab.close', { id: 'tab' }]]);
});
test('last pane gets a replacement before close', async () => {
  const { state, api } = fixture();
  await closeSafely('pane.close', {}, api);
  assert.deepEqual(state.calls.map(c => c[0]), ['tab.new', 'pane.close']);
  assert.deepEqual(state.calls[1][1], { pane: 'pane' });
});
test('last visible agent gets a replacement before kill', async () => {
  const { state, api } = fixture();
  await closeSafely('terminal.kill', { terminal: 'terminal' }, api);
  assert.deepEqual(state.calls.map(c => c[0]), ['tab.new', 'terminal.kill']);
});
test('another tab means no replacement', async () => {
  const { state, api } = fixture();
  state.spaces[0].tabs.push({ id: 'other' });
  await closeSafely('tab.close', { id: 'tab' }, api);
  assert.deepEqual(state.calls, [['tab.close', { id: 'tab' }]]);
});
test('another pane, including a mod pane, means no replacement', async () => {
  const { state, api } = fixture();
  state.panes.push({ pane: 'mod', tab: 'tab', terminal: null });
  await closeSafely('pane.close', { pane: 'pane' }, api);
  assert.deepEqual(state.calls, [['pane.close', { pane: 'pane' }]]);
});
test('closing a whole split tab uses its focused terminal directory', async () => {
  const { state, api } = fixture();
  state.panes.push({ pane: 'focused', tab: 'tab', terminal: 'other', cwd: '/latest' });
  state.focus.pane = 'focused';
  await closeSafely('tab.close', { id: 'tab' }, api);
  assert.equal(state.calls[0][1].folder, '/latest');
});
test('mod-only last pane uses space folder', async () => {
  const { state, api } = fixture();
  state.panes[0].terminal = null;
  state.panes[0].cwd = null;
  await closeSafely('pane.close', { pane: 'pane' }, api);
  assert.equal(state.calls[0][1].folder, '/repo');
});
test('missing latest directory retries space folder before closing', async () => {
  const { state, api } = fixture();
  const command = api.command;
  api.command = async (name, args) => {
    if (name === 'tab.new' && args.folder === '/repo/sub') {
      state.calls.push([name, args]);
      throw new Error('folder missing');
    }
    return command(name, args);
  };
  await closeSafely('tab.close', {}, api);
  assert.deepEqual(state.calls.map(c => [c[0], c[1].folder]), [['tab.new', '/repo/sub'], ['tab.new', '/repo'], ['tab.close', undefined]]);
});
test('failed replacement leaves original open and reports error', async () => {
  const { state, api } = fixture();
  api.command = async (name, args) => { state.calls.push([name, args]); throw new Error('offline'); };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.some(c => c[0] === 'tab.close'), false);
  assert.match(state.notices[0].body, /offline/);
});
test('unconfirmed replacement leaves original open', async () => {
  const { state, api } = fixture();
  api.command = async (name, args) => { state.calls.push([name, args]); return { space: 'space', tab: 'replacement', terminal: 'shell' }; };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.length, 1);
  assert.equal(state.notices.length, 1);
});
test('replacement must contain its live shell, not just a tab', async () => {
  const { state, api } = fixture();
  const command = api.command;
  api.command = async (...args) => { const result = await command(...args); if (args[0] === 'tab.new') state.panes.pop(); return result; };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.length, 1);
  assert.equal(state.notices.length, 1);
});
test('waits for replacement shell to reach live model', async () => {
  const { state, api } = fixture();
  const command = api.command;
  api.command = async (...args) => { const result = await command(...args); if (args[0] === 'tab.new') state.panes.pop(); return result; };
  api.sleep = async () => { state.panes.push({ pane: 'replacement-pane', tab: 'replacement', terminal: 'shell' }); };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.at(-1)[0], 'tab.close');
});
test('subagent with no pane is killed without a replacement', async () => {
  const { state, api } = fixture();
  await closeSafely('terminal.kill', { terminal: 'child' }, api);
  assert.deepEqual(state.calls, [['terminal.kill', { terminal: 'child' }]]);
});
test('stale target does not close newly focused tab', async () => {
  const { state, api } = fixture();
  await closeSafely('tab.close', { id: 'missing' }, api);
  assert.deepEqual(state.calls, []);
});
test('no focused pane does not implicitly close something else', async () => {
  const { state, api } = fixture();
  state.focus.pane = null;
  await closeSafely('pane.close', {}, api);
  assert.deepEqual(state.calls, []);
});
test('does not recreate space explicitly removed during shell startup', async () => {
  const { state, api } = fixture();
  const command = api.command;
  api.command = async (...args) => { const result = await command(...args); state.spaces = []; return result; };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.length, 1);
});
test('closing an inactive space restores prior focus after replacement', async () => {
  const { state, api } = fixture();
  state.spaces.push({ id: 'other-space', folder: '/other', tabs: [{ id: 'other-tab' }] });
  state.focus = { space: 'other-space', tab: 'other-tab', pane: 'other-pane' };
  await closeSafely('tab.close', { id: 'tab' }, api);
  assert.deepEqual(state.calls.at(-1), ['tab.select', { id: 'other-tab' }]);
});
test('does not override focus moved by user during startup', async () => {
  const { state, api } = fixture();
  state.spaces.push({ id: 'other-space', tabs: [{ id: 'other-tab' }] });
  const command = api.command;
  api.command = async (...args) => { const result = await command(...args); if (args[0] === 'tab.new') state.focus = { tab: 'other-tab' }; return result; };
  await closeSafely('tab.close', {}, api);
  assert.equal(state.calls.some(c => c[0] === 'tab.select'), false);
});
test('explicit space close cannot be routed through this helper', async () => {
  const { state, api } = fixture();
  await closeSafely('space.close', { id: 'space' }, api);
  assert.deepEqual(state.calls, []);
});
test('remote ids and directory remain machine-qualified', async () => {
  const { state, api } = fixture();
  state.spaces[0].id = 'remote/space';
  state.spaces[0].tabs[0].id = 'remote/tab';
  state.panes[0].tab = 'remote/tab';
  state.panes[0].pane = 'remote/pane';
  await closeSafely('tab.close', { id: 'remote/tab' }, api);
  assert.equal(state.calls[0][1].space, 'remote/space');
  assert.equal(state.calls[1][1].id, 'remote/tab');
});
test('reports whether the close went through', async () => {
  const ok = fixture();
  assert.equal(await closeSafely('pane.close', { pane: 'pane' }, ok.api), true);
  const failing = fixture();
  failing.api.command = async () => { throw new Error('no tab'); };
  assert.equal(await closeSafely('pane.close', { pane: 'pane' }, failing.api), false);
  assert.equal(failing.state.notices.length, 1);
});
