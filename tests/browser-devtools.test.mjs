import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLocalUrl, activeTab, errorsFrom } from "../mods/omarchy-browser/page.mjs";
import * as viewer from "../mods/omarchy-pane/viewer.js";

const { isViewer, onScreen, errorLabel, pageShown, errorsPopup, saveFolder, reloads, Burst } = viewer;

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

// ---- viewer.js ----

test("the viewer pane is view.sh, or herdr-browser-view on @omarchy only", () => {
  assert.ok(isViewer({ argv: ["sh", "/Users/me/.config/herdr-app/mods/omarchy-browser/view.sh", "t5"] }));
  assert.ok(isViewer({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["node", "/Users/me/.config/herdr-app/bin/herdr-browser-view", "--task", "@omarchy"] } }));
  assert.ok(!isViewer({ foreground: { argv: ["node", "/x/bin/herdr-browser-view", "--task", "@omarchy-devtools"] } }));
  assert.ok(!isViewer({ foreground: { argv: ["node", "/x/bin/herdr-browser-view", "--task", "repo#4"] } }));
  assert.ok(!isViewer({ argv: ["sh", "/tmp/view.sh"] }));
  assert.ok(!isViewer({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["nvim", "mods/omarchy-browser/view.sh.bak"] } }));
  assert.ok(!isViewer(null));
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

function header({ panes, spaces, terminals, props, answers = [] }) {
  const execs = [], overlays = [], timers = [], spawned = [], watches = [];
  const cx = {
    notify() {}, stop_propagation() {}, sleep: never,
    spawn: (fn) => spawned.push(fn(cx)),
    timer: { every: (ms, fn) => timers.push({ ms, fn, every: true }), after: (ms, fn) => timers.push({ ms, fn }) },
  };
  const host = {
    View: class {}, div: el, svg: el, image: el, h_flex: el, v_flex: el,
    InputState: { new: () => ({ on() {}, set_value() {}, value: () => "", focus() {}, set_selected_range() {} }) }, Input: { new: el },
    panes: () => panes, spaces: () => spaces, terminals: () => terminals, machines: () => [], props: () => props,
    run() {}, theme: () => new Proxy({}, { get: () => "#888888" }), home: () => "/Users/me", appHome: () => "/Users/me/.config/herdr-app",
    exec: async (cmd, args) => { execs.push([cmd, ...args]); return { code: 0, stdout: JSON.stringify(answers.shift() ?? { open: false }), stderr: "" }; },
    hc: async () => ({ code: 0, stdout: "" }), notify() {}, nextCommand: never, readTextFile: async () => null, layout: () => ({}),
    shared: () => undefined, setShared() {}, window: () => ({ platform: "macos" }), openOverlay: (spec) => { overlays.push(spec); return "o1"; },
    watchFolder: (dir) => new Promise((resolve) => watches.push({ dir, resolve })),
    act: async () => false, readLive: async () => null, watchLive() {}, touches: () => false, assistantStep: () => ({ do: "none", memo: {} }), slotOf: () => null,
    ...viewer,
  };
  const body = readFileSync("mods/omarchy-pane/main.js", "utf8").replace(/^import [\s\S]*?;\n/gm, "").replace("export default class", "return class");
  const Pane = Function(...Object.keys(host), body)(...Object.values(host));
  const view = new Pane();
  view.init(props, cx);
  // Lets started tasks run to their next wait (the command loop waits forever; it isn't awaited).
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  // Runs the timers due now (after(0)) and the repeating ones, as Herdr would.
  const tick = async () => { for (const t of timers.splice(0).filter((t) => t.every || t.ms === 0)) { t.fn(cx); if (t.every) timers.push(t); } await settle(); };
  // Runs the one-shot timers set for `ms`.
  const fire = async (ms) => { for (const t of timers.filter((t) => !t.every && t.ms === ms)) { timers.splice(timers.indexOf(t), 1); t.fn(cx); } await settle(); };
  // A save under the watched folder.
  const save = async (...paths) => { const w = watches.shift(); assert.ok(w, "a folder is watched"); w.resolve(paths); await settle(); };
  return { view, cx, execs, overlays, timers, watches, render: () => view.render(cx), tick, settle, fire, save };
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
