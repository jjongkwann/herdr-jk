// The first Claude Code or Codex opened in a space with no Assistant becomes its Assistant.
// Shepherdr's Assistant is that same agent: a plain `claude` whose first message is the assistant
// template's words, labelled for its space. So an agent just opened, before its first turn, gets
// that message and those labels. An agent that already has a conversation is left alone.
// No herdr imports, so tests can run this.

// How long after its last status report a just-opened agent still counts as just opened.
export const FRESH_MS = 2 * 60000;

const AGENTS = new Set(["claude", "codex"]);
const bare = (id) => String(id).split("/").pop();
const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

const isAssistant = (k) => k.state === "live"
  && (k.labels?.["herdr.role"] === "coordinator" || k.template === "assistant" || k.template === "coordinator");

// The person's own agent: not a task's worker, a reviewer, a sub-agent or an Assistant.
const own = (k) => k.state === "live" && AGENTS.has(k.program?.key) && !k.parent && !k.template
  && !k.labels?.["herdr.task"] && !k.labels?.["herdr.role"];

// The agents to adopt now: [{ space, address, tab }], at most one per space. A space qualifies when it
// has no Assistant and this idle agent, shown in one of its tabs and with no turn yet, is its only agent.
export function firstAgents({ spaces, terminals, panes }) {
  const out = [];
  for (const k of terminals) {
    if (!own(k) || k.turn || k.status !== "idle") continue;
    const pane = panes.find((p) => p.terminal === k.address);
    const space = pane && spaces.find((s) => s.tabs.some((t) => t.id === pane.tab));
    if (!space) continue;
    const id = bare(space.id), tabs = new Set(space.tabs.map((t) => t.id));
    const here = terminals.filter((t) => machineOf(t.address) === (space.machine ?? null));
    if (here.some((t) => isAssistant(t) && [t.labels?.["herdr.coordinator.space"], t.labels?.["herdr.space"]].includes(id))) continue;
    // Shown in this space, or parked as a Chat, which keeps the space's label.
    const agents = here.filter((t) => own(t) && (t.labels?.["herdr.space"] === id || panes.some((p) => p.terminal === t.address && tabs.has(p.tab))));
    if (agents.length === 1) out.push({ space, address: k.address, tab: pane.tab });
  }
  return out;
}

// Whether a command line starts a new conversation (not a resumed one, nor a one-shot run).
export function startsFresh(argv = []) {
  const args = argv.slice(1).map(String);
  if (argv.some((a) => /(^|[/\\])codex(\.\w+)?$/.test(String(a)))) return !args.some((a) => ["resume", "fork", "exec", "e"].includes(a));
  return !args.some((a) => /^(--resume|-r|--continue|-c|--print|-p)(=|$)/.test(a));
}

// The last word before adopting, from `hc get`'s record of the terminal.
export function stillFresh(k, now = Date.now()) {
  return k?.state === "live" && !k.parent && !k.template && !k.turn && k.status?.state === "idle"
    && now - (k.status_ms ?? 0) <= FRESH_MS && startsFresh(k.foreground?.argv ?? []);
}

// The assistant template's words, without its header. Empty when it has none.
export const assistantWords = (template) => String(template ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

// The labels that make a terminal its space's Assistant.
export const assistantLabels = (space, tab) => ["herdr.role=coordinator",
  `herdr.coordinator.space=${bare(space.id)}`, `herdr.coordinator.tab=${bare(tab)}`];

// The words go in as the person's (hc connect names no caller), as Shepherdr's chat sends them.
export const sendRequest = (address, text) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.send", params: { terminal: address, text } });
