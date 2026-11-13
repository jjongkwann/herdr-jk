// An Assistant tab opens in Terminal view. Shepherdr opens a space's Assistant tab as a `chat`
// pane with no agent yet (its slot is in shared "coordinator.slots"); the agent starts on the
// person's first message. Here, once such a chat has been shown for a moment, its header asks
// Shepherdr's chat to start the agent (shared "chat.startreq", what Shepherdr's own pane header
// sends for its Terminal switch), so the agent is exactly what the chat would start: same
// template, settings and labels. Once it runs, parked behind the chat, the header swaps the chat
// for its terminal (main.js toTerminal). Chat tabs nobody looks at start nothing, and an
// Assistant tab that already has an agent, in Chat or Terminal view, is left as it is.
//
// assistantStep() decides; it takes Herdr's live lists as arguments, so tests can run it.

// How long an agentless Assistant chat stays shown before its agent starts. Opening one in the
// background (Shepherdr's openCoordinator with show off) shows the new tab for a moment before
// going back to where the person was; that doesn't count as looking at it.
export const SETTLE_MS = 2000;
// A start request the chat missed (or a start that failed) is asked again once, this much later.
export const RETRY_MS = 8000;
export const TRIES = 2;

// Labels hold ids local to the terminal's machine; the app names another machine's ids
// "<machine>/<id>". machineOf("mini/t5") is "mini" (null: this computer).
const machineOf = (address) => (String(address ?? "").includes("/") ? address.split("/")[0] : null);
const qualify = (machine, id) => (machine && id && !id.includes("/") ? `${machine}/${id}` : id);
const chatPaneOf = (k) => qualify(machineOf(k.address), k.labels?.["herdr.chat"] ?? null);

// A live Assistant, as Shepherdr's coordinator.js isCoordinator: labelled by role, or started
// from the "assistant" template (earlier ones from "coordinator").
const isAssistant = (k) => k?.state === "live" && (k.labels?.["herdr.role"] === "coordinator" || k.template === "assistant" || k.template === "coordinator");

// The Assistant slot a chat pane holds (its key in "coordinator.slots"), or null.
export const slotOf = (pane, slots) => Object.entries(slots ?? {}).find(([, r]) => r?.pane === pane)?.[0] ?? null;

// What the header of chat pane `pane` does now:
//   { do: "none" | "wait" | "start" | "terminal", ms?, memo }
// "wait": look again in `ms`; "start": ask the chat to start its agent; "terminal": swap the chat
// for the agent's terminal. `memo` is this pane's record between looks (keep the returned one):
//   since: when it was first seen shown and agentless; asked, last: start requests made and when;
//   had: it had an agent here (an Assistant that ended is started again only by a message).
// lists: { pane, panes, spaces, terminals, slots (shared "coordinator.slots"), machines, now }.
export function assistantStep({ pane, panes, spaces, terminals, slots, machines, now }, memo = {}) {
  const self = panes.find((p) => p.pane === pane);
  if (self?.mod !== "chat") return { do: "none", memo: {} };
  const slot = slotOf(pane, slots);
  if (!slot) return { do: "none", memo: {} };
  const space = spaces.find((s) => s.tabs.some((t) => t.id === self.tab));
  const shown = Boolean(space?.active && space.tabs.find((t) => t.id === self.tab)?.active);
  const behind = terminals.find((k) => k.state === "live" && chatPaneOf(k) === pane);
  const started = behind ?? terminals.find((k) => k.state === "live" && k.labels?.["herdr.chat.slot"] === slot);
  if (started) {
    // The agent this header asked for, parked behind the chat: its terminal, once the tab shows.
    if (memo.asked && behind && !panes.some((p) => p.terminal === behind.address))
      return shown ? { do: "terminal", memo: { had: true } } : { do: "none", memo };
    return { do: "none", memo: { had: true } };
  }
  const idle = { do: "none", memo: { ...memo, since: null } };
  if (memo.had || !shown || !space) return idle;
  // Its machine's tabs and terminals are all known only once its layout is ready.
  const machine = space.machine ?? null;
  if (machines.find((m) => (m.name ?? null) === machine)?.layout !== "ready") return idle;
  // The space's Assistant already runs (being handed to this chat, or started elsewhere): one is enough.
  const id = String(space.id).split("/").pop();
  if (terminals.some((k) => isAssistant(k) && machineOf(k.address) === machine
    && [k.labels?.["herdr.coordinator.space"], k.labels?.["herdr.space"]].includes(id))) return idle;
  const since = memo.since ?? now;
  if (now - since < SETTLE_MS) return { do: "wait", ms: SETTLE_MS - (now - since), memo: { ...memo, since } };
  const asked = memo.asked ?? 0;
  if (asked >= TRIES) return { do: "none", memo: { ...memo, since } };
  if (memo.last && now - memo.last < RETRY_MS) return { do: "wait", ms: RETRY_MS - (now - memo.last), memo: { ...memo, since } };
  return { do: "start", memo: { ...memo, since, asked: asked + 1, last: now } };
}
