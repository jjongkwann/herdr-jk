import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, appHome, focused, notify, run, theme, nextCommand } from "herdr";
import { findTools, missing, startRecording, stopRecording, cancelRecording, transcribe } from "./voice.js";

// Push-to-talk dictation for any terminal: `omarchy-voice.toggle` starts recording, the next one
// stops, writes it down with whisper.cpp and pastes the text into the focused terminal without Enter.
// Placed once in the layout (a small mic in the top bar); the copy there takes the key.

const MODELS = () => `${appHome()}/data/whisper`;
const FILE = () => `${appHome()}/data/omarchy-voice/recording.wav`;
const RED = "#ff5d6c";
const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

// pbcopy/pbpaste read and write UTF-8 only with a UTF-8 locale; Herdr's environment may have none.
const UTF8 = 'export LC_ALL=en_US.UTF-8; ';
const readClipboard = () => exec("sh", ["-c", UTF8 + "pbpaste"]).then((r) => r.stdout).catch(() => "");
const writeClipboard = (text) => exec("sh", ["-c", UTF8 + 'printf %s "$1" | pbcopy', "x", text]);

export default class OmarchyVoice extends View {
  init(_props, cx) {
    this.state = "idle"; // idle | starting | recording | writing
    this.started = 0;
    // A reload or crash may have left a recorder running; it would hold the microphone.
    cancelRecording(exec, FILE());
    // Each step touches cx, so a reloaded mod's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "toggle") this.toggle(cx);
        cx.notify();
      }
    });
    cx.timer.every(1000, (cx) => { if (this.state === "recording") cx.notify(); });
  }

  async close() {
    if (this.state === "recording" || this.state === "starting") await cancelRecording(exec, FILE());
  }

  toggle(cx) {
    if (this.state === "idle") cx.spawn(async (cx) => { await this.start(cx); cx.notify(); });
    else if (this.state === "recording") cx.spawn(async (cx) => { await this.finish(cx); cx.notify(); });
  }

  async start(cx) {
    this.state = "starting";
    cx.notify();
    const tools = await findTools(exec, MODELS());
    const lack = missing(tools, MODELS());
    if (lack) {
      this.state = "idle";
      notify({ title: "Voice dictation", body: lack, level: "error", timeout: 10000 });
      return;
    }
    this.tools = tools;
    const trouble = await startRecording(exec, tools.ffmpeg, FILE()).catch((e) => String(e?.message ?? e));
    if (trouble) {
      this.state = "idle";
      notify({ title: "Voice dictation", body: trouble, level: "error", timeout: 10000 });
      return;
    }
    this.state = "recording";
    this.started = Date.now();
  }

  async finish(cx) {
    this.state = "writing";
    cx.notify();
    try {
      await stopRecording(exec, FILE());
      const { text, error } = await transcribe(exec, this.tools, FILE());
      if (error) return notify({ title: "Voice dictation", body: error, level: "error" });
      if (!text) return notify({ title: "Voice dictation", body: "Nothing was heard.", level: "warning", timeout: 4000 });
      await this.paste(text, cx);
    } catch (e) {
      notify({ title: "Voice dictation", body: `Dictation failed: ${e?.message ?? e}`, level: "error" });
    } finally {
      this.state = "idle";
      exec("rm", ["-f", FILE(), `${FILE()}.log`]).catch(() => null);
    }
  }

  // Into the focused terminal through the clipboard (terminal.paste pastes without Enter), then the
  // clipboard's earlier text comes back. With no terminal focused the text stays on the clipboard.
  async paste(text, cx) {
    const before = await readClipboard();
    await writeClipboard(text);
    if (!focused()?.terminal) {
      notify({ title: "Voice dictation", body: "No terminal is focused; the text is on the clipboard.", level: "info", timeout: 5000 });
      return;
    }
    run("terminal.paste");
    // terminal.paste reads the clipboard when it runs; wait a moment before putting the old text back.
    await cx.sleep(500);
    if (before) await writeClipboard(before).catch(() => null);
  }

  render(cx) {
    const t = theme();
    const rec = this.state === "recording";
    const busy = this.state === "writing" || this.state === "starting";
    const secs = Math.floor((Date.now() - this.started) / 1000);
    const label = rec ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : busy ? "…" : null;
    return h_flex().id("omarchy-voice").size_full().items_center().justify_center().bg(t.chrome).text_size(12)
      .child(own(h_flex().id("mic").h_full().px(8).gap(4).items_center().cursor_pointer()
        .text_color(rec ? RED : busy ? t.foreground : t.dim)
        .hover((s) => s.bg(t.hover).text_color(rec ? RED : t.foreground))
        .on_click((_e, cx) => this.toggle(cx))
        .child(svg("mods/omarchy-voice/mic.svg").size(14))
        .when(Boolean(label), (el) => el.child(div().child(label)))));
  }
}
