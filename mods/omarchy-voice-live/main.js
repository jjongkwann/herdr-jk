import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, hc, focused, panes, placement, props, shared, theme, openOverlay, closeOverlay } from "herdr";
import { inputRow, bubbleSpot } from "./spot.js";

// What omarchy-voice is doing, like macOS dictation's bubble: a mic and the language while it
// listens, a loader while whisper writes the words down. Nothing while it is idle.
// Two floats on the node that holds the tab, both this mod:
//   { "floating": [{ "id": "voice-live", "content": { "mod": "omarchy-voice-live" }, "edge": "bottom", "align": "center" },
//                  { "id": "voice-anchor", "content": { "mod": "omarchy-voice-live" }, "edge": "top", "align": "center" }] }
// The top one draws nothing; its spot is the node's top edge. The bottom one opens the bubble as a
// small window just above the line the focused terminal takes its input on (spot.js), and moves it
// as that line moves. Where that can't be worked out (a split tab), it draws the bubble itself, at
// the bottom of the node.

const STATE = "omarchy-voice.state";
const RED = "#ff5d6c";
// The letter macOS shows for a language.
const LETTER = { ko: "한", en: "EN", ja: "あ", zh: "中" };
// The tab node's pane frame in layouts/omarchy.json: border, header and terminal padding, in px.
const FRAME = { border: 2, header: 30, padding: 12 };
const SIZE = { width: 64, height: 30 };
// How far in from its node's edge Herdr puts a float.
const INSET = 12;

export default class OmarchyVoiceLive extends View {
  init(_props, cx) {
    this.role = props()?.bubble ? "bubble" : placement()?.edge === "top" ? "anchor" : "keeper";
    if (this.role === "anchor") return;
    this.letter = "";
    this.dim = false;
    // The language dictation listens in: macOS dictation's (live.swift reads the same setting).
    exec("defaults", ["read", "com.apple.speech.recognition.AppleSpeechRecognition.prefs", "DictationIMPreferredLanguageIdentifiers"])
      .then((r) => {
        const code = /"?([a-z]{2,3})[_-]/i.exec(r.stdout ?? "")?.[1]?.toLowerCase();
        this.letter = code ? LETTER[code] ?? code.toUpperCase() : "";
        cx.notify();
      }).catch(() => null);
    // A slow pulse while it is on.
    cx.timer.every(600, (cx) => {
      if (!shared(STATE)) return;
      this.dim = !this.dim;
      cx.notify();
    });
    if (this.role !== "keeper") return;
    this.bubble = null;   // the open window's id
    this.at = null;       // where it is
    this.node = null;     // the tab node's edges, read once per dictation
    this.fallback = false;
    this.busy = false;
    cx.timer.every(300, (cx) => this.follow(cx));
  }

  async close() {
    this.hide();
  }

  // Opens, moves or closes the bubble to match what omarchy-voice is doing and where the input is.
  follow(cx) {
    if (!shared(STATE)) {
      this.hide();
      this.node = null;
      if (this.fallback) { this.fallback = false; cx.notify(); }
      return;
    }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const spot = await this.spot().catch(() => null);
        if (!shared(STATE)) return;
        const fallback = !spot;
        if (fallback !== this.fallback) { this.fallback = fallback; cx.notify(); }
        if (!spot) return this.hide();
        if (this.bubble && this.at.x === spot.x && this.at.y === spot.y) return;
        this.hide();
        this.bubble = openOverlay({ mod: "omarchy-voice-live", props: { bubble: true }, kind: "window", frame: "none", width: SIZE.width, height: SIZE.height, at: spot });
        this.at = spot;
      } finally {
        this.busy = false;
      }
    });
  }

  // The bubble's spot for the focused terminal, or null when its place on screen isn't known: it
  // must be the only pane shown in the tab, so it fills the node.
  async spot() {
    const f = focused();
    if (!f?.terminal) return null;
    const shown = panes().filter((p) => p.tab === f.tab);
    if (shown.length !== 1 && !shown.some((p) => p.zoomed)) return null;
    this.node ??= await this.edges();
    if (!this.node) return null;
    const [got, read] = await Promise.all([hc(["get", f.terminal, "--json"]), hc(["read", f.terminal, "--json"])]);
    const rows = JSON.parse(got.stdout).rows;
    const row = inputRow(JSON.parse(read.stdout).text.split("\n"));
    if (!(rows > 0) || row < 0) return null;
    return bubbleSpot(this.node, rows, row, FRAME, SIZE);
  }

  // The tab node's top, bottom and middle, from where Herdr put the two floats; null if unknown.
  async edges() {
    const r = await exec("herdr-app", ["status"]);
    const floats = JSON.parse(r.stdout).floats ?? {};
    const low = floats["voice-live"]?.bounds, high = floats["voice-anchor"]?.bounds;
    if (!low || !high) return null;
    return { top: high[1] - INSET, bottom: low[1] + low[3] + INSET, centerX: low[0] + low[2] / 2 };
  }

  hide() {
    if (this.bubble) closeOverlay(this.bubble);
    this.bubble = null;
    this.at = null;
  }

  pill(state, t) {
    const writing = state === "writing";
    return h_flex().gap(6).items_center().text_size(13).text_color(t.foreground)
      .child(svg(`mods/omarchy-voice-live/${writing ? "loader" : "mic"}.svg`).size(15)
        .text_color(writing ? t.accent : RED).opacity(this.dim ? 0.45 : 1))
      .when(Boolean(this.letter), (el) => el.child(div().child(this.letter)));
  }

  render() {
    const state = shared(STATE);
    if (this.role === "anchor" || !state) return div();
    const t = theme();
    // In its own window: draws its own frame, like Herdr's around a float.
    if (this.role === "bubble") {
      return h_flex().id("omarchy-voice-bubble").size_full().justify_center().items_center()
        .bg(t.popover).border_1().border_color(t.border).rounded(10)
        .child(this.pill(state, t));
    }
    if (!this.fallback) return div();
    return h_flex().id("omarchy-voice-live").px(10).py(3).child(this.pill(state, t));
  }
}
