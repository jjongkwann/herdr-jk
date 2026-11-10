// Agents parked behind a chat pane (omarchy-pane's Chat | Terminal switch, or Shepherdr's
// pane-chat), known by their core label herdr.chat=<chat pane>. Herdr lists an agent through
// its pane, so an agent whose terminal is parked while its chat shows drops out of agents()
// and out of tab and space status. The agents list and the spaces list add these back, as the
// chat pane's agent. Adapted from Shepherdr's lib/parked.js
// (https://github.com/eliasstravik/shepherdr, MIT, Copyright (c) 2026 Elias Stravik; the license
// text is in omarchy-pane/NOTICE).
//
// The same file is in omarchy-agents and omarchy-spaces (each mod installs on its own);
// tests/parked.test.mjs checks the copies match. It takes Herdr's live lists as arguments,
// so a render reads each list once.

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATES = ["working", "blocked", "done", "idle"];

// Shaped like agents()'s entries; `pane` is the chat pane, `cwd` the terminal's folder.
// lists: { panes, terminals, spaces, focusedPane, seen } (seen: shared "chat.seen").
export function chatAgents({ panes, terminals, spaces, focusedPane = null, seen = {} }) {
  const chats = new Map(panes.filter((p) => p.mod === "chat").map((p) => [p.pane, p]));
  if (!chats.size) return [];
  const own = new Set(panes.map((p) => p.terminal).filter(Boolean));
  const where = new Map(spaces.flatMap((s) => s.tabs.map((t) => [t.id, { s, t }])));
  const out = [];
  for (const k of terminals) {
    const pane = k.labels?.["herdr.chat"];
    const p = pane && chats.get(pane);
    if (!p || k.state !== "live" || own.has(k.address)) continue;
    let status = STATES.includes(k.status) ? k.status : "idle";
    // Done means finished while nobody looked; looking at its chat makes it idle, as Herdr does.
    if (status === "done" && (focusedPane === pane || (seen?.[k.address] ?? -1) >= (k.turn ?? 0))) status = "idle";
    const w = where.get(p.tab);
    out.push({
      address: k.address, pane, space: w?.s.id ?? null, space_name: w?.s.name ?? "", tab: p.tab,
      tab_index: w?.t.index ?? 0, tab_name: w?.t.name ?? "", status, app: k.report?.app ?? null,
      program: k.program, title: k.title ?? "", seq: k.turn ?? 0, focused: focusedPane === pane,
      pinned: Boolean(k.labels?.["herdr.pinned"]), cwd: k.foreground?.cwd ?? k.cwd ?? null,
    });
  }
  return out;
}

// The more urgent of two statuses (null: none).
export const urgent = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a ?? null);

// spaces with parked agents counted in their tabs' and spaces' status.
export function spacesWithChats(spaces, parked) {
  if (!parked.length) return spaces;
  return spaces.map((s) => {
    const tabs = s.tabs.map((t) => ({
      ...t,
      status: parked.filter((a) => a.tab === t.id).reduce((st, a) => urgent(st, a.status), t.status ?? null),
    }));
    return { ...s, tabs, status: tabs.reduce((st, t) => urgent(st, t.status), s.status ?? null) };
  });
}

// agents() with the parked ones placed in space and tab order, as agents() orders its own.
export function withParked(listed, parked, spaces) {
  if (!parked.length) return listed;
  const order = new Map(spaces.map((s, i) => [s.id, i]));
  const at = (a) => order.get(a.space) ?? spaces.length;
  return [...listed, ...parked]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => at(x.a) - at(y.a) || (x.a.tab_index ?? 0) - (y.a.tab_index ?? 0) || x.i - y.i)
    .map((r) => r.a);
}
