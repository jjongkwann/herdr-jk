import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutMods, mergeKeys, mergeSettings, missingKeyMods, packaged, reservedKeys, stripLayout } from '../scripts/win-pc/core.mjs';

const LAYOUT = {
  id: 'root', type: 'column', children: [
    { id: 'topbar', type: 'row', children: [
      { id: 'bar', type: 'block', content: { mod: 'omarchy-bar' } },
      { id: 'voice', type: 'block', content: { mod: 'omarchy-voice' } },
    ] },
    { id: 'main', type: 'row', floating: [
      { id: 'voice-live', content: { mod: 'omarchy-voice-live' } },
      { id: 'voice-live-2', content: { mod: 'omarchy-voice-live' } },
    ], children: [
      { id: 'panel', type: 'stack', active: 'herdr-sim', children: [
        { id: 'tasks', type: 'block', content: { mod: 'tasks' } },
        { id: 'herdr-sim', type: 'block', content: { mod: 'herdr-sim', props: { frames: 'panel' } } },
      ] },
    ] },
  ],
};

test('takes the macOS-only mods out of the layout, wherever they sit', () => {
  const { layout, removed } = stripLayout(LAYOUT);
  assert.deepEqual(removed.sort(), ['herdr-sim', 'voice', 'voice-live', 'voice-live-2']);
  assert.deepEqual(layoutMods(layout), ['omarchy-bar', 'tasks']);
  assert.deepEqual(layout.children[1].floating, []);
});

test('a stack that was showing a removed node shows one that is left', () => {
  assert.equal(stripLayout(LAYOUT).layout.children[1].children[0].active, 'tasks');
});

test('leaves the layout it was given alone', () => {
  const before = structuredClone(LAYOUT);
  stripLayout(LAYOUT);
  assert.deepEqual(LAYOUT, before);
});

const WIN = {
  global: { 'alt-left': 'pane.go:left', 'alt-t': 'tab.new' },
  terminal: { 'ctrl-shift-c': 'terminal.copy', 'alt-backspace': 'send:u' },
  'layout:win98': { 'alt-q': 'x' },
};
const MAC = {
  global: { 'cmd-q': 'app.quit', 'cmd-alt-left': 'pane.go:left', 'alt-left': 'tab.prev', 'ctrl-1': 'space.select:1' },
  terminal: { 'cmd-c': 'terminal.copy', 'alt-backspace': 'send:w', 'ctrl-k': 'terminal' },
  'layout:omarchy': { 'super-k': 'mod.open:omarchy-keys', 'super-ctrl-v': 'omarchy-voice.toggle', 'cmd-j': 'x' },
  'layout:shepherdr': { 'ctrl-j': 'y' },
  'mod:chat': { 'ctrl-f': 'chat.find' },
};

test('the Mac keys win, without the ones a PC has no key for', () => {
  const keys = mergeKeys(WIN, MAC);
  assert.deepEqual(keys.global, { 'alt-left': 'tab.prev', 'alt-t': 'tab.new', 'ctrl-1': 'space.select:1' });
  assert.deepEqual(keys.terminal, { 'ctrl-shift-c': 'terminal.copy', 'alt-backspace': 'send:w', 'ctrl-k': 'terminal' });
});

test('brings the omarchy and chat keys without voice, and no other layout of the Mac', () => {
  const keys = mergeKeys(WIN, MAC);
  assert.deepEqual(keys['layout:omarchy'], { 'super-k': 'mod.open:omarchy-keys' });
  assert.deepEqual(keys['mod:chat'], { 'ctrl-f': 'chat.find' });
  assert.deepEqual(keys['layout:win98'], { 'alt-q': 'x' });
  assert.equal(keys['layout:shepherdr'], undefined);
});

test('merging again changes nothing', () => {
  const once = mergeKeys(WIN, MAC);
  assert.deepEqual(mergeKeys(once, MAC), once);
});

test('settings take the look of the Mac and keep everything else of Windows', () => {
  const out = mergeSettings(
    { zoom: 1, font_ligatures: false, sounds: { enabled: true } },
    { zoom: 2, font: 'D2KodingLigature Nerd Font', font_size: 14, telemetry: false, appearance: 'dark', theme: 'x', option_as_alt: 'on' },
  );
  assert.deepEqual(out, { zoom: 1, font_ligatures: false, sounds: { enabled: true }, font: 'D2KodingLigature Nerd Font', font_size: 14, telemetry: false, appearance: 'dark', theme: 'x' });
});

test('names the keys Windows keeps for itself and what to press instead', () => {
  const rows = reservedKeys({ 'layout:omarchy': { 'super-k': 'mod.open:omarchy-keys', 'super-alt-3': 'space.select:3', 'super-return': 'terminal.open' } });
  assert.deepEqual(rows.map((r) => [r.key, r.instead]), [['super-k', 'ctrl-alt-k'], ['super-alt-3', 'ctrl-3']]);
  assert.match(rows[0].takenBy, /Cast/);
});

test('a key offered in place of a taken one does not take a key that does something else', () => {
  const keys = mergeKeys(WIN, MAC);
  const bound = Object.assign({}, ...Object.values(keys));
  for (const { key, instead, action } of reservedKeys({ 'layout:omarchy': { ...MAC['layout:omarchy'] } })) {
    assert.ok(!(instead in bound) || bound[instead] === action, `${key} -> ${instead}`);
  }
});

test('finds keys that open a mod that is not installed', () => {
  assert.deepEqual(missingKeyMods({ global: { a: 'mod.open:jump', b: 'mod.open:gone', c: 'tab.new' } }, ['jump']), ['gone']);
});

test('leaves litter and build output out of the package', () => {
  for (const path of ['mods/tasks/bin/__pycache__/x.pyc', 'mods/chat/node_modules/a/b.js', 'mods/._pr-flow', 'themes/.DS_Store', 'mods/chat/gpui-kit.d.ts', 'mods\\chat\\jsconfig.json', 'mods/x/.git/config']) {
    assert.equal(packaged(path), false, path);
  }
  for (const path of ['mods/tasks/bin/herdr-task', 'lib/COPIES', 'backgrounds/omarchy/nord/0-black-moon.webp']) {
    assert.equal(packaged(path), true, path);
  }
});
