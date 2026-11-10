// A parked agent (parked.js) carries the core label herdr.chat=<its chat pane>. When that pane
// is gone (its tab or space closed, even one never shown since Herdr started), the agent ends,
// as closing its pane would have ended it, and its chat asks go with it. While the pane is
// there, core keep is kept on. A machine is only judged once its layout has loaded, and a pane
// must be missing twice in a row. Shepherdr runs it from its tab bar, omarchy from this list.
// Adapted from Shepherdr's lib/parked.js sweep() (https://github.com/eliasstravik/shepherdr,
// MIT, Copyright (c) 2026 Elias Stravik; the license text is in omarchy-pane/NOTICE).

import { machines, panes, terminals, run, exec, hc, appHome } from "herdr";

const missing = new Set();
const kept = new Set();

async function keepOn(address) {
  kept.add(address);
  try {
    const t = JSON.parse((await hc(["get", address, "--json"])).stdout);
    if (t.keep === false) await hc(["keep", address]);
  } catch { kept.delete(address); }
}

export function sweep() {
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const ps = panes();
  const have = new Set(ps.map((p) => p.pane));
  const own = new Set(ps.map((p) => p.terminal).filter(Boolean));
  for (const k of terminals()) {
    const chat = k.labels?.["herdr.chat"];
    if (!chat || k.state !== "live") { kept.delete(k.address); continue; }
    const machine = k.address.includes("/") ? k.address.split("/")[0] : "";
    if (!ready.has(machine) || have.has(chat) || own.has(k.address)) {
      missing.delete(k.address);
      // Parking turned core keep off: on again, so it survives a lost core like a pane's terminal.
      if (have.has(chat) && !own.has(k.address) && !kept.has(k.address)) keepOn(k.address);
      continue;
    }
    if (!missing.has(k.address)) { missing.add(k.address); continue; }
    missing.delete(k.address);
    run("terminal.kill", { terminal: k.address });
    if (!machine) exec("sh", ["-c", 'rm -f "$1/open/$2" "$1/req/$2".*.json "$1/ans/$2".*.json', "x", `${appHome()}/data/chat-asks`, k.address]);
  }
}
