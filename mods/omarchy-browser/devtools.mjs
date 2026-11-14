#!/usr/bin/env node
// DevTools for the omarchy browser's page, in a pane of its own (the Browser pane header's DevTools
// button and super-ctrl-i split it below the Browser pane). Chrome's own DevTools frontend, which
// the @omarchy browser serves on its debugging port, for the page agent-browser shows there:
// opened in a second agent-browser session (@omarchy-devtools, so it never mixes with the agents'
// browser) and drawn by herdr-app's viewer, as view.sh draws the page.
//   node devtools.mjs [--font-size <Herdr's terminal font size>] [--theme dark|light]
// It sizes the DevTools page to the pane, opens it on the Console in Herdr's light or dark with
// DevTools' own screencast of the page off (the Browser pane shows the page), keeps the viewer's
// heartbeat fresh, fits the page again when the pane is resized, and closes the DevTools browser
// when the pane goes: an open DevTools left behind could stop the agents' page on a breakpoint
// nobody sees.
import { execFile, spawn } from "node:child_process";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGE_TASK = "@omarchy", PAGE_SESSION = "herdr-omarchy";
const TASK = "@omarchy-devtools";

// The DevTools frontend for one page target, from the browser's debugging address
// (ws://127.0.0.1:<port>/devtools/browser/<id>), on the Console.
export function inspectorUrl(cdpUrl, targetId) {
  const host = /^ws:\/\/([^/]+)\//.exec(cdpUrl ?? "")?.[1];
  if (!host || !targetId) return null;
  return `http://${host}/devtools/inspector.html?ws=${host}/devtools/page/${targetId}&panel=console`;
}

// The DevTools page's size in CSS pixels: the pane's picture area (all rows but the viewer's status
// bar) in the screen's points. The terminal reports its cells in device pixels on a Retina screen,
// in points elsewhere; a cell is about 1.25 font sizes tall, so the ratio tells which.
export function viewport(cols, rows, cell, fontSize) {
  const c = cell ?? { w: 9, h: 18 };
  const scale = Math.max(1, Math.round(c.h / ((fontSize || 14) * 1.25)));
  return { width: Math.max(320, Math.floor((cols * c.w) / scale)), height: Math.max(200, Math.floor((Math.max(1, rows - 1) * c.h) / scale)) };
}

// ---- running ----

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = [process.env.HERDR_APP_HOME, join(HERE, "..", "..")].find((d) => d && existsSync(join(d, "bin", "herdr-browser")))
  ?? join(homedir(), ".config", "herdr-app");
const BIN = join(APP, "bin", "herdr-browser");
const BEAT = join(homedir(), ".herdr", "browser", "omarchy-devtools.view");
// The DevTools pane opened last owns the DevTools browser: its pid.
const OWNER = join(homedir(), ".herdr", "browser", "omarchy-devtools.owner");

function browser(task, args, input) {
  return new Promise((resolve) => {
    const p = execFile(BIN, ["--own", "--task", task, ...args], { timeout: 30000, maxBuffer: 8 << 20 }, (err, stdout) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch {}
      resolve({ ok: !err, json });
    });
    if (input != null) p.stdin.end(input);
  });
}

// The terminal's cell size in pixels ({ w, h }), asked with CSI 16 t; null when it doesn't answer.
function cellSize() {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let got = "";
    const done = (v) => {
      clearTimeout(timer);
      process.stdin.off("data", on);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(v);
    };
    const on = (d) => {
      got += d;
      const m = /\x1b\[6;(\d+);(\d+)t/.exec(got);
      if (m) done({ h: Number(m[1]), w: Number(m[2]) });
    };
    const timer = setTimeout(() => done(null), 800);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", on);
    process.stdout.write("\x1b[16t");
  });
}

function beat() {
  const t = new Date();
  try { utimesSync(BEAT, t, t); } catch { try { writeFileSync(BEAT, ""); } catch {} }
}

const say = (text) => process.stdout.write(`\r\n  ${text}\r\n`);

// Closes the DevTools browser after this pane, unless a DevTools pane opened since owns it.
function closeLater() {
  const sh = `sleep 1; [ "$(cat "$4" 2>/dev/null)" = "$1" ] && exec "$2" --own --task "$3" close`;
  spawn("sh", ["-c", sh, "close", String(process.pid), BIN, TASK, OWNER], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  // First, so a DevTools pane closing as this one opens leaves the DevTools browser open.
  try { writeFileSync(OWNER, String(process.pid)); } catch {}
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const fontSize = Number(arg("--font-size")) || 14;
  const theme = arg("--theme") === "dark" ? "dark" : "default";
  const sessions = (await browser(PAGE_TASK, ["session", "list", "--json"])).json?.data?.sessions ?? [];
  if (!sessions.includes(PAGE_SESSION)) {
    say("The omarchy browser isn't open. Open a page in the Browser pane, then DevTools again.");
    await new Promise((r) => setTimeout(r, 4000));
    process.exit(1);
  }
  const r = await browser(PAGE_TASK, ["batch", "--json", "get cdp-url", "tab list"]);
  const [cdp, tabs] = Array.isArray(r.json) ? r.json.map((x) => x.result ?? {}) : [];
  const tab = (tabs?.tabs ?? []).find((t) => t.active) ?? tabs?.tabs?.[0];
  const url = inspectorUrl(cdp?.cdpUrl, tab?.targetId);
  if (!url) {
    say("The omarchy browser has no page to inspect.");
    await new Promise((r) => setTimeout(r, 4000));
    process.exit(1);
  }
  const cell = await cellSize();
  const fit = () => viewport(process.stdout.columns || 80, process.stdout.rows || 24, cell, fontSize);
  const size = fit();
  say("Opening DevTools…");
  // DevTools keeps its settings (JSON) in the frontend's own origin (the debugging port), so its
  // own screencast and its theme are set there before the frontend loads.
  const steps = [
    ["set", "viewport", String(size.width), String(size.height)],
    ["open", `${url.split("/devtools/")[0]}/json/version`],
    ["eval", `localStorage.setItem("screencast-enabled", "false"); localStorage.setItem("ui-theme", ${JSON.stringify(JSON.stringify(theme))})`],
    ["open", url],
  ];
  const opened = await browser(TASK, ["batch", "--json", "--bail"], JSON.stringify(steps));
  if (!opened.ok) {
    say("DevTools didn't open.");
    await new Promise((r) => setTimeout(r, 4000));
    closeLater();
    process.exit(1);
  }
  beat();
  const beating = setInterval(beat, 5000);
  const viewer = spawn("node", [join(APP, "bin", "herdr-browser-view"), "--task", TASK], { stdio: "inherit" });
  let refit = null;
  process.stdout.on("resize", () => {
    clearTimeout(refit);
    refit = setTimeout(() => { const s = fit(); browser(TASK, ["set", "viewport", String(s.width), String(s.height)]); }, 300);
  });
  const end = (code) => { clearInterval(beating); closeLater(); process.exit(code); };
  viewer.on("exit", (code) => end(code ?? 0));
  for (const sig of ["SIGHUP", "SIGTERM"]) process.on(sig, () => { viewer.kill("SIGTERM"); end(0); });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
