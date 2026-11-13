// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "omarchy-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
//
// A pane showing a herdr-browser page gets the browser's toolbar instead, in
// the look of Herdr UI's browser tabs: back, forward, reload, the address,
// zoom, Annotate and open-in-browser. Annotating shows the browser-notes
// panel in the layout's right-hand stack.
//
// Agent panes (Claude Code, Codex) get a Chat | Terminal switch when Shepherdr's `chat` mod is
// installed. Chat puts the `chat` mod in the agent pane's exact spot: it splits beside the
// agent's pane, then the agent's terminal is parked (it keeps running, without a pane), so the
// chat takes the whole slot. Terminal does the reverse. The agent's core label
// herdr.chat=<chat pane> says which chat shows which agent; omarchy-agents and omarchy-spaces
// read it to keep listing the parked agent. A chat pane wears its agent's header, and its ✕
// ends the agent after asking. "omarchy-pane.toggle" switches the focused pane.
// A space's Assistant tab opens in Terminal view: its chat with no agent yet, once shown, has
// Shepherdr's chat start the agent, then swaps to its terminal (assistant.js).
// Adapted from Shepherdr's pane-chat (MIT, see NOTICE).

import { View, div, svg, image } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { panes, terminals, spaces, machines, props, run, theme, home, exec, hc, notify, nextCommand, readTextFile, appHome, layout, shared, setShared, window } from "herdr";
import { act, readLive, watchLive, touches } from "./browser/client.js";
import { assistantStep, slotOf } from "./assistant.js";

const CHAT = "chat";
const LABEL = "herdr.chat";
// When a toggle last swapped a pane (every copy of this build shares it).
let lastSwap = 0;
// Whether Shepherdr's chat mod is installed, looked up once for every copy. Without it there
// is no switch.
let chatInstalled = false;
let chatCheck = null;
// Each Assistant chat's record for assistantStep, by pane (every copy of this build shares it).
const assistantMemos = new Map();

// Chat reads Claude Code's and Codex's own session logs; other agents have no chat.
const chatty = (p) => Boolean(p?.terminal) && (["claude-code", "codex"].includes(p.app) || ["claude", "codex"].includes(p.program?.key));

// Labels hold ids local to the terminal's machine; the app shows another machine's ids as
// "<machine>/<id>". Reading, a label is qualified with its terminal's machine (one already
// prefixed is kept); writing, the prefix is stripped.
const machineOf = (address) => (String(address ?? "").includes("/") ? address.split("/")[0] : null);
const qualify = (machine, id) => (machine && id && !id.includes("/") ? `${machine}/${id}` : id);
const chatPaneOf = (k) => qualify(machineOf(k.address), k.labels?.[LABEL] ?? null);
const local = (terminal, pane) => {
  const m = machineOf(terminal);
  return m && pane.startsWith(`${m}/`) ? pane.slice(m.length + 1) : pane;
};

// The chat pane showing a terminal, if one is open.
function chatOf(terminal) {
  const k = terminals().find((x) => x.address === terminal);
  const c = k && chatPaneOf(k);
  return c && panes().some((p) => p.pane === c && p.mod === CHAT) ? c : null;
}

// The live agent a chat pane shows (one terminals() copy: the header reads it once per render).
const agentEntry = (chat) => terminals().find((x) => x.state === "live" && chatPaneOf(x) === chat) ?? null;
const agentOf = (chat) => agentEntry(chat)?.address ?? null;

// A parked agent, shown in a chat pane: what the header shows for it.
function parked(k) {
  const st = ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : null;
  return { terminal: k.address, program: k.program, status: st, cwd: k.foreground?.cwd ?? k.cwd ?? null, title: k.title ?? "" };
}

