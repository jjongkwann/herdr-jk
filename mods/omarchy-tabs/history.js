// Pane back / forward (omarchy-tabs.pane-back / pane-forward): the panes the person has focused,
// across tabs and spaces, stepped through like a browser's history. In memory for the window's life.
//
// An entry is a place: { pane, terminal, tab, space, machine }. `terminal` is the pane's own
// terminal, or for a chat pane the agent parked behind it (herdr.chat label, as parked.js reads it),
// so a chat pane and its agent's terminal pane (omarchy-pane's Chat | Terminal switch swaps one for
// the other in place) are the same place: after a swap, an entry follows the terminal to the pane
// that shows it now. Only model panes are places: overlays, side panels and layout terminal blocks
// are not in panes(), so they never land in the history.
//
// lists: { panes, terminals, spaces } as Herdr gives them.

import { chatPaneOf } from "./parked.js";

// Focus has to stay this long on a pane to count: passing through panes, or the tab and space
// switches a Back itself makes, add nothing.
export const SETTLE = 400;
export const CAP = 50;

// The agent a chat pane shows: a live terminal labelled with it that has no pane of its own.
function parkedAgent(chat, { panes, terminals }) {
  const own = new Set(panes.map((p) => p.terminal).filter(Boolean));
  return terminals.find((k) => k.state === "live" && !own.has(k.address) && chatPaneOf(k) === chat)?.address ?? null;
}

function placeOfPane(p, lists) {
  const s = lists.spaces.find((x) => x.tabs.some((t) => t.id === p.tab));
  if (!s) return null;
  const terminal = p.terminal ?? (p.mod === "chat" ? parkedAgent(p.pane, lists) : null);
  return { pane: p.pane, terminal, tab: p.tab, space: s.id, machine: s.machine ?? null };
}

// The place focus is on (focused()), or null when no model pane has it.
export function placeOf(focus, lists) {
  const p = focus?.pane ? lists.panes.find((x) => x.pane === focus.pane) : null;
  return p ? placeOfPane(p, lists) : null;
}

export const samePlace = (a, b) => Boolean(a && b && (a.pane === b.pane || (a.terminal != null && a.terminal === b.terminal)));

// Where an entry is now: its pane, else the pane showing its terminal (its own pane, or the chat
// it is parked behind). Null: gone (closed, its tab closed).
export function resolve(entry, lists) {
  const { panes, terminals } = lists;
  let p = panes.find((x) => x.pane === entry.pane);
  if (!p && entry.terminal) {
    p = panes.find((x) => x.terminal === entry.terminal);
    const k = !p && terminals.find((x) => x.address === entry.terminal && x.state === "live");
    const chat = k && chatPaneOf(k);
    if (chat) p = panes.find((x) => x.pane === chat && x.mod === "chat");
  }
  return p ? placeOfPane(p, lists) : null;
}

export class PaneHistory {
  constructor({ wait = SETTLE, cap = CAP } = {}) {
    this.wait = wait;
    this.cap = cap;
    this.entries = [];
    this.index = -1;
    // The focus not yet settled: { place, since, done }.
    this.pending = null;
    this.navAt = -Infinity;
  }

  // Focus is on `place` (null: no pane) at `now`. True when a new pane starts settling: check
  // settle() again `wait` ms later.
  see(place, now) {
    const p = this.pending;
    if (!place) { this.pending = null; return false; }
    if (p?.place.pane === place.pane) {
      p.place = place;
      // A chat's agent label can show after the chat was recorded: keep the entry current.
      if (p.done && this.entries[this.index]?.pane === place.pane) this.entries[this.index] = place;
      return false;
    }
    this.pending = { place, since: now, done: false };
    return true;
  }

  // Records the pending focus once it has stayed `wait` ms. True when it did.
  settle(now) {
    const p = this.pending;
    if (!p || p.done || now - p.since < this.wait) return false;
    p.done = true;
    this.record(p.place);
    return true;
  }

  // The same place as the current entry updates it (a swap, or arriving where a Back went);
  // a new one drops the forward entries, as a browser does.
  record(place) {
    if (samePlace(this.entries[this.index], place)) { this.entries[this.index] = place; return; }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(place);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
    this.index = this.entries.length - 1;
  }

  // Back (dir -1) or forward (+1) from where the person is (`here`, the focused place): the place
  // to show, or null when there is none. Entries that are gone, or the same place as the current
  // one, are skipped and removed.
  go(dir, lists, here, now) {
    // Pressed before the focus settled: where they are counts as the current entry. Not right
    // after a Back or Forward, whose own focus may not have landed yet.
    if (here && now - this.navAt >= this.wait && !samePlace(this.index >= 0 ? resolve(this.entries[this.index], lists) : null, here)) {
      this.record(here);
      if (this.pending?.place.pane === here.pane) this.pending.done = true;
    }
    const at = this.index >= 0 ? resolve(this.entries[this.index], lists) : null;
    for (let i = this.index + dir; i >= 0 && i < this.entries.length;) {
      const r = resolve(this.entries[i], lists);
      if (r && !samePlace(r, at)) {
        this.entries[i] = r;
        this.index = i;
        this.navAt = now;
        return r;
      }
      this.entries.splice(i, 1);
      if (i < this.index) this.index--;
      if (dir < 0) i--;
    }
    return null;
  }
}
