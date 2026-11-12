import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, appHome, focused, notify, readTextFile, run, setShared, theme, nextCommand } from "herdr";
import { MAX_SECONDS, findTools, missing, buildLive, terminalSize, screenText, screenTerms, startLive, startRecording, stopRecording, cancelRecording, transcribe, saveClipboard, restoreClipboard, writeClipboard } from "./voice.js";

// Push-to-talk dictation for any terminal: `omarchy-voice.toggle` starts recording, the next one
// stops, writes it down with whisper.cpp and pastes the text into the focused terminal without Enter.
// Where the live helper builds (live.swift, macOS 26+), the words are typed into the terminal while
// they are said, and whisper.cpp corrects them at the stop.
// Placed once in the layout (a small mic in the top bar); the copy there takes the key.
// omarchy-voice-live, a float at the bottom of the panes, shows that it listens or writes.

const MODELS = () => `${appHome()}/data/whisper`;
const DIR = () => `${appHome()}/data/omarchy-voice`;
const FILE = () => `${DIR()}/recording.wav`;
const FAILED = () => `${DIR()}/failed.wav`;
const SAVED = () => `${DIR()}/clipboard`;
const SCRIPT = () => `${appHome()}/mods/omarchy-voice/pasteboard.jxa`;
const LIVE_SOURCE = () => `${appHome()}/mods/omarchy-voice/live.swift`;
const LIVE = () => `${DIR()}/live`;
// Terms to expect, one per line (names, English words): the person's own list. The helper gets it
// with the terms on the terminal's screen after it, in EXPECTED.
const WORDS = () => `${DIR()}/words.txt`;
const EXPECTED = () => `${FILE()}.words`;
// Shared with omarchy-voice-live: "listening", "writing" (whisper at work), or null.
const STATE = "omarchy-voice.state";
// How long whisper may take to correct a live dictation, in seconds.
const CORRECTING = 120;
const RED = "#ff5d6c";
const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
const say = (body, level = "error", timeout) => notify({ title: "Voice dictation", body, level, ...(timeout ? { timeout } : {}) });

