// Recording and transcription for omarchy-voice, all on this computer: ffmpeg records the default
// microphone (AVFoundation) to a 16 kHz mono WAV, whisper.cpp writes it down. Every function takes the
// `exec` to run programs with (herdr's in the mod, Node's in tests), so this file imports nothing.
// Where live.swift builds (macOS 26+), that helper listens instead and types the words into the
// terminal while they are said, then has whisper.cpp correct them (see live.swift).
// The flow and the clean-up of whisper's output follow Shepherdr's chat dictation (mods/chat/dictate.js, MIT).

// The model the mod looks for first (multilingual, good Korean, a few seconds on Apple Silicon).
export const MODEL = "ggml-large-v3-turbo-q5_0.bin";
// Longest recording; ffmpeg stops by itself after this many seconds.
export const MAX_SECONDS = 300;

const BREW = ["/opt/homebrew/bin", "/usr/local/bin"];

// The first program of `names` that runs here (the PATH, then Homebrew's folders), or null.
async function which(exec, names) {
  const r = await exec("sh", ["-c",
    'for n in "$@"; do w=$(command -v "$n") && { echo "$w"; exit 0; }; for d in ' + BREW.join(" ") + '; do [ -x "$d/$n" ] && { echo "$d/$n"; exit 0; }; done; done; true',
    "x", ...names]).catch(() => null);
  return r?.stdout.trim() || null;
}

// The model to use from a folder listing: MODEL if present, else another ggml model (never a
// Core ML encoder or a partial download), else null.
export function pickModel(names) {
  if (names.includes(MODEL)) return MODEL;
  return names.filter((n) => /^ggml-.+\.bin$/.test(n) && !/encoder/.test(n)).sort()[0] ?? null;
}

// What dictation needs: { ffmpeg, whisper, model } with null for whatever is missing.
export async function findTools(exec, modelDir) {
  const [ffmpeg, whisper, listing] = await Promise.all([
    which(exec, ["ffmpeg"]),
    which(exec, ["whisper-cli", "whisper-cpp"]),
    exec("ls", ["-1", modelDir]).then((r) => r.stdout).catch(() => ""),
  ]);
  const name = pickModel(listing.split("\n").map((l) => l.trim()).filter(Boolean));
  return { ffmpeg, whisper, model: name ? `${modelDir}/${name}` : null };
}

// One sentence on what is missing and how to get it, or null when everything is there.
export function missing(tools, modelDir) {
  const lacks = [];
  if (!tools.ffmpeg) lacks.push("ffmpeg (brew install ffmpeg)");
  if (!tools.whisper) lacks.push("whisper.cpp (brew install whisper-cpp)");
  if (!tools.model) lacks.push(`a whisper model in ${modelDir} (e.g. ${MODEL} from huggingface.co/ggerganov/whisper.cpp)`);
  return lacks.length ? `Dictation needs ${lacks.join(", ")}.` : null;
}

// Shell lines that set $p to the recorder's pid, only while that pid is still the recorder of "$1":
// a pid file left by a crash may name an unrelated process by now.
const OURS = 'ours() { p=$(cat "$1.pid" 2>/dev/null) && ps -ww -p "$p" -o args= 2>/dev/null | grep -qF -- "$1"; }; ';

// Starts ffmpeg in the background, writing `file`; its pid goes to `file.pid`, its log to `file.log`.
// ffmpeg quits at once when the microphone is refused or missing, so the shell watches it for 0.8 s.
// Resolves with null once it is recording, or with what went wrong.
export async function startRecording(exec, ffmpeg, file) {
  const r = await exec("sh", ["-c",
    'mkdir -p "$(dirname "$2")" && rm -f "$2" "$2.log" || exit 2; ' +
    'nohup "$1" -nostdin -hide_banner -loglevel error -f avfoundation -i ":default" -t "$3" -ac 1 -ar 16000 -c:a pcm_s16le -y "$2" </dev/null >"$2.log" 2>&1 & ' +
    'p=$!; echo $p > "$2.pid"; i=0; while [ $i -lt 8 ]; do sleep 0.1; kill -0 $p 2>/dev/null || { rm -f "$2.pid"; cat "$2.log"; exit 1; }; i=$((i+1)); done',
    "x", ffmpeg, file, String(MAX_SECONDS)]);
  return r.code === 0 ? null : recorderTrouble(r.stdout);
}

// Builds the live helper from live.swift when it is missing or older than its source. Resolves with
// its path, or null where it can't be built (no swiftc, or macOS before 26).
export async function buildLive(exec, source, bin) {
  const r = await exec("sh", ["-c",
    '[ "$2" -nt "$1" ] && exit 0; command -v swiftc >/dev/null || exit 1; mkdir -p "$(dirname "$2")" && swiftc -O -parse-as-library -o "$2" "$1" >"$2.log" 2>&1',
    "x", source, bin], { timeout: 300000 }).catch(() => null);
  return r?.code === 0 ? bin : null;
}

// A terminal's size in cells, { cols, rows }, or null.
export async function terminalSize(exec, terminal) {
  const r = await exec("hc", ["get", terminal, "--json"]).catch(() => null);
  try {
    const { cols, rows } = JSON.parse(r.stdout);
    return cols > 0 && rows > 0 ? { cols, rows } : null;
  } catch { return null; }
}

