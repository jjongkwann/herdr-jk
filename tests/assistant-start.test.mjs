import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantStep, slotOf, SETTLE_MS, RETRY_MS, TRIES } from "../mods/omarchy-pane/assistant.js";

// Space s1 shows its Assistant tab (a), with an agentless chat (chat1) whose slot is coord-1.
// Space s2 is in the background with its own Assistant chat (chat2).
const world = (over = {}) => ({
  pane: "chat1",
  panes: [
    { pane: "chat1", mod: "chat", tab: "a", terminal: null },
    { pane: "p1", tab: "b", terminal: "t1" },
    { pane: "chat2", mod: "chat", tab: "c", terminal: null },
  ],
  spaces: [
    { id: "s1", machine: null, active: true, tabs: [{ id: "a", active: true }, { id: "b", active: false }] },
    { id: "s2", machine: null, active: false, tabs: [{ id: "c", active: true }] },
  ],
  terminals: [{ address: "t1", state: "live", labels: { "herdr.space": "s1" } }],
  slots: { "coord-1": { space: "s1", tab: "a", pane: "chat1" }, "coord-2": { space: "s2", tab: "c", pane: "chat2" } },
  machines: [{ name: null, layout: "ready" }],
  now: 100000,
  ...over,
});

// Looks at a pane over time, as the header does: each look keeps the memo the last one gave.
function lookAt(w, times, memo = {}) {
  const out = [];
  for (const now of times) {
    const step = assistantStep({ ...w, now }, memo);
    memo = step.memo;
    out.push(step);
  }
  return out;
}

const assistant = (labels, extra = {}) => ({ address: "t9", state: "live", template: "assistant", labels: { "herdr.role": "coordinator", ...labels }, ...extra });

test("slotOf finds the chat pane's Assistant slot", () => {
  assert.equal(slotOf("chat2", world().slots), "coord-2");
  assert.equal(slotOf("nope", world().slots), null);
  assert.equal(slotOf("chat1", undefined), null);
});

test("a shown Assistant chat with no agent starts it once it has been shown a moment", () => {
  const [first, early, ready] = lookAt(world(), [100000, 100000 + SETTLE_MS - 1, 100000 + SETTLE_MS]);
  assert.equal(first.do, "wait");
  assert.equal(first.ms, SETTLE_MS);
  assert.equal(early.do, "wait");
  assert.equal(early.ms, 1);
  assert.equal(ready.do, "start");
  assert.equal(ready.memo.asked, 1);
});

test("a background Assistant tab nobody looked at starts nothing", () => {
  const w = world({ pane: "chat2" });
  for (const step of lookAt(w, [0, SETTLE_MS, 10 * SETTLE_MS])) assert.equal(step.do, "none");
});

test("a tab shown only for a moment (opened in the background) starts nothing", () => {
  const w = world();
  const shown = assistantStep({ ...w, now: 0 }, {});
  assert.equal(shown.do, "wait");
  // The view goes back to where the person was before the settle time is up.
  const away = { ...w, spaces: w.spaces.map((s) => (s.id === "s1" ? { ...s, tabs: [{ id: "a", active: false }, { id: "b", active: true }] } : s)) };
  const left = assistantStep({ ...away, now: SETTLE_MS / 2 }, shown.memo);
  assert.equal(left.do, "none");
  assert.equal(left.memo.since, null);
  // Shown again later: the settle time starts over.
  assert.equal(assistantStep({ ...w, now: SETTLE_MS * 2 }, left.memo).do, "wait");
});

test("a shown tab in a space that isn't shown doesn't count", () => {
  const w = world();
  const hidden = { ...w, spaces: w.spaces.map((s) => ({ ...s, active: s.id === "s2" })) };
  for (const step of lookAt(hidden, [0, SETTLE_MS * 3])) assert.equal(step.do, "none");
});

test("an Assistant chat that already has its agent is left in Chat view", () => {
  const w = world({ terminals: [assistant({ "herdr.chat": "chat1", "herdr.chat.slot": "coord-1" })] });
  const [step] = lookAt(w, [0]);
  assert.equal(step.do, "none");
  assert.equal(step.memo.had, true);
});

test("an Assistant in Terminal view (its own pane) is left alone", () => {
  const w = world({
    panes: [...world().panes, { pane: "p9", tab: "a", terminal: "t9" }],
    terminals: [assistant({ "herdr.chat.slot": "coord-1" })],
  });
  assert.equal(lookAt(w, [0])[0].do, "none");
});

