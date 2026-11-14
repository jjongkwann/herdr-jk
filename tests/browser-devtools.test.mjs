import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isLocalUrl, activeTab, errorsFrom } from "../mods/omarchy-browser/page.mjs";
import { inspectorUrl, viewport, browserRoot } from "../mods/omarchy-browser/devtools.mjs";
import * as viewer from "../mods/omarchy-pane/viewer.js";

const { isViewer, isDevtools, kindOf, devtoolsArgv, devtoolsKeyPane, onScreen, errorLabel, pageShown, errorsPopup, saveFolder, reloads, Burst } = viewer;

// ---- page.mjs ----

test("local pages are this computer's: localhost, 127.0.0.1, *.localhost and files", () => {
  for (const url of ["http://localhost:5173/", "https://localhost/a", "http://127.0.0.1:8080/x?y", "http://app.localhost:3000/",
    "http://[::1]:4000/", "http://0.0.0.0:3000/", "file:///Users/me/site/index.html", "http://LOCALHOST:1/"]) assert.ok(isLocalUrl(url), url);
  for (const url of ["https://example.com/", "http://localhost.example.com/", "http://127.0.0.2.nip.io/", "about:blank", "chrome://newtab/",
    "data:text/html,hi", "", "not a url"]) assert.ok(!isLocalUrl(url), url);
});

test("the page is agent-browser's active tab, else its first", () => {
  assert.equal(activeTab([{ targetId: "a" }, { targetId: "b", active: true }]).targetId, "b");
  assert.equal(activeTab([{ targetId: "a" }, { targetId: "b" }]).targetId, "a");
  assert.equal(activeTab([]), null);
  assert.equal(activeTab(undefined), null);
});

const frame = (url, lineNumber) => ({ callFrames: [{ url, lineNumber }] });

test("errors count console.error, failed asserts, uncaught exceptions and Chrome's error entries", () => {
  const events = [
    { method: "Runtime.consoleAPICalled", params: { type: "log", args: [{ type: "string", value: "fine" }] } },
    { method: "Runtime.consoleAPICalled", params: { type: "warning", args: [{ type: "string", value: "careful" }] } },
    { method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ type: "string", value: "bad" }, { type: "number", value: 3 }, { type: "object", description: "Object" }], stackTrace: frame("http://localhost:5173/src/app.js?t=1", 9) } },
    { method: "Runtime.consoleAPICalled", params: { type: "assert", args: [], stackTrace: frame("http://localhost:5173/", 0) } },
    { method: "Runtime.exceptionThrown", params: { exceptionDetails: { exceptionId: 1, text: "Uncaught", exception: { description: "TypeError: x is undefined\n    at f (app.js:2:3)" }, stackTrace: frame("http://localhost:5173/app.js", 1) } } },
    { method: "Runtime.exceptionThrown", params: { exceptionDetails: { exceptionId: 2, text: "Uncaught (in promise)", exception: { description: "Error: later handled" } } } },
    { method: "Runtime.exceptionRevoked", params: { exceptionId: 2, reason: "Handler added to rejected promise" } },
    { method: "Log.entryAdded", params: { entry: { level: "error", source: "network", text: "Failed to load resource: 404", url: "http://localhost:5173/logo.png" } } },
    { method: "Log.entryAdded", params: { entry: { level: "warning", source: "other", text: "deprecated" } } },
  ];
  assert.deepEqual(errorsFrom(events), [
    "bad 3 Object (app.js:10)",
    "Assertion failed (localhost:5173:1)",
    "Uncaught TypeError: x is undefined (app.js:2)",
    "Failed to load resource: 404 http://localhost:5173/logo.png",
  ]);
  assert.deepEqual(errorsFrom([]), []);
});

// ---- devtools.mjs ----

