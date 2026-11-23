// What the Windows install is made of, and the merges that need no machine: scripts/win-pc.mjs builds
// the package on this Mac with these, and scripts/win-pc/remote.mjs installs it on the Windows PC.

export const MODS = [
  "accept-card", "artifacts", "chat", "chat-call", "chat-image", "chat-models", "chat-react", "confirm-chat",
  "coordinator", "equal-width", "files-plus", "jump", "keybinds", "new-menu-tasks", "newspace", "omarchy-agents",
  "omarchy-ai-usage", "omarchy-backgrounds", "omarchy-bar", "omarchy-changes", "omarchy-chrome", "omarchy-close",
  "omarchy-keys", "omarchy-mod-manager", "omarchy-notes", "omarchy-palette", "omarchy-pane", "omarchy-settings",
  "omarchy-spaces", "omarchy-tabs", "omarchy-themes", "pane-chat", "pr-flow", "prompt-chat", "reviewer",
  "shepherdr-settings", "spaces-chat", "task-pr", "tasks", "tasks-menu", "toasts",
];

// macOS only (AVFoundation, Swift, the iOS Simulator): the layout must not name them.
export const MAC_ONLY_MODS = ["herdr-sim", "omarchy-voice", "omarchy-voice-live"];

// Whole folders of the install root, and the folders whose entries are installed one by one because
// Windows already has entries of its own there.
export const TREES = ["lib", "core", "bin"];
export const SHARED_TREES = ["themes", "backgrounds"];

// Shepherdr's Python tools, each with the folder it is in under the install root. Windows can't start
// an extensionless script, so each gets a .exe of the same name beside it (shim.cs).
export const TOOLS = [
  { name: "herdr-task", dir: "mods/tasks/bin" },
  { name: "herdr-artifact", dir: "mods/artifacts/bin" },
  { name: "herdr-secret", dir: "bin" },
];

export const FONTS = [
  { file: "D2KodingLigatureNerdFont-Regular.ttf", value: "D2KodingLigature Nerd Font Regular (TrueType)" },
  { file: "D2KodingLigatureNerdFont-Bold.ttf", value: "D2KodingLigature Nerd Font Bold (TrueType)" },
];

const SKIPPED_NAMES = new Set(["__pycache__", "node_modules", ".git", ".DS_Store", "gpui-kit.d.ts", "jsconfig.json"]);

// Whether a file of the install goes in the package (a path relative to the install root, either slash).
export function packaged(path) {
  return String(path).split(/[\\/]/).every((part) => !SKIPPED_NAMES.has(part) && !part.startsWith("._"));
}

// The layout without the nodes of the given mods. A stack showing a removed node shows its first node left.
export function stripLayout(layout, drop = MAC_ONLY_MODS) {
  const out = structuredClone(layout), removed = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (drop.includes(node[i]?.content?.mod)) removed.push(...node.splice(i, 1).map((n) => n.id));
        else walk(node[i]);
      }
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
      if (Array.isArray(node.children) && typeof node.active === "string" && !node.children.some((c) => c.id === node.active)) {
        node.active = node.children[0]?.id;
      }
    }
  };
  walk(out);
  return { layout: out, removed: removed.reverse() };
}

// Every mod a layout places.
export function layoutMods(layout) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (typeof node.content?.mod === "string") found.add(node.content.mod);
      Object.values(node).forEach(walk);
    }
  };
  walk(layout);
  return [...found].sort();
}

const usableKeys = (section = {}) => Object.fromEntries(Object.entries(section).filter(([key, action]) =>
  !key.split("-").includes("cmd") && !String(action).startsWith("omarchy-voice")));

// Windows' keys with the Mac's on top: its global and terminal keys that exist on a PC, the omarchy
// layout's keys and the chat's. Any other section stays as Windows has it.
export function mergeKeys(win, mac) {
  return {
    ...win,
    global: { ...win.global, ...usableKeys(mac.global) },
    terminal: { ...win.terminal, ...usableKeys(mac.terminal) },
    "layout:omarchy": usableKeys(mac["layout:omarchy"]),
    "mod:chat": mac["mod:chat"],
  };
}

// Windows' settings with the Mac's look on top.
export function mergeSettings(win, mac) {
  const look = Object.fromEntries(["font", "font_size", "telemetry", "appearance", "theme"]
    .filter((k) => mac[k] !== undefined).map((k) => [k, mac[k]]));
  return { ...win, ...look };
}

// Keys Windows (or PowerToys, which this PC runs) takes before Herdr sees them, and the key to use instead.
const TAKEN = {
  "alt-escape": ["Windows: switch windows", "alt-shift-w"],
  "super-k": ["Windows: Cast", "ctrl-alt-k"],
  "super-w": ["Windows: Widgets", "alt-shift-w"],
  "super-f": ["Windows: Feedback Hub", "ctrl-shift-z"],
  "super-c": ["Windows: Copilot", "ctrl-shift-c"],
  "super-v": ["Windows: clipboard history", "ctrl-shift-v"],
  "super-up": ["Windows: maximize the window", "alt-up"],
  "super-down": ["Windows: minimize the window", "alt-down"],
  "super-shift-up": ["Windows: stretch the window", "alt-["],
  "super-shift-down": ["Windows: restore the window", "alt-]"],
  "super-shift-left": ["Windows: move the window to another display", "alt-left"],
  "super-shift-right": ["Windows: move the window to another display", "alt-right"],
  "super-shift-r": ["Windows: Snipping Tool video", "ctrl-alt-r"],
  "super-shift-space": ["Windows: previous input language", "ctrl-alt-b"],
  "super-ctrl-left": ["Windows: previous virtual desktop", "ctrl-alt-,"],
  "super-ctrl-right": ["Windows: next virtual desktop", "ctrl-alt-."],
  "super-ctrl-space": ["Windows: last input language", "ctrl-alt-n"],
  "super-ctrl-c": ["Windows: color filters", "ctrl-alt-p"],
  "super-ctrl-f": ["Windows: find computers on a network", "f11"],
  "super-ctrl-b": ["Windows: go to the notification area's app", "ctrl-alt-g"],
  "super-ctrl-t": ["PowerToys: Always On Top", "ctrl-alt-t"],
  "super-alt-space": ["PowerToys: Command Palette", "ctrl-shift-p"],
};

// The bound keys that never reach Herdr on Windows: [{ key, section, action, takenBy, instead }].
export function reservedKeys(keys) {
  return Object.entries(keys).flatMap(([section, bound]) => Object.entries(bound).flatMap(([key, action]) => {
    const digit = /^super-alt-([1-9])$/.exec(key)?.[1];
    const [takenBy, instead] = digit ? ["Windows: the taskbar app's jump list", `ctrl-${digit}`] : TAKEN[key] ?? [];
    return takenBy ? [{ key, section, action, takenBy, instead }] : [];
  }));
}

// The mods keys open (mod.open:<mod>) that aren't among the installed ones.
export function missingKeyMods(keys, installed) {
  const have = new Set(installed);
  return [...new Set(Object.values(keys).flatMap((bound) => Object.values(bound))
    .flatMap((action) => /^mod\.open:(.+)$/.exec(String(action))?.[1] ?? [])
    .filter((mod) => !have.has(mod)))].sort();
}