test("once the agent asked for runs behind the chat, the tab swaps to its terminal, once", () => {
  const w = world();
  const [, started] = lookAt(w, [0, SETTLE_MS]);
  assert.equal(started.do, "start");
  const running = { ...w, terminals: [...w.terminals, assistant({ "herdr.chat": "chat1", "herdr.chat.slot": "coord-1" })] };
  const swap = assistantStep({ ...running, now: SETTLE_MS + 500 }, started.memo);
  assert.equal(swap.do, "terminal");
  // The swap is under way (the terminal has its pane, or the chat still shows): never asked twice.
  assert.equal(assistantStep({ ...running, now: SETTLE_MS + 600 }, swap.memo).do, "none");
});

test("the agent comes up while the person looks elsewhere: its terminal shows when they come back", () => {
  const w = world();
  const [, started] = lookAt(w, [0, SETTLE_MS]);
  const elsewhere = { ...w, spaces: w.spaces.map((s) => ({ ...s, active: s.id === "s2" })),
    terminals: [...w.terminals, assistant({ "herdr.chat": "chat1", "herdr.chat.slot": "coord-1" })] };
  const away = assistantStep({ ...elsewhere, now: SETTLE_MS + 500 }, started.memo);
  assert.equal(away.do, "none");
  const back = { ...elsewhere, spaces: w.spaces };
  assert.equal(assistantStep({ ...back, now: SETTLE_MS + 900 }, away.memo).do, "terminal");
});

test("an agent on another machine names its chat pane without the machine prefix", () => {
  const w = world({
    pane: "mini/c5",
    panes: [{ pane: "mini/c5", mod: "chat", tab: "mini/a", terminal: null }],
    spaces: [{ id: "mini/s7", machine: "mini", active: true, tabs: [{ id: "mini/a", active: true }] }],
    terminals: [],
    slots: { "coord-mini/s7-x": { space: "mini/s7", tab: "mini/a", pane: "mini/c5" } },
    machines: [{ name: null, layout: "ready" }, { name: "mini", layout: "ready" }],
  });
  const [, started] = lookAt(w, [0, SETTLE_MS]);
  assert.equal(started.do, "start");
  const running = { ...w, terminals: [{ address: "mini/t3", state: "live", template: "assistant", labels: { "herdr.role": "coordinator", "herdr.chat": "c5" } }] };
  assert.equal(assistantStep({ ...running, now: SETTLE_MS + 500 }, started.memo).do, "terminal");
});

test("a machine whose layout isn't ready yet starts nothing", () => {
  const w = world({
    spaces: [{ id: "mini/s7", machine: "mini", active: true, tabs: [{ id: "a", active: true }] }],
    machines: [{ name: null, layout: "ready" }, { name: "mini", layout: "loading" }],
  });
  for (const step of lookAt(w, [0, SETTLE_MS * 3])) assert.equal(step.do, "none");
});

test("the space's Assistant already running (being handed to this chat) is not started again", () => {
  const w = world({ terminals: [assistant({ "herdr.coordinator.space": "s1" })] });
  for (const step of lookAt(w, [0, SETTLE_MS * 3])) assert.equal(step.do, "none");
  // A worker in the space isn't an Assistant: it doesn't hold the start back.
  const worker = world({ terminals: [{ address: "t5", state: "live", labels: { "herdr.space": "s1", "herdr.task": "HJK-1" } }] });
  assert.equal(lookAt(worker, [0, SETTLE_MS])[1].do, "start");
});

test("an Assistant that ended here isn't started again without a message", () => {
  const w = world();
  const had = assistantStep({ ...world({ terminals: [assistant({ "herdr.chat": "chat1", "herdr.chat.slot": "coord-1" })] }), now: 0 }, {});
  for (const step of lookAt(w, [SETTLE_MS, SETTLE_MS * 5], had.memo)) assert.equal(step.do, "none");
});

test("a missed or failed start is asked again, then given up", () => {
  const w = world();
  const t0 = SETTLE_MS;
  const steps = lookAt(w, [0, t0, t0 + 1000, t0 + RETRY_MS, t0 + RETRY_MS * 3, t0 + RETRY_MS * 10]);
  assert.deepEqual(steps.map((s) => s.do), ["wait", "start", "wait", "start", "none", "none"]);
  assert.equal(steps[2].ms, RETRY_MS - 1000);
  assert.equal(steps.at(-1).memo.asked, TRIES);
});

test("panes that aren't Assistant chats are none of its business", () => {
  assert.deepEqual(assistantStep({ ...world(), pane: "p1" }, {}), { do: "none", memo: {} });
  const plain = world({ panes: [{ pane: "chat1", mod: "chat", tab: "a", terminal: null }], slots: {} });
  assert.deepEqual(assistantStep(plain, {}), { do: "none", memo: {} });
  // A chat opened by the switch for a running agent (no slot) is never touched.
  assert.equal(assistantStep({ ...world(), slots: null }, {}).do, "none");
});
