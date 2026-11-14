import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { H, DAY } from '../mods/omarchy-ai-usage/time.js';

// `system.platform` is what Herdr's os.platform() says ("linux" unless given); `system.security`
// answers each `security` call with an { code, stdout } (or throws, as exec does when it can't run).
// `host` adds or replaces what main.js gets (elements, props, theme) for render tests.
function usageHarness(files = {}, response = {}, status = 200, homeDir = '/home/test', system = {}, host = {}) {
  const state = new Map();
  const requests = [];
  const commands = [];
  const dependencies = {
    View: class {},
    createHash,
    platform: () => system.platform ?? 'linux',
    exec: async (command, args) => {
      commands.push([command, ...args]);
      if (command !== '/usr/bin/security' || !system.security) throw new Error(`${command}: not found`);
      return { stderr: '', ...system.security(args) };
    },
    home: () => homeDir,
    appHome: () => `${homeDir}/.config/herdr-app`,
    settings: () => ({}),
    props: () => ({}),
    readTextFile: async path => files[path] === undefined ? null : JSON.stringify(files[path]),
    shared: key => state.get(key),
    setShared: (key, value) => state.set(key, value),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      // A function answers per URL; a promise stands for a request still in flight.
      const body = typeof response === 'function' ? response(url) : response;
      if (typeof body?.then === 'function') return body;
      return { ok: status === 200, status, json: async () => body };
    },
  };
  const providerSource = readFileSync(new URL('../mods/omarchy-ai-usage/providers.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const providers = Function(...Object.keys(dependencies), 'H', 'DAY', `${providerSource}\nreturn { PROVIDERS, sourcesFor, alwaysSources, fetchUsage };`)(...Object.values(dependencies), H, DAY);
  Object.assign(dependencies, providers, host);
  const source = readFileSync(new URL('../mods/omarchy-ai-usage/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class', 'class');
  const { refreshOne, refreshAll, AiUsage } = Function(...Object.keys(dependencies), `${source}\nreturn { refreshOne, refreshAll, AiUsage };`)(...Object.values(dependencies));
  return { state, requests, commands, route: (value, directory = null) => providers.sourcesFor(value, async () => directory), always: providers.alwaysSources, refreshOne, refreshAll, AiUsage };
}

// Starts the bar the way Herdr does, with a cx that keeps the 60-second tick and counts redraws.
function mount(h) {
  const m = { notifications: 0, tasks: [], tick: null };
  const cx = {
    timer: { every(_ms, cb) { m.tick = () => cb(cx); } },
    spawn(fn) { const task = fn(cx); m.tasks.push(task); return task; },
    notify() { m.notifications++; },
  };
  new h.AiUsage().init({}, cx);
  return m;
}
// Lets pending fetches and file reads run.
const settle = async (until = () => false) => { for (let i = 0; i < 20 && !until(); i++) await new Promise(r => setImmediate(r)); };
const copilotLogin = { '/home/test/.config/github-copilot/hosts.json': { github: { oauth_token: 'synthetic-copilot-token' } } };
const copilotReply = { ok: true, status: 200, json: async () => ({ quota_reset_date_utc: '2026-12-01', quota_snapshots: {} }) };

const agent = key => ({ terminal: 't1', program: { key, name: key, icon: `${key}.svg`, tint: true } });
const claude = { id: 'claude.claude', provider: 'claude', agent: 'Claude', from: { claude: '/home/test/.claude' } };
const codex = { id: 'codex', provider: 'codex', agent: 'Codex', from: { codex: true } };
const copilot = { id: 'copilot', provider: 'copilot', agent: 'Copilot', from: { copilot: true } };
const claudeLogin = { '/home/test/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'claude-token' } } };

test('Claude normalizes session and model limits, ignoring unknown windows', async () => {
  const h = usageHarness(claudeLogin, { limits: [
    { kind: 'session', percent: 42.4, resets_at: '2026-11-05T01:00:00Z' },
    { kind: 'weekly_scoped', percent: 91.7, resets_at: '2026-11-08T01:00:00Z', scope: { model: { display_name: 'Sonnet' } } },
    { kind: 'unknown', percent: 12 },
  ] });
  await h.refreshOne(claude);
  assert.deepEqual(h.state.get('omarchy-ai-usage.claude.claude').windows, [
    { short: '5h', long: '5-hour limit', span: 5 * 3600e3, used: 42, resets_at: '2026-11-05T01:00:00Z' },
    { short: 'Sonnet', long: 'Weekly Sonnet limit', span: 7 * 24 * 3600e3, used: 92, resets_at: '2026-11-08T01:00:00Z', scoped: true },
  ]);
  assert.equal(h.requests[0].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer claude-token');
  assert.ok(!JSON.stringify([...h.state]).includes('claude-token'));
});

test('Claude reads its login under a Windows home', async () => {
  const h = usageHarness({ 'C:\\Users\\test/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'claude-token' } } },
    { limits: [{ kind: 'session', percent: 10, resets_at: 'later' }] }, 200, 'C:\\Users\\test');
  await h.refreshOne({ ...claude, from: { claude: 'C:\\Users\\test/.claude' } });
  assert.equal(h.requests[0]?.headers.Authorization, 'Bearer claude-token');
});

test('Claude also accepts legacy usage windows', async () => {
  const h = usageHarness(claudeLogin, { five_hour: { utilization: 12.6, resets_at: 'later' }, seven_day: { utilization: 60, resets_at: 'next week' } });
  await h.refreshOne(claude);
  assert.deepEqual(h.state.get('omarchy-ai-usage.claude.claude').windows.map(w => [w.short, w.used]), [['5h', 13], ['7d', 60]]);
});

test('Codex sends account ID and normalizes timestamps', async () => {
  const h = usageHarness({ '/home/test/.codex/auth.json': { tokens: { access_token: 'codex-token', account_id: 'account' } } }, {
    rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 34.5, reset_at: 1800000000 }, secondary_window: {} },
  });
  await h.refreshOne(codex);
  assert.deepEqual(h.state.get('omarchy-ai-usage.codex').windows, [
    { short: '5h', long: '5-hour limit', span: 18000e3, used: 35, resets_at: new Date(1800000000e3).toISOString() },
  ]);
  assert.equal(h.requests[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(h.requests[0].headers['ChatGPT-Account-Id'], 'account');
});

test('Copilot excludes unlimited and unknown quotas', async () => {
  const h = usageHarness({ '/home/test/.config/github-copilot/hosts.json': { github: { oauth_token: 'copilot-token' } } }, {
    quota_reset_date_utc: '2026-12-01', quota_snapshots: {
      premium_interactions: { percent_remaining: 70 }, chat: { unlimited: true, percent_remaining: 100 }, other: { percent_remaining: 0 },
    },
  });
  await h.refreshOne(copilot);
  assert.deepEqual(h.state.get('omarchy-ai-usage.copilot').windows, [
    { short: 'mo', long: 'Monthly premium requests', span: 30 * 24 * 3600e3, used: 30, resets_at: '2026-12-01', monthly: true },
  ]);
  assert.equal(h.requests[0].url, 'https://api.github.com/copilot_internal/user');
  assert.equal(h.requests[0].headers.Authorization, 'token copilot-token');
});

test('failed credentials preserve last fetched usage without making requests', async () => {
  const h = usageHarness({ '/home/test/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'expired-token', expiresAt: 1 } } });
  const previous = { fetched: '2026-11-01T00:00:00Z', windows: [{ used: 20 }] };
  h.state.set('omarchy-ai-usage.claude.claude', previous);
  await h.refreshOne(claude);
  const result = h.state.get('omarchy-ai-usage.claude.claude');
  assert.equal(result.fetched, previous.fetched);
  assert.deepEqual(result.windows, previous.windows);
  assert.match(result.error, /token expired/);
  assert.equal(h.requests.length, 0);
  await h.refreshOne(codex);
  assert.match(h.state.get('omarchy-ai-usage.codex').error, /no Codex ChatGPT login/);
});

test('Claude account routing keeps work and personal sources separate', async () => {
  const h = usageHarness({ '/home/test/.claude-personal/.credentials.json': { claudeAiOauth: { accessToken: 'personal-token' } } });
  assert.deepEqual((await h.route(agent('claude-code'))).map(s => [s.id, s.from.claude]), [
    ['claude.claude', '/home/test/.claude'], ['claude.personal', '/home/test/.claude-personal'],
  ]);
  // A profile folder with no login is left out.
  assert.deepEqual((await usageHarness().route(agent('claude-code'))).map(s => s.id), ['claude.claude']);
  const [personal] = await h.route(agent('claude-code'), '/home/test/.claude-personal');
  assert.equal(personal.id, 'claude.personal');
  assert.equal(personal.from.claude, '/home/test/.claude-personal');
});

const fileLogin = (accessToken, expiresAt) => ({ '/home/test/.claude/.credentials.json': { claudeAiOauth: { accessToken, expiresAt } } });
const keychain = (accessToken, expiresAt) => ({ code: 0, stdout: `${JSON.stringify({ claudeAiOauth: { accessToken, expiresAt } })}\n` });
const mac = security => ({ platform: 'macos', security });
const session = { limits: [{ kind: 'session', percent: 10, resets_at: 'later' }] };

test('on macOS Claude uses the Keychain login when it runs out after the file', async () => {
  const h = usageHarness(fileLogin('file-token', Date.now() - H), session, 200, '/home/test', mac(() => keychain('keychain-token', Date.now() + H)));
  await h.refreshOne(claude);
  assert.equal(h.requests[0]?.headers.Authorization, 'Bearer keychain-token');
  assert.equal(h.state.get('omarchy-ai-usage.claude.claude').error, null);
  // One read per refresh, of ~/.claude's own item.
  assert.deepEqual(h.commands, [['/usr/bin/security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']]);
  const saved = JSON.stringify([...h.state]);
  assert.ok(!saved.includes('keychain-token') && !saved.includes('file-token'));
});

test('on macOS Claude keeps the file login when it runs out after the Keychain one', async () => {
  const h = usageHarness(fileLogin('file-token', Date.now() + 2 * H), session, 200, '/home/test', mac(() => keychain('keychain-token', Date.now() + H)));
  await h.refreshOne(claude);
  assert.equal(h.requests[0]?.headers.Authorization, 'Bearer file-token');
});

test('a Keychain that fails, refuses or holds junk counts as no login, and the file stands in', async () => {
  const answers = [
    () => { throw new Error('exec timed out'); },
    () => ({ code: 44, stdout: '' }),
    () => ({ code: 128, stdout: '' }),
    () => ({ code: 0, stdout: 'not json synthetic-secret' }),
  ];
  for (const answer of answers) {
    const h = usageHarness(fileLogin('file-token', Date.now() + H), session, 200, '/home/test', mac(answer));
    await h.refreshOne(claude);
    assert.equal(h.requests[0]?.headers.Authorization, 'Bearer file-token');
  }
  // Neither has one: the usual missing-login error, with nothing of the Keychain's output in it.
  const h = usageHarness({}, session, 200, '/home/test', mac(() => ({ code: 0, stdout: '{"claudeAiOauth": synthetic-secret' })));
  await h.refreshOne(claude);
  assert.equal(h.state.get('omarchy-ai-usage.claude.claude').error, 'no Claude Code login in ~/.claude');
  assert.equal(h.requests.length, 0);
});

test('off macOS Claude reads only the file and never runs security', async () => {
  for (const platform of ['linux', 'windows']) {
    const h = usageHarness(fileLogin('file-token', Date.now() + H), session, 200, '/home/test', { platform, security: () => keychain('keychain-token', Date.now() + 2 * H) });
    await h.refreshOne(claude);
    assert.equal(h.requests[0]?.headers.Authorization, 'Bearer file-token');
    assert.equal((await h.always([{ key: 'claude', name: 'claude', icon: null, tint: false }])).length, 1);
    assert.deepEqual(h.commands, []);
  }
});

test('another Claude profile reads the Keychain item Claude Code names after its folder', async () => {
  const services = [];
  const h = usageHarness({}, session, 200, '/home/test', mac(args => { services.push(args[2]); return keychain('profile-token', Date.now() + H); }));
  await h.refreshOne({ ...claude, id: 'claude.personal', from: { claude: '/home/test/.claude-personal' } });
  // A folder name in decomposed Unicode hashes as its composed (NFC) form, as Claude Code does.
  await h.refreshOne({ ...claude, id: 'claude.e', from: { claude: '/home/test/.claude-é' } });
  assert.deepEqual(services, ['Claude Code-credentials-3c951c30', 'Claude Code-credentials-237ea4bf']);
  assert.equal(h.requests[0]?.headers.Authorization, 'Bearer profile-token');
});

test('on macOS a profile whose login is only in the Keychain is shown, found without reading its secret', async () => {
  const items = new Set(['Claude Code-credentials', 'Claude Code-credentials-3c951c30']);
  const h = usageHarness({}, {}, 200, '/home/test', mac(args => ({ code: items.has(args[2]) ? 0 : 44, stdout: '' })));
  const programs = [{ key: 'claude', name: 'claude', icon: null, tint: false }];
  assert.deepEqual((await h.always(programs)).map(s => s.id), ['claude.claude', 'claude.personal']);
  assert.ok(h.commands.length && h.commands.every(c => !c.includes('-w')), 'finding a login never asks for the secret');
  const asked = h.commands.length;
  assert.deepEqual((await h.route(agent('claude-code'))).map(s => s.id), ['claude.claude', 'claude.personal']);
  assert.equal(h.commands.length, asked, 'a tab switch soon after asks the Keychain nothing new');
  // No item for the profile: left out, as with no file.
  const none = usageHarness({}, {}, 200, '/home/test', mac(() => ({ code: 44, stdout: '' })));
  assert.deepEqual((await none.route(agent('claude-code'))).map(s => s.id), ['claude.claude']);
  assert.deepEqual(await none.always(programs), []);
});

test('Pi shares Codex login only when account IDs match', async () => {
  for (const accountId of ['same', 'different']) {
    const h = usageHarness({
      '/home/test/.pi/agent/settings.json': { defaultProvider: 'openai-codex' },
      '/home/test/.pi/agent/auth.json': { 'openai-codex': { type: 'oauth', accountId, access: 'pi-token' } },
      '/home/test/.codex/auth.json': { tokens: { account_id: 'same' } },
    });
    const [source] = await h.route(agent('pi'));
    assert.equal(source.id, accountId === 'same' ? 'codex' : 'pi.codex');
    assert.deepEqual(source.from, accountId === 'same' ? { codex: true } : { harness: 'pi', entry: 'openai-codex' });
  }
});

test('unsupported agents and API-key harnesses remain labelled without requests', async () => {
  const h = usageHarness({
    '/home/test/.config/opencode/opencode.json': { model: 'anthropic/sonnet' },
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'api', key: 'secret' } },
  });
  assert.equal((await h.route(agent('other')))[0].note, 'no usage API');
  assert.equal((await h.route(agent('opencode')))[0].note, 'anthropic: no usage API');
  assert.equal(h.requests.length, 0);
});

test('provider HTTP errors preserve previously fetched windows', async () => {
  const h = usageHarness(claudeLogin, {}, 401);
  const previous = { fetched: '2026-11-01T00:00:00Z', windows: [{ used: 20 }] };
  h.state.set('omarchy-ai-usage.claude.claude', previous);
  await h.refreshOne(claude);
  const result = h.state.get('omarchy-ai-usage.claude.claude');
  assert.equal(result.error, 'HTTP 401');
  assert.equal(result.fetched, previous.fetched);
  assert.deepEqual(result.windows, previous.windows);
});

test('OpenCode Claude OAuth uses access token for the usage endpoint', async () => {
  const h = usageHarness({
    '/home/test/.config/opencode/opencode.json': { model: 'anthropic/sonnet' },
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'oauth', refresh: 'refresh-token', access: 'access-token' } },
  });
  const [source] = await h.route(agent('opencode'));
  await h.refreshOne(source);
  assert.equal(source.id, 'opencode.claude');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer access-token');
  assert.ok(!JSON.stringify([...h.state]).includes('access-token'));
});

test('Pi Copilot OAuth uses refresh token for the usage endpoint', async () => {
  const h = usageHarness({
    '/home/test/.pi/agent/settings.json': { defaultProvider: 'github-copilot' },
    '/home/test/.pi/agent/auth.json': { 'github-copilot': { type: 'oauth', refresh: 'refresh-token', access: 'access-token' } },
  });
  const [source] = await h.route(agent('pi'));
  await h.refreshOne(source);
  assert.equal(source.id, 'pi.copilot');
  assert.equal(h.requests[0].headers.Authorization, 'token refresh-token');
});

test('a Claude profile is named after its organization, Personal, or its folder', async () => {
  const { route } = usageHarness({
    '/home/test/.claude.json': { oauthAccount: { organizationName: 'Flexspring' } },
    '/home/test/.claude-personal/.claude.json': { oauthAccount: { organizationName: "me@example.com's Organization" } },
  });
  assert.equal((await route(agent('claude'), '/home/test/.claude'))[0].label, 'Flexspring');
  assert.equal((await route(agent('claude'), '/home/test/.claude-personal'))[0].label, 'Personal');
  assert.equal((await route(agent('claude'), '/home/test/.claude-other'))[0].label, 'Other');
});

test('settings.json claude_labels names a Claude profile outright', async () => {
  const { route } = usageHarness({
    '/home/test/.claude.json': { oauthAccount: { organizationName: 'Flexspring' } },
    '/home/test/.config/herdr-app/settings.json': { claude_labels: { '~/.claude': 'Work' } },
  });
  assert.equal((await route(agent('claude'), '/home/test/.claude'))[0].label, 'Work');
  assert.equal((await route(agent('claude'), '/home/test/.claude-other'))[0].label, 'Other');
});

test('logged-in agents show whatever the tab holds, and agy reads its saved quota', async () => {
  const later = new Date(Date.now() + 3600e3).toISOString();
  const h = usageHarness({
    '/home/test/.codex/auth.json': { tokens: { access_token: 'codex-token', account_id: 'account' } },
    '/home/test/.gemini/antigravity-cli/quota-cache.json': { quota: {
      'gemini-5h': { remaining_fraction: 0.75, reset_time: later },
      'gemini-weekly': { remaining_fraction: 0.5, reset_time: '2020-01-01T00:00:00Z' },
    } },
  });
  const programs = ['claude', 'codex', 'antigravity', 'copilot'].map(key => ({ key, name: key, icon: null, tint: false }));
  const sources = await h.always(programs);
  // No Claude login file here, so Claude is left out.
  assert.deepEqual(sources.map(s => s.id), ['codex', 'antigravity']);
  await h.refreshOne(sources[1]);
  const windows = h.state.get('omarchy-ai-usage.antigravity').windows;
  assert.deepEqual(windows.map(w => [w.short, w.used]), [['5h', 25], ['7d', 0]]);
  assert.equal(h.requests.length, 0);
});

test('Claude puts its model-scoped weekly window before the plan-wide one', async () => {
  const h = usageHarness(claudeLogin, { limits: [
    { kind: 'weekly_all', percent: 41, resets_at: '2026-11-14T01:00:00Z' },
    { kind: 'weekly_scoped', percent: 30, resets_at: '2026-11-14T01:00:00Z', scope: { model: { display_name: 'Fable' } } },
  ] });
  await h.refreshOne(claude);
  assert.deepEqual(h.state.get('omarchy-ai-usage.claude.claude').windows.map(w => w.short), ['Fable', '7d']);
});

test('each 60-second tick redraws while a quota request is still pending', async () => {
  let resolveQuota, settled = false;
  const quota = new Promise(resolve => { resolveQuota = resolve; });
  const h = usageHarness(copilotLogin, quota);
  h.state.set('omarchy-ai-usage.shown', { list: [copilot], idle: false });
  const bar = mount(h);
  try {
    await settle(() => h.requests.length);
    assert.equal(h.requests.length, 1, 'the fetch on load waits on Copilot');
    bar.tasks[0].then(() => { settled = true; });
    bar.tick();
    assert.equal(bar.notifications, 1, 'the tick redraws before the quota fetch completes');
    bar.tick();
    assert.equal(bar.notifications, 2, 'a later tick redraws even though the first fetch is still pending');
    await settle();
    assert.equal(settled, false);
  } finally {
    resolveQuota(copilotReply);
    await Promise.all(bar.tasks);
  }
});

test('periodic ticks keep refreshing and redrawing while a forced Copilot fetch hangs', async () => {
  const originalNow = Date.now, start = Date.now();
  let now = start, codexUsed = 25, resolveCopilot;
  Date.now = () => now;
  const copilotPending = new Promise(resolve => { resolveCopilot = resolve; });
  const h = usageHarness({ ...copilotLogin, '/home/test/.codex/auth.json': { tokens: { access_token: 'codex-token', account_id: 'account' } } },
    url => url.includes('github') ? copilotPending
      : { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: codexUsed, reset_at: 1800000000 } } });
  h.state.set('omarchy-ai-usage.shown', { list: [codex, copilot], idle: false });
  const copilotRequests = () => h.requests.filter(r => r.url.includes('github')).length;
  const codexShown = () => h.state.get('omarchy-ai-usage.codex')?.windows?.[0]?.used;
  const bar = mount(h);
  let forced;
  try {
    await settle(() => codexShown() === 25);
    assert.equal(copilotRequests(), 1, 'the fetch on load waits on Copilot');

    // The popup's Refresh forces every source again.
    codexUsed = 50;
    forced = h.refreshAll(true);
    await settle(() => codexShown() === 50);
    assert.equal(codexShown(), 50);
    assert.equal(copilotRequests(), 1, 'Refresh does not send a second Copilot request while one is pending');

    now = start + 13 * 60_000;
    codexUsed = 72;
    bar.tick();
    assert.equal(bar.notifications, 1, 'the timer notifies before periodic work');
    await settle(() => codexShown() === 72);
    assert.equal(codexShown(), 72, 'the tick refreshes Codex while Copilot is still pending');
    assert.equal(copilotRequests(), 1, 'the pending Copilot request is deduplicated');

    now += 60_000;
    bar.tick();
    assert.equal(bar.notifications, 2, 'later ticks still notify while forced Copilot work is pending');
    await settle();
    assert.equal(copilotRequests(), 1);

    // Once Copilot answers, its next refresh goes out again.
    resolveCopilot(copilotReply);
    await Promise.all([...bar.tasks, forced]);
    assert.ok(h.state.get('omarchy-ai-usage.copilot').fetched);
    await h.refreshAll(true);
    assert.equal(copilotRequests(), 2);
  } finally {
    resolveCopilot(copilotReply);
    await Promise.all([...bar.tasks, forced]);
    Date.now = originalNow;
  }
});

// Elements that remember their id, children, handlers and tooltip.
const NODE = Symbol('node');
function el() {
  const node = { id: null, kids: [], on: {}, tip: null };
  const self = new Proxy(node, {
    get(_t, prop) {
      if (prop === NODE) return node;
      return (...args) => {
        if (prop === 'id') node.id = args[0];
        else if (prop === 'child') node.kids.push(args[0]);
        else if (prop === 'children') node.kids.push(...args[0]);
        else if (prop === 'when') return args[0] ? args[1](self) : self;
        else if (prop === 'tooltip') node.tip = args[0];
        else if (prop === 'on_click' || prop === 'on_mouse_down') node.on[prop] = args.at(-1);
        return self;
      };
    },
  });
  return self;
}
const walk = (e, out = []) => {
  const n = e?.[NODE];
  if (!n) return out;
  out.push(n);
  for (const k of n.kids) walk(k, out);
  return out;
};

test('in the top bar only the meters open the popup, so the rest of the block drags the window', () => {
  const overlays = [];
  let stopped = 0;
  const h = usageHarness({}, {}, 200, '/home/test', {}, {
    div: el, h_flex: el, v_flex: el, image: el, svg: el,
    props: () => ({ compact: true }), theme: () => new Proxy({}, { get: () => '#888888' }),
    focused: () => null, settings: () => ({ zoom: 1 }), openOverlay: o => overlays.push(o),
  });
  h.state.set('omarchy-ai-usage.shown', { list: [{ id: 'codex.codex', provider: 'codex', label: 'Codex', icon: 'codex.svg' }], idle: false });
  const cx = { timer: { every() {} }, spawn() {}, notify() {}, stop_propagation() { stopped++; } };
  const view = new h.AiUsage();
  view.init({}, cx);
  const nodes = walk(view.render(cx));
  const root = nodes.find(n => n.id === 'root'), usage = nodes.find(n => n.id === 'usage');
  assert.deepEqual(Object.keys(root.on), [], 'the block itself takes no presses');
  assert.deepEqual(Object.keys(usage.on).sort(), ['on_click', 'on_mouse_down']);
  assert.ok(nodes.every(n => n.tip === null), 'the bar has no tooltip');

  usage.on.on_mouse_down({ bounds: { x: 900, y: 0, width: 260, height: 30 } }, cx);
  usage.on.on_click({}, cx);
  assert.equal(stopped, 1, 'a press on the meters does not reach the window drag');
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].props.below, true);
});