// One app command, waited for (the swap's steps must go in order).
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${name} failed`);
  return out;
}

const failed = (e) => String(e?.message ?? e ?? "").trim() || "Something went wrong.";

// The sizes of a pane and its siblings (pane-size.py): the swap's split and removal shift a row's
// widths, so they are read first and put back once the swap is done. Best effort.
const SIZE = () => `${appHome()}/mods/omarchy-pane/pane-size.py`;
async function rowSizes(pane) {
  const m = machineOf(pane);
  const r = await exec("python3", [SIZE(), "get", pane, ...(m ? ["--machine", m] : [])]);
  try { return r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}
function carrySizes(from, to, sizes) {
  if (!from || !to || !sizes) return;
  const m = machineOf(to);
  const args = [SIZE(), "carry", from, to, JSON.stringify(sizes), ...(m ? ["--machine", m] : [])].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  exec("sh", ["-c", `python3 ${args} >/dev/null 2>&1 &`]);
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// A home folder on any machine (macOS, Linux or Windows), so a remote one shortens to "~" too.
const HOME = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/;

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd.replace(HOME, "~");
}

// What the address field shows: a local page by its path, the rest by URL.
function shown(live) {
  if (!live || live.url === "about:blank") return "";
  return live.local ? live.display : live.url;
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return findNode(node.root, id);
}

// The pane frame may be rounded in the layout: the header's top corners follow, inside its border.
function headRadius() {
  const pane = findNode(layout(), "main")?.content?.pane;
  return Math.max(0, (pane?.radius ?? 0) - (pane?.border?.width ?? 0));
}

// The system's browser: Windows has no `open`, and Linux distros like Arch only ship `xdg-open`.
function openOutside(url) {
  if (/^[a-z]:[\\/]/i.test(home())) exec("explorer", [url]);
  else exec(window()?.platform === "linux" ? "xdg-open" : "open", [url]);
}

const BROWSER = "mods/omarchy-pane/browser";

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.terminal = props()?.terminal || null;
    this.live = null;
    this.flash = null;
    this.typing = false;
    this.ending = false;
    chatCheck ??= readTextFile(`${appHome()}/mods/${CHAT}/mod.json`).then((text) => text != null, () => false);
    cx.spawn(async (cx) => {
      chatInstalled = await chatCheck;
      cx.notify();
    });
    // A copy just started (the swap's new pane) may still be handed the toggle that made it:
    // it would swap straight back. Toggles go to copies at least 2 s old, one swap per 3 s.
    this.born = Date.now();
    // "omarchy-pane.toggle" (a key, or `herdr-app do`): the focused pane switches. At most 5 s
    // per wait, so a reload's old build ends at its next cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const self = this.me();
        if (c !== "toggle" || !self?.focused || !chatInstalled) continue;
        if (Date.now() - this.born < 2000 || Date.now() - lastSwap < 3000) continue;
        lastSwap = Date.now();
        if (self.mod === CHAT) { if (agentOf(self.pane)) this.toTerminal(self.pane, cx); }
        else if (chatty(self)) this.toChat(self, cx);
      }
    });
    this.address = InputState.new({ placeholder: "Enter an address" });
    this.address.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.address.on("blur", (_e, cx) => {
      this.typing = false;
      this.address.set_value(shown(this.live));
      cx.notify();
    });
    this.address.on("submit", (_e, cx) => {
      const typed = this.address.value().trim();
      if (typed) act(this.terminal, "navigate", { url: typed });
      run("pane.focus", { pane: props()?.pane });
      cx.notify();
    });
    if (!this.terminal) return;
    cx.spawn(async (cx) => { await this.reload(cx); });
    watchLive(cx, this, async (changed, cx) => {
      if (touches(changed, this.terminal)) await this.reload(cx);
    });
  }

  async close() {
    this.closed = true;
    if (!this.live) return;
    this.hideNotes();
    await act(this.terminal, "native", { on: false });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  async reload(cx) {
    const live = await readLive(this.terminal);
    if (this.closed) return; // closing gave the toolbar back: don't take it again
    const before = this.live;
    this.live = live;
    if (!live) { if (before) cx.notify(); return; }
    // A focused field keeps what the user typed, but follows the page while it
    // still shows the old address.
    if (!this.typing || this.address.value() === shown(before)) this.address.set_value(shown(live));
    if (!before && live.url === "about:blank") this.address.focus();
    if (before && live.addressSeq > (before.addressSeq || 0)) {
      this.address.focus();
      const text = this.address.value();
      this.address.set_selected_range({ start: 0, end: text.length });
    }
    if (before && live.toast && live.toast.seq !== before.toast?.seq) {
      const flash = live.toast;
      this.flash = flash;
      cx.timer.after(4000, (cx) => { if (this.flash === flash) { this.flash = null; cx.notify(); } });
    }
    if (live.annotating && !before?.annotating) this.showNotes();
    if (!live.annotating && before?.annotating) this.hideNotes();
    cx.notify();
    // This header draws the toolbar, so the terminal draws only the page. The
    // helper may be restarting: ask again until it takes.
    if (!live.native && !this.claiming && !this.closed) {
      this.claiming = true;
      const ok = await act(this.terminal, "native", { on: true });
      this.claiming = false;
      // Closed while the claim was on its way: give the toolbar back again.
      if (this.closed) { if (ok) await act(this.terminal, "native", { on: false }); return; }
      if (!ok) cx.timer.after(2000, (cx) => cx.spawn(async (cx) => { if (!this.closed) await this.reload(cx); }));
    }
  }

  // The notes live in the layout's right-hand stack while annotating; the
  // panel goes back to what it showed before afterwards.
  showNotes() {
    if (shared("browser.notes") !== this.terminal) {
      const panel = findNode(layout(), "panel");
      const stack = findNode(layout(), "panel-body");
      if (!findNode(layout(), "browser-notes")) return;
      if (!shared("browser.notes")) this.before = { hidden: !!panel?.hidden, active: stack?.active || "files" };
      setShared("browser.notes", this.terminal);
    }
    run("layout.select", { stack: "panel-body", child: "browser-notes" });
    run("layout.show", { id: "panel" });
  }

  hideNotes() {
    if (shared("browser.notes") !== this.terminal) return;
    setShared("browser.notes", null);
    const before = this.before || { hidden: true, active: "files" };
    if (before.active !== "browser-notes") run("layout.select", { stack: "panel-body", child: before.active });
    if (before.hidden) run("layout.hide", { id: "panel" });
  }

  // Terminal → Chat: the chat takes this agent pane's spot.
  toChat(p, cx) {
    const open = chatOf(p.terminal);
    if (open) { run("pane.focus", { pane: open }); return; }
    if (this.busy) return;
    this.busy = true;
    const terminal = p.terminal;
    cx.spawn(async (cx) => {
      try {
        const sizes = await rowSizes(p.pane);
        const out = await app("pane.split", { direction: "right", pane: p.pane, mod: CHAT, props: { terminal } });
        if (!out.pane) throw new Error("Herdr didn't open the chat");
        // The agent knows its chat: if that pane goes with its tab or space, omarchy-agents
        // ends the agent (its sweep), as closing its own pane would have.
        // On the terminal's machine, without the app's "<machine>/" prefix.
        await hc(["label", terminal, `${LABEL}=${local(terminal, out.pane)}`]);
        run("pane.focus", { pane: out.pane });
        // Last: parking removes this pane, and this header with it. The chat turns core keep
        // back on once the park has gone through.
        carrySizes(p.pane, out.pane, sizes);
        await app("terminal.park", { terminal });
      } catch (e) {
        notify({ title: "Chat didn't open", body: failed(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Chat → Terminal: the agent's terminal gets a pane beside the chat, then the chat closes,
  // so the terminal is back in the same spot.
  toTerminal(chat, cx) {
    const terminal = agentOf(chat);
    // Not running, or still in a pane of its own (a chat opened beside it): just close the chat.
    const own = terminal && panes().find((x) => x.terminal === terminal);
    if (!terminal || own) {
      const zoomed = panes().find((x) => x.pane === chat)?.zoomed;
      run("pane.close", { pane: chat });
      if (terminal) hc(["label", terminal, `${LABEL}=`]);
      if (own) { if (zoomed && own.zoomed) run("pane.zoom", { pane: own.pane }); run("pane.focus", { pane: own.pane }); }
      return;
    }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const sizes = await rowSizes(chat);
        await app("pane.focus", { pane: chat });
        const out = await app("terminal.keep", { terminal, place: "right" });
        // A keep that waits on the machine (pending) can still fail: the label and the chat stay
        // until the terminal has its pane, so the agent never runs unseen with neither.
        if (out.pending) {
          const until = Date.now() + 15000;
          while (!panes().some((x) => x.terminal === terminal)) {
            if (Date.now() > until) throw new Error("Herdr didn't give the terminal a pane");
            await cx.sleep(250);
          }
        }
        await hc(["label", terminal, `${LABEL}=`]);
        const back = out.pane ?? panes().find((x) => x.terminal === terminal)?.pane;
        if (back) run("pane.focus", { pane: back });
        // Last: closing the chat removes this header too.
        carrySizes(chat, back, sizes);
        await app("pane.close", { pane: chat });
      } catch (e) {
        notify({ title: "Terminal didn't come back", body: failed(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // An Assistant chat with no agent yet (assistant.js): once it has been shown a moment, Shepherdr's
  // chat starts its agent (shared "chat.startreq"); once that runs, its terminal takes the chat's
  // spot. Acts from a timer, never in the render itself.
  autoAssistant(self, cx) {
    // Only Assistant chats need the lists; one that had its agent here never starts another.
    if (assistantMemos.get(self.pane)?.had || !slotOf(self.pane, shared("coordinator.slots"))) return;
    const ps = panes();
    const step = assistantStep({ pane: self.pane, panes: ps, spaces: spaces(), terminals: terminals(),
      slots: shared("coordinator.slots"), machines: machines(), now: Date.now() }, assistantMemos.get(self.pane));
    if (Object.keys(step.memo).length) assistantMemos.set(self.pane, step.memo);
    else assistantMemos.delete(self.pane);
    if (assistantMemos.size > 16) for (const pane of assistantMemos.keys()) if (!ps.some((p) => p.pane === pane)) assistantMemos.delete(pane);
    if (step.do === "wait") {
      const at = Date.now() + step.ms;
      if (this.wakeAt && this.wakeAt > Date.now() && this.wakeAt <= at) return;
      this.wakeAt = at;
      cx.timer.after(step.ms + 50, (cx) => cx.notify());
    } else if (step.do === "start") {
      cx.timer.after(0, () => setShared("chat.startreq", { pane: self.pane, at: Date.now() }));
    } else if (step.do === "terminal") {
      cx.timer.after(0, (cx) => { lastSwap = Date.now(); this.toTerminal(self.pane, cx); });
    }
  }

  // A chat pane's ✕ does what an agent pane's does: ends the agent, and the pane goes. It asks
  // first, in the header itself (this.ending).
  closeChat(chat) {
    this.ending = false;
    const terminal = agentOf(chat);
    if (terminal) run("terminal.kill", { terminal });
    run("pane.close", { pane: chat });
  }

  // A 20 px text button for the header's "End …?" question.
  textButton(t, id, label, primary, onClick) {
    return div()
      .id(id)
      .h(20)
      .px(8)
      .flex_none()
      .flex()
      .items_center()
      .rounded(0)
      .border_1()
      .cursor_pointer()
      .when(primary, (e) => e.bg(t.blocked).border_color(t.blocked).text_color(t.background).hover((s) => s.bg(t.blocked + "d9")))
      .when(!primary, (e) => e.border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40")))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick();
        cx.notify();
      })
      .child(label);
  }

  // Chat | Terminal, two square segments; the one showing is filled.
  switcher(t, pane, chatMode, onChat, onTerminal) {
    const seg = (id, label, on, fn) => div()
      .id(id)
      .h_full()
      .px(8)
      .flex()
      .items_center()
      .when(on, (e) => e.bg(t.foreground + "2e").text_color(t.foreground))
      .when(!on, (e) => e.text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.foreground + "14").text_color(t.foreground)))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!on) fn(cx);
        cx.notify();
      })
      .child(label);
    return h_flex()
      .id(`ph-mode-${pane}`)
      .h(20)
      .flex_none()
      .rounded(0)
      .border_1()
      .border_color(t.border)
      .text_size(11)
      .child(seg(`ph-chat-${pane}`, "Chat", chatMode, onChat))
      .child(div().w(1).h_full().bg(t.border))
      .child(seg(`ph-term-${pane}`, "Terminal", !chatMode, onTerminal));
  }

  // A tab's only pane has nothing to zoom over.
  alone(p) {
    return panes().filter((other) => other.tab === p.tab).length === 1;
  }

  button(t, id, icon, command, args, fn = null) {
    return div()
      .id(id)
      .p(3)
      .rounded(0)
      .border_1()
      .border_color(t.surface)
      .text_color(t.dim)
      .hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (fn) fn(); else run(command, args);
        cx.notify();
      })
      .child(svg(`mods/omarchy-pane/${icon}.svg`).size(14));
  }

  // A 24 px toolbar button: an icon, or an icon and a label.
  tool(t, id, name, enabled, onClick, label, style) {
    const el = h_flex()
      .id(id)
      .h(24)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(0)
      .border_1()
      .border_color(t.surface)
      .gap(4)
      .text_color(enabled ? t.foreground : t.dim);
    const sized = label ? el.px(6) : el.w(24);
    const built = sized
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40")).on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      }))
      .child(svg(`${BROWSER}/${name}.svg`).size(label ? 13 : 14))
      .when(Boolean(label), (e) => e.child(label));
    return style ? style(built) : built;
  }

  browserHeader(t, p) {
    const live = this.live;
    const pane = p.pane;
    const term = this.terminal;
    const page = live.url && live.url !== "about:blank";
    const armed = live.annotating;
    const notes = live.notes?.length || 0;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(6)
      .gap(4)
      .items_center()
      .bg(t.surface)
      .rounded_t(headRadius())
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(this.tool(t, `bh-back-${pane}`, "arrow-left", live.back, () => act(term, "back")))
      .child(this.tool(t, `bh-fwd-${pane}`, "arrow-right", live.forward, () => act(term, "forward")))
      .child(live.loading
        ? this.tool(t, `bh-stop-${pane}`, "close", true, () => act(term, "stop"))
        : this.tool(t, `bh-reload-${pane}`, "refresh", page, () => act(term, "reload")))
      .child(h_flex()
        .id(`bh-address-${pane}`)
        .flex_1()
        .min_w(0)
        .h(24)
        .px(8)
        .items_center()
        .rounded(0)
        .border_1()
        .border_color(this.typing ? t.accent : t.border)
        .bg(t.background)
        .cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.stop_propagation())
        .on_key_down((e, cx) => {
          if (e.key !== "escape") return;
          this.address.set_value(shown(this.live));
          run("pane.focus", { pane });
          cx.notify();
        })
        .child(Input.new(this.address).w_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(this.flash), (el) => el.child(div()
        .flex_none()
        .max_w(240)
        .truncate()
        .px(4)
        .text_color(this.flash.error ? t.blocked : t.accent)
        .child(this.flash.message)))
      .when(live.zoom && live.zoom !== 100, (el) => el.child(h_flex()
        .id(`bh-zoom-${pane}`)
        .h(24)
        .px(6)
        .flex_none()
        .items_center()
        .rounded(0)
        .cursor_pointer()
        .text_color(t.foreground)
        .hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40"))
        .on_click((_e, cx) => { cx.stop_propagation(); act(term, "zoom", { zoom: 100 }); })
        .child(`${live.zoom}%`)))
      .child(this.tool(t, `bh-annotate-${pane}`, "pencil", page, () => act(term, "annotate", { on: !armed }), "Annotate",
        (el) => (armed ? el.bg(t.accent + "38") : el)
          // Unsent notes wait while the panel is closed: show how many.
          .when(!armed && notes > 0, (e) => e.child(div().h(16).min_w(16).px(4).rounded(0).flex().items_center().justify_center()
            .bg(t.ansi3).text_color(t.background).text_size(10).font_semibold().child(String(notes))))))
      .child(this.tool(t, `bh-open-${pane}`, "external", page && /^https?:/.test(live.url), () => openOutside(live.url)))
      // The pane controls show on hover in room kept for them, so the
      // toolbar doesn't shift under the pointer.
      .child(h_flex().w(101).flex_none().gap(4).items_center()
        .when(p.zoomed, (el) => el.justify_end()
          .child(this.button(t, `ph-z-${pane}`, "unzoom", "pane.zoom", { pane })))
        .when(this.hovered && !p.zoomed, (el) => el
          .child(div().w(1).h(16).mx(2).flex_none().bg(t.border))
          .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
          .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }))
          .when(!this.alone(p), (e) => e.child(this.button(t, `ph-z-${pane}`, "zoom", "pane.zoom", { pane })))));
  }

  render(cx) {
    const t = theme();
    const self = this.me();
    if (!self) return div();
    if (this.live && self.terminal === this.terminal) return this.browserHeader(t, self);
    // A chat pane wears its agent's header: its name, folder and status.
    const chatMode = self.mod === CHAT;
    if (chatMode && chatInstalled) this.autoAssistant(self, cx);
    const entry = chatMode ? agentEntry(self.pane) : null;
    const agent = entry?.address ?? null;
    const p = entry ? parked(entry) : self;
    // The icon names the program; the header says what it works on: its title, else the folder.
    const clean = (p.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    // A shell's title is often just its terminal address ("t4c"), which says nothing either.
    const own = clean && clean !== p.program?.name && clean !== "Claude Code" && clean !== p.terminal ? clean : "";
    const name = chatMode && !agent ? "Chat" : own || folder(p.cwd).split(/[\\/]/).filter(Boolean).pop() || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = self.pane;
    const canSwitch = chatInstalled && (chatMode ? Boolean(agent) : chatty(self));
    const prog = p.program?.name || "the agent";
    const asking = Boolean(agent) && this.ending;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .rounded_t(headRadius())
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; if (!hovered) this.ending = false; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd) !== name ? folder(p.cwd) : ""))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(0).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(0).bg(t.done)))
      // Ending a chat's agent asks first, in place of the hover buttons.
      .when(asking, el => el
        .child(div().flex_none().whitespace_nowrap().text_color(t.foreground).child(`End ${prog}?`))
        .child(this.textButton(t, `ph-end-no-${pane}`, "Cancel", false, () => { this.ending = false; }))
        .child(this.textButton(t, `ph-end-${pane}`, "End agent", true, () => this.closeChat(pane))))
      // A zoomed pane shows only its unzoom button, always.
      .when(self.zoomed && !asking, el => el.child(this.button(t, `ph-z-${pane}`, "unzoom", "pane.zoom", { pane })))
      .when(this.hovered && !self.zoomed && !asking, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(agent
          ? this.button(t, `ph-x-${pane}`, "close", null, null, () => { this.ending = true; }).tooltip(`End ${prog}`)
          : this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }))
        .when(!this.alone(self), (e) => e.child(this.button(t, `ph-z-${pane}`, "zoom", "pane.zoom", { pane }))))
      // After the hover buttons, so Chat | Terminal never moves under the pointer.
      .when(canSwitch, (el) => el.child(this.switcher(t, pane, chatMode,
        (cx) => this.toChat(self, cx),
        (cx) => this.toTerminal(pane, cx))));
  }
}
