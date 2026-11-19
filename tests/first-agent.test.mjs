import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantLabels, assistantWords, deliver, firstAgents, FRESH_MS, isHome, noteStarts, sendFailure, sendRequest, SEND_MS, startsFresh, stillFresh } from '../mods/omarchy-tabs/first-agent.js';

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

test('an agent opened in a home folder stays a plain agent', () => {
  for (const home of ['/Users/me', '/Users/me/', '/home/me', '/root', 'C:\\Users\\me', 'C:/Users/me', '/c/Users/me']) assert.equal(isHome(home), true, home);
  for (const dir of ['/Users/me/work', '/home/me/repo', '/tmp', 'C:\\Users\\me\\work', '/c/Users/me/work', '', null]) assert.equal(isHome(dir), false, String(dir));
  const now = 1_000_000_000;
  const k = { state: 'live', turn: 0, status: { state: 'idle' }, status_ms: now, cwd: '/Users/me', foreground: { argv: ['claude'], cwd: '/Users/me/work' } };
  assert.equal(stillFresh(k, now), true);
  assert.equal(stillFresh({ ...k, foreground: { argv: ['claude'], cwd: '/Users/me' } }, now), false);
  assert.equal(stillFresh({ ...k, foreground: { argv: ['claude'] } }, now), false);
});

test("the template's header is not part of its words", () => {
  assert.equal(assistantWords('---\nname: assistant\ncommand: claude\n---\nYou are the coordinator.\n'), 'You are the coordinator.');
  assert.equal(assistantWords(null), '');
});

// A used terminal (turn 230) as the tab bar sees it over time.
const shell = (extra = {}) => ({ address: 't8', state: 'live', status: null, turn: 230, program: { key: 'shell' }, labels: { 'herdr.space': 'sp1' }, ...extra });
const claude = (extra = {}) => agent('t8', { turn: 230, ...extra });
const watch = (...looks) => { const starts = new Map(); for (const k of looks) noteStarts(starts, [k]); return starts; };
const adoptable = (k, starts) => firstAgents({ spaces: [space], terminals: [k], panes: [pane(k.address)], starts }).map((x) => x.address);

test('an agent started at the prompt of a used terminal is a candidate', () => {
  const starts = watch(shell(), claude({ status: null }), claude());
  assert.equal(starts.get('t8'), 230);
  assert.deepEqual(adoptable(claude(), starts), ['t8']);
  const now = 1_000_000_000;
  const k = { state: 'live', turn: 230, status: { state: 'idle' }, status_ms: now, foreground: { argv: ['claude.exe'] } };
  assert.equal(stillFresh(k, now, starts.get('t8')), true);
  assert.equal(stillFresh(k, now), false);
});

test('an agent in a used terminal stops being a candidate at its first turn', () => {
  const starts = watch(shell(), claude(), claude({ status: 'working' }), claude({ turn: 231 }));
  assert.deepEqual(adoptable(claude({ turn: 231 }), starts), []);
  const now = 1_000_000_000;
  assert.equal(stillFresh({ state: 'live', turn: 231, status: { state: 'idle' }, status_ms: now, foreground: { argv: ['claude'] } }, now, starts.get('t8')), false);
});

test('an agent not seen starting at a prompt is left alone', () => {
  assert.deepEqual(adoptable(claude(), watch(claude())), []);
  // its report went missing for a moment, with the agent still in front: not a new start
  assert.deepEqual(adoptable(claude(), watch(claude(), claude({ status: null }), claude())), []);
  // straight from one agent's report to another's, with no prompt seen between them
  assert.deepEqual(adoptable(claude(), watch(claude({ status: 'done' }), claude())), []);
});

test('the rules for a resumed agent and a home folder hold in a used terminal', () => {
  const now = 1_000_000_000, start = 230;
  const k = { state: 'live', turn: 230, status: { state: 'idle' }, status_ms: now, foreground: { argv: ['claude'], cwd: '/Users/me/work' } };
  assert.equal(stillFresh(k, now, start), true);
  assert.equal(stillFresh({ ...k, foreground: { argv: ['claude', '--resume', 'x'], cwd: '/Users/me/work' } }, now, start), false);
  assert.equal(stillFresh({ ...k, foreground: { argv: ['claude'], cwd: '/Users/me' } }, now, start), false);
  for (const extra of [{ parent: 't0' }, { labels: { 'herdr.task': 'repo#1' } }, { labels: { 'herdr.role': 'reviewer' } }]) {
    assert.deepEqual(adoptable(claude(extra), watch(shell(), claude(extra))), []);
  }
  const assistant = agent('t0', { labels: { 'herdr.role': 'coordinator', 'herdr.coordinator.space': 'sp1' } });
  const starts = watch(shell(), claude());
  assert.deepEqual(firstAgents({ spaces: [space], terminals: [assistant, claude()], panes: [pane('t8')], starts }).map((x) => x.address), []);
});

// herdr's exec and writeTextFile, recording what they were given.
function fakeHerdr(answer) {
  const files = new Map(), calls = [];
  return {
    files, calls,
    appHome: () => 'C:\\Users\\me\\.config\\herdr-app',
    writeTextFile: async (path, text, expected) => { assert.equal(expected, null); files.set(path, text); return null; },
    exec: async (command, args, options) => {
      calls.push({ command, args, options, sent: files.get(args.at(-1)) });
      if (args[1].includes('rm -f')) { files.delete(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; }
      return answer();
    },
  };
}

test('the first message goes through a file, whatever its length, and the file is removed', async () => {
  const io = fakeHerdr(() => ({ code: 0, stdout: '{"jsonrpc":"2.0","id":1,"result":{}}\n', stderr: '' }));
  const words = '가'.repeat(40000);
  await deliver(io, 'win-pc/t8', words);
  const [send, clean] = io.calls;
  assert.equal(send.command, 'sh');
  assert.ok(send.args.every((a) => a.length < 1000), 'nothing long on the command line');
  assert.equal(send.sent, sendRequest('win-pc/t8', words));
  assert.equal(JSON.parse(send.sent).params.text, words);
  assert.ok(send.sent.endsWith('\n'));
  assert.equal(send.options.timeout, SEND_MS);
  assert.ok(clean.args[1].includes('rm -f'));
  assert.equal(clean.args.at(-1), send.args.at(-1));
  assert.equal(io.files.size, 0);
});

test('a failed send says why and still removes the file', async () => {
  const refused = fakeHerdr(() => ({ code: 0, stdout: '{"jsonrpc":"2.0","id":1,"error":{"message":"no such terminal"}}\n', stderr: '' }));
  await assert.rejects(deliver(refused, 't8', 'hi'), /no such terminal/);
  assert.equal(refused.files.size, 0);
  const crashed = fakeHerdr(() => { throw new Error('timed out'); });
  await assert.rejects(deliver(crashed, 't8', 'hi'), /timed out/);
  assert.equal(crashed.files.size, 0);
});

test('a send only counts when hc answers with a result', () => {
  assert.equal(sendFailure({ code: 0, stdout: '{"result":{}}', stderr: '' }), null);
  assert.equal(sendFailure({ code: 1, stdout: '', stderr: 'boom\n' }), 'boom');
  assert.equal(sendFailure({ code: 3, stdout: '', stderr: '' }), 'hc connect exited with 3');
  assert.equal(sendFailure({ code: 0, stdout: '', stderr: '' }), 'hc connect exited with 0');
});