test("DevTools opens the frontend the page browser serves, for the page's target, on the Console", () => {
  assert.equal(inspectorUrl("ws://127.0.0.1:51397/devtools/browser/abc", "T1"),
    "http://127.0.0.1:51397/devtools/inspector.html?ws=127.0.0.1:51397/devtools/page/T1&panel=console");
  assert.equal(inspectorUrl("", "T1"), null);
  assert.equal(inspectorUrl("ws://127.0.0.1:1/devtools/browser/x", undefined), null);
});

test("the DevTools page is the pane's picture area in screen points", () => {
  // Retina cells (16x34 device px for a 14 pt font): 143 x 40 cells is 1144 x 663 points.
  assert.deepEqual(viewport(143, 40, { w: 16, h: 34 }, 14), { width: 1144, height: 663 });
  // Cells in points (8x17) on a plain screen.
  assert.deepEqual(viewport(143, 40, { w: 8, h: 17 }, 14), { width: 1144, height: 663 });
  // Herdr zoomed in (bigger cells) still reads as Retina.
  assert.deepEqual(viewport(100, 30, { w: 19, h: 41 }, 14), { width: 950, height: 594 });
  // No answer to the cell-size question: the viewer's own guess, and never smaller than a usable page.
  assert.deepEqual(viewport(100, 30, null, 14), { width: 900, height: 522 });
  assert.deepEqual(viewport(10, 3, { w: 16, h: 34 }, 14), { width: 320, height: 200 });
});

// ---- viewer.js ----

// A home whose Shepherdr data has (moved) or hasn't moved to Shepherdr's own folders (its LAYOUT file says 2).
function shepHome(moved) {
  const home = mkdtempSync(join(tmpdir(), "omarchy-browser-"));
  if (moved) {
    mkdirSync(join(home, ".local/share/shepherdr"), { recursive: true });
    writeFileSync(join(home, ".local/share/shepherdr/LAYOUT"), "2\n");
  }
  return home;
}

test("the browser folder is Shepherdr's state folder once its data moved, else ~/.herdr/browser", () => {
  const old = shepHome(false);
  assert.equal(browserRoot(old, {}), join(old, ".herdr/browser"));
  const home = shepHome(true);
  assert.equal(browserRoot(home, {}), `${home}/.local/state/shepherdr/browser`);
  assert.equal(browserRoot(home, { XDG_DATA_HOME: `${home}/.local/share`, XDG_STATE_HOME: "/x/state" }), "/x/state/shepherdr/browser");
  assert.equal(browserRoot(home, { SHEPHERDR_HOME: "/nowhere" }), join(home, ".herdr/browser"));
  // Rolled back: the old place again.
  mkdirSync(join(home, ".herdr"), { recursive: true });
  writeFileSync(join(home, ".herdr/.layout-rollback"), "");
  assert.equal(browserRoot(home, {}), join(home, ".herdr/browser"));
});

test("view.sh keeps the viewer's heartbeat in the browser folder the viewer reads", () => {
  for (const moved of [false, true]) {
    const home = shepHome(moved);
    // The viewer, agent-browser and node are stand-ins: node exits at once, as a viewer that quit.
    mkdirSync(join(home, "app/bin"), { recursive: true });
    writeFileSync(join(home, "app/bin/herdr-browser-view"), "");
    mkdirSync(join(home, "bin"));
    for (const name of ["agent-browser", "node"]) {
      writeFileSync(join(home, "bin", name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(home, "bin", name), 0o755);
    }
    const r = spawnSync("sh", ["mods/omarchy-browser/view.sh"], { env: { HOME: home, PATH: `${home}/bin:/usr/bin:/bin`, HERDR_APP_HOME: join(home, "app") } });
    assert.equal(r.status, 0, String(r.stderr));
    assert.ok(existsSync(join(browserRoot(home, {}), "omarchy.view")), moved ? "moved" : "not moved");
    assert.equal(existsSync(join(home, ".herdr/browser")), !moved);
  }
});

test("the viewer pane is view.sh, or herdr-browser-view on @omarchy only", () => {
  assert.ok(isViewer({ argv: ["sh", "/Users/me/.config/herdr-app/mods/omarchy-browser/view.sh", "t5"] }));
  assert.ok(isViewer({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["node", "/Users/me/.config/herdr-app/bin/herdr-browser-view", "--task", "@omarchy"] } }));
  assert.ok(!isViewer({ foreground: { argv: ["node", "/x/bin/herdr-browser-view", "--task", "@omarchy-devtools"] } }));
  assert.ok(!isViewer({ foreground: { argv: ["node", "/x/bin/herdr-browser-view", "--task", "repo#4"] } }));
  assert.ok(!isViewer({ argv: ["sh", "/tmp/view.sh"] }));
  assert.ok(!isViewer({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["nvim", "mods/omarchy-browser/view.sh.bak"] } }));
  assert.ok(!isViewer(null));
});

