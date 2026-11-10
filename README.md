<div align="center">

# Omarchy for Herdr

**A [Herdr](https://herdr.dev) layout that looks like the [Omarchy](https://github.com/basecamp/omarchy) desktop.**

[Features](#features) · [Install](#install) · [Keys](#keys) · [What is inside](#what-is-inside) · [Development](#development)

![Omarchy layout in Herdr](preview.png)

</div>

The Omarchy desktop, rebuilt inside Herdr. Your terminals and coding agents sit in flat, square, bordered tiles that float over a wallpaper. Everything you need while agents work is on one screen: which spaces and agents are busy, how much AI quota is left, your files, your Git changes and the whole commit graph. It follows Omarchy closely, down to the themes, the wallpapers, the theme switcher and the keys.

## Highlights

- **Agents at a glance.** The sidebar lists every agent with its live status: working, needs you, done or idle. Tabs show each agent's icon, what it works on and a spinner while it runs.
- **AI usage in the top bar.** The 5-hour and 7-day quotas of the agents on screen sit in the middle of the bar, each with a bar in its provider's color. Claude profiles are named, so a work and a personal account are easy to tell apart. Click for reset times.
- **Closed a tab by mistake? Bring it back.** `ctrl-alt-shift-t` reopens the last closed tab in the same place, with the same splits and sizes. Claude, Codex and pi come back in their own conversations, with their flags and profiles.
- **Git without leaving the window.** The side panel shows your changes with a diff (wrap long lines, drag the split), commits, pushes, pulls, stashes and switches or creates branches. One click opens the full commit graph, with branch lanes, labels and right-click menus for checkout, merge, rebase, reset and tags.
- **Omarchy's themes and wallpapers.** Every Omarchy theme ships with all of its wallpapers. The theme switcher is Omarchy 4's: big desktop previews, left and right to choose. `super-ctrl-b` picks a wallpaper from any theme, and `super-ctrl-w` cycles the current theme's. Light themes switch Herdr to light mode, dark ones back to dark.
- **Omarchy's keys.** The layout uses Omarchy's own keys wherever GNOME leaves them free. `super-k` lists every key, with the ones that came with the layout set apart.
- **Square dialogs that match.** The command palette, Settings, a Keybindings list and a mod manager that browses, reviews and installs community mods all share the same look.

## Features

- **Top bar**: your spaces on the left, AI usage in the middle, search, sidebar and window buttons on the right.
- **Sidebar**: spaces and agents with their status. Resize it, or fold it into an icon rail. The footer opens Settings, Keybindings and Mods.
- **Tabs**: agent icons, what each one works on, its status, and a close button on hover.
- **Side panel**: Files with colored icons, and Changes with the commit graph inside it.
- **Themes**: every Omarchy color theme, each with its wallpapers.

## Install

Ask your agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add the layout from github.com/shafiqimtiaz/herdr-omarchy.
```

The agent copies the layout, mods, themes and wallpapers into `~/.config/herdr-app`. Your own layout stays. Press `ctrl-shift-l` to change between layouts.

> [!NOTE]
> Some mods use the network or run programs:
> - `omarchy-ai-usage` reads the local login files of your AI agents (Claude, Codex, Copilot, OpenCode and Pi). It uses the tokens in them to get your usage from the API of each provider.
> - `omarchy-spaces`, `omarchy-files` and `omarchy-changes` run `git` in your folders. The commit graph in `omarchy-changes` also runs `find` to look for repos in a folder that is not one.
> - `omarchy-mod-manager` searches GitHub for mods. It runs `git` and `gh` to download and install them.

## Keys

These keys work only in the Omarchy layout, except Ctrl+arrows, which also apply in terminals across layouts. They follow Omarchy: its Herdr keymap and its desktop keys. Keys that GNOME already uses are left out. `super-k` lists every key.

| Key | Action |
| --- | --- |
| `alt-1` … `alt-9` | Go to tab 1 to 9 |
| `super-alt-1` … `super-alt-9` | Go to space 1 to 9 |
| `alt-left` / `alt-right` | Previous / next tab |
| `alt-up` / `alt-down` or `super-up` / `super-down` | Previous / next space |
| `super-shift-up` / `super-shift-down` | Previous / next agent, in the sidebar's order |
| `ctrl-left` / `ctrl-right` / `ctrl-up` / `ctrl-down` | Move between panes |
| `alt-enter` / `alt-shift-enter` | Split the pane right / down |
| `super-return` | New terminal |
| `ctrl-alt-shift-t` | Reopen the last closed tab, with its agents resumed |
| `super-w` | Close the pane |
| `super-f` | Zoom the pane |
| `super-c` / `super-v` | Copy / paste |
| `super-alt-space` | Open the command palette (also `ctrl-shift-p`) |
| `super-shift-space` | Show or hide the top bar |
| `super-k` | Show every key binding |
| `super-ctrl-t` or `super-ctrl-shift-space` | Pick a theme |
| `super-ctrl-b` | Pick a wallpaper, from any theme |
| `super-ctrl-w` or `super-ctrl-space` | Change to the theme's next wallpaper |
| `ctrl-,` | Open Settings |
| `ctrl-shift-m` | Open the mod manager |
| `ctrl-shift-l` | Change to a different layout |

Left out because GNOME uses them: Omarchy Herdr's `ctrl-space` prefix (input method), `alt-esc` (cycle windows), `ctrl-alt-arrows` and `ctrl-alt-shift-arrows` (workspaces). Herdr's own `alt-h/j/k/l` still move between panes.

Ctrl+arrows take priority over terminal shortcuts, including Ctrl+Left/Right word movement.

## What is inside

The repo has the same structure as a Herdr home folder:

| Path | Contents |
| --- | --- |
| `layouts/omarchy.json` | The layout: tile tree, sizes and spacing |
| `mods/` | One folder for each mod. Each mod installs on its own. |
| `themes/` | The Omarchy color themes |
| `backgrounds/omarchy/` | The wallpapers of each theme |
| `keys.json` | The layout keys |
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

[`DEVELOPMENT.md`](DEVELOPMENT.md) shows which file to change for each part of the layout.

> [!TIP]
> Your edits in this repo do not change the copy in `~/.config/herdr-app`. Copy the changed files there to see them in Herdr.