// Terms to expect in what is said, from what a terminal shows: its words in Latin letters (names,
// commands, files), the most frequent first, at most `limit`. Talk is mostly about what is on screen.
export function screenTerms(text, limit = 40) {
  const count = new Map();
  for (const word of text.match(/[A-Za-z][A-Za-z0-9+#._-]*[A-Za-z0-9+#]/g) ?? []) {
    // Short all-lowercase words are mostly English filler ("the", "and", "with").
    if (word.length < 5 && word === word.toLowerCase() && !/[^a-z]/.test(word)) continue;
    count.set(word, (count.get(word) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

// What `terminal` shows now, with `lines` of its history, as text ("" when it can't be read).
export async function screenText(exec, terminal, lines = 200) {
  const r = await exec("hc", ["read", terminal, "--lines", String(lines)]).catch(() => null);
  return r?.code === 0 ? r.stdout : "";
}

// Starts the live helper `bin` in the background, typing into `terminal` (of `size`) and keeping the
// audio in `file`; its pid goes to `file.pid`, its log to `file.log`. `words` is the file of terms to
// expect (it may be written after this; it is read at the stop); with `tools.whisper` and
// `tools.model`, whisper corrects the text once it is stopped.
// Resolves with null once it is listening, or with what went wrong.
export async function startLive(exec, bin, file, terminal, size, words, tools) {
  const r = await exec("sh", ["-c",
    'f="$1"; bin="$2"; shift 2; mkdir -p "$(dirname "$f")" && rm -f "$f" "$f.log" || exit 2; ' +
    'nohup "$bin" "$@" </dev/null >"$f.log" 2>&1 & ' +
    'p=$!; echo $p > "$f.pid"; i=0; while [ $i -lt 8 ]; do sleep 0.1; kill -0 $p 2>/dev/null || { rm -f "$f.pid"; cat "$f.log"; exit 1; }; i=$((i+1)); done',
    "x", file, bin, terminal, String(size.cols), String(size.rows), file, words,
    ...(tools?.whisper && tools.model ? [tools.whisper, tools.model] : [])]);
  return r.code === 0 ? null : recorderTrouble(r.stdout);
}

// Whether the recorder for `file` is still running (it stops by itself at MAX_SECONDS).
export async function recording(exec, file) {
  const r = await exec("sh", ["-c", OURS + 'ours "$1"', "x", file]).catch(() => null);
  return r?.code === 0;
}

// Stops the recorder so it finishes (ffmpeg the WAV; the live helper its typing, whisper included),
// and waits for it to exit, at most `seconds`. SIGTERM, not SIGINT: a job started in the background by
// a non-interactive shell starts with SIGINT ignored.
export async function stopRecording(exec, file, seconds = 2) {
  await exec("sh", ["-c", OURS +
    'if ours "$1"; then kill -TERM "$p"; i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt "$2" ]; do sleep 0.1; i=$((i+1)); done; ours "$1" && kill -KILL "$p"; fi; rm -f "$1.pid"; true',
    "x", file, String(seconds * 10)], { timeout: (seconds + 5) * 1000 });
}

// Throws a recording away (the mod reloading or closing mid-recording).
export async function cancelRecording(exec, file) {
  await exec("sh", ["-c", OURS + 'ours "$1" && kill -TERM "$p"; rm -f "$1.pid" "$1" "$1.log" "$1.words"; true', "x", file]).catch(() => null);
}

// Writes `file` down. Resolves with { text } ("" when nothing was heard) or { error }.
export async function transcribe(exec, tools, file) {
  const r = await exec(tools.whisper, ["-m", tools.model, "-f", file, "-l", "auto", "-nt", "-np", "-t", "8"], { timeout: 600000 })
    .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
  if (r.code !== 0) return { error: whisperTrouble(r.stderr) };
  return { text: clean(r.stdout) };
}

// What went wrong with the recorder, in plain words with what to do.
export function recorderTrouble(log) {
  if (/not authorized|permission|denied/i.test(log)) return "Herdr may not use the microphone. Allow it in System Settings › Privacy & Security › Microphone, then try again.";
  if (/no such|not found|input\/output|could not|failed to/i.test(log)) return "No microphone was found. Check the input device, then try again.";
  return "Recording didn't start. Check the microphone, then try again.";
}

// What went wrong with whisper.cpp. Only its "error:" lines count: it logs loading the model on every run.
export function whisperTrouble(said) {
  const errors = said.split("\n").filter((l) => /^error:/i.test(l.trim())).join("\n");
  if (/model|context/i.test(errors)) return "The whisper model couldn't be loaded. Download it again.";
  if (/audio|input file|read/i.test(errors)) return "Nothing was recorded. Check the microphone, then try again.";
  return "Couldn't write that down. Try again.";
}

// whisper's text without its markers for silence and noise ("[BLANK_AUDIO]", "(music)", "[음악]").
export function clean(text) {
  return text.split("\n").map((l) => l.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// The clipboard, whole: pasteboard.jxa copies every item and type (an image, copied files, rich text)
// to `dir` and back. `board` is "general" for the clipboard; tests use "ruler", which nothing else uses.
export async function saveClipboard(exec, script, board, dir) {
  const r = await exec("osascript", ["-l", "JavaScript", script, "save", board, dir]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "couldn't save the clipboard");
}

export async function restoreClipboard(exec, script, board, dir) {
  const r = await exec("osascript", ["-l", "JavaScript", script, "restore", board, dir]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "couldn't restore the clipboard");
}

// Puts text on the pasteboard. pbcopy reads UTF-8 only with a UTF-8 locale, which Herdr's environment may lack.
export async function writeClipboard(exec, board, text) {
  const r = await exec("sh", ["-c", 'printf %s "$2" | LC_ALL=en_US.UTF-8 pbcopy -pboard "$1"', "x", board, text]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "couldn't copy the text");
}
