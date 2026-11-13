import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jump } from '../mods/omarchy-tabs/jump.js';
import { chatAgents, spacesWithChats } from '../mods/omarchy-tabs/parked.js';

const items = (...statuses) => statuses.map((status, i) => ({ id: i, status, cur: false }));
const at = (list, i) => { list[i].cur = true; return list; };
const isCur = x => x.cur;

test('skips to the next running or blocked item, wrapping', () => {
  const list = at(items('working', null, 'idle', 'blocked', null), 3);
  assert.equal(jump(list, isCur, 1).id, 0);
  assert.equal(jump(list, isCur, -1).id, 0);
});

test('done and idle do not count as running', () => {
  const list = at(items(null, 'done', 'idle', 'working'), 0);
  assert.equal(jump(list, isCur, 1).id, 3);
});

test('falls back to every item when no other one is running', () => {
  const list = at(items(null, 'working', null), 1);
  assert.equal(jump(list, isCur, 1).id, 2);
  assert.equal(jump(list, isCur, -1).id, 0);
});

test('starts from the edge when nothing is current', () => {
  const list = items(null, 'working', 'blocked');
  assert.equal(jump(list, isCur, 1).id, 1);
  assert.equal(jump(list, isCur, -1).id, 2);
});

test('returns null for an empty list', () => {
  assert.equal(jump([], isCur, 1), null);
});

test('counts an agent shown as Chat as running, as the tab strip does', () => {
  // t3's agent is parked behind its chat pane, so Herdr gives t3 no status of its own.
  const panes = [{ pane: 'p1', tab: 't1', terminal: 'k1' }, { pane: 'p2', tab: 't2', terminal: 'k2' }, { pane: 'p3', tab: 't3', mod: 'chat' }];
  const terminals = [
    { address: 'k1', state: 'live', status: 'idle' },
    { address: 'k2', state: 'live', status: 'idle' },
    { address: 'k3', state: 'live', status: 'working', labels: { 'herdr.chat': 'p3' } },
  ];
  const spaces = [{ id: 's1', active: true, tabs: [{ id: 't1', active: true, status: 'idle' }, { id: 't2', status: 'idle' }, { id: 't3', status: null }] }];
  const isActive = t => t.active;
  assert.equal(jump(spaces[0].tabs, isActive, 1).id, 't2');
  const tabs = spacesWithChats(spaces, chatAgents({ panes, terminals, spaces }))[0].tabs;
  assert.equal(jump(tabs, isActive, 1).id, 't3');
  assert.equal(jump(tabs, isActive, -1).id, 't3');
});