test("the DevTools pane is devtools.mjs, or the viewer on @omarchy-devtools", () => {
  const argv = devtoolsArgv("/Users/me/.config/herdr-app", 14, true);
  assert.deepEqual(argv.slice(3), ["/Users/me/.config/herdr-app/mods/omarchy-browser/devtools.mjs", "14", "dark"]);
  assert.equal(devtoolsArgv("/a", undefined, false).at(-2), "14");
  assert.equal(devtoolsArgv("/a", 13, false).at(-1), "light");
  assert.ok(isDevtools({ argv }));
  assert.ok(isDevtools({ foreground: { argv: ["node", "/x/bin/herdr-browser-view", "--task", "@omarchy-devtools"] } }));
  assert.ok(!isDevtools({ argv: ["sh", "/x/mods/omarchy-browser/view.sh", ""] }));
  assert.equal(kindOf({ argv }), "devtools");
  assert.equal(kindOf({ argv: ["sh", "/x/mods/omarchy-browser/view.sh", ""] }), "viewer");
  assert.equal(kindOf({ argv: ["/bin/zsh", "-l"] }), null);
});

test("the DevTools key goes to the focused Browser or DevTools pane, else the Browser pane on screen", () => {
  const spaces = [{ id: "s1", active: true, tabs: [{ id: "a", active: true }, { id: "b", active: false }] }];
  const kinds = { v1: "viewer", v2: "viewer", d1: "devtools" };
  const kind = (p) => kinds[p.pane] ?? null;
  const panes = (focused) => [
    { pane: "v2", tab: "b" }, { pane: "sh", tab: "a" }, { pane: "v1", tab: "a" }, { pane: "d1", tab: "a" },
  ].map((p) => ({ ...p, focused: p.pane === focused }));
  assert.equal(devtoolsKeyPane(panes("sh"), spaces, kind), "v1", "the Browser pane on screen, not the one in a background tab");
  assert.equal(devtoolsKeyPane(panes("d1"), spaces, kind), "d1");
  assert.equal(devtoolsKeyPane(panes("v2"), spaces, kind), "v2");
  assert.equal(devtoolsKeyPane([{ pane: "sh", tab: "a", focused: true }], spaces, kind), null);
});

test("a pane is on screen when its space and tab show and nothing else in its tab is zoomed", () => {
  const spaces = [
    { id: "s1", active: true, tabs: [{ id: "a", active: true }, { id: "b", active: false }] },
    { id: "s2", active: false, tabs: [{ id: "c", active: true }] },
  ];
  const panes = [{ pane: "p1", tab: "a" }, { pane: "p2", tab: "a" }, { pane: "p3", tab: "b" }, { pane: "p4", tab: "c" }];
  assert.ok(onScreen(panes[0], spaces, panes));
  assert.ok(!onScreen(panes[2], spaces, panes), "a tab in the background");
  assert.ok(!onScreen(panes[3], spaces, panes), "a space in the background");
  const zoomed = [{ ...panes[0] }, { ...panes[1], zoomed: true }];
  assert.ok(!onScreen(zoomed[0], spaces, zoomed), "behind a zoomed pane");
  assert.ok(onScreen(zoomed[1], spaces, zoomed), "the zoomed pane itself");
  assert.ok(!onScreen(undefined, spaces, panes));
});

