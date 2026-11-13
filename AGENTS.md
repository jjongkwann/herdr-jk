# AGENTS.md

How to work in this repo. [`README.md`](README.md) says what the layout does, [`DEVELOPMENT.md`](DEVELOPMENT.md) which file to change for each part, and [`RECIPE.md`](RECIPE.md) is the full brief for building it again.

## What the repo holds

- This is `jjongkwann/herdr-jk` (remote `origin`). It holds the `omarchy` layout (`layouts/omarchy.json`), its `omarchy-*` mods, `keys.json`, themes and wallpapers, and nothing else.
- Other mods the layout places live in their own repos: `files-plus`, `pr-flow`, `herdr-sim`, Shepherdr's `chat`, `tasks`, `artifacts`, `task-*` and `new-menu-tasks`, and `reviewer`. `layouts/omarchy.json` naming mods that are not in this repo is intended. Don't copy those mods in, and don't remove them from the layout.
- The repo started from `shafiqimtiaz/herdr-omarchy` (remote `upstream`), which is reference only: its push URL is disabled. Bring an upstream commit in with `git cherry-pick -x <sha>` so the upstream sha stays in the message. When it conflicts, keep this repo's behavior and fit the upstream feature into it. Never push to upstream or open pull requests there.
- Commit messages are English and follow the repo's style: `feat(omarchy-keys): ...`, `fix(omarchy-ai-usage): ...`.

## Checks

Run both before you call a change done:

```sh
npm test                          # node --test tests/*.mjs, no install step
herdr-app check mods/<name>       # each mod you changed
```

`herdr-app check` loads the entry point, its helper imports and the first render. It does not run clicks or later asynchronous states. `herdr-app check mods/omarchy-keys` can fail with "interrupted" when the machine is busy (the render goes over the time limit); rerun it before blaming your change.

## The installed copy

- Herdr runs the copy in `~/.config/herdr-app`, which is separate from this repo. Edits here change nothing in the app until the changed files are copied there.
- Herdr rewrites the installed `layouts/omarchy.json` as the person works (sizes, open panels, the wallpaper). Never copy it back into the repo.
- The person installs this only on this Mac. Their Windows PC runs plain Herdr, and nothing is copied to other machines.
- In a Herdr task, don't copy files into `~/.config/herdr-app`, switch layouts or drive the Herdr window: the Assistant installs the change after the person accepts it.
- Saving a mod file in `~/.config/herdr-app` reloads every copy of that mod. Make all of a file's changes in one save.
- Shepherdr's chat mod has local edits on this Mac so its mic works: `~/.config/herdr-app/mods/chat/record.ts` records with ffmpeg on macOS, and `mods/chat/dictate.js` has a changed whisper model path. They are edits to another project's installed mod, not part of this repo, and a Shepherdr update replaces them.

## Writing mod code

- Each folder under `mods/` is a mod that installs on its own. `main.js` is its entry point, and it imports only files in its own folder.
- Mods use `gpui-kit`, `gpui-base` and `herdr`. They also get `crypto` (`createHash`) and `os`; `os.platform()` returns `"macos"`, not `"darwin"`. `window()` is undefined under `herdr-app check`.
- `parked.js` has one copy each in `omarchy-agents`, `omarchy-spaces` and `omarchy-tabs`. Keep the three identical; `tests/parked.test.mjs` checks it.
- `omarchy-tabs/coordinator.js`, `live.js`, `spacelog.js` and `ui.js` are unchanged copies of Shepherdr's files in `~/.config/herdr-app/lib/`. `~/.config/herdr-app/bin/sync-shared` does not update them; copy them again when Shepherdr changes them.
- Put logic that needs tests in a file with no `herdr` imports (for example `omarchy-pane/assistant.js`, `omarchy-tabs/jump.js`, `omarchy-tabs/history.js`), so `node --test` can import it.
- Shepherdr's installed mods in `~/.config/herdr-app/mods` are read-only references for the points where this repo meets them, such as the shared `chat.startreq` request, `coordinator.openreq`, and the chat's `data/chat-sendreq.json` with `chat.send`.

## Testing notes

- `tests/ai-usage.test.mjs` loads the mod's files through `Function()` with the herdr functions passed in. Its `mount(h)` gives a `cx` mock that keeps the 60-second tick and counts `notify()` calls.
- To test a mod's clicks without the live app, load its `main.js` against a fake herdr host and elements that record their children and handlers, as `tests/sidebar-close.test.mjs` does.
- To see a mod's render without touching the live app, copy `keys.json` and `mods/` into a scratch folder and run `HERDR_APP_HOME=<scratch> herdr-app check <mod> --print-spec`. `keys()` drops keys whose mod is not in that home.
- `herdr-app check mods/omarchy-chrome` renders only the header, since it gets no props. To check the footer, check a scratch copy whose `main.js` makes `props()` return `{ footer: true }`.
