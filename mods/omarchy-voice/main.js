import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, appHome, focused, notify, readTextFile, run, setShared, theme, nextCommand } from "herdr";
import { MAX_SECONDS, findTools, missing, buildLive, startRecording, stopRecording, cancelRecording, settledCount, transcribe, saveClipboard, restoreClipboard, writeClipboard } from "./voice.js";

// Push-to-talk dictation for any terminal: `omarchy-voice.toggle` starts recording, the next one
// stops, and the text goes into the focused terminal without Enter. Where the live helper builds
// (live.swift), it listens and the words are typed while they are said; elsewhere ffmpeg records and
// whisper.cpp writes the recording down once it has stopped.
// Placed once in the layout (a small mic in the top bar); the copy there takes the key.
// While it records, omarchy-voice-live (a float in the layout) says so.

const MODELS = () => `${appHome()}/data/whisper`;
const DIR = () => `${appHome()}/data/omarchy-voice`;
const FILE = () => `${DIR()}/recording.wav`;
const FAILED = () => `${DIR()}/failed.wav`;
const SAVED = () => `${DIR()}/clipboard`;
const SCRIPT = () => `${appHome()}/mods/omarchy-voice/pasteboard.jxa`;
const LIVE_SOURCE = () => `${appHome()}/mods/omarchy-voice/live.swift`;
const LIVE = () => `${DIR()}/live`;
const HEARD = () => `${FILE()}.txt`;
// Shared with omarchy-voice-live: when the running recording started (ms), or false.
const RECORDING = "omarchy-voice.recording";
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
    setShared(RECORDING, false);
    // The live preview's helper, once it is built (the first build takes a while); null until then.
    this.live = null;
    buildLive(exec, LIVE_SOURCE(), LIVE()).then((bin) => { this.live = bin; });
    // Each step touches cx, so a reloaded mod's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "toggle") this.toggle(cx);
        cx.notify();
      }
    });
    // The live words: type the ones that have settled.
    cx.timer.every(100, (cx) => {
      if (this.state !== "recording" || !this.typing || this.reading) return;
      this.reading = true;
      cx.spawn(async () => {
        try {
          const words = await this.heard();
          if (this.state !== "recording" || !focused()?.terminal) return;
          const count = settledCount(words, this.since, Date.now());
          if (count > this.typed) {
            this.type(`${words.slice(this.typed, count).join(" ")} `);
            this.typed = count;
          }
        } finally { this.reading = false; }
      });
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
    setShared(RECORDING, false);
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
    cx.notify();
    // Typing as it goes, when the live helper is there; else ffmpeg and whisper.
    this.typing = Boolean(this.live);
    if (!this.typing) {
      const tools = await findTools(exec, MODELS());
      const lack = missing(tools, MODELS());
      if (lack) {
        this.state = "idle";
        say(lack, "error", 10000);
        return;
      }
      this.tools = tools;
    }
    const trouble = await startRecording(exec, this.tools?.ffmpeg, FILE(), this.live).catch((e) => String(e?.message ?? e));
    if (trouble) {
      this.state = "idle";
      say(trouble, "error", 10000);
      return;
    }
    // A reload while starting ends this copy: its recorder must not keep the microphone.
    try { cx.notify(); } catch (e) { await cancelRecording(exec, FILE()); throw e; }
    this.state = "recording";
    this.started = Date.now();
    this.typed = 0;
    this.since = [];
    this.reading = false;
    this.pasting = Promise.resolve();
    this.saved = null;
    setShared(RECORDING, this.started);
    if (this.stopWhenStarted) await this.finish(cx);
  }

  async finish(cx) {
    this.state = "writing";
    setShared(RECORDING, false);
    cx.notify();
    let keep = false;
    try {
      await stopRecording(exec, FILE());
      if (this.typing) {
        // The live helper's last words, after the ones already typed.
        const words = await this.heard();
        if (!words.length) return say("Nothing was heard.", "warning", 4000);
        this.type(words.slice(this.typed).join(" "));
        return await this.typedAll();
      }
      const { text, error } = await transcribe(exec, this.tools, FILE());
      if (error) {
        // Keep the audio so a long dictation isn't lost to one failed run.
        keep = (await exec("mv", ["-f", FILE(), FAILED()]).catch(() => null))?.code === 0;
        return say(keep ? `${error} The recording is kept at ${FAILED()}.` : error);
      }
      if (!text) return say("Nothing was heard.", "warning", 4000);
      this.type(text);
      await this.typedAll();
    } catch (e) {
      say(`Dictation failed: ${e?.message ?? e}`);
    } finally {
      this.state = "idle";
      exec("rm", ["-f", FILE(), `${FILE()}.log`, `${FILE()}.txt`]).catch(() => null);
    }
  }

  // What the live helper has heard so far, as words.
  async heard() {
    return ((await readTextFile(HEARD()).catch(() => null)) ?? "").split(/\s+/).filter(Boolean);
  }

  // Types `text` into the focused terminal, after what is already on its way: through the clipboard
  // (terminal.paste pastes without Enter). The clipboard's own content is set aside at the first one.
  type(text) {
    if (!text) return;
    this.pasting = this.pasting.then(async () => {
      this.saved ??= await saveClipboard(exec, SCRIPT(), "general", SAVED()).then(() => true, () => false);
      await writeClipboard(exec, "general", text);
      if (!focused()?.terminal) {
        say("No terminal is focused; the text is on the clipboard.", "info", 5000);
        this.saved = null;
        return;
      }
      run("terminal.paste");
      // terminal.paste reads the clipboard when it runs; wait a moment before changing it again.
      await exec("sleep", ["0.15"]);
    }).catch((e) => say(`Dictation failed: ${e?.message ?? e}`));
  }

  // Once everything is typed, the clipboard gets back everything it held, images and copied files
  // included, or nothing if it was empty. No cx here, so a reload mid-paste still restores it.
  async typedAll() {
    await this.pasting;
    if (this.saved === null) return;
    if (!this.saved) return say("Pasted, but the earlier clipboard couldn't be saved, so it wasn't put back.", "warning", 5000);
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
