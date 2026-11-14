<div align="center">

# herdr-jk

**A personal [Herdr](https://herdr.dev) layout and mods, styled after the [Omarchy](https://github.com/basecamp/omarchy) desktop.**

[What differs from upstream](#what-differs-from-upstream) · [Install](#install) · [Voice dictation](#voice-dictation) · [Keys](#keys) · [What is inside](#what-is-inside) · [Development](#development)

![Omarchy layout in Herdr](preview.png)

</div>

This is [jjongkwann/herdr-jk](https://github.com/jjongkwann/herdr-jk). It started as a copy of [shafiqimtiaz/herdr-omarchy](https://github.com/shafiqimtiaz/herdr-omarchy), Shafiq Imtiaz's Omarchy layout for Herdr, and has since grown its own features for one person's Mac. The look, the themes and the wallpapers come from [Omarchy](https://github.com/basecamp/omarchy) by Basecamp (MIT, see [`LICENSE-omarchy`](LICENSE-omarchy)).

The repo holds the `omarchy` layout and its `omarchy-*` mods. Terminals and coding agents sit in rounded, see-through tiles over a wallpaper. The sidebar shows which spaces and agents are busy, the top bar shows how much AI quota is left, and a side panel holds your files, Git changes, the commit graph, pull requests and Shepherdr's tasks. From upstream it keeps Omarchy's themes, wallpapers and theme switcher, the restyled palette, Settings and mod manager, and `ctrl-alt-shift-t` to reopen a closed tab in place.

## What differs from upstream

- **Chat | Terminal switch.** With [Shepherdr](https://github.com/eliasstravik/shepherdr)'s chat mod installed, Claude Code and Codex pane headers get a Chat | Terminal switch; `super-ctrl-c` switches the focused pane. A chat pane shows its agent's name, folder and status, and the sidebar and tab strip still count an agent while it is shown as Chat. Pane widths stay the same across the switch. A space's Assistant tab opens in Terminal view: once it has been on screen for two seconds, an Assistant chat with no agent yet starts its agent and the header shows that agent's terminal.
- **Voice dictation.** `super-ctrl-v` dictates into the focused terminal or Shepherdr chat box, typing the words while you speak. See [Voice dictation](#voice-dictation).
- **One shared browser (`omarchy-browser`).** Agents drive one persistent browser with the mod's `ab` script, and the tab strip's Browser button opens it as a split to the right of the focused pane. It runs on herdr-app's own task browser (session `herdr-omarchy`, profile `~/.herdr/browser/omarchy`), so sign-ins persist. It needs agent-browser and herdr-app's browser viewer; without them the button says what is missing. While the Browser pane is on screen, its header shows how many errors the page has had since it loaded (console errors, uncaught exceptions, failed loads, as DevTools counts them); a click lists the latest ones. When the page is local (`localhost`, `127.0.0.1`, `*.localhost`, a file), saving a page file (HTML, CSS, JS/TS, JSON, SVG, images, Markdown) in the space's folder reloads it; the header's **On save** button turns that off for the pane. The header's **DevTools** button, or `super-ctrl-i`, opens Chrome's DevTools for the page in a pane below the Browser pane (in a second browser session, so it never mixes with the agents' browser); press it again to close it. While DevTools is open, a breakpoint stops the agents' page too.
- **Wallpaper picker.** `super-ctrl-b` picks any wallpaper from any theme. Changing the theme keeps the wallpaper, and `super-ctrl-w` cycles the current theme's wallpapers.
- **See-through panes.** Terminals draw at 70% opacity over the wallpaper, tiles and panes have a 12px radius, and the gaps are 8px.
- **AI usage always shows Claude, Codex and Antigravity**, in that order, when this machine has their login; agents in the focused tab follow them. Antigravity's quota comes from the file its statusline saves, without a network call. On macOS, Claude's login is read from the Keychain, where Claude Code keeps it fresh.
- **One Git button.** Changes, the commit graph, Review and PRs share one side-panel view with a switch row at the top, so the tab strip has a single Git button.
- **Pane back / forward.** `super-ctrl-left` and `super-ctrl-right` go back and forward through the panes you focused, across tabs and spaces, like a browser's history.
- **Keys for macOS.** Spaces, agents and full screen use `super` (⌘) keys, since Ctrl+1…9 switch desktops on macOS. See [Keys](#keys).
- **Buttons for other mods.** The tab strip shows Simulator, Browser, Tasks and Artifacts buttons only when the mod behind each one is installed. The Files panel uses files-plus.

### Brought in from upstream

These upstream features were merged by the recent tasks and fitted to the changes above:

- **Keybinding groups.** `super-k` lists every key in plain English, grouped by type (Spaces, Tabs, Panes, Agents, Terminal, Git, Dialogs, Look, App). Numbered runs like `alt-1` … `alt-9` fold into one row, a click on a heading folds it, and the fold is remembered.
- **Sidebar close buttons.** Hover a space or an agent to close it with its ×. One with an agent working or waiting on you asks for a second click within 3 seconds.
- **Compact footer.** Settings, Keybindings, Mods and Add machine sit in a 2×2 grid with short labels (full names in tooltips); the folded rail keeps a stack of four.
- **Running-tab keys.** `super-shift-left` and `super-shift-right` jump to the previous or next tab with a working or blocked agent, or to the plain previous or next tab when none has one.
- **AI usage fixes.** Claude profile names from `settings.json`'s `claude_labels` are found again, the bar keeps redrawing while a quota request is slow, and each provider has at most one request in flight.

### Mods it expects

`layouts/omarchy.json` also places mods that live in their own repos. Install them alongside this one:

| Mod | Where it comes from | What it does here |
| --- | --- | --- |
| `files-plus` | [jjongkwann/herdr-files-plus](https://github.com/jjongkwann/herdr-files-plus) | The Files panel |
| `pr-flow` | [jjongkwann/herdr-pr-flow](https://github.com/jjongkwann/herdr-pr-flow) | PRs in the Git panel; `super-shift-r` refreshes it |
| `herdr-sim` | [jjongkwann/herdr-sim](https://github.com/jjongkwann/herdr-sim) | The Simulator panel |
| `chat`, `tasks`, `artifacts`, `task-*`, `new-menu-tasks` | [Shepherdr](https://github.com/eliasstravik/shepherdr) | Chat panes and the Chat \| Terminal switch, the Tasks and Artifacts panels, and the tab strip's `+` menu |
| `reviewer` | Vytas Gavelis's review mod (MIT) | Review in the Git panel |

## Install

Ask your agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add the layout from github.com/jjongkwann/herdr-jk.
```

The agent copies the layout, mods, themes and wallpapers into `~/.config/herdr-app`. Your own layout stays; pick a layout in Settings › Look. Add the [mods it expects](#mods-it-expects) the same way.

> [!NOTE]
> Some mods use the network or run programs:
> - `omarchy-ai-usage` reads the local login files of your AI agents (Claude, Codex, Copilot, OpenCode and Pi) and, on macOS, Claude Code's Keychain entry with `security`. It uses the tokens to get your usage from each provider's API. Antigravity's quota is read from `~/.gemini/antigravity-cli/quota-cache.json`.
> - `omarchy-spaces`, `omarchy-files` and `omarchy-changes` run `git` in your folders. The commit graph in `omarchy-changes` also runs `find` to look for repos in a folder that is not one.
> - `omarchy-tabs` and `omarchy-pane` run `python3` to read and restore pane trees and sizes.
> - `omarchy-voice` records the microphone. It builds its live helper with `swiftc`, and runs `whisper-cli`, `ffmpeg`, `hc` and `osascript` (to save and restore the clipboard). Everything stays on this computer.
> - `omarchy-browser` runs herdr-app's `bin/herdr-browser` and its viewer. `omarchy-pane` runs `node` (`omarchy-browser/page.mjs`) every 4 seconds while the Browser pane is on screen, to read the page's errors from Chrome's local debugging port, and to reload a local page when a file in the space's folder is saved. Its DevTools pane runs `node` (`omarchy-browser/devtools.mjs`) with herdr-app's viewer on a second session, `herdr-omarchy-devtools` (profile `~/.herdr/browser/omarchy-devtools`), closed again when the pane closes.
> - `omarchy-mod-manager` searches GitHub for mods. It runs `git` and `gh` to download and install them.

## Voice dictation

`super-ctrl-v`, or the mic in the top bar, starts dictation; press it again to stop. The mic shows the recording time.

- **Live mode** (macOS 26 or later, where `mods/omarchy-voice/live.swift` builds with `swiftc`): Apple's on-device dictation model types the words into the focused terminal while you say them, in the language macOS dictation is set to. When you stop, whisper.cpp writes the whole recording down and its text replaces what was typed; whisper also catches English words inside Korean speech. Control characters are never typed (they become spaces), so a line end in the text can't press Enter. A small bubble above the input line shows a mic and the language while it listens, and a loader while whisper writes.
- **Into a Shepherdr chat.** With a chat pane focused, the words go into the chat's input box after any draft already there, and whisper's text replaces them when you stop.
- **Without the live helper**, ffmpeg records, whisper.cpp writes the recording down when you stop, and the text is pasted into the focused terminal without Enter. The clipboard then gets back what it held before.

It needs whisper.cpp (`brew install whisper-cpp`) and a whisper model in `~/.config/herdr-app/data/whisper` (`ggml-large-v3-turbo-q5_0.bin` is picked first), and Herdr must be allowed to use the microphone. Live mode also needs the dictation language's on-device model; the path without it needs ffmpeg (`brew install ffmpeg`). A recording stops at 5 minutes. To help whisper with names and terms, list them one per line in `~/.config/herdr-app/data/omarchy-voice/words.txt`; the words on the terminal's screen are added to them.

> [!TIP]
> A one-key start: a [Karabiner-Elements](https://karabiner-elements.pqrs.org) rule can send `super-ctrl-v` (⌘⌃V) when Right Control is tapped alone with Herdr in front. This is setup on your own Mac, not part of the repo. The rule's shape:
>
> ```json
> {
>   "description": "Herdr: right_control alone -> cmd+ctrl+v (voice dictation)",
>   "manipulators": [{
>     "type": "basic",
>     "from": { "key_code": "right_control", "modifiers": { "optional": ["any"] } },
>     "to": [{ "key_code": "right_control" }],
>     "to_if_alone": [{ "key_code": "v", "modifiers": ["left_command", "left_control"] }],
>     "conditions": [{ "type": "frontmost_application_if", "bundle_identifiers": ["^dev\\.herdr\\.app$"] }]
>   }]
> }
> ```

## Keys

These are the keys in [`keys.json`](keys.json). They work only in the Omarchy layout. `super` is ⌘ on macOS. `super-k` lists every key.

| Key | Action |
| --- | --- |
| `alt-1` … `alt-9` | Go to tab 1 to 9 |
| `super-alt-1` … `super-alt-9` | Go to space 1 to 9 |
| `alt-left` / `alt-right` | Previous / next tab |
| `super-shift-left` / `super-shift-right` | Previous / next tab with a working or blocked agent; the plain previous / next tab when none has one |
| `alt-up` / `alt-down` or `super-up` / `super-down` | Previous / next space |
| `super-shift-up` / `super-shift-down` | Previous / next agent, in the sidebar's order |
| `super-ctrl-left` / `super-ctrl-right` | Back / forward through the panes you focused |
| `alt-enter` / `alt-shift-enter` | Split the pane right / down |
| `super-return` | New terminal |
| `ctrl-alt-shift-t` | Reopen the last closed tab |
| `super-w` | Close the pane |
| `super-f` | Zoom the pane |
| `super-ctrl-c` | Switch the focused pane between Chat and Terminal |
| `super-ctrl-i` | Open or close DevTools below the Browser pane |
| `super-c` / `super-v` | Copy / paste |
| `super-ctrl-v` | Start or stop voice dictation |
| `super-shift-r` | Refresh pull requests (pr-flow) |
| `super-alt-space` or `ctrl-shift-p` | Open the command palette |
| `super-shift-space` | Show or hide the top bar |
| `super-ctrl-f` | Enter or leave full screen |
| `super-k` | Show every key binding |
| `super-ctrl-t` or `super-ctrl-shift-space` | Pick a theme |
| `super-ctrl-b` | Pick a wallpaper, from any theme |
| `super-ctrl-w` or `super-ctrl-space` | Change to the theme's next wallpaper |
| `ctrl-,` | Open Settings |
| `ctrl-shift-m` | Open the mod manager |

Moving between panes is Herdr's own default, `super-alt` arrows; this repo doesn't bind it.

## What is inside

The repo has the same structure as a Herdr home folder:

| Path | Contents |
| --- | --- |
| `layouts/omarchy.json` | The layout: tile tree, sizes and spacing |
| `mods/` | One folder for each `omarchy-*` mod. Each mod installs on its own. |
| `themes/` | The Omarchy color themes, plus Dracula |
| `backgrounds/omarchy/` | The wallpapers of each theme |
| `keys.json` | The layout keys |
| `tests/` | Node tests for the mods' logic |
| `RECIPE.md` | The full brief. An agent can build the layout again from it. |

## Development

Run the tests from the repo root. They use the Node test runner and need no install step:

```sh
npm test
```

Check each mod that you change:

```sh
herdr-app check mods/omarchy-settings
```

[`DEVELOPMENT.md`](DEVELOPMENT.md) shows which file to change for each part of the layout, and [`AGENTS.md`](AGENTS.md) says how to work in this repo.

> [!TIP]
> Your edits in this repo do not change the copy in `~/.config/herdr-app`. Copy the changed files there to see them in Herdr.

## Credits

- [Omarchy](https://github.com/basecamp/omarchy) by Basecamp: the look, themes, wallpapers and theme previews (MIT, [`LICENSE-omarchy`](LICENSE-omarchy)).
- [shafiqimtiaz/herdr-omarchy](https://github.com/shafiqimtiaz/herdr-omarchy): the layout this repo started from.
- The Chat | Terminal switch and `parked.js` are adapted from [Shepherdr](https://github.com/eliasstravik/shepherdr) (MIT), and `omarchy-voice` follows the dictation flow of Shepherdr's chat mod.
- `omarchy-tabs` is based on RofieSagara/herdr-auto-tabs (Apache-2.0), the commit graph on rabeeh-ta/herdr-git-graph (MIT), and the file icons are Charmed icons. Each mod's `NOTICE` or license file has the details.
