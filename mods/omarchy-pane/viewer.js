// The omarchy browser's pane: a terminal running omarchy-browser's view.sh (herdr-app's viewer on
// the @omarchy browser). Its header shows the page's errors (omarchy-browser/page.mjs). Here: how
// the header knows that pane and when it's on screen. No herdr imports, so tests can load it.

// Whether core terminal `k` (an entry of terminals()) is the omarchy browser's viewer: started as
// omarchy-browser/view.sh, or running herdr-browser-view on @omarchy (not another task's browser).
export function isViewer(k) {
  const words = [...(k?.argv ?? []), ...(k?.foreground?.argv ?? [])].map(String);
  if (words.some((w) => /(^|[\\/])omarchy-browser[\\/]view\.sh$/.test(w))) return true;
  const i = words.indexOf("--task");
  return i >= 0 && words[i + 1] === "@omarchy" && words.some((w) => /(^|[\\/])herdr-browser-view$/.test(w));
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
