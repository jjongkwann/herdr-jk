// Wallpaper picker, the theme switcher's twin: every image under backgrounds/, whatever
// the theme, the chosen one large in the middle. ←/→ move, Enter applies, Esc or a click
// outside closes.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, layout, settings, theme, props, closeOverlay } from "herdr";

const ROOT = "backgrounds";
const title = (s) => s.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// "backgrounds/omarchy/tokyo-night/1-winding-road.webp" reads "Tokyo Night · Winding Road".
const label = (path) => path.split("/").slice(-2).map(title).join(" · ");

export default class OmarchyBackgrounds extends View {
  init(_props, cx) {
    this.all = [];
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
    cx.spawn(async (cx) => {
      const home = appHome(), r = await exec("find", [`${home}/${ROOT}`, "-type", "f"]).catch(() => null);
      this.all = (r?.stdout ?? "").split("\n").filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => f.slice(home.length + 1)).sort();
      this.at = Math.max(0, this.all.indexOf(layout()?.background?.image));
      cx.notify();
    });
  }

  move(by, cx) {
    const n = this.all.length;
    this.at = (this.at + by + n) % n;
    cx.notify();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Through the CLI: run() refuses an argument nested deeper than 16 levels, and this layout's
  // tree is deeper. Awaited before closing: this overlay's tasks end with it.
  async pick(path) {
    const l = layout();
    if (l) await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: { ...l, background: { ...l.background, image: path } } })]).catch(() => null);
    this.close();
  }

  render() {
    const t = theme(), all = this.all, current = layout()?.background?.image;
    if (!all.length) return div().id("omarchy-backgrounds").track_focus(this.handle).size_full().bg("#000000cc")
      .on_key_down((e) => { if (e.key === "escape") this.close(); });
    const at = Math.min(this.at, all.length - 1), chosen = all[at];
    const near = (by) => all[(at + by + all.length) % all.length];
    // Laid out as omarchy-themes: the chosen one at half the window width, neighbours as strips.
    const width = (this.size?.width ?? 1600) / (settings().zoom ?? 1), W = Math.round(width * 0.5), H = Math.round(W * 9 / 16);
    const STRIP = 64, sideH = Math.round(H * 0.88), count = Math.min(6, Math.floor((all.length - 1) / 2), Math.floor((width - W) / 2 / STRIP));
    // Wallpapers aren't all 16:9: the width is fixed and a taller one is cut at the frame.
    const shot = (path, w, h) => div().w(w).h(h).flex_none().overflow_hidden().bg("#000000").flex().items_center().justify_center().child(image(path).w(w));
    const strip = (by) => div().id(`bg-strip-${by}`).relative().w(STRIP).h(sideH).flex_none().overflow_hidden()
      .border_l(1).border_r(1).border_color("#000000").cursor_pointer().on_click((_e, cx) => this.move(by, cx))
      .child(div().absolute().top(0).when(by < 0, (e) => e.left(0)).when(by > 0, (e) => e.right(0)).child(shot(near(by), Math.round(W * 0.88), sideH)))
      .child(div().absolute().inset_0().bg(`#000000${Math.round(0x30 + 0x18 * (Math.abs(by) - 1)).toString(16)}`));
    const side = (sign) => Array.from({ length: count }, (_, i) => (sign < 0 ? i - count : i + 1)).map(strip);
    return v_flex().id("omarchy-backgrounds").track_focus(this.handle).size_full().gap(28).items_center().justify_center().bg("#000000cc")
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "enter") return this.pick(chosen);
        if (k === "right" || k === "down" || k === "tab") this.move(1, cx);
        else if (k === "left" || k === "up") this.move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().id("bg-row").items_center().on_mouse_down_out(() => this.close())
        .children(side(-1))
        .child(div().id("bg-chosen").flex_none().mx(10).border_3().border_color(t.accent).cursor_pointer().on_click(() => this.pick(chosen)).child(shot(chosen, W, H)))
        .children(side(1)))
      .child(h_flex().gap(12).items_center()
        .child(div().text_size(30).font_semibold().text_color("#ffffffee").child(label(chosen)))
        .child(div().text_size(12).text_color("#ffffff99").child(`${at + 1} / ${all.length}`))
        .when(chosen === current, (e) => e.child(div().px(6).border_1().border_color(t.accent).text_size(12).text_color(t.accent).child("current"))));
  }
}
