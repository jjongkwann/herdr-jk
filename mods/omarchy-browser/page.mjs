#!/usr/bin/env node
// The omarchy browser's page, for the Browser pane's header (omarchy-pane). agent-browser (through
// ./ab, always --own: Herdr's own looks never count as the agent using the browser and are never
// refused while the person drives) gives Chrome's debugging port and the active tab; the page's
// errors come from Chrome itself. Nothing here opens a closed browser: each command first checks
// that the session runs, and prints {"open":false} when it doesn't.
//   node page.mjs errors   {"open":true,"url":"…","local":true,"count":2,"errors":["…","…"]}
//
// Errors since the page loaded: Chrome keeps a page's console messages from its last load (what
// DevTools shows when opened late) and sends them again to a client that turns on the Runtime and
// Log domains. agent-browser's own `errors` and `console` keep one buffer for the whole session
// that a navigation doesn't clear, with no times, so they can't say which page an error came from.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SESSION = "herdr-omarchy"; // ab's fixed key @omarchy
const SHOWN = 5;                 // the latest errors printed with the count

// Pages that run on this computer.
export function isLocalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "file:") return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0";
}

// The tab agent-browser acts on (its `tab list`).
export const activeTab = (tabs) => (tabs ?? []).find((t) => t.active) ?? tabs?.[0] ?? null;

// "index.html:6" from a script's address and its 0-based line.
function where(url, line) {
  if (!url) return "";
  const name = url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || url;
  return ` (${name}${Number.isInteger(line) ? `:${line + 1}` : ""})`;
}

function argText(a) {
  if (a.type === "string") return a.value;
  if (a.value !== undefined) return String(a.value);
  return a.description ?? a.className ?? a.type;
}

// The page's errors, oldest first, from the CDP events a client gets when it turns on Runtime and
// Log: console.error and failed console.assert, uncaught exceptions and promise rejections (less
// the ones handled later), and Chrome's own error entries (a resource that failed to load, CSP).
export function errorsFrom(events) {
  const out = [];
  const thrown = new Map();
  for (const e of events) {
    const p = e.params ?? {};
    if (e.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) {
      const top = p.stackTrace?.callFrames?.[0];
      const text = (p.args ?? []).map(argText).join(" ") || (p.type === "assert" ? "Assertion failed" : "console.error");
      out.push(text + where(top?.url, top?.lineNumber));
    } else if (e.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails ?? {};
      const what = (d.exception?.description ?? "").split("\n")[0];
      const text = [d.text, what].filter(Boolean).join(" ") || "Uncaught exception";
      const at = d.stackTrace?.callFrames?.[0];
      thrown.set(d.exceptionId, out.length);
      out.push(text + where(at?.url ?? d.url, at?.lineNumber ?? d.lineNumber));
    } else if (e.method === "Runtime.exceptionRevoked") {
      const i = thrown.get(p.exceptionId);
      if (i !== undefined) out[i] = null;
    } else if (e.method === "Log.entryAdded" && p.entry?.level === "error") {
      out.push(p.entry.text + (p.entry.url ? ` ${p.entry.url}` : ""));
    }
  }
  return out.filter((x) => x !== null);
}

// ---- agent-browser and Chrome ----

const AB = join(dirname(fileURLToPath(import.meta.url)), "ab");

function ab(...args) {
  return new Promise((resolve) => {
    execFile("sh", [AB, "--own", ...args], { timeout: 20000, maxBuffer: 8 << 20 }, (err, stdout) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch {}
      resolve({ ok: !err, json });
    });
  });
}

// The running browser's debugging address and active tab, or null when it isn't running.
async function page() {
  const list = await ab("session", "list", "--json");
  if (!list.json?.data?.sessions?.includes(SESSION)) return null;
  const r = await ab("batch", "--json", "get cdp-url", "tab list");
  const [cdp, tabs] = Array.isArray(r.json) ? r.json.map((x) => x.result ?? {}) : [];
  const tab = activeTab(tabs?.tabs);
  if (!cdp?.cdpUrl || !tab) return null;
  return { cdpUrl: cdp.cdpUrl, tab };
}

// What a fresh client gets for the tab's page: Chrome sends the stored messages while it turns the
// domains on, before it answers, so once both answers are in, every message is too.
function replay(cdpUrl, targetId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cdpUrl);
    const events = [], waiting = new Map();
    let id = 0;
    const call = (method, params = {}, sessionId) => new Promise((done) => {
      waiting.set(++id, done);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.onerror = () => reject(new Error("Chrome's debugging port didn't answer."));
    ws.onmessage = (m) => {
      let j;
      try { j = JSON.parse(m.data); } catch { return; }
      if (j.id) { waiting.get(j.id)?.(j); waiting.delete(j.id); } else events.push(j);
    };
    ws.onopen = async () => {
      const a = await call("Target.attachToTarget", { targetId, flatten: true });
      const s = a.result?.sessionId;
      if (!s) { ws.close(); return reject(new Error(a.error?.message ?? "The page went away.")); }
      await Promise.all([call("Runtime.enable", {}, s), call("Log.enable", {}, s)]);
      await call("Target.detachFromTarget", { sessionId: s });
      ws.close();
      resolve(events.filter((e) => e.sessionId === s));
    };
  });
}

async function main(cmd) {
  const p = await page();
  if (!p) return { open: false };
  const url = p.tab.url ?? "";
  const local = isLocalUrl(url);
  if (cmd === "errors") {
    const errors = errorsFrom(await replay(p.cdpUrl, p.tab.targetId));
    return { open: true, url, local, count: errors.length, errors: errors.slice(-SHOWN) };
  }
  throw new Error(`page.mjs: unknown command ${cmd ?? ""} (errors)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  setTimeout(() => { process.stdout.write(JSON.stringify({ error: "timed out" }) + "\n"); process.exit(1); }, 25000).unref();
  main(process.argv[2]).then(
    (r) => { process.stdout.write(JSON.stringify(r) + "\n"); process.exit(0); },
    (e) => { process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }) + "\n"); process.exit(1); },
  );
}
