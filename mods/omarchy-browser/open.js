// Opens the omarchy browser (view.sh: herdr-app's viewer on the @omarchy browser) as a terminal
// split to the right of the focused pane. When the focused pane is an agent, the viewer tells it
// when the person takes the browser over and hands it back.
import { appHome, exec, panes, run, notify } from "herdr";

const viewScript = () => `${appHome()}/mods/omarchy-browser/view.sh`;

// null when agent-browser and herdr-app's viewer are installed, else what's missing.
export async function missing() {
  const r = await exec("sh", [viewScript(), "--check"]).catch((e) => ({ code: 1, stdout: String(e?.message ?? e) }));
  return r.code === 0 ? null : (r.stdout.trim() || "agent-browser or herdr-app's browser viewer");
}

export async function openBrowser() {
  const gone = await missing();
  if (gone) {
    notify({ title: "Browser isn't available", body: `Missing: ${gone}`, level: "warning" });
    return;
  }
  const pane = panes().find((p) => p.focused);
  const worker = pane?.terminal && pane.status ? pane.terminal : "";
  run("pane.split", { direction: "right", argv: ["sh", viewScript(), worker] });
}
