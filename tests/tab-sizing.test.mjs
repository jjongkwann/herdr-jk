import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { tabWidths, TAB_MAX, TAB_MIN, TAB_ACTIVE } from "../mods/omarchy-tabs/sizing.js";

const widths = (count, strip, panels = 0, zoom = 1) => {
  const { tab, active } = tabWidths(count, strip, panels, zoom);
  return [tab, active];
};

test("tabs share the measured strip less the panel buttons and +", () => {
  // 600 - 100 - 36 = 464px for five tabs: the active one keeps 128, the others get the minimum.
  assert.deepEqual(widths(5, 600, 100), [84, 128]);
  // 1000 - 36 = 964px: three tabs of 190 fit, so the strip doesn't fill the room.
  assert.deepEqual(widths(3, 1000), [TAB_MAX, TAB_MAX]);
});

test("tabs shrink toward the minimum before the strip scrolls", () => {
  // 836px for eight tabs: the active one gets 150 and the others 98 instead of 190, so all eight fit.
  assert.deepEqual(widths(8, 872), [98, TAB_ACTIVE]);
  // Too many to fit: every tab stops at the minimum, and the strip scrolls.
  assert.deepEqual(widths(10, 500), [TAB_MIN, TAB_MIN]);
});

test("tabs overflow only at the minimum, and the active tab gets at most TAB_ACTIVE, never less than the others", () => {
  for (let count = 2; count <= 12; count++) for (let strip = 200; strip <= 2400; strip += 37) {
    const [tab, active] = widths(count, strip), at = `${count} tabs, ${strip}px: ${tab}/${active}`;
    assert.ok(active >= tab && tab >= TAB_MIN && tab <= TAB_MAX, at);
    if (tab < TAB_ACTIVE) assert.ok(active <= TAB_ACTIVE, at);
    if (tab > TAB_MIN) assert.ok((count - 1) * tab + active <= strip - 36, at);
  }
});

test("measured widths account for UI zoom", () => {
  assert.deepEqual(widths(5, 1200, 200, 2), widths(5, 600, 100));
});

test("an empty or not yet measured strip uses the full width", () => {
  assert.deepEqual(widths(0, 0), [TAB_MAX, TAB_MAX]);
  assert.deepEqual(widths(5, 0), [TAB_MAX, TAB_MAX]);
  // One tab in a narrow strip takes what is left.
  assert.deepEqual(widths(1, 150), [114, 114]);
});

// Elements that remember their id, width, children, size handler and tooltip.
const NODE = Symbol("node");
function el(kind = null) {
  const node = { kind, id: null, w: null, max: null, kids: [], size: null, tip: null };
  const self = new Proxy(node, {
    get(_t, prop) {
      if (prop === NODE) return node;
      return (...args) => {
        if (prop === "id") node.id = args[0];
        else if (prop === "w") node.w = args[0];
        else if (prop === "max_w") node.max = args[0];
        else if (prop === "child") node.kids.push(args[0]);
        else if (prop === "children") node.kids.push(...args[0]);
        else if (prop === "when") return args[0] ? args[1](self) : self;
        else if (prop === "tooltip") node.tip = args[0];
        else if (prop === "on_size_change") node.size = args[0];
        return self;
      };
    },
  });
  return self;
}
const walk = (e, out = []) => {
  const n = e?.[NODE] ?? e;
  if (!n?.kids) return out;
  out.push(n);
  for (const k of n.kids) walk(k, out);
  return out;
};

test("the strip measures itself and sizes its tabs from it", () => {
  const program = { key: "claude", name: "Claude Code", icon: "claude.svg", agent: true };
  const tabs = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, index: i + 1, name: `work ${i}`, named: true, active: i === 0, status: i === 0 ? "working" : "idle" }));
  const cx = { notify() {}, spawn() {}, stop_propagation() {}, timer: { every() {}, after() {} } };
  const context = {
    View: class {}, div: () => el(), h_flex: () => el(), svg: () => el("svg"), image: () => el("image"),
    localStorage: { getItem: () => null, setItem() {} },
    spaces: () => [{ id: "s1", active: true, machine: null, branch: null, tabs }],
    panes: () => tabs.map((c, i) => ({ pane: `p${i}`, tab: c.id, terminal: `a${i}`, status: c.status, program, title: `task ${i}`, cwd: "/Users/me/work" })),
    terminals: () => [], focused: () => null, props: () => ({}), settings: () => ({ zoom: 1 }),
    run() {}, openOverlay() {}, notify() {}, shared: () => undefined, setShared() {},
    theme: () => new Proxy({}, { get: () => "#888888" }), layout: () => ({ id: "root", children: [{ id: "tabs" }] }),
    exec: async () => ({ code: 1 }), readTextFile: async () => null, home: () => "/Users/me", appHome: () => "/app", nextCommand: () => new Promise(() => {}),
    syncNames() {}, renderPaneHeader() {}, chatAgents: () => [], spacesWithChats: s => s, resumeCommand() {}, argvOf() {},
    coordinatorTab: () => null, openCoordinator() {}, jump: () => null,
    PaneHistory: class { see() { return false; } }, placeOf: () => null, SETTLE: 0,
    tabWidths, TAB_ICONS: 120, NEW_TAB: 36,
  };
  const code = readFileSync(new URL("../mods/omarchy-tabs/main.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "").replace("export default class Tabs", "globalThis.Tabs = class Tabs");
  vm.runInNewContext(code, context);
  const strip = new context.Tabs();
  strip.init({}, cx);
  const tab = (nodes, id) => nodes.find(n => n.id === `tab-${id}`);
  const widthsOf = nodes => tabs.map(c => tab(nodes, c.id).w);
  const icons = (nodes, id) => walk(tab(nodes, id)).filter(n => n.kind === "image").length;

  // Not measured yet: full-width tabs, each with its icon.
  let nodes = walk(strip.render(cx));
  assert.deepEqual(widthsOf(nodes), Array(8).fill(TAB_MAX));
  assert.equal(icons(nodes, "t1"), 1);
  // The strip reports 900px and its panel buttons 64px: 800px for eight tabs and no scrolling.
  nodes.find(n => n.id === "tab-strip").size({ width: 900 }, cx);
  nodes.find(n => n.id === "tab-panels").size({ width: 64 }, cx);
  nodes = walk(strip.render(cx));
  assert.deepEqual(widthsOf(nodes), [150, 92, 92, 92, 92, 92, 92, 92]);
  assert.equal(nodes.find(n => n.id === "tab-scroll").max, 150 + 7 * 92);
  // The active tab keeps its icon; a 92px tab gives it up. The status word is only in the tooltip.
  assert.equal(icons(nodes, "t0"), 1);
  assert.equal(icons(nodes, "t1"), 0);
  assert.match(tab(nodes, "t0").tip, /Working/);
  const strings = nodes.flatMap(n => n.kids.filter(k => typeof k === "string"));
  assert.ok(!strings.includes("Working") && !strings.includes("Idle"), strings.join(","));
});