test("the header shows the page without its scheme and the popup lists the latest errors", () => {
  assert.equal(pageShown("http://localhost:5173/"), "localhost:5173");
  assert.equal(pageShown("https://example.com/a/b"), "example.com/a/b");
  assert.equal(pageShown("file:///Users/me/my%20site/index.html"), "/Users/me/my site/index.html");
  assert.equal(pageShown("about:blank"), "");
  assert.equal(errorLabel(1), "1 error");
  assert.equal(errorLabel(7), "7 errors");
  assert.deepEqual(errorsPopup({ url: "http://localhost:3000/", count: 0, errors: [] }),
    { title: "No errors on localhost:3000", note: "Nothing went wrong since the page loaded.", lines: [] });
  const p = errorsPopup({ url: "http://localhost:3000/", count: 7, errors: ["a", "b", "x".repeat(500)] });
  assert.equal(p.title, "7 errors on localhost:3000");
  assert.equal(p.note, "The latest 3; 4 more before them.");
  assert.equal(p.lines[2].length, 400);
});

test("saves reload from the space's own folder on this computer, never from home", () => {
  assert.equal(saveFolder({ folder: "/Users/me/site/" }, "/Users/me"), "/Users/me/site");
  assert.equal(saveFolder({ folder: "/Users/me" }, "/Users/me"), null);
  assert.equal(saveFolder({ folder: "" }, "/Users/me"), null);
  assert.equal(saveFolder({ folder: "/home/u/site", machine: "mini" }, "/Users/me"), null);
  assert.equal(saveFolder(undefined, "/Users/me"), null);
});

test("only page files outside dependencies, Git and dev-server caches reload", () => {
  const dir = "/Users/me/site";
  for (const f of ["index.html", "a.htm", "src/app.css", "src/main.js", "src/x.mjs", "src/App.tsx", "src/a.ts", "src/b.jsx", "data/x.json",
    "img/logo.svg", "img/a.PNG", "img/b.jpeg", "c.webp", "favicon.ico", "README.md", "dist/bundle.js", "build/index.html"]) assert.ok(reloads(`${dir}/${f}`, dir), f);
  for (const f of ["node_modules/react/index.js", ".git/index", ".git/HEAD", ".next/server/app.js", ".svelte-kit/x.js", "a/.cache/b.json",
    "server.log", "src/.main.js.swp", "src/main.js~", "notes.txt", "Cargo.lock", "coverage/lcov.json"]) assert.ok(!reloads(`${dir}/${f}`, dir), f);
  assert.ok(reloads(dir, dir), "the folder itself: many things changed");
  assert.ok(!reloads("/Users/me/site-old/index.html", dir), "a sibling folder");
  assert.ok(reloads("C:\\work\\site\\index.html", "C:\\work\\site"));
});

test("a burst of saves reloads once, 300 ms after the last", () => {
  const b = new Burst(300);
  assert.equal(b.hit(1000), true, "the first save starts a timer");
  assert.equal(b.hit(1100), false);
  assert.equal(b.hit(1250), false);
  assert.equal(b.left(1300), 250, "the timer comes back for the rest");
  assert.equal(b.left(1550), 0, "time to reload");
  assert.equal(b.hit(2000), true, "the next save starts a new timer");
});

// ---- the header, against a fake Herdr ----

