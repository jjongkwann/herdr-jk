import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, theme } from "herdr";

// A sign that omarchy-voice is recording, with how long: a float in the layout
// ({ "floating": [{ "id": "voice-live", "content": { "mod": "omarchy-voice-live" }, "edge": "bottom", "align": "center" }] }).
// Nothing when no recording runs. The words themselves go into the terminal.

const RECORDING = "omarchy-voice.recording";
const RED = "#ff5d6c";

export default class OmarchyVoiceLive extends View {
  init(_props, cx) {
    cx.timer.every(1000, (cx) => { if (shared(RECORDING)) cx.notify(); });
  }

  render() {
    const started = shared(RECORDING);
    if (!started) return div();
    const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
    return h_flex().id("omarchy-voice-live").px(12).py(4).gap(8).items_center().text_size(13).text_color(theme().foreground)
      .child(div().size(8).rounded(4).bg(RED))
      .child(div().child(`Recording ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`));
  }
}
