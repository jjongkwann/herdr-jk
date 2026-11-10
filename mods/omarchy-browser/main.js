// The omarchy browser: one persistent browser the person and agents share, built on herdr-app's
// own task browser (bin/herdr-browser, bin/herdr-browser-view) under the fixed key @omarchy.
// Agents drive it with ./ab; "omarchy-browser.open" (a key, or another mod's button) opens the
// viewer as a right split. Shows nothing itself; a later step adds page comments here.
import { View, div } from "gpui-kit";
import { nextCommand } from "herdr";
import { openBrowser } from "./open.js";

export default class OmarchyBrowser extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") await openBrowser();
        cx.notify();
      }
    });
  }

  render() {
    return div();
  }
}