const NODE = Symbol("node");
function el() {
  const node = { id: null, kids: [], on: {}, tip: null };
  const self = new Proxy(node, {
    get(_t, prop) {
      if (prop === NODE) return node;
      return (...args) => {
        if (prop === "id") node.id = args[0];
        else if (prop === "child") node.kids.push(args[0]);
        else if (prop === "children") node.kids.push(...args[0]);
        else if (prop === "when") return args[0] ? args[1](self) : self;
        else if (prop === "tooltip") node.tip = args[0];
        else if (prop === "on_click" || prop === "on_hover") node.on[prop] = args[0];
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
const byId = (tree, id) => walk(tree).find((n) => n.id === id);
const texts = (tree) => walk(tree).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const never = () => new Promise(() => {});

function header({ panes, spaces, terminals, props, answers = [], born = 0 }) {
  const execs = [], overlays = [], timers = [], spawned = [], watches = [], runs = [], commands = [];
  const cx = {
    notify() {}, stop_propagation() {}, sleep: never,
    spawn: (fn) => spawned.push(fn(cx)),
    timer: { every: (ms, fn) => timers.push({ ms, fn, every: true }), after: (ms, fn) => timers.push({ ms, fn }) },
  };
  const host = {
    View: class {}, div: el, svg: el, image: el, h_flex: el, v_flex: el,
    InputState: { new: () => ({ on() {}, set_value() {}, value: () => "", focus() {}, set_selected_range() {} }) }, Input: { new: el },
    panes: () => panes, spaces: () => spaces, terminals: () => terminals, machines: () => [], props: () => props,
    run: (name, args) => runs.push([name, args]), settings: () => ({ font_size: 14, dark: true }), theme: () => new Proxy({}, { get: () => "#888888" }), home: () => "/Users/me", appHome: () => "/Users/me/.config/herdr-app",
    exec: async (cmd, args) => { execs.push([cmd, ...args]); return { code: 0, stdout: JSON.stringify(answers.shift() ?? { open: false }), stderr: "" }; },
    hc: async () => ({ code: 0, stdout: "" }), notify() {}, nextCommand: () => new Promise((resolve) => commands.push(resolve)), readTextFile: async () => null, layout: () => ({}),
    shared: () => undefined, setShared() {}, window: () => ({ platform: "macos" }), openOverlay: (spec) => { overlays.push(spec); return "o1"; },
    watchFolder: (dir) => new Promise((resolve) => watches.push({ dir, resolve })),
    act: async () => false, readLive: async () => null, watchLive() {}, touches: () => false, assistantStep: () => ({ do: "none", memo: {} }), slotOf: () => null,
    ...viewer,
  };
  const body = readFileSync("mods/omarchy-pane/main.js", "utf8").replace(/^import [\s\S]*?;\n/gm, "").replace("export default class", "return class");
  const Pane = Function(...Object.keys(host), body)(...Object.values(host));
  const view = new Pane();
  const realNow = Date.now;
  Date.now = () => realNow() - born;
  try { view.init(props, cx); } finally { Date.now = realNow; }
  // Lets started tasks run to their next wait (the command loop waits forever; it isn't awaited).
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  // Runs the timers due now (after(0)) and the repeating ones, as Herdr would.
  const tick = async () => { for (const t of timers.splice(0).filter((t) => t.every || t.ms === 0)) { t.fn(cx); if (t.every) timers.push(t); } await settle(); };
  // Runs the one-shot timers set for `ms`.
  const fire = async (ms) => { for (const t of timers.filter((t) => !t.every && t.ms === ms)) { timers.splice(timers.indexOf(t), 1); t.fn(cx); } await settle(); };
  // A save under the watched folder.
  const save = async (...paths) => { const w = watches.shift(); assert.ok(w, "a folder is watched"); w.resolve(paths); await settle(); };
  // A key command for this mod, as every header copy gets it.
  const command = async (c) => { await settle(); commands.shift()?.(c); await settle(); };
  return { view, cx, execs, overlays, timers, watches, runs, render: () => view.render(cx), tick, settle, fire, save, command };
}

const VIEW = { address: "t9", argv: ["sh", "/Users/me/.config/herdr-app/mods/omarchy-browser/view.sh", ""] };
const world = (active = true) => ({
  panes: [{ pane: "p1", terminal: "t1", tab: "a", cwd: "/Users/me/site", program: { name: "zsh" } }, { pane: "p2", terminal: "t9", tab: "a", cwd: "/Users/me/site", program: { name: "node" } }],
  spaces: [{ id: "s1", active, folder: "/Users/me/site", tabs: [{ id: "a", active: true }] }],
  terminals: [{ address: "t1", argv: ["/bin/zsh", "-l"] }, VIEW],
});
const errorsPage = { open: true, url: "http://localhost:5173/", local: true, count: 2, errors: ["Uncaught Error: boom (app.js:3)", "bad (app.js:9)"] };

test("the viewer pane's header looks at the page while on screen and shows its error count", async () => {
  const h = header({ ...world(), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage] });
  let tree = h.render();
  assert.ok(texts(tree).includes("Browser"));
  assert.equal(byId(tree, "ph-errors-p2"), undefined, "nothing before the first look");
  await h.tick();
  assert.equal(h.execs.length, 1);
  assert.deepEqual(h.execs[0].slice(-2), ["/Users/me/.config/herdr-app/mods/omarchy-browser/page.mjs", "errors"]);
  tree = h.render();
  assert.ok(texts(tree).includes("localhost:5173"));
  const badge = byId(tree, "ph-errors-p2");
  assert.ok(texts({ [NODE]: badge }).includes("2 errors"));
  badge.on.on_click({}, h.cx);
  assert.equal(h.overlays.length, 1);
  assert.equal(h.overlays[0].mod, "omarchy-pane");
  assert.equal(h.overlays[0].kind, "popup");
  assert.deepEqual(h.overlays[0].props, { popup: "errors", page: errorsPage });
});

test("the error popup lists the errors it was given", () => {
  const h = header({ ...world(), props: { popup: "errors", page: errorsPage, overlay: "o1" } });
  const tree = h.render();
  assert.ok(texts(tree).includes("2 errors on localhost:5173"));
  assert.ok(texts(tree).includes("bad (app.js:9)"));
  assert.equal(h.timers.length, 0, "the popup polls nothing");
});

test("a viewer pane off screen, or any other pane, never asks the browser", async () => {
  const hidden = header({ ...world(false), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage] });
  hidden.render();
  await hidden.tick();
  assert.equal(hidden.execs.length, 0);
  const shell = header({ ...world(), props: { pane: "p1", terminal: "t1" }, answers: [errorsPage] });
  shell.render();
  await shell.tick();
  assert.equal(shell.execs.length, 0);
  assert.equal(byId(shell.render(), "ph-errors-p1"), undefined);
});

test("a closed browser hides the count", async () => {
  const h = header({ ...world(), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage, { open: false }] });
  h.render();
  await h.tick();
  assert.ok(byId(h.render(), "ph-errors-p2"));
  await h.tick();
  assert.equal(byId(h.render(), "ph-errors-p2"), undefined);
});

test("saving a page file reloads the page once after a burst; the switch turns it off", async (t) => {
  let now = 10000;
  t.mock.method(Date, "now", () => now);
  const reloaded = { open: true, url: "http://localhost:5173/", local: true, reloaded: true };
  const h = header({ ...world(), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage, reloaded, { ...errorsPage, count: 0, errors: [] }] });
  h.render();
  await h.tick();
  assert.equal(h.watches[0].dir, "/Users/me/site");
  const sw = byId(h.render(), "ph-onsave-p2");
  assert.ok(texts({ [NODE]: sw }).includes("On save"));
  await h.save("/Users/me/site/node_modules/x/index.js", "/Users/me/site/server.log");
  assert.equal(h.timers.filter((x) => x.ms === 300).length, 0, "nothing to reload");
  await h.save("/Users/me/site/src/app.css");
  now += 200;
  await h.save("/Users/me/site/src/app.css", "/Users/me/site/src/main.js");
  now += 100;
  await h.fire(300);
  assert.equal(h.execs.length, 1, "not yet: 200 ms since the last save");
  now += 200;
  await h.fire(200);
  assert.deepEqual(h.execs.map((e) => e.at(-1)), ["errors", "reload"]);
  await h.fire(500);
  assert.deepEqual(h.execs.map((e) => e.at(-1)), ["errors", "reload", "errors"], "the errors start over with the new load");
  assert.ok(texts(h.render()).includes("No errors"));

  byId(h.render(), "ph-onsave-p2").on.on_click({}, h.cx);
  assert.ok(texts({ [NODE]: byId(h.render(), "ph-onsave-p2") }).includes("Off"));
  await h.save("/Users/me/site/index.html");
  await h.fire(300);
  assert.equal(h.execs.filter((e) => e.at(-1) === "reload").length, 1, "off: saves don't reload");
  assert.equal(h.watches.length, 0, "and the folder isn't watched any more");
});

test("a remote page shows no reload switch", async () => {
  const h = header({ ...world(), props: { pane: "p2", terminal: "t9" }, answers: [{ open: true, url: "https://example.com/", local: false, count: 0, errors: [] }] });
  h.render();
  await h.tick();
  const tree = h.render();
  assert.ok(byId(tree, "ph-errors-p2"));
  assert.equal(byId(tree, "ph-onsave-p2"), undefined);
});

const DEVTOOLS = { address: "t7", argv: devtoolsArgv("/Users/me/.config/herdr-app", 14, true) };
const withDevtools = () => {
  const w = world();
  return { ...w, panes: [...w.panes, { pane: "p3", terminal: "t7", tab: "a", cwd: "/Users/me", program: { name: "node" } }], terminals: [...w.terminals, DEVTOOLS] };
};

test("the Browser pane's DevTools button opens DevTools below it, or closes the one open", async () => {
  const h = header({ ...world(), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage] });
  h.render();
  await h.tick();
  byId(h.render(), "ph-devtools-p2").on.on_click({}, h.cx);
  assert.deepEqual(h.runs, [["pane.split", { direction: "down", pane: "p2", argv: devtoolsArgv("/Users/me/.config/herdr-app", 14, true) }]]);

  const open = header({ ...withDevtools(), props: { pane: "p2", terminal: "t9" }, answers: [errorsPage] });
  open.render();
  await open.tick();
  byId(open.render(), "ph-devtools-p2").on.on_click({}, open.cx);
  assert.deepEqual(open.runs, [["pane.close", { pane: "p3" }]]);
});

