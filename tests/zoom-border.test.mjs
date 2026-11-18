import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// setZoomBorder writes the frames back, so leaving zoom must restore the layout's own widths.
function load(sent) {
  const pane = { border: { width: 1, color: "border" }, focus: { width: 2, color: "accent" } };
  const layout = () => ({ id: "root", children: [{ id: "main", content: { tab: "active", pane } }] });
  const exec = async (_cmd, args) => { sent.push(JSON.parse(args[2]).layout.children[0].content.pane); return { code: 0 }; };
  const code = readFileSync(new URL("../mods/omarchy-bar/wallpaper.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/m, "").replace(/^export /gm, "");
  return Function("exec", "layout", "appHome", `${code}\nreturn setZoomBorder;`)(exec, layout, () => "/app");
}

test("a zoomed pane gets the thick frame, and leaving zoom restores 1px and the 2px focus", async () => {
  const sent = [];
  const setZoomBorder = load(sent);
  await setZoomBorder(true);
  await setZoomBorder(false);
  assert.deepEqual(sent.map((p) => [p.border.width, p.focus.width]), [[4, 4], [1, 2]]);
});
