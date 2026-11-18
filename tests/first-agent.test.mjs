import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantLabels, assistantWords, firstAgents, FRESH_MS, startsFresh, stillFresh } from '../mods/omarchy-tabs/first-agent.js';

const space = { id: 'sp1', machine: null, tabs: [{ id: 'tb1' }, { id: 'tb2' }] };
const agent = (address, extra = {}) => ({ address, state: 'live', status: 'idle', turn: 0, program: { key: 'claude' }, labels: { 'herdr.space': 'sp1' }, ...extra });
const pane = (terminal, tab = 'tb1') => ({ terminal, tab });
const found = (terminals, panes = terminals.map((k) => pane(k.address))) => firstAgents({ spaces: [space], terminals, panes }).map((x) => x.address);

test('the only agent in a space with no Assistant is adopted, Claude or Codex', () => {
  assert.deepEqual(found([agent('t1')]), ['t1']);
  assert.deepEqual(found([agent('t1', { program: { key: 'codex' } })]), ['t1']);
});

test('a space that has an Assistant keeps it', () => {
  const assistant = agent('t0', { labels: { 'herdr.role': 'coordinator', 'herdr.coordinator.space': 'sp1' } });
  assert.deepEqual(found([assistant, agent('t1')], [pane('t1')]), []);
  assert.deepEqual(found([agent('t0', { template: 'assistant' }), agent('t1')], [pane('t1')]), []);
});

test('an agent with a conversation, still starting, or not the first is left alone', () => {
  assert.deepEqual(found([agent('t1', { turn: 3 })]), []);
  assert.deepEqual(found([agent('t1', { status: 'blocked' })]), []);
  assert.deepEqual(found([agent('t1', { turn: 2 }), agent('t2')]), []);
  // the earlier agent is parked as a Chat: no pane, but it is still this space's
  assert.deepEqual(found([agent('t1', { turn: 2 }), agent('t2')], [pane('t2')]), []);
});

test('workers, sub-agents and other programs are not candidates', () => {
  assert.deepEqual(found([agent('t1', { parent: 't0' })]), []);
  assert.deepEqual(found([agent('t1', { labels: { 'herdr.task': 'repo#1' } })]), []);
  assert.deepEqual(found([agent('t1', { labels: { 'herdr.role': 'reviewer' } })]), []);
  assert.deepEqual(found([agent('t1', { program: { key: 'nvim' } })]), []);
});

test('a space on another machine only looks at that machine', () => {
  const remote = { id: 'box/sp2', machine: 'box', tabs: [{ id: 'box/tb9' }] };
  const k = agent('box/t1', { labels: { 'herdr.space': 'sp2' } });
  const out = firstAgents({ spaces: [remote], terminals: [agent('t7', { labels: { 'herdr.role': 'coordinator', 'herdr.coordinator.space': 'sp2' } }), k], panes: [pane('box/t1', 'box/tb9')] });
  assert.deepEqual(out.map((x) => x.address), ['box/t1']);
  assert.deepEqual(assistantLabels(remote, 'box/tb9'), ['herdr.role=coordinator', 'herdr.coordinator.space=sp2', 'herdr.coordinator.tab=tb9']);
});

test('a resumed or one-shot agent is not a new conversation', () => {
  assert.equal(startsFresh(['claude']), true);
  assert.equal(startsFresh(['claude', '--model', 'opus']), true);
  for (const flag of ['--resume', '-r', '--continue', '-c', '-p', '--print', '--resume=abc']) assert.equal(startsFresh(['claude', flag]), false, flag);
  assert.equal(startsFresh(['codex', '-c', 'model=x']), true);
  assert.equal(startsFresh(['node', '/usr/bin/codex', 'resume']), false);
  assert.equal(startsFresh(['codex', 'exec', 'hi']), false);
});

test('the record hc gives decides last', () => {
  const now = 1_000_000_000;
  const k = { state: 'live', turn: 0, status: { state: 'idle' }, status_ms: now - 1000, foreground: { argv: ['claude'] } };
  assert.equal(stillFresh(k, now), true);
  assert.equal(stillFresh({ ...k, status_ms: now - FRESH_MS - 1 }, now), false);
  assert.equal(stillFresh({ ...k, turn: 1 }, now), false);
  assert.equal(stillFresh({ ...k, status: { state: 'working' } }, now), false);
  assert.equal(stillFresh({ ...k, foreground: { argv: ['claude', '--resume', 'x'] } }, now), false);
});

test("the template's header is not part of its words", () => {
  assert.equal(assistantWords('---\nname: assistant\ncommand: claude\n---\nYou are the coordinator.\n'), 'You are the coordinator.');
  assert.equal(assistantWords(null), '');
});
