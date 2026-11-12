// The Git panel's switch row (props {view: "switch"}): one button per view in the `git` stack
// (layouts/omarchy.json), so Changes, Graph, Review and PRs share one tab-strip button.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, layout, run } from "herdr";

const VIEWS = {
  "changes-view": ["Changes", "mods/omarchy-changes/changes.svg"],
  "git-graph": ["Graph", "mods/omarchy-changes/graph.svg"],
  review: ["Review", "mods/reviewer/comment.svg"],
  prs: ["PRs", "mods/pr-flow/merge.svg"],
};
const find = (n, id) => !n || typeof n !== "object" ? null : n.id === id ? n : (n.children ?? []).reduce((a, c) => a ?? find(c, id), null);

export function renderSwitch() {
  const t = theme(), stack = find(layout(), "git");
  const views = (stack?.children ?? []).filter((c) => VIEWS[c.id]);
  return h_flex().size_full().px(14).gap(8).items_center().border_b(1).border_color(t.border).bg(t.background)
    .children(views.map((c) => {
      const [label, icon] = VIEWS[c.id], on = stack.active === c.id;
      return h_flex().id(`git-${c.id}`).h(22).px(7).gap(5).flex_none().items_center().border_1().cursor_pointer().text_size(11)
        .border_color(on ? t.accent : t.border).text_color(on ? t.accent : t.muted).hover((s) => s.text_color(t.foreground))
        .on_click(() => run("layout.select", { stack: "git", child: c.id }))
        .child(svg(icon).size(12)).child(label);
    }))
    .child(div().flex_1());
}
