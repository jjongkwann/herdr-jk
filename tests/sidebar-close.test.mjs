import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatAgents, withParked, spacesWithChats } from "../mods/omarchy-agents/parked.js";
import { arrange } from "../mods/omarchy-spaces/order.js";

// Elements that remember their id, children, handlers, tooltip and the style calls made on them.
const NODE = Symbol("node");
function el() {
  const node = { id: null, kids: [], on: {}, tip: null, calls: [] };
  const self = new Proxy(node, {
    get(_t, prop) {
      if (prop === NODE) return node;
      return (...args) => {
        node.calls.push(prop);
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

function load(file, host) {
  const body = readFileSync(file, "utf8").replace(/^import .*;\n/gm, "").replace(/^export function/gm, "function").replace("export default class", "return class");
  const deps = { View: class {}, div: el, image: el, svg: el, v_flex: el, h_flex: el, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, chatAgents, withParked, spacesWithChats, arrange, sweep() {}, ...host };
  return Function(...Object.keys(deps), body)(...Object.values(deps));
}

function harness(file, lists, px = 243) {
  const calls = [], timers = [];
  const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {}, after: (ms, fn) => timers.push({ ms, fn }) } };
  const host = {
    ...lists, run: (name, args) => calls.push([name, args]), theme: () => new Proxy({}, { get: () => "#888888" }),
    focused: () => ({ pane: null, agent: null }), shared: () => undefined, setShared() {}, setAgentOrder() {}, openOverlay() {}, closeOverlay() {},
    props: () => ({}), window: () => ({ platform: "macos", active: false }), home: () => "/Users/me", machines: () => [{ name: "mini", layout: "ready" }],
    layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px } }] }), exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "" }), watchFolder: async () => {},
  };
  const view = new (load(file, host))();
  view.init({}, cx);
  const render = () => view.render(cx);
  // Hover the row, then click its close button `times` times, re-rendering in between as cx.notify() would.
  const close = (row, closer, times = 1) => {
    byId(render(), row).on.on_hover(true, cx);
    for (let i = 0; i < times; i++) byId(render(), closer).on.on_click({}, cx);
  };
  return { calls, timers, cx, render, close };
}

const program = { key: "claude", name: "Claude Code", agent: true };
const agentLists = {
  // t1 has its own pane; t2 is parked behind chat1 here, mini/t5 behind mini's own chat pane p9.
  agents: () => [{ address: "t1", pane: "p1", space: "s1", space_name: "one", tab: "a", tab_index: 1, status: "idle", program, title: "", seq: 1, focused: false, pinned: false }],
  terminals: () => [
    { address: "t1", state: "live", status: "idle", program, labels: {} },
    { address: "t2", state: "live", status: "blocked", program, turn: 1, labels: { "herdr.chat": "chat1" } },
    { address: "mini/t5", state: "live", status: "working", program, turn: 1, labels: { "herdr.chat": "p9" } },
  ],
  panes: () => [
    { pane: "p1", terminal: "t1", tab: "a", cwd: "/Users/me/work/one" },
    { pane: "chat1", terminal: null, mod: "chat", tab: "b" },
    { pane: "mini/p9", terminal: null, mod: "chat", tab: "mini/x" },
  ],
  spaces: () => [
    { id: "s1", name: "one", tabs: [{ id: "a", index: 1, name: "1" }] },
    { id: "s2", name: "two", tabs: [{ id: "b", index: 1, name: "1" }] },
    { id: "mini/s1", name: "far", machine: "mini", tabs: [{ id: "mini/x", index: 1, name: "1" }] },
  ],
};

test("an idle agent stops on the first click of its hover close button", () => {
  const h = harness("mods/omarchy-agents/main.js", agentLists);
  assert.equal(byId(h.render(), "kill-t1"), undefined);
  h.close("ag-t1", "kill-t1");
  assert.deepEqual(h.calls, [["terminal.kill", { terminal: "t1" }]]);
});

test("a parked agent that needs you stops its own terminal on a second click within 3s", () => {
  const h = harness("mods/omarchy-agents/main.js", agentLists);
  h.close("ag-t2", "kill-t2");
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers[0].ms, 3000);
  // Armed, it stays shown after the pointer leaves and asks for the second click.
  byId(h.render(), "ag-t2").on.on_hover(false, h.cx);
  assert.equal(byId(h.render(), "kill-t2").tip, "Click again to stop it");
  byId(h.render(), "kill-t2").on.on_click({}, h.cx);
  assert.deepEqual(h.calls, [["terminal.kill", { terminal: "t2" }]]);
});

test("after 3s the arming lapses and the next click arms again", () => {
  const h = harness("mods/omarchy-agents/main.js", agentLists);
  h.close("ag-t2", "kill-t2");
  h.timers[0].fn(h.cx);
  h.close("ag-t2", "kill-t2");
  assert.deepEqual(h.calls, []);
});

test("a working agent parked on another machine stops by its qualified terminal", () => {
  const h = harness("mods/omarchy-agents/main.js", agentLists);
  h.close("ag-mini/t5", "kill-mini/t5", 2);
  assert.deepEqual(h.calls, [["terminal.kill", { terminal: "mini/t5" }]]);
});

test("a narrow sidebar gives the name the row and hides how long ago", () => {
  const nameCalls = (tree) => walk(tree).find((n) => n.kids.includes("one") && n.calls.includes("truncate")).calls;
  const wide = harness("mods/omarchy-agents/main.js", agentLists, 243).render();
  assert.ok(texts(wide).includes("<1m"));
  assert.ok(!nameCalls(wide).includes("max_w"));
  assert.ok(!texts(harness("mods/omarchy-agents/main.js", agentLists, 220).render()).includes("<1m"));
});

const spaceLists = {
  // Space two's only agent is parked behind its chat pane and working, so it is listed
  // first, where the sidebar keeps it: no space.move runs before the clicks.
  spaces: () => [
    { id: "s2", name: "two", status: null, folder: "/w/two", tabs: [{ id: "b", index: 1, status: null }] },
    { id: "s1", name: "one", status: null, active: true, folder: "/w/one", tabs: [{ id: "a", index: 1, status: null }] },
    { id: "mini/s1", name: "far", machine: "mini", status: "idle", folder: "/home/u", tabs: [{ id: "mini/x", index: 1, status: "idle" }] },
  ],
  panes: () => [{ pane: "chat1", terminal: null, mod: "chat", tab: "b" }],
  terminals: () => [{ address: "t2", state: "live", status: "working", program, labels: { "herdr.chat": "chat1" } }],
};

test("an idle space closes on one click and lets Herdr ask about other work", () => {
  const h = harness("mods/omarchy-spaces/main.js", spaceLists);
  h.close("space-s1", "close-s1");
  assert.deepEqual(h.calls, [["space.close", { id: "s1", confirmed: false }]]);
});

test("a space whose parked agent is working closes, confirmed, on the second click", () => {
  const h = harness("mods/omarchy-spaces/main.js", spaceLists);
  h.close("space-s2", "close-s2");
  assert.deepEqual(h.calls, []);
  assert.equal(byId(h.render(), "close-s2").tip, "Click again to close it");
  byId(h.render(), "close-s2").on.on_click({}, h.cx);
  assert.deepEqual(h.calls, [["space.close", { id: "s2", confirmed: true }]]);
});

test("a space on another machine closes by its qualified id", () => {
  const h = harness("mods/omarchy-spaces/main.js", spaceLists);
  h.close("space-mini/s1", "close-mini/s1");
  assert.deepEqual(h.calls, [["space.close", { id: "mini/s1", confirmed: false }]]);
});
