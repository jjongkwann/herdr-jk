import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, shared, theme } from "herdr";

// What omarchy-voice is doing, like macOS dictation's bubble: a mic and the language while it
// listens, a loader while whisper writes the words down. A float at the bottom of the panes, under
// the input most programs keep there:
// { "floating": [{ "id": "voice-live", "content": { "mod": "omarchy-voice-live" }, "edge": "bottom", "align": "center" }] }
// on the node that holds the tab. Nothing while omarchy-voice is idle.

const STATE = "omarchy-voice.state";
const RED = "#ff5d6c";
// The letter macOS shows for a language.
const LETTER = { ko: "한", en: "EN", ja: "あ", zh: "中" };

export default class OmarchyVoiceLive extends View {
  init(_props, cx) {
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
  }

  render() {
    const state = shared(STATE);
    if (!state) return div();
    const t = theme();
    const writing = state === "writing";
    return h_flex().id("omarchy-voice-live").px(10).py(3).gap(6).items_center().text_size(13).text_color(t.foreground)
      .child(svg(`mods/omarchy-voice-live/${writing ? "loader" : "mic"}.svg`).size(15)
        .text_color(writing ? t.accent : RED).opacity(this.dim ? 0.45 : 1))
      .when(Boolean(this.letter), (el) => el.child(div().child(this.letter)));
  }
}
