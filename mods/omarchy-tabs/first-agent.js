// The first Claude Code or Codex opened in a space with no Assistant becomes its Assistant.
// Shepherdr's Assistant is that same agent: a plain `claude` whose first message is the assistant
// template's words, labelled for its space. So an agent just opened, before its first turn, gets
// that message and those labels. An agent that already has a conversation is left alone.
// No herdr imports, so tests can run this.

// How long after its last status report a just-opened agent still counts as just opened.
export const FRESH_MS = 2 * 60000;
// How long the first message may take: hc holds it while the person is typing (up to 60 s after their last key).
export const SEND_MS = 90000;

const AGENTS = new Set(["claude", "codex"]);
const SHELLS = /(^|[\\/])-?(zsh|bash|fish|sh|dash|nu|pwsh|powershell|cmd|elvish|xonsh|tcsh|csh|ksh|ion)(\.exe)?$/i;
const bare = (id) => String(id).split("/").pop();
const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

const isAssistant = (k) => k.state === "live"
  && (k.labels?.["herdr.role"] === "coordinator" || k.template === "assistant" || k.template === "coordinator");

// At a shell's prompt, reporting nothing. Herdr can still name the last agent there (on Windows `app` stays
// claude-code after it exits), so hc's `agent`, the program in front, counts too.
const atPrompt = (k) => !k.status && Boolean(k.program?.shell || SHELLS.test(String(k.agent ?? "")));
const isAgent = (k) => !atPrompt(k) && (AGENTS.has(k.program?.key) || ["claude-code", "codex"].includes(k.agent));

// The person's own agent: not a task's worker, a reviewer, a sub-agent or an Assistant.
const own = (k) => k.state === "live" && isAgent(k) && !k.parent && !k.template
  && !k.labels?.["herdr.task"] && !k.labels?.["herdr.role"];

// hc's `turn` counts everything a terminal ever ran, so an agent started in a used terminal begins above zero.
// A new agent shows as a terminal at its prompt, reporting nothing, whose program then starts reporting. `starts`
// keeps PROMPT for the first and { turn, at } for the second; the agent's own first turn moves past that turn.
// A terminal not watched from its prompt has no entry, so an agent already running there is left alone.
const PROMPT = Object.freeze({ at: 0 });
export function noteStarts(starts, terminals, now = Date.now()) {
  for (const k of terminals) {
    if (atPrompt(k)) starts.set(k.address, PROMPT);
    else if (k.status && starts.get(k.address) === PROMPT) starts.set(k.address, { turn: k.turn ?? 0, at: now });
  }
}
const noTurnYet = (turn, start) => !turn || turn === start;

// One try per start of an agent: `claude -c` and the plain `claude` after it in one terminal are two.
export const attemptOf = (address, starts) => `${address}@${starts.get(address)?.at ?? 0}`;

// The agents to adopt now: [{ space, address, tab }], at most one per space. A space qualifies when it
// has no Assistant and this idle agent, shown in one of its tabs and with no turn yet, is its only agent.
export function firstAgents({ spaces, terminals, panes, starts = new Map() }) {
  const out = [];
  for (const k of terminals) {
    if (!own(k) || !noTurnYet(k.turn, starts.get(k.address)?.turn) || k.status !== "idle") continue;
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

// A home folder on macOS, Linux or Windows (also as Git's sh writes it): no project for an Assistant to run.
export const isHome = (path) => /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/[a-z]\/Users\/[^/]+)[\\/]?$/.test(String(path ?? ""));

// The last word before adopting, from `hc get`'s record of the terminal. The agent's own folder comes first:
// the terminal's can be where its shell started. `start`: the turn noteStarts saw this agent start at.
export function stillFresh(k, now = Date.now(), start) {
  return k?.state === "live" && !k.parent && !k.template && noTurnYet(k.turn, start) && k.status?.state === "idle"
    && now - (k.status_ms ?? 0) <= FRESH_MS && startsFresh(k.foreground?.argv ?? []) && !isHome(k.foreground?.cwd ?? k.cwd);
}

// The assistant template's words, without its header. Empty when it has none.
export const assistantWords = (template) => String(template ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

// The labels that make a terminal its space's Assistant.
export const assistantLabels = (space, tab) => ["herdr.role=coordinator",
  `herdr.coordinator.space=${bare(space.id)}`, `herdr.coordinator.tab=${bare(tab)}`];

// The words go in as the person's (hc connect names no caller), as Shepherdr's chat sends them.
export const sendRequest = (address, text) => `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.send", params: { terminal: address, text } })}\n`;

// Why a send failed, or null when hc answered with a result.
export function sendFailure({ code, stdout = "", stderr = "" }) {
  if (code === 0 && stdout.includes('"result"')) return null;
  return (stderr.trim() || stdout.trim() || `hc connect exited with ${code}`).slice(0, 300);
}

// hc connect stops when its input ends, without waiting for the answer, so its input stays open until one comes.
const SEND = `out="$1.out"; : > "$out"
{ cat "$1"; n=0; while [ ! -s "$out" ] && [ $n -lt ${SEND_MS / 100} ]; do sleep 0.1; n=$((n+1)); done; } | hc connect > "$out"
cat "$out"`;

// Sends the first message through a file: the words are longer than a Windows command line (32,767 characters),
// and a mod's exec has no stdin. io: herdr's { exec, writeTextFile, appHome }. Throws when it wasn't delivered.
export async function deliver({ exec, writeTextFile, appHome }, address, text) {
  const file = `${appHome()}/data/first-message-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await writeTextFile(file, sendRequest(address, text), null);
  try {
    const failure = sendFailure(await exec("sh", ["-c", SEND, "hc-send", file], { timeout: SEND_MS }));
    if (failure) throw new Error(failure);
  } finally {
    await exec("sh", ["-c", 'rm -f "$1" "$1.out"', "hc-clean", file]).catch(() => {});
  }
}

// Every window showing a space sees the same new agent (this Mac's and the PC's show the PC's spaces). Each writes
// its own token and reads it back after a pause, so only the last one written goes on. Returns hc's record, or null.
export const CLAIM = "herdr.adopting";
export async function claimAdoption({ hc, exec }, address, token = Math.random().toString(36).slice(2)) {
  const set = await hc(["label", address, `${CLAIM}=${token}`]);
  if (set.code !== 0) throw new Error(set.stderr.trim() || `hc label ${address} failed`);
  await exec("sh", ["-c", "sleep 2"]);
  const got = await hc(["get", address]);
  if (got.code !== 0) throw new Error(got.stderr.trim() || `hc get ${address} failed`);
  const k = JSON.parse(got.stdout);
  return k.labels?.[CLAIM] === token ? k : null;
}
