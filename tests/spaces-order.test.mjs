import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrange } from '../mods/omarchy-spaces/order.js';

const space = (id, status = null, changed = null) => ({ w: { id, status, tabs: [{ changed_at: changed }] }, g: null });
const ids = (rows) => rows.map((r) => r.w.id);

test('spaces keep their order, whatever their agents are doing', () => {
  const list = [space('a'), space('b', 'working', 10), space('c', 'idle', 99), space('d', 'done', 30), space('e', 'blocked', 20)];
  assert.deepEqual(ids(arrange(list)), ['a', 'b', 'c', 'd', 'e']);
});

test('a worktree space goes under its checkout, which keeps its place', () => {
  const main = { ...space('main'), g: { repo: 'r', linked: false } };
  const tree = { ...space('tree', 'working', 5), g: { repo: 'r', linked: true } };
  const out = arrange([space('x', 'done', 1), main, space('y'), tree]);
  assert.deepEqual(ids(out), ['x', 'main', 'tree', 'y']);
  assert.equal(out[2].tree, '└─');
});
