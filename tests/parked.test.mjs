import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatAgents, spacesWithChats, withParked } from "../mods/omarchy-agents/parked.js";

const program = { key: "claude", name: "Claude Code", agent: true };
const spaces = [
  { id: "s1", name: "one", status: null, tabs: [{ id: "a", index: 1, name: "1", status: null }] },
  { id: "s2", name: "two", status: "idle", tabs: [{ id: "b", index: 1, name: "1", status: "idle" }, { id: "c", index: 2, name: "2", status: null }] },
];
const panes = [
  { pane: "p1", terminal: "t1", tab: "a" },
  { pane: "chat1", terminal: null, mod: "chat", tab: "b" },
  { pane: "chat2", terminal: null, mod: "chat", tab: "c" },
];
const terminals = [
  { address: "t1", state: "live", status: "working", program, labels: {} },
  { address: "t2", state: "live", status: "blocked", program, title: "fix", turn: 3, labels: { "herdr.chat": "chat1", "herdr.pinned": "1" }, foreground: { cwd: "/w/two" } },
  { address: "t3", state: "live", status: "done", program, turn: 5, labels: { "herdr.chat": "chat2" } },
  // Its chat pane is gone, or it still has a pane of its own, or it ended: not parked.
  { address: "t4", state: "live", status: "idle", program, labels: { "herdr.chat": "gone" } },
  { address: "t1x", state: "exited", status: "idle", program, labels: { "herdr.chat": "chat1" } },
];

test("parked agents come back shaped like agents() entries", () => {
  const out = chatAgents({ panes, terminals, spaces });
  assert.deepEqual(out.map((a) => a.address), ["t2", "t3"]);
  const [t2] = out;
  assert.equal(t2.pane, "chat1");
  assert.equal(t2.space, "s2");
  assert.equal(t2.tab, "b");
  assert.equal(t2.status, "blocked");
  assert.equal(t2.pinned, true);
  assert.equal(t2.cwd, "/w/two");
  assert.equal(t2.focused, false);
});

test("a terminal that still has its own pane is not listed twice", () => {
  const withPane = [...panes, { pane: "p2", terminal: "t2", tab: "b" }];
  assert.deepEqual(chatAgents({ panes: withPane, terminals, spaces }).map((a) => a.address), ["t3"]);
});

test("done turns idle once its chat is looked at or seen", () => {
  assert.equal(chatAgents({ panes, terminals, spaces }).find((a) => a.address === "t3").status, "done");
  assert.equal(chatAgents({ panes, terminals, spaces, focusedPane: "chat2" }).find((a) => a.address === "t3").status, "idle");
  assert.equal(chatAgents({ panes, terminals, spaces, seen: { t3: 5 } }).find((a) => a.address === "t3").status, "idle");
});

test("no chat panes, no work", () => {
  assert.deepEqual(chatAgents({ panes: panes.slice(0, 1), terminals, spaces }), []);
});

test("parked agents count in their tab's and space's status", () => {
  const out = spacesWithChats(spaces, chatAgents({ panes, terminals, spaces }));
  assert.equal(out[0].status, null);
  assert.equal(out[1].tabs[0].status, "blocked");
  assert.equal(out[1].tabs[1].status, "done");
  assert.equal(out[1].status, "blocked");
  assert.equal(spacesWithChats(spaces, []), spaces);
});

test("parked agents sit in space and tab order among agents()", () => {
  const listed = [
    { address: "t1", space: "s1", tab_index: 1 },
    { address: "t9", space: "s2", tab_index: 2 },
  ];
  const parked = [{ address: "t2", space: "s2", tab_index: 1 }, { address: "t0", space: "s1", tab_index: 1 }];
  assert.deepEqual(withParked(listed, parked, spaces).map((a) => a.address), ["t1", "t0", "t2", "t9"]);
});

test("omarchy-agents and omarchy-spaces carry the same parked.js", () => {
  assert.equal(readFileSync("mods/omarchy-spaces/parked.js", "utf8"), readFileSync("mods/omarchy-agents/parked.js", "utf8"));
});
