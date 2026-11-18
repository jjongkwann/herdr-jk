// Spaces keep the order the person gives them (drag a row); each worktree space goes
// under its main checkout's.

// `list`: [{ w: SpaceInfo, g: git info or null }] in space order.
export function arrange(list) {
  const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
  const nested = (r) => r.g?.linked && mains.has(r.g.repo);
  // space.move can't leave a machine's block: keep each machine's spaces together.
  const block = (r) => list.findIndex((k) => (k.w.machine ?? null) === (r.w.machine ?? null));
  const top = list.filter((r) => !nested(r)).map((r) => ({ r, m: block(r) }))
    .sort((a, b) => a.m - b.m).map((x) => x.r);
  const out = [];
  const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
  for (const r of top) {
    out.push({ ...r, tree: null });
    if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
    placed.add(r.g.repo);
    const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
    kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
  }
  return out;
}
