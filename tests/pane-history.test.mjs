import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaneHistory, placeOf, resolve, SETTLE, CAP } from '../mods/omarchy-tabs/history.js';

// A window: spaces s1 (tabs a, b) and mini/s2 (tab mini/c), panes as given.
function world(panes, terminals = []) {
  const spaces = [
    { id: 's1', machine: null, tabs: [{ id: 'a' }, { id: 'b' }] },
    { id: 'mini/s2', machine: 'mini', tabs: [{ id: 'mini/c' }] },
  ];
  return { panes, terminals, spaces };
}
const pane = (id, tab, terminal = `k-${id}`) => ({ pane: id, tab, terminal });
const at = (lists, id) => placeOf({ pane: id }, lists);

// Focus on each pane in turn, each held long enough to settle.
function visit(h, lists, ids, start = 0) {
  let now = start;
  for (const id of ids) {
    h.see(at(lists, id), now);
    now += SETTLE;
    h.settle(now);
    now += 10;
  }
  return now;
}
const back = (h, lists, here, now) => h.go(-1, lists, at(lists, here), now)?.pane ?? null;
const forward = (h, lists, here, now) => h.go(1, lists, at(lists, here), now)?.pane ?? null;

test('a focus counts only once it has settled', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b')]);
  const h = new PaneHistory();
  assert.equal(h.see(at(lists, 'p1'), 0), true);
  assert.equal(h.settle(SETTLE - 1), false);
  assert.equal(h.settle(SETTLE), true);
  // Passing through p2 on the way to p3 adds nothing.
  h.see(at(lists, 'p2'), 1000);
  h.see(at(lists, 'p3'), 1100);
  h.settle(1000 + SETTLE);
  h.settle(1100 + SETTLE);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1', 'p3']);
  // The same pane seen again is not a new focus.
  assert.equal(h.see(at(lists, 'p3'), 2000), false);
  assert.equal(h.settle(3000), false);
  assert.equal(h.entries.length, 2);
});

test('overlays, side panels and terminal blocks are not panes', () => {
  const lists = world([pane('p1', 'a')]);
  assert.equal(placeOf({ pane: null, terminal: 'k-x' }, lists), null);
  assert.equal(placeOf({ pane: 'files' }, lists), null);
  assert.equal(placeOf(null, lists), null);
  const h = new PaneHistory();
  assert.equal(h.see(null, 0), false);
  assert.equal(h.settle(SETTLE), false);
  assert.deepEqual(h.entries, []);
});

test('back and forward step through panes across tabs and spaces', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'b'), pane('mini/p3', 'mini/c', 'mini/t3')]);
  const h = new PaneHistory();
  let now = visit(h, lists, ['p1', 'p2', 'mini/p3']);
  const to = h.go(-1, lists, at(lists, 'mini/p3'), now);
  assert.deepEqual(to, { pane: 'p2', terminal: 'k-p2', tab: 'b', space: 's1', machine: null });
  now = visit(h, lists, ['p2'], now);
  assert.equal(back(h, lists, 'p2', now), 'p1');
  now = visit(h, lists, ['p1'], now);
  assert.equal(back(h, lists, 'p1', now), null);
  assert.equal(forward(h, lists, 'p1', now), 'p2');
  now = visit(h, lists, ['p2'], now);
  assert.deepEqual(h.go(1, lists, at(lists, 'p2'), now), { pane: 'mini/p3', terminal: 'mini/t3', tab: 'mini/c', space: 'mini/s2', machine: 'mini' });
  now = visit(h, lists, ['mini/p3'], now);
  assert.equal(forward(h, lists, 'mini/p3', now), null);
});

test('the focus a back lands on adds no entry and keeps the forward ones', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b')]);
  const h = new PaneHistory();
  let now = visit(h, lists, ['p1', 'p2', 'p3']);
  assert.equal(back(h, lists, 'p3', now), 'p2');
  // On the way there the tab switch shows p1 for a moment.
  h.see(at(lists, 'p1'), now + 5);
  now = visit(h, lists, ['p2'], now + 10);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1', 'p2', 'p3']);
  assert.equal(forward(h, lists, 'p2', now), 'p3');
});

test('focusing something new after a back drops the forward entries', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b'), pane('p4', 'b')]);
  const h = new PaneHistory();
  let now = visit(h, lists, ['p1', 'p2', 'p3']);
  assert.equal(back(h, lists, 'p3', now), 'p2');
  now = visit(h, lists, ['p2', 'p4'], now);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1', 'p2', 'p4']);
  assert.equal(forward(h, lists, 'p4', now), null);
  assert.equal(back(h, lists, 'p4', now), 'p2');
});

test('a back pressed before the focus settled starts from where the person is', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b')]);
  const h = new PaneHistory();
  let now = visit(h, lists, ['p1', 'p2']);
  h.see(at(lists, 'p3'), now);
  assert.equal(back(h, lists, 'p3', now + 100), 'p2');
  // Its settle timer fires afterwards and records nothing.
  h.see(at(lists, 'p2'), now + 150);
  h.settle(now + SETTLE + 20);
  assert.equal(forward(h, lists, 'p2', now + 200 + SETTLE), 'p3');
});

test('a second back right after the first goes on from the first one\'s pane', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b')]);
  const h = new PaneHistory();
  const now = visit(h, lists, ['p3', 'p2', 'p1', 'p3']);
  assert.equal(back(h, lists, 'p3', now), 'p1');
  // The first back's focus hasn't landed yet: Herdr still reports p3.
  assert.equal(back(h, lists, 'p3', now + 50), 'p2');
  assert.equal(back(h, lists, 'p3', now + 100), 'p3');
});

