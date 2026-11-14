#!/bin/sh
# The omarchy browser in a pane: herdr-app's browser viewer (bin/herdr-browser-view) on the
# @omarchy browser that `ab` drives.
#   view.sh [worker]   run the viewer; worker: the agent terminal told when the person takes over
#   view.sh --check    exit 0 when agent-browser and the viewer are installed, else print what's missing
# The viewer quits once omarchy.view in its browser folder is 15 s old, so this touches it every 5 s
# for as long as the viewer runs.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
app=${HERDR_APP_HOME:-$(cd "$(dirname "$0")/../.." && pwd)}
[ -f "$app/bin/herdr-browser-view" ] || app="$HOME/.config/herdr-app"
viewer="$app/bin/herdr-browser-view"

missing=
command -v agent-browser >/dev/null 2>&1 || missing="agent-browser (npm i -g agent-browser@0.41.1, then agent-browser install)"
[ -f "$viewer" ] || missing="${missing:+$missing; }herdr-app's browser viewer ($viewer)"
command -v node >/dev/null 2>&1 || missing="${missing:+$missing; }node"
if [ "${1-}" = --check ]; then
  [ -z "$missing" ] && exit 0
  echo "$missing"; exit 1
fi
if [ -n "$missing" ]; then
  echo "omarchy browser: missing $missing" >&2
  exit 1
fi

# The browser folder, as bin/herdr-browser picks it: Shepherdr's state folder once this machine's data
# moved there (Shepherdr 3.1.34's layout move), else the old ~/.herdr/browser.
if [ -n "${SHEPHERDR_HOME:-}" ]; then shep_data="$SHEPHERDR_HOME/data"; shep_state="$SHEPHERDR_HOME/state"
else shep_data="${XDG_DATA_HOME:-$HOME/.local/share}/shepherdr"; shep_state="${XDG_STATE_HOME:-$HOME/.local/state}/shepherdr"; fi
if [ "$(cut -c1 "$shep_data/LAYOUT" 2>/dev/null)" = 2 ] && [ ! -e "$HOME/.herdr/.layout-rollback" ]; then root="$shep_state/browser"
else root="$HOME/.herdr/browser"; fi
mkdir -p "$root" && chmod 700 "$root"
beat="$root/omarchy.view"
touch "$beat"
# The viewer replaces this shell (same pid), so the loop ends within 5 s of the viewer exiting.
# It stays in the foreground itself: a background job of sh gets /dev/null for input.
self=$$
( while kill -0 "$self" 2>/dev/null; do touch "$beat"; sleep 5; done ) </dev/null >/dev/null 2>&1 &
exec node "$viewer" --task @omarchy ${1:+--worker "$1"}