test("super-ctrl-i: the Browser pane's header opens DevTools, the DevTools pane's closes it, others do nothing", async () => {
  const browserPane = header({ ...world(), props: { pane: "p2", terminal: "t9" }, born: 5000 });
  const shell = header({ ...world(), props: { pane: "p1", terminal: "t1" }, born: 5000 });
  await browserPane.command("devtools");
  await shell.command("devtools");
  assert.deepEqual(browserPane.runs.map((r) => r[0]), ["pane.split"]);
  assert.deepEqual(shell.runs, []);

  const w = withDevtools();
  w.panes = w.panes.map((p) => ({ ...p, focused: p.pane === "p3" }));
  const dt = header({ ...w, props: { pane: "p3", terminal: "t7" }, born: 5000 });
  assert.ok(texts(dt.render()).includes("DevTools"));
  await dt.command("devtools");
  assert.deepEqual(dt.runs, [["pane.close", { pane: "p3" }]]);
});

test("a header just opened ignores the DevTools key that opened its pane", async () => {
  const w = withDevtools();
  w.panes = w.panes.map((p) => ({ ...p, focused: p.pane === "p3" }));
  const dt = header({ ...w, props: { pane: "p3", terminal: "t7" } });
  await dt.command("devtools");
  assert.deepEqual(dt.runs, []);
});