test('panes that are gone are skipped and removed', () => {
  const all = [pane('p1', 'a'), pane('p2', 'a'), pane('p3', 'b'), pane('p4', 'b')];
  const h = new PaneHistory();
  let now = visit(h, world(all), ['p1', 'p2', 'p3', 'p4']);
  // p2 closed, and tab b went with p3 in it (p4 moved to tab a).
  const lists = world([pane('p1', 'a'), { ...pane('p4', 'a') }]);
  assert.equal(back(h, lists, 'p4', now), 'p1');
  assert.deepEqual(h.entries.map(e => e.pane), ['p1', 'p4']);
  now = visit(h, lists, ['p1'], now);
  assert.equal(forward(h, lists, 'p1', now), 'p4');
});

test('nothing to go to: does nothing', () => {
  const h = new PaneHistory();
  const lists = world([pane('p1', 'a'), pane('p2', 'a')]);
  assert.equal(back(h, lists, 'p1', 0), null);
  const now = visit(h, lists, ['p1', 'p2']);
  // Everything behind is gone, or the same pane again.
  const left = world([pane('p2', 'a')]);
  visit(h, left, ['p2'], now);
  assert.equal(back(h, left, 'p2', now + 1000), null);
  assert.equal(forward(h, left, 'p2', now + 1000), null);
  assert.equal(h.entries[h.index].pane, 'p2');
});

test('an entry that is the pane the person is on is dropped, not landed on', () => {
  const lists = world([pane('p1', 'a'), pane('p2', 'a')]);
  const h = new PaneHistory();
  const now = visit(h, lists, ['p1', 'p2', 'p1']);
  // p2 closes: what is behind p1 is p1 itself.
  const left = world([pane('p1', 'a')]);
  assert.equal(back(h, left, 'p1', now), null);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1']);
});

test('history keeps the last CAP panes', () => {
  const panes = Array.from({ length: CAP + 10 }, (_, i) => pane(`p${i}`, 'a'));
  const lists = world(panes);
  const h = new PaneHistory();
  visit(h, lists, panes.map(p => p.pane));
  assert.equal(h.entries.length, CAP);
  assert.equal(h.entries[0].pane, 'p10');
  assert.equal(h.index, CAP - 1);
});

// omarchy-pane's Chat | Terminal switch: Terminal -> Chat splits a chat pane beside the agent's
// pane, labels the agent herdr.chat=<chat>, focuses the chat, then parks the agent (its pane goes).
// Chat -> Terminal gives the agent a new pane, clears the label and closes the chat.
const live = (address, chat) => ({ address, state: 'live', labels: chat ? { 'herdr.chat': chat } : {} });

test('after a swap to Chat, back lands on the chat pane, not the parked one', () => {
  const before = world([pane('p1', 'a'), pane('p2', 'a', 'k2')], [live('k2')]);
  const h = new PaneHistory();
  let now = visit(h, before, ['p2', 'p1']);
  // p2's agent k2 is now behind chat pane c9.
  const after = world([pane('p1', 'a'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], [live('k2', 'c9')]);
  assert.deepEqual(resolve({ pane: 'p2', terminal: 'k2' }, after), { pane: 'c9', terminal: 'k2', tab: 'a', space: 's1', machine: null });
  assert.equal(back(h, after, 'p1', now), 'c9');
});

test('the swap itself adds no entry: the chat takes its terminal pane\'s place', () => {
  const h = new PaneHistory();
  const before = world([pane('p1', 'a'), pane('p2', 'a', 'k2')], [live('k2')]);
  let now = visit(h, before, ['p1', 'p2']);
  // Mid-swap: the chat is focused and labelled while p2 is still there, then p2 goes.
  const mid = world([pane('p1', 'a'), pane('p2', 'a', 'k2'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], [live('k2', 'c9')]);
  h.see(at(mid, 'c9'), now);
  const after = world([pane('p1', 'a'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], [live('k2', 'c9')]);
  h.see(at(after, 'c9'), now + 100);
  now += SETTLE + 20;
  h.settle(now);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1', 'c9']);
  assert.equal(back(h, after, 'c9', now), 'p1');
});

test('after a swap back to Terminal, back lands on the agent\'s new pane', () => {
  const chat = world([pane('p1', 'a'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], [live('k2', 'c9')]);
  const h = new PaneHistory();
  let now = visit(h, chat, ['c9', 'p1']);
  assert.equal(h.entries[0].terminal, 'k2');
  const term = world([pane('p1', 'a'), pane('p7', 'a', 'k2')], [live('k2')]);
  assert.equal(back(h, term, 'p1', now), 'p7');
});

test('a chat whose agent was not known yet is treated as gone once it closes', () => {
  const chat = world([pane('p1', 'a'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], []);
  const h = new PaneHistory();
  const now = visit(h, chat, ['c9', 'p1']);
  const term = world([pane('p1', 'a'), pane('p7', 'a', 'k2')], [live('k2')]);
  assert.equal(back(h, term, 'p1', now), null);
  assert.deepEqual(h.entries.map(e => e.pane), ['p1']);
});

test('a chat beside its agent\'s own pane is a place of its own', () => {
  const lists = world([pane('p2', 'a', 'k2'), { pane: 'c9', tab: 'a', terminal: null, mod: 'chat' }], [live('k2', 'c9')]);
  assert.equal(at(lists, 'c9').terminal, null);
  const h = new PaneHistory();
  const now = visit(h, lists, ['p2', 'c9']);
  assert.equal(back(h, lists, 'c9', now), 'p2');
});
