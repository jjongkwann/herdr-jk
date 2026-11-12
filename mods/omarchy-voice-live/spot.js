// Where the dictation bubble goes: just above the line a program takes its input on. Herdr tells
// mods nothing about where a terminal or its cursor is on screen, so this works it out from the tab
// node's edges (two floats on it, one at the bottom and one at the top, as `herdr-app status`
// reports them), the layout's pane frame and the terminal's rows. It imports nothing (tests run it).

// The row (0-based, from the top of the screen) the bubble sits on: the rule above the last prompt
// line ("❯" Claude Code, "›" Codex), else that prompt line, else the last line with text; -1 for an
// empty screen.
export function inputRow(lines) {
  const rule = (line) => /^\s*[─━]{8,}/.test(line);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[❯›]/.test(lines[i])) return i > 0 && rule(lines[i - 1]) ? i - 1 : i;
  }
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return i;
  return -1;
}

// The bubble's top left (window px), `gap` px above `row`, centered on the tab node, for a terminal
// that fills the node: `node` is { top, bottom, centerX } inside the node, `frame` the pane frame's
// { border, header, padding } and `size` the bubble's { width, height }.
export function bubbleSpot(node, rows, row, frame, size, gap = 2) {
  const top = node.top + frame.border + frame.header + frame.padding;
  const bottom = node.bottom - frame.border - frame.padding;
  const cell = (bottom - top) / rows;
  return { x: Math.round(node.centerX - size.width / 2), y: Math.round(top + row * cell - size.height - gap) };
}
