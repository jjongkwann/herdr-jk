# Working on Omarchy

Each folder under `mods/` is a self-contained Herdr mod. `main.js` is its entry point. Keep helper imports within that folder so the mod can be installed independently. Herdr runs the UI with `gpui-kit`, `gpui-base`, and `herdr`. Mods also get `crypto` (`createHash`) and `os`; the rest of Node is available only in tests. `layouts/omarchy.json` also places mods from other repos (files-plus, pr-flow, herdr-sim, Shepherdr's chat, tasks and artifacts, reviewer); they are not in this repo. [`AGENTS.md`](AGENTS.md) has the rules for working here and the testing notes.

## Where to make changes

| Change | File |
| --- | --- |
| Layout, tile sizes, spacing | `layouts/omarchy.json` |
| Theme colors | `themes/*.json` |
| Theme wallpapers | `backgrounds/omarchy/<theme>/` |
| Next-wallpaper and full-screen keys | `mods/omarchy-bar/main.js` |
| Wallpaper picker | `mods/omarchy-backgrounds/main.js` |
| Theme picker | `mods/omarchy-themes/main.js` |
| Commit graph table, header, Manygit list | `mods/omarchy-changes/graph/graph.js` |
| Git commands, parsing, menus, dialogs | `mods/omarchy-changes/graph/git.js` |
| Settings state, persistence, machine actions | `mods/omarchy-settings/main.js` |
| Layout, theme, appearance, font pickers | `mods/omarchy-settings/look.js` |
| Settings buttons, rows, toggles, steppers | `mods/omarchy-settings/controls.js` |
| Usage endpoints, credentials, agent/provider routing | `mods/omarchy-ai-usage/providers.js` |
| Usage countdowns and quota-window timing | `mods/omarchy-ai-usage/time.js` |
| Usage display, refresh scheduling, cached results | `mods/omarchy-ai-usage/main.js` |
| Mod installation, updates, removal | `mods/omarchy-mod-manager/core.js` |
| Mod Manager text contrast and colors | `mods/omarchy-mod-manager/palette.js` |
| Mod Manager navigation and display | `mods/omarchy-mod-manager/main.js` |
| Changes view: diff, wrap, split, branches, commit | `mods/omarchy-changes/main.js` |
| Git switch row: Changes, Graph, Review, PRs | `mods/omarchy-changes/switch.js` |
| Tab strip, its panel buttons, running-tab and pane back/forward keys | `mods/omarchy-tabs/main.js` |
| Next or previous tab with a running agent | `mods/omarchy-tabs/jump.js` |
| Pane back / forward history | `mods/omarchy-tabs/history.js` |
| Reopen closed tab: snapshot and reopen key | `mods/omarchy-tabs/main.js` |
| Reopen: agent resume commands | `mods/omarchy-tabs/reopen.js` |
| Reopen: process scan, exact pane tree restore | `mods/omarchy-tabs/reopen.py` |
| Keybindings list, sections and folding | `mods/omarchy-keys/main.js` |
| Keybinding labels, types and folded runs | `mods/omarchy-keys/describe.js` |
| Pane header, Chat \| Terminal switch | `mods/omarchy-pane/main.js` |
| Assistant tab opening in Terminal view | `mods/omarchy-pane/assistant.js` |
| Pane widths across the Chat \| Terminal swap | `mods/omarchy-pane/pane-size.py` |
| Agents shown as Chat (one copy per mod, kept identical) | `mods/omarchy-agents/parked.js`, `mods/omarchy-spaces/parked.js`, `mods/omarchy-tabs/parked.js` |
| Ending agents whose chat pane closed | `mods/omarchy-agents/sweep.js` |
| Spaces list and its hover close button | `mods/omarchy-spaces/main.js` |
| Agents list and its hover close button | `mods/omarchy-agents/main.js` |
| Sidebar footer and its height | `mods/omarchy-chrome/main.js` |
| Dictation: recording, whisper, paste, chat box | `mods/omarchy-voice/main.js`, `mods/omarchy-voice/voice.js` |
| Live dictation helper (macOS 26+) | `mods/omarchy-voice/live.swift` |
| Dictation bubble and where it sits | `mods/omarchy-voice-live/main.js`, `mods/omarchy-voice-live/spot.js` |
| Shared browser: open command, agent script, viewer | `mods/omarchy-browser/open.js`, `mods/omarchy-browser/ab`, `mods/omarchy-browser/view.sh` |
| Browser pane header: the page's error count and its popup, reload on save | `mods/omarchy-pane/viewer.js`, `mods/omarchy-pane/main.js`, `mods/omarchy-browser/page.mjs` |
| DevTools pane below the Browser pane, its button and key | `mods/omarchy-browser/devtools.mjs`, `mods/omarchy-pane/viewer.js`, `mods/omarchy-pane/main.js` |
| Theme switcher and its previews | `mods/omarchy-themes/main.js`, `mods/omarchy-themes/previews/` |

## Check changes

From the repo root, run `npm test`. Tests use Node's built-in runner with no installation step. Provider tests use fake login files and HTTP responses.

From the repo root, check each changed mod, for example:

```sh
herdr-app check mods/omarchy-settings
herdr-app check mods/omarchy-ai-usage
herdr-app check mods/omarchy-mod-manager
```

`check` loads the entry point, helper imports, and initial UI. It does not exercise later clicks or asynchronous states. When changing UI behavior, also exercise the affected picker, panel, or dialog in Herdr. Repo edits and installed copies under `~/.config/herdr-app` are separate unless explicitly linked.
