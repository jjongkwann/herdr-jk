import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatAgents, withParked } from "../mods/omarchy-agents/parked.js";

// A sub-agent someone kept as a pane, or parked behind a chat pane, is in agents() too, and its
// parent's tree shows it as well. The agents list shows it once, under its parent.

// Elements that remember their id, children, handlers and the style calls made on them.
const NODE = Symbol("node");
function el() {
  const node = { id: null, kids: [], on: {}, calls: [] };
  const self = new Proxy(node, {
    get(_t, prop) {
      if (prop === NODE) return node;
      return (...args) => {
        node.calls.push(prop);
        if (prop === "id") node.id = args[0];
        else if (prop === "child") node.kids.push(args[0]);
        else if (prop === "children") node.kids.push(...args[0]);
        else if (prop === "when") return args[0] ? args[1](self) : self;
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
const ids = (tree) => walk(tree).map((n) => n.id).filter((id) => /^(ag-t|sub-|sec-)/.test(id));
const byId = (tree, id) => walk(tree).find((n) => n.id === id);
const texts = (tree) => walk(tree).flatMap((n) => n.kids.filter((k) => typeof k === "string"));

function harness(lists, px = 243, settings = {}) {
  const calls = [], order = [];
  const cx = { notify() {}, stop_propagation() {}, timer: { every() {}, after() {} } };
  const host = {
    ...lists, run: (name, args) => calls.push([name, args]), requestClose: (name, args, after) => calls.push([`omarchy-close:${name}`, args, after]),
    theme: () => new Proxy({}, { get: () => "#888888" }), focused: () => ({ pane: null, agent: null }), shared: (key) => settings[key], setShared() {},
    setAgentOrder: (o) => order.push(o), openOverlay() {}, closeOverlay() {}, props: () => ({}), window: () => ({ platform: "macos" }), home: () => "/Users/me",
    layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px } }] }),
  };
  const body = readFileSync("mods/omarchy-agents/main.js", "utf8").replace(/^import .*;\n/gm, "").replace("export default class", "return class");
  const deps = { View: class {}, ScrollRail: class { render(_id, rows) { return el().children(rows); } }, div: el, image: el, svg: el, v_flex: el, h_flex: el,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, chatAgents, withParked, sweep() {}, ...host };
  const view = new (Function(...Object.keys(deps), body)(...Object.values(deps)))();
  view.init({}, cx);
  return { calls, order, cx, render: () => view.render(cx) };
}

const program = { key: "claude", name: "Claude Code", agent: true };
const entry = (address, pane, status, more = {}) => ({ address, pane, space: "s1", space_name: "one", tab: "a", tab_index: 1, status, program, title: "", seq: 1, focused: false, pinned: false, ...more });
// t1 is working with two helpers: t2 has no pane, t3 someone kept as a pane, so agents() lists it; t3 is done.
const kept = {
  agents: () => [entry("t1", "p1", "working"), entry("t3", "p3", "done")],
  terminals: () => [
    { address: "t1", state: "live", status: "working", program, labels: {} },
    { address: "t2", parent: "t1", name: "scout", state: "live", status: "working", program, labels: {} },
    { address: "t3", parent: "t1", name: "helper", state: "live", status: "done", program, labels: {} },
  ],
  panes: () => [{ pane: "p1", terminal: "t1", tab: "a" }, { pane: "p3", terminal: "t3", tab: "a" }],
  spaces: () => [{ id: "s1", name: "one", tabs: [{ id: "a", index: 1, name: "1" }] }],
};

test("a kept sub-agent shows once, under its parent, and its done doesn't pull the parent into Done", () => {
  const h = harness(kept);
  const tree = h.render();
  assert.deepEqual(ids(tree), ["sec-2", "ag-t1", "sub-t2", "sub-t3"]);
  // Its row keeps its own done: a filled dot, where idle is a ring.
  const dot = byId(tree, "sub-t3").kids.at(-1)[NODE];
  assert.ok(dot.calls.includes("bg") && !dot.calls.includes("border"));
  // Agent keys go down the list as it reads: the parent, then its kept helper.
  assert.deepEqual(h.order.at(-1), ["t1", "t3"]);
  // It has a pane: a click goes there instead of peeking.
  byId(tree, "sub-t3").on.on_click();
  byId(tree, "sub-t2").on.on_click();
  assert.deepEqual(h.calls, [["pane.focus", { pane: "p3" }], ["terminal.peek", { terminal: "t2" }]]);
});

test("a kept sub-agent keeps its own row when its parent is gone, when pinned, and on the rail", () => {
  const gone = { ...kept, agents: () => [entry("t3", "p3", "done")], terminals: () => kept.terminals().map((k) => (k.address === "t1" ? { ...k, state: "exited" } : k)) };
  assert.deepEqual(ids(harness(gone).render()), ["sec-3", "ag-t3"]);
  const pinned = { ...kept, agents: () => [entry("t1", "p1", "working"), entry("t3", "p3", "done", { pinned: true })] };
  const h = harness(pinned);
  assert.deepEqual(ids(h.render()), ["ag-t3", "sec-2", "ag-t1", "sub-t2", "sub-t3"]);
  assert.deepEqual(h.order.at(-1), ["t3", "t1"]);
  // The rail draws no trees, so each listed agent keeps its own square there.
  assert.deepEqual(ids(harness(kept, 100).render()), ["ag-t3", "ag-t1"]);
});

test("a sub-agent parked behind a chat shows under its parent and its × closes the chat first", () => {
  const parked = {
    agents: () => [entry("t1", "p1", "working")],
    terminals: () => [
      { address: "t1", state: "live", status: "working", program, labels: {} },
      { address: "t5", parent: "t1", name: "worker", state: "live", status: "idle", program, cwd: "/w/one", labels: { "herdr.chat": "chat5" } },
    ],
    panes: () => [{ pane: "p1", terminal: "t1", tab: "a" }, { pane: "chat5", terminal: null, mod: "chat", tab: "a" }],
    spaces: kept.spaces,
  };
  const h = harness(parked);
  assert.deepEqual(ids(h.render()), ["sec-2", "ag-t1", "sub-t5"]);
  byId(h.render(), "sub-t5").on.on_click();
  byId(h.render(), "sub-t5").on.on_hover(true, h.cx);
  byId(h.render(), "kill-t5").on.on_click({}, h.cx);
  assert.deepEqual(h.calls, [
    ["pane.focus", { pane: "chat5" }],
    ["omarchy-close:pane.close", { pane: "chat5", folder: "/w/one" }, { command: "terminal.kill", args: { terminal: "t5" } }],
  ]);
});

test("a kept sub-agent's row pins it, and a folded space still says it needs you", () => {
  const h = harness(kept);
  byId(h.render(), "sub-t2").on.on_hover(true, h.cx);
  assert.equal(byId(h.render(), "pin-t2"), undefined);
  byId(h.render(), "sub-t3").on.on_hover(true, h.cx);
  byId(h.render(), "pin-t3").on.on_click({}, h.cx);
  assert.deepEqual(h.calls, [["terminal.pin", { terminal: "t3", pinned: true }]]);
  const needs = { ...kept, agents: () => [entry("t1", "p1", "idle"), entry("t3", "p3", "blocked")] };
  const g = harness(needs, 243, { "agents.sort": "grouped" });
  byId(g.render(), "sp-s1").on.on_click({}, g.cx);
  assert.ok(texts(g.render()).includes("!"));
});
