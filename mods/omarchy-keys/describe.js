// Plain-English label and type for a key's action, and alt-1..alt-9 style runs folded into one row.

export const GROUPS = ["Spaces", "Tabs", "Panes", "Agents", "Terminal", "Git", "Dialogs", "Look", "App", "Other"];

const DIRS = { left: "left", right: "right", up: "up", down: "down" };
const FIXED = {
  "space.next": ["Spaces", "Next space"], "space.prev": ["Spaces", "Previous space"],
  "space.new": ["Spaces", "New space"], "space.rename": ["Spaces", "Rename space"],
  "tab.next": ["Tabs", "Next tab"], "tab.prev": ["Tabs", "Previous tab"],
  "tab.new": ["Tabs", "New tab"], "tab.close": ["Tabs", "Close tab"], "tab.rename": ["Tabs", "Rename tab"],
  "omarchy-tabs.reopen": ["Tabs", "Reopen closed tab"],
  "omarchy-tabs.tab-next": ["Tabs", "Next tab with a running agent"],
  "omarchy-tabs.tab-prev": ["Tabs", "Previous tab with a running agent"],
  "pane.close": ["Panes", "Close pane"], "pane.zoom": ["Panes", "Zoom pane"],
  "omarchy-pane.toggle": ["Panes", "Switch pane between Chat and Terminal"],
  "mod.open:equal-width": ["Panes", "Make panes equal width"],
  "agent.next": ["Agents", "Next agent"], "agent.prev": ["Agents", "Previous agent"],
  "terminal.open": ["Terminal", "New terminal"], "terminal.copy": ["Terminal", "Copy"],
  "terminal.paste": ["Terminal", "Paste"], "terminal.paste_image": ["Terminal", "Paste image"],
  "omarchy-voice.toggle": ["Terminal", "Start or stop dictation"],
  "pr-flow.refresh": ["Git", "Refresh pull requests"],
  "app.palette": ["Dialogs", "Command palette"], "app.settings": ["Dialogs", "Settings"], "app.help": ["Dialogs", "Help"],
  "layout.switch": ["Look", "Switch layout"], "omarchy-bar.next-wallpaper": ["Look", "Next wallpaper"],
  "omarchy-bar.fullscreen": ["Look", "Enter or leave full screen"],
  "app.zoom_in": ["Look", "Zoom in"], "app.zoom_out": ["Look", "Zoom out"], "app.zoom_reset": ["Look", "Reset zoom"],
  "app.quit": ["App", "Quit Herdr"], "app.hide": ["App", "Hide Herdr"], "app.hide_others": ["App", "Hide other apps"],
  "app.reset": ["App", "Reset to the default screen"],
};
const DIALOG = {
  palette: "command palette", "mod-manager": "mod manager", keys: "keybindings", picker: "tab picker",
  themes: "theme picker", backgrounds: "wallpaper picker",
};
const PART = { topbar: "top bar" };
// What the shell does with the bytes a key sends (emacs-style line editing).
const SEND = {
  "\u001bb": "Move a word left", "\u001bf": "Move a word right",
  "\u0001": "Move to line start", "\u0005": "Move to line end",
  "\u0017": "Delete word before cursor", "\u0015": "Delete to line start",
};

export function describe(action) {
  if (FIXED[action]) return { group: FIXED[action][0], label: FIXED[action][1] };
  const [cmd, arg = ""] = action.split(/:(.*)/s);
  if (cmd === "space.select") return { group: "Spaces", label: `Go to space ${arg}` };
  if (cmd === "tab.select") return { group: "Tabs", label: `Go to tab ${arg}` };
  if (cmd === "pane.go" && DIRS[arg]) return { group: "Panes", label: `Focus pane ${arg}` };
  if (cmd === "pane.swap" && DIRS[arg]) return { group: "Panes", label: `Swap pane ${arg}` };
  if (cmd === "pane.split" && DIRS[arg]) return { group: "Panes", label: `Split ${arg}` };
  if (cmd === "send") return { group: "Terminal", label: SEND[arg] ?? "Send keys" };
  if (cmd === "layout.toggle") return { group: "Look", label: `Show or hide ${PART[arg] ?? arg}` };
  if (cmd === "mod.open") {
    const name = arg.replace(/^omarchy-/, "");
    return { group: "Dialogs", label: `Open ${DIALOG[name] ?? name.replace(/-/g, " ")}` };
  }
  return { group: "Other", label: action };
}

// The raw action as text: control bytes in send:… shown in caret notation ("send:\u0017" -> "send:^W").
export const shown = (action) => action.replace(/[\u0000-\u001f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`);

// alt-1 tab.select:1 ... alt-9 tab.select:9 -> one row "alt-1…9", "tab.select:1…9".
export function fold(list) {
  const out = [];
  for (const k of list) {
    const km = k.keys.match(/^(.*-)(\d)$/), am = k.action.match(/^(.*:)(\d)$/);
    const last = out[out.length - 1];
    if (km && am && km[2] === am[2] && last?.run && last.keyBase === km[1] && last.actBase === am[1] && last.to + 1 === +km[2]) {
      last.to = +km[2];
      last.keys = `${km[1]}${last.from}…${last.to}`;
      last.action = `${am[1]}${last.from}…${last.to}`;
      continue;
    }
    out.push(km && am && km[2] === am[2]
      ? { ...k, run: true, keyBase: km[1], actBase: am[1], from: +km[2], to: +km[2] }
      : k);
  }
  return out;
}