export default class OmarchyVoice extends View {
  init(_props, cx) {
    this.state = "idle"; // idle | starting | recording | writing
    this.started = 0;
    this.stopWhenStarted = false;
    // A reload or crash may have left a recorder running; it would hold the microphone.
    cancelRecording(exec, FILE());
    setShared(STATE, null);
    // The live helper, once it is built (the first build takes a while); null until then.
    this.live = null;
    buildLive(exec, LIVE_SOURCE(), LIVE()).then((bin) => { this.live = bin; });
    // whisper and its model, found ahead so a dictation starts without looking for them.
    this.tools = null;
    findTools(exec, MODELS()).then((tools) => { this.tools = tools; });
    // Each step touches cx, so a reloaded mod's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "toggle") this.toggle(cx);
        cx.notify();
      }
    });
    cx.timer.every(1000, (cx) => {
      if (this.state !== "recording") return;
      // ffmpeg stops by itself at the cap; write down what it has instead of counting on.
      if (Date.now() - this.started >= MAX_SECONDS * 1000) {
        say(`Recording stopped at the ${MAX_SECONDS / 60}-minute limit; writing it down.`, "warning", 5000);
        this.toggle(cx);
      }
      cx.notify();
    });
  }

  async close() {
    if (this.state === "recording" || this.state === "starting") await cancelRecording(exec, FILE());
    setShared(STATE, null);
  }

  toggle(cx) {
    if (this.state === "idle") cx.spawn(async (cx) => { await this.start(cx); cx.notify(); });
    else if (this.state === "recording") cx.spawn(async (cx) => { await this.finish(cx); cx.notify(); });
    // A press before the recorder is up: stop as soon as it is.
    else if (this.state === "starting") this.stopWhenStarted = !this.stopWhenStarted;
  }

  async start(cx) {
    this.state = "starting";
    this.stopWhenStarted = false;
    setShared(STATE, "listening");
    cx.notify();
    // Typing as it goes, when the live helper is there and a terminal is focused to type into: the
    // helper starts as soon as the terminal's size is known, with the tools found last time (this.tools,
    // from init); the terms it should expect are gathered while it already listens.
    const terminal = this.live && focused()?.terminal;
    this.started = Date.now();
    const size = terminal ? await terminalSize(exec, terminal) : null;
    this.typing = Boolean(size);
    let trouble;
    if (this.typing) {
      this.expect(terminal);
      trouble = await startLive(exec, this.live, FILE(), terminal, size, EXPECTED(), this.tools).catch((e) => String(e?.message ?? e));
    } else {
      const tools = await findTools(exec, MODELS());
      const lack = missing(tools, MODELS());
      if (lack) {
        this.state = "idle";
        setShared(STATE, null);
        say(lack, "error", 10000);
        return;
      }
      this.tools = tools;
      trouble = await startRecording(exec, tools.ffmpeg, FILE()).catch((e) => String(e?.message ?? e));
    }
    if (trouble) {
      this.state = "idle";
      setShared(STATE, null);
      say(trouble, "error", 10000);
      return;
    }
    // A reload while starting ends this copy: its recorder must not keep the microphone.
    try { cx.notify(); } catch (e) { await cancelRecording(exec, FILE()); throw e; }
    this.state = "recording";
    if (!this.typing) this.started = Date.now();
    if (this.stopWhenStarted) await this.finish(cx);
  }

  // Writes the terms whisper should expect for this dictation: the person's list, then the ones on
  // the terminal's screen.
  async expect(terminal) {
    const [own, screen] = await Promise.all([readTextFile(WORDS()).catch(() => null), screenText(exec, terminal)]);
    const words = [...(own ?? "").split("\n").map((w) => w.trim()).filter(Boolean), ...screenTerms(screen)];
    await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s\\n" "$2" > "$1"', "x", EXPECTED(), [...new Set(words)].join("\n")]).catch(() => null);
  }

  async finish(cx) {
    this.state = "writing";
    setShared(STATE, "writing");
    cx.notify();
    let keep = false;
    try {
      // The live helper has typed the words; it ends once whisper has corrected them.
      if (this.typing) return await stopRecording(exec, FILE(), CORRECTING);
      await stopRecording(exec, FILE());
      const { text, error } = await transcribe(exec, this.tools, FILE());
      if (error) {
        // Keep the audio so a long dictation isn't lost to one failed run.
        keep = (await exec("mv", ["-f", FILE(), FAILED()]).catch(() => null))?.code === 0;
        return say(keep ? `${error} The recording is kept at ${FAILED()}.` : error);
      }
      if (!text) return say("Nothing was heard.", "warning", 4000);
      await this.paste(text);
    } catch (e) {
      say(`Dictation failed: ${e?.message ?? e}`);
    } finally {
      this.state = "idle";
      setShared(STATE, null);
      exec("rm", ["-f", FILE(), `${FILE()}.log`, EXPECTED()]).catch(() => null);
    }
  }

  // Into the focused terminal through the clipboard (terminal.paste pastes without Enter); then the
  // clipboard gets back everything it held, images and copied files included, or nothing if it was empty.
  // No cx past this point, so a reload mid-paste still restores the clipboard.
  async paste(text) {
    const saved = await saveClipboard(exec, SCRIPT(), "general", SAVED()).then(() => true, () => false);
    await writeClipboard(exec, "general", text);
    if (!focused()?.terminal) {
      say("No terminal is focused; the text is on the clipboard.", "info", 5000);
      return;
    }
    run("terminal.paste");
    // terminal.paste reads the clipboard when it runs; wait a moment before putting the old one back.
    await exec("sleep", ["0.5"]);
    if (!saved) return say("Pasted, but the earlier clipboard couldn't be saved, so it wasn't put back.", "warning", 5000);
    await restoreClipboard(exec, SCRIPT(), "general", SAVED())
      // The saved copy may hold anything that was copied; it goes once it is back.
      .then(() => exec("rm", ["-rf", SAVED()]))
      .catch((e) => say(`Pasted, but the earlier clipboard couldn't be put back: ${e?.message ?? e}`, "warning"));
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
