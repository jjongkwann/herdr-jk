import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, run, window, props, layout, shared, setShared, focused, home, nextCommand, settings } from "herdr";
import { wallpapers, setWallpaper, setZoomBorder, ZOOM_BORDER } from "./wallpaper.js";

const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const isRail = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Same toggle as omarchy-chrome's header: the rail goes by width.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  const narrow = isRail();
  if (!narrow) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow);
  run("layout.resize", { id: "sidebar", px: narrow ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// The theme's next wallpaper, as Omarchy's Super+Ctrl+Space.
async function nextWallpaper() {
  const all = await wallpapers(settings().theme);
  if (!all.length) return;
  setWallpaper(all[(all.indexOf(layout()?.background?.image) + 1) % all.length]);
}

export default class OmarchyBar extends View {
  init(_props, cx) {
    // The bar is in the layout twice; one copy takes the key.
    if (props()?.part !== "left") return;
    // Each step touches cx, so a reloaded bar's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next-wallpaper") await nextWallpaper();
        // macOS full screen (its own desktop), as ⌃⌘F in apps with a View menu.
        if (command === "fullscreen") globalThis.window.toggle_fullscreen();
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const part = props()?.part;
    const row = h_flex().id(`omarchy-${part}`).size_full().items_center().bg(t.chrome).text_size(12).text_color(t.muted).overflow_hidden();
    if (part === "right") return this.right(row, t);
    return this.left(row, t);
  }

  left(row, t) {
    const list = spaces();
    const zoomed = Boolean(list.find((s) => s.active)?.tabs.find((tab) => tab.active)?.zoomed);
    if (zoomed !== this.zoomed) {
      // First render only fixes a thick frame left over from a zoom when the app quit.
      if (zoomed || this.zoomed !== undefined || find(layout(), "main")?.content?.pane?.focus?.width === ZOOM_BORDER) setZoomBorder(zoomed);
      this.zoomed = zoomed;
    }
    // As the sidebar counts them, agents shown as Chat included.
    const blocked = new Set(shared("omarchy-spaces.needs") ?? []);
    const space = list.find((s) => s.active);
    const number = (s) => list.indexOf(s) + 1;
    // The open sidebar lists every space, so the bar names this one and the next that waits on you.
    // A narrow window has no room for the numbers either.
    const rail = isRail() && !this.narrow;
    const waiting = list.filter((s) => blocked.has(s.id) && !s.active);
    const cwd = focused()?.cwd;
    const here = cwd ? (cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop()) : null;
    const sep = () => div().flex_none().mx(10).text_color(t.border).child("│");
    // macOS draws its window buttons over this corner; leave them room.
    const w = window();
    return row.pl(w?.platform === "macos" && !w.fullscreen ? 76 : 4)
      // Below 1024px the right block keeps only the window buttons, and the usage gets its room.
      .on_size_change((_size, cx) => {
        const narrow = globalThis.window.viewport_size().width < 1024;
        if (narrow === this.narrow) return;
        this.narrow = narrow;
        const size = narrow ? { px: w?.buttons ? 90 : 0 } : { weight: 1 };
        const current = find(layout(), "bar-right")?.size;
        if (current && (current.px !== size.px || current.weight !== size.weight)) run("layout.resize", { id: "bar-right", ...size });
        cx.notify();
      })
      .child(own(div().id("menu").flex_none().size(24).mr(6).flex().items_center().justify_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(() => run("mod.open", { name: "omarchy-palette" }))
        .text_color(t.accent).child(svg("mods/omarchy-bar/omarchy.svg").size(14))))
      .child(own(div().id("sidebar-toggle").flex_none().w(30).h_full().mr(4).flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(toggleSidebar)
        .child(svg("mods/omarchy-chrome/sidebar.svg").size(14))))
      .when(!rail && Boolean(space), (el) => el.child(div().flex_none().h(20).min_w(20).px(6).mr(8).flex().items_center().justify_center().rounded(4)
        .bg(t.accent).text_color(t.accent_foreground).font_bold().child(String(number(space)))))
      .children((rail ? list : []).map((s, i) => {
        const col = blocked.has(s.id) ? t.blocked : s.active ? t.foreground : t.muted;
        // The block drags the window; a space number keeps its press so the click selects.
        return own(div().id(`ws-${s.id}`).flex_none().h_full().px(8).flex().items_center().justify_center().cursor_pointer()
          .border_b(2).border_color(s.active ? t.accent : "#00000000").text_color(col)
          .hover((st) => st.text_color(t.foreground).bg(t.hover))
          .on_click(() => run("space.select", { id: s.id }))
          .child(String(i + 1)));
      }))
      .child(own(div().id("search").flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("mod.open", { name: "picker" }))
        .child(svg("mods/omarchy-chrome/search.svg").size(14))))
      .when(Boolean(space), (el) => el.child(sep())
        .child(div().flex_none().font_medium().text_color(t.foreground).child(space.name))
        // The focused terminal may have moved away from the folder its space was named after.
        .when(Boolean(here) && here !== space.name, (e) => e.child(div().flex_none().ml(8).text_color(t.muted).child(here)))
        .when(Boolean(space.branch), (e) => e.child(div().flex_none().ml(8).text_color(t.muted).child(space.branch)))
        .when(Boolean(space.machine), (e) => e.child(div().flex_none().ml(8).text_color(t.muted).child(`@${space.machine}`))))
      .when(!rail && waiting.length > 0, (el) => el.child(own(h_flex().id("needs-you").flex_none().h(22).ml(12).px(8).gap(6).items_center().rounded(5).cursor_pointer()
        .bg(t.blocked + "26").border(1).border_color(t.blocked + "55").text_color(t.blocked).font_semibold()
        .hover((s) => s.bg(t.blocked + "40")).on_click(() => run("space.select", { id: waiting[0].id }))
        .child(`! ${number(waiting[0])} ${waiting[0].name}`)
        .when(waiting.length > 1, (e) => e.child(div().child(`+${waiting.length - 1}`))))));
  }

  right(row, t) {
    const w = window();
    const btn = (id, icon, cmd, danger) => own(
      div().id(id).flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(danger ? t.blocked : t.hover).text_color(danger ? t.background : t.foreground))
        .on_click(() => run(cmd))
        .child(svg(`mods/terminals-bar/${icon}.svg`).size(14)));
    return row.justify_end()
      .when(Boolean(w?.buttons), (el) => el
        .child(btn("wb-min", "win-min", "window.minimize"))
        .child(btn("wb-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
        .child(btn("wb-close", "win-close", "window.close", true)));
  }
}
