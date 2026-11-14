// The omarchy browser's pane: a terminal running omarchy-browser's view.sh (herdr-app's viewer on
// the @omarchy browser). Its header shows the page's errors and reloads a local page when a file
// in the space's folder is saved (omarchy-browser/page.mjs), and opens DevTools for the page in a
// pane below it (omarchy-browser/devtools.mjs). Here: how the header knows those panes, when
// they're on screen, and which saves reload. No herdr imports, so tests can load it.

// Whether core terminal `k` (an entry of terminals()) is the omarchy browser's viewer: started as
// omarchy-browser/view.sh, or running herdr-browser-view on @omarchy (not another task's browser).
export function isViewer(k) {
  const words = [...(k?.argv ?? []), ...(k?.foreground?.argv ?? [])].map(String);
  if (words.some((w) => /(^|[\\/])omarchy-browser[\\/]view\.sh$/.test(w))) return true;
  const i = words.indexOf("--task");
  return i >= 0 && words[i + 1] === "@omarchy" && words.some((w) => /(^|[\\/])herdr-browser-view$/.test(w));
}

// Whether core terminal `k` is the DevTools pane: omarchy-browser/devtools.mjs, or the viewer it
// runs on @omarchy-devtools.
export function isDevtools(k) {
  const words = [...(k?.argv ?? []), ...(k?.foreground?.argv ?? [])].map(String);
  if (words.some((w) => /(^|[\\/])omarchy-browser[\\/]devtools\.mjs$/.test(w))) return true;
  const i = words.indexOf("--task");
  return i >= 0 && words[i + 1] === "@omarchy-devtools" && words.some((w) => /(^|[\\/])herdr-browser-view$/.test(w));
}

// What a pane is to these headers: "viewer" (the Browser pane), "devtools", or null.
export const kindOf = (k) => (isViewer(k) ? "viewer" : isDevtools(k) ? "devtools" : null);

// The DevTools pane's program: devtools.mjs with the terminal font size (to tell Retina cells
// from points) and Herdr's light or dark.
export function devtoolsArgv(app, fontSize, dark) {
  return ["sh", "-c", 'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"; exec node "$0" --font-size "$1" --theme "$2"',
    `${app}/mods/omarchy-browser/devtools.mjs`, String(fontSize || 14), dark ? "dark" : "light"];
}

// The pane whose header acts on the DevTools key (every header copy gets it): the focused pane
// when it's the Browser or DevTools pane, else the first Browser pane on screen. `kind(pane)` as
// kindOf for that pane's terminal.
export function devtoolsKeyPane(panes, spaces, kind) {
  const focused = panes.find((p) => p.focused);
  if (focused && kind(focused)) return focused.pane;
  return panes.find((p) => kind(p) === "viewer" && onScreen(p, spaces, panes))?.pane ?? null;
}

// Whether pane `self` (an entry of panes()) is on screen: its space and tab show, and no other
// pane of its tab is zoomed over it.
export function onScreen(self, spaces, panes) {
  if (!self) return false;
  const space = spaces.find((s) => s.tabs.some((t) => t.id === self.tab));
  if (!space?.active || !space.tabs.find((t) => t.id === self.tab)?.active) return false;
  return Boolean(self.zoomed) || !panes.some((p) => p.tab === self.tab && p.zoomed);
}

export const errorLabel = (n) => (n === 1 ? "1 error" : `${n} errors`);

// The page's address as the header shows it: without the scheme, a file by its path.
export function pageShown(url) {
  if (!url || url === "about:blank") return "";
  if (url.startsWith("file://")) { try { return decodeURIComponent(url.slice(7)); } catch { return url.slice(7); } }
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// What the popup a click on the error count opens says: the latest errors, oldest first.
export function errorsPopup(page) {
  const where = pageShown(page?.url) || "this page";
  if (!page?.count) return { title: `No errors on ${where}`, note: "Nothing went wrong since the page loaded.", lines: [] };
  const lines = (page.errors ?? []).map((e) => (e.length > 400 ? `${e.slice(0, 399)}…` : e));
  const older = page.count - lines.length;
  return { title: `${errorLabel(page.count)} on ${where}`, note: older > 0 ? `The latest ${lines.length}; ${older} more before them.` : "", lines };
}

// The folder whose saves reload the page: the pane's space's, on this computer, never the whole
// home folder (or none: the space starts in home).
export function saveFolder(space, home) {
  const dir = (space?.folder ?? "").replace(/[\\/]+$/, "");
  if (!space || space.machine || !dir || dir === home.replace(/[\\/]+$/, "")) return null;
  return dir;
}

// What a page is made of; other files (logs, editor swap and backup files) don't reload it.
const PAGE_FILE = /\.(html?|css|m?js|jsx|tsx?|json|svg|png|jpe?g|gif|webp|avif|ico|md)$/i;
// Folders that change by themselves: dependencies, Git, and the caches dev servers write while they
// serve a page (Next.js compiles into .next on each request), which would reload it in a loop.
const CHURN = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".astro", ".output", ".cache",
  ".parcel-cache", ".turbo", ".angular", ".vercel", "coverage"]);

// Whether a changed path (from watchFolder(dir)) reloads the page. The folder itself means "many
// things changed" (Herdr's bounded batch): that reloads too.
export function reloads(path, dir) {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, ""), root = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (p === root) return true;
  if (!p.startsWith(root + "/")) return false;
  const parts = p.slice(root.length + 1).split("/");
  return !parts.some((x) => CHURN.has(x)) && PAGE_FILE.test(parts[parts.length - 1]);
}

// Saves come in bursts (an editor writes, a formatter writes again): one reload, `ms` after the last.
export class Burst {
  constructor(ms) { this.ms = ms; this.due = 0; }
  // A save at `now`; true when no timer waits yet (start one for `ms`).
  hit(now) { const idle = !this.due; this.due = now + this.ms; return idle; }
  // The timer fired at `now`: 0 when it's time to reload, else how much longer to wait.
  left(now) {
    const ms = this.due - now;
    if (ms > 0) return ms;
    this.due = 0;
    return 0;
  }
}
