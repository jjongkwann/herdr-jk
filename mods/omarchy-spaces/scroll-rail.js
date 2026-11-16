import { div, PathBuilder, Background } from "gpui-kit";
import { v_flex } from "gpui-base";
import { settings } from "herdr";

const rectangle = PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export class ScrollRail {
  constructor() {
    this.offset = 0;
    this.viewport = 0;
    this.content = 0;
  }

  maximum() { return Math.max(0, this.content - this.viewport); }

  scroll(delta) {
    const next = Math.max(0, Math.min(this.maximum(), this.offset - delta));
    if (next === this.offset) return false;
    this.offset = next;
    return true;
  }

  measure(key, pixels, cx) {
    const value = pixels / (settings().zoom ?? 1);
    if (this[key] === value) return;
    this[key] = value;
    this.offset = Math.min(this.offset, this.maximum());
    cx.notify();
  }

  render(id, rows, color, padding = 6) {
    const shade = top => window.paint_path(rectangle, Background.linear_gradient(top ? 180 : 0, color, `${color.slice(0, 7)}00`))
      .absolute().left(0).right(0).h(18).when(top, el => el.top(0)).when(!top, el => el.bottom(0));
    return div().id(id).relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => this.measure("viewport", size.height, cx))
      .on_scroll_wheel((event, cx) => {
        if (!this.scroll(event.delta.y)) return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(v_flex().id(`${id}-content`).absolute().left(0).right(0).top(-this.offset)
        .pt(padding).pb(10).gap(6).items_center()
        .on_size_change((size, cx) => this.measure("content", size.height, cx))
        .children(rows))
      .when(this.offset > 0, el => el.child(shade(true)))
      .when(this.offset < this.maximum(), el => el.child(shade(false)));
  }
}
