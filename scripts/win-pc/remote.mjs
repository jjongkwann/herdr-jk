// The Windows side of scripts/win-pc.mjs, run there with node from its work folder (%TEMP%\herdr-win-pc).
//
//   node remote.mjs scratch|prepare|check|finish   the stage: a scratch copy of the install, checked
//   node remote.mjs apply [--dry-run]      backs up what it changes, then installs the staged package
//   node remote.mjs rollback [backup]      undoes an apply from its backup (default: the latest)
//   node remote.mjs backups                lists the backups

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS, MODS, SHARED_TREES, TOOLS, TREES, layoutMods, mergeKeys, mergeSettings, missingKeyMods, reservedKeys } from "./core.mjs";

const WORK = dirname(fileURLToPath(import.meta.url));
const PKG = join(WORK, "package"), PAYLOAD = join(PKG, "payload"), SHIM = join(WORK, "shim.exe");
const REPORT = join(WORK, "stage-report.json"), SANDBOX = join(WORK, "sandbox");
const BACKUP_PREFIX = "herdr-app.win-pc-backup-", INCOMING = ".win-pc-incoming";
const LIVE_FONT_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const SANDBOX_FONT_KEY = "HKCU\\Software\\herdr-win-pc-sandbox\\Fonts";
// What Herdr writes as it runs: not copied into the scratch home, and not compared after a rollback.
const RUNTIME = new Set(["data", "telemetry", "herdr-app.sock", "view.json", "window.json", "shared.json", "seen.json", INCOMING]);

const live = () => ({
  live: true, home: join(homedir(), ".config", "herdr-app"), bin: join(homedir(), ".local", "bin"),
  fonts: join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"), fontKey: LIVE_FONT_KEY, backups: join(homedir(), ".config"),
});
const sandbox = () => ({
  live: false, home: join(SANDBOX, "home"), bin: join(SANDBOX, "bin"), fonts: join(SANDBOX, "fonts"), fontKey: SANDBOX_FONT_KEY, backups: SANDBOX,
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 60000, ...opts });

// Windows refuses a rename for a moment while something (an antivirus, Herdr's watcher) has the file open.
function retry(fn) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 20 || !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}
const move = (from, to) => { fs.mkdirSync(dirname(to), { recursive: true }); retry(() => fs.renameSync(from, to)); };
const remove = (p) => retry(() => fs.rmSync(p, { recursive: true, force: true }));

// Whether the install already has this theme or background, line endings aside (Herdr writes its own with CRLF here).
function alreadyThere(t, rel) {
  const target = join(t.home, rel), source = join(PAYLOAD, rel);
  if (!exists(target) || !fs.statSync(source).isFile() || !fs.statSync(target).isFile()) return false;
  const text = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return text(target) === text(source);
}

// Everything an apply does, in order. Nothing here touches the disk.
function plan(t) {
  const mac = readJson(join(PKG, "mac.json"));
  const trees = [
    ...MODS.map((mod) => `mods/${mod}`), ...TREES,
    ...SHARED_TREES.flatMap((tree) => fs.readdirSync(join(PAYLOAD, tree)).map((entry) => `${tree}/${entry}`).filter((rel) => !alreadyThere(t, rel))),
    "layouts/omarchy.json", "layouts/omarchy.svg",
  ];
  const litter = fs.readdirSync(join(t.home, "mods")).filter((name) => name.startsWith("._"));
  return [
    ...litter.map((name) => ({ kind: "remove", path: join(t.home, "mods", name), label: `mods/${name}` })),
    ...trees.map((rel) => ({ kind: "tree", rel, path: join(t.home, rel), label: rel })),
    { kind: "write", path: join(t.home, "keys.json"), label: "keys.json", text: JSON.stringify(mergeKeys(readJson(join(t.home, "keys.json")), mac.keys), null, 2) },
    { kind: "write", path: join(t.home, "settings.json"), label: "settings.json", text: JSON.stringify(mergeSettings(readJson(join(t.home, "settings.json")), mac.settings), null, 2) },
    ...TOOLS.map(({ name }) => ({ kind: "file", source: SHIM, path: join(t.bin, `${name}.exe`), label: join(t.bin, `${name}.exe`) })),
    ...FONTS.flatMap((f) => [
      { kind: "file", source: join(PKG, "fonts", f.file), path: join(t.fonts, f.file), label: join(t.fonts, f.file) },
      { kind: "reg", key: t.fontKey, name: f.value, value: join(t.fonts, f.file), label: `${t.fontKey}: ${f.value}` },
    ]),
  ];
}

function regRead(key, name) {
  const r = run("reg", ["query", key, "/v", name]);
  return r.status === 0 ? /REG_\w+\s+(.*)$/m.exec(r.stdout)?.[1]?.trim() ?? null : null;
}

// Copies one tree of the package to a folder beside its target, with the tools' shims in it.
function incomingTree(step, dir) {
  fs.cpSync(join(PAYLOAD, step.rel), dir, { recursive: true });
  for (const tool of TOOLS) {
    if (tool.dir === step.rel || tool.dir.startsWith(`${step.rel}/`)) fs.copyFileSync(SHIM, join(dir, relative(step.rel, tool.dir), `${tool.name}.exe`));
  }
}

// Applies the plan, one swap per target so a mod appears whole. The manifest is saved after each
// step: an apply that stops halfway can still be rolled back.
function install(t, steps, stamp, dry) {
  const backup = join(t.backups, `${BACKUP_PREFIX}${stamp}`);
  const manifest = { stamp, package: packageId(), home: t.home, actions: [] };
  const save = () => fs.writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest, null, 2));
  const saved = (i, step) => join(backup, "files", `${i}-${step.path.split(/[\\/]/).pop()}`);
  if (!dry) { fs.mkdirSync(backup, { recursive: true }); save(); }
  console.log(dry ? "Apply would change:" : `Backup: ${backup}`);
  steps.forEach((step, i) => {
    const had = step.kind === "reg" ? regRead(step.key, step.name) !== null : exists(step.path);
    if (step.kind === "write" && had && fs.readFileSync(step.path, "utf8") === step.text) return console.log(`  unchanged ${step.label}`);
    const verb = step.kind === "remove" ? "remove" : had ? "replace" : "add";
    console.log(`  ${dry ? "would " : ""}${verb} ${step.label}`);
    if (dry) return;
    if (step.kind === "reg") {
      manifest.actions.push({ op: "reg", key: step.key, name: step.name, previous: regRead(step.key, step.name) });
      const r = run("reg", ["add", step.key, "/v", step.name, "/t", "REG_SZ", "/d", step.value, "/f"]);
      if (r.status !== 0) throw new Error(`reg add failed: ${r.stderr}`);
    } else if (step.kind === "remove") {
      move(step.path, saved(i, step));
      manifest.actions.push({ op: "removed", path: step.path, saved: saved(i, step) });
    } else {
      const incoming = join(t.home, INCOMING, String(i));
      fs.mkdirSync(dirname(incoming), { recursive: true });
      if (step.kind === "tree") incomingTree(step, incoming);
      else if (step.kind === "file") fs.copyFileSync(step.source, incoming);
      else fs.writeFileSync(incoming, step.text);
      if (had) move(step.path, saved(i, step));
      manifest.actions.push(had ? { op: "replaced", path: step.path, saved: saved(i, step) } : { op: "added", path: step.path });
      save();
      move(incoming, step.path);
    }
    save();
  });
  if (!dry) remove(join(t.home, INCOMING));
  return backup;
}

// Loads or unloads fonts for this session (AddFontResourceW, RemoveFontResourceW); prints how many it took.
function fontCall(fn, files) {
  const calls = files.map((f) => `[F]::${fn}('${f}')`).join(";");
  const script = `Add-Type -Namespace '' -Name F -MemberDefinition '[DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int ${fn}(string f);'; ${calls}`;
  return run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
}

// Undoes a backup's actions, last first, and returns what it could not undo. It touches only the paths in
// its manifest, and can run again after a partial undo.
function undo(backup) {
  const file = join(backup, "manifest.json"), manifest = readJson(file), failed = [];
  if (manifest.rolledBack) throw new Error(`${backup} was already rolled back`);
  for (const a of [...manifest.actions].reverse()) {
    if (a.op === "reg") {
      if (a.previous === null) run("reg", ["delete", a.key, "/v", a.name, "/f"]);
      else run("reg", ["add", a.key, "/v", a.name, "/t", "REG_SZ", "/d", a.previous, "/f"]);
      console.log(`  restored ${a.key}: ${a.name}`);
      continue;
    }
    try {
      if (a.path.endsWith(".ttf")) fontCall("RemoveFontResourceW", [a.path]);
      if (a.op === "added") remove(a.path);
      else if (exists(a.saved)) { remove(a.path); move(a.saved, a.path); }
      console.log(`  ${a.op === "added" ? "removed" : "restored"} ${a.path}`);
    } catch (e) {
      failed.push(a.path);
      console.log(`  COULD NOT UNDO ${a.path}: ${e.message}`);
    }
  }
  remove(join(manifest.home, INCOMING));
  if (!failed.length) manifest.rolledBack = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return failed;
}

const packageId = () => fs.readFileSync(join(WORK, "package.sha256"), "utf8").trim();

function listBackups(t) {
  return fs.readdirSync(t.backups).filter((n) => n.startsWith(BACKUP_PREFIX) && exists(join(t.backups, n, "manifest.json"))).sort();
}

// A file list of an install, to compare before an apply and after its rollback.
function fingerprint(home) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relative(home, join(dir, e.name)).replaceAll("\\", "/");
      if (RUNTIME.has(rel) || e.name === "gpui-kit.d.ts" || e.name === "jsconfig.json") continue;
      if (e.isDirectory()) walk(join(dir, e.name));
      else out.push(`${rel} ${createHash("sha1").update(fs.readFileSync(join(dir, e.name))).digest("hex")}`);
    }
  };
  walk(home);
  return out.sort();
}

// The environment of everything the stage runs: its own home, its own herdr-core, nothing of the person's.
function stageEnv(t) {
  const user = join(SANDBOX, "user");
  fs.mkdirSync(user, { recursive: true });
  return { ...process.env, HERDR_APP_HOME: t.home, HC_SESSION: "win-pc-stage", USERPROFILE: user, HOME: user, HERDR_TELEMETRY: "0", PATH: `${t.bin};${process.env.PATH}` };
}

// The scratch home: a copy of the live install, which is only read.
function scratch() {
  const csc = join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const built = run(csc, ["/nologo", "/optimize", "/target:exe", `/out:${SHIM}`, join(WORK, "shim.cs")]);
  if (built.status !== 0) throw new Error(`the shim did not compile: ${built.stdout}${built.stderr}`);
  remove(PKG);
  fs.mkdirSync(PKG, { recursive: true });
  const tar = run(join(process.env.WINDIR, "System32", "tar.exe"), ["-xzf", join(WORK, "package.tgz"), "-C", PKG], { timeout: 300000 });
  if (tar.status !== 0) throw new Error(`the package did not unpack: ${tar.stderr}`);

  const t = sandbox(), real = live();
  remove(SANDBOX);
  fs.mkdirSync(t.bin, { recursive: true });
  fs.cpSync(real.home, t.home, { recursive: true, filter: (src) => !RUNTIME.has(relative(real.home, src).replaceAll("\\", "/")) });
  // The tools as ~/.local/bin holds them. A symlink needs admin rights to make, so its target is copied.
  for (const { name } of TOOLS) fs.copyFileSync(fs.realpathSync(join(real.bin, name)), join(t.bin, name));
  console.log(`Scratch home: ${t.home}`);
}

function prepare() {
  const t = sandbox();
  const before = fingerprint(t.home);
  install(t, plan(t), "stage", false);
  fs.writeFileSync(REPORT, JSON.stringify({ package: packageId(), before }));
}

async function checkMods(t) {
  const env = stageEnv(t), mods = fs.readdirSync(join(t.home, "mods"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const one = (mod) => new Promise((done) => {
    const p = spawn("herdr-app", ["check", join(t.home, "mods", mod)], { env, windowsHide: true, timeout: 120000 });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("error", (e) => done({ mod, code: 1, out: String(e) }));
    p.on("close", (code) => done({ mod, code, out }));
  });
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < mods.length) {
      const mod = mods[next++];
      let r = await one(mod);
      if (r.code !== 0 && /interrupted/.test(r.out)) r = await one(mod);
      results.push(r);
    }
  }));
  const failed = results.filter((r) => r.code !== 0).map((r) => ({ mod: r.mod, out: r.out.trim().slice(-600) }));
  console.log(`herdr-app check: ${results.length - failed.length} of ${results.length} mods pass`);
  failed.forEach((f) => console.log(`  FAIL ${f.mod}: ${f.out}`));
  return { total: results.length, failed };
}

// Each tool, started the two ways Shepherdr's mods start it: by its path and by its bare name.
function checkTools(t) {
  const env = stageEnv(t), rows = [];
  const tryIt = (label, cmd, args) => {
    const r = run(cmd, args, { env, timeout: 30000 });
    rows.push({ label, ok: r.status === 0, code: r.status ?? String(r.error) });
    console.log(`  ${r.status === 0 ? "ok  " : "FAIL"} ${label}${r.status === 0 ? "" : `: ${(r.stderr || r.error || "").toString().trim().slice(-300)}`}`);
  };
  console.log("Shepherdr's tools:");
  const verb = { "herdr-task": ["list", "--all", "--json"], "herdr-artifact": ["list"], "herdr-secret": ["--help"] };
  for (const { name, dir } of TOOLS) {
    tryIt(`${name} by path`, join(t.home, dir, name), verb[name]);
    tryIt(`${name} by name`, name, verb[name]);
  }
  // ~/.local/bin/herdr-artifact is a symlink here: what its shim will run.
  tryIt("python through the real ~/.local/bin/herdr-artifact", "python", ["-X", "utf8", join(live().bin, "herdr-artifact"), "--help"]);
  return rows;
}

function checkContent(t) {
  const installed = fs.readdirSync(join(t.home, "mods"));
  const keys = readJson(join(t.home, "keys.json")), settings = readJson(join(t.home, "settings.json"));
  const missingInLayout = layoutMods(readJson(join(t.home, "layouts", "omarchy.json"))).filter((m) => !installed.includes(m));
  const missingKeys = missingKeyMods(keys, installed);
  const themeFound = exists(join(t.home, "themes", `${settings.theme}.json`));
  const script = "Add-Type -AssemblyName System.Drawing; foreach ($f in $args) { $c = New-Object System.Drawing.Text.PrivateFontCollection; $c.AddFontFile($f); $c.Families[0].Name }";
  const names = run("powershell", ["-NoProfile", "-Command", `& { ${script} } ${FONTS.map((f) => `'${join(PKG, "fonts", f.file)}'`).join(" ")}`]);
  const families = names.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const fontOk = families.length === FONTS.length && families.every((f) => f === settings.font);
  console.log(`Layout: every mod it names is installed: ${missingInLayout.length ? `NO (${missingInLayout})` : "yes"}`);
  console.log(`Keys: every mod they open is installed: ${missingKeys.length ? `NO (${missingKeys})` : "yes"}`);
  console.log(`Theme ${settings.theme}: ${themeFound ? "found" : "NOT FOUND"}`);
  console.log(`Font: files report "${families.join('", "')}", settings ask for "${settings.font}"`);
  const taken = reservedKeys(keys);
  console.log(`Keys Windows takes before Herdr sees them (${taken.length}):`);
  taken.forEach((k) => console.log(`  ${k.key.padEnd(24)} ${k.action.padEnd(30)} ${k.takenBy}; use ${k.instead}`));
  return { missingInLayout, missingKeys, themeFound, fontOk, taken: taken.length };
}

function finish() {
  const t = sandbox(), report = readJson(REPORT);
  const backup = join(t.backups, `${BACKUP_PREFIX}stage`);
  const stuck = undo(backup);
  run("reg", ["delete", "HKCU\\Software\\herdr-win-pc-sandbox", "/f"]);
  const after = fingerprint(t.home);
  const rollback = !stuck.length && JSON.stringify(after) === JSON.stringify(report.before);
  console.log(`Rollback on the scratch home restored every file: ${rollback ? "yes" : "NO"}`);
  if (!rollback) {
    const was = new Set(report.before), now = new Set(after);
    [...was].filter((x) => !now.has(x)).slice(0, 20).forEach((x) => console.log(`  lost ${x}`));
    [...now].filter((x) => !was.has(x)).slice(0, 20).forEach((x) => console.log(`  left ${x}`));
  }
  const ok = rollback && report.checks.failed.length === 0 && report.tools.every((r) => r.ok)
    && !report.content.missingInLayout.length && !report.content.missingKeys.length && report.content.themeFound && report.content.fontOk;
  fs.writeFileSync(REPORT, JSON.stringify({ ...report, before: undefined, rollback, ok, at: new Date().toISOString() }, null, 2));
  remove(SANDBOX);
  console.log("");
  install(live(), plan(live()), "dry-run", true);
  console.log("");
  console.log(ok ? "Stage passed." : "Stage FAILED: apply will refuse this package.");
  return ok ? 0 : 1;
}

function apply(dry) {
  const report = exists(REPORT) ? readJson(REPORT) : null;
  if (!report?.ok || report.package !== packageId()) {
    console.error("No passing stage for this package. Run: node scripts/win-pc.mjs stage");
    return 1;
  }
  const t = live(), steps = plan(t);
  if (dry) { install(t, steps, "dry-run", true); return 0; }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  let backup;
  try {
    backup = install(t, steps, stamp, false);
  } catch (e) {
    console.error(`Apply stopped: ${e.message}\nUndo what it did with: node scripts/win-pc.mjs rollback ${BACKUP_PREFIX}${stamp}`);
    return 1;
  }
  fontCall("AddFontResourceW", FONTS.map((f) => join(t.fonts, f.file)));
  const broken = TOOLS.filter(({ name, dir }) => run(join(t.home, dir, name), ["--help"], { timeout: 30000 }).status !== 0).map((x) => x.name);
  if (broken.length) console.error(`These tools did not start: ${broken.join(", ")}`);
  console.log(`\nInstalled. Backup: ${backup}`);
  console.log("To show it: herdr-app do layout.switch --name omarchy");
  console.log(`To undo it: node scripts/win-pc.mjs rollback ${backup.split(/[\\/]/).pop()}`);
  return broken.length ? 1 : 0;
}

function rollback(name) {
  const t = live(), all = listBackups(t);
  const open = all.filter((n) => !readJson(join(t.backups, n, "manifest.json")).rolledBack);
  const pick = name ?? open.at(-1);
  if (!pick || !all.includes(pick)) { console.error(name ? `No backup named ${name}` : "No backup to roll back"); return 1; }
  if (pick !== open.at(-1)) { console.error(`${open.at(-1) ?? pick} is the newest apply still in place: roll that back first`); return 1; }
  const shown = JSON.parse(run("herdr-app", ["status"]).stdout || "{}").layout;
  if (shown === "omarchy") { console.error("The window is showing the omarchy layout. Switch away first: herdr-app do layout.switch --name main"); return 1; }
  const failed = undo(join(t.backups, pick));
  if (failed.length) { console.error(`${failed.length} paths are still in use. Close Herdr and run this again.`); return 1; }
  console.log(`Rolled back ${pick}. Restart Herdr so the window drops the removed mods.`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const save = (fields) => fs.writeFileSync(REPORT, JSON.stringify({ ...readJson(REPORT), ...fields }));
const commands = {
  scratch: () => { scratch(); return 0; },
  prepare: () => { prepare(); return 0; },
  check: async () => {
    const t = sandbox();
    const checks = await checkMods(t), tools = checkTools(t), content = checkContent(t);
    run("hc", ["server", "stop"], { env: stageEnv(t) });
    save({ checks, tools, content });
    return 0;
  },
  finish,
  apply: () => apply(rest.includes("--dry-run")),
  rollback: () => rollback(rest[0]),
  backups: () => { listBackups(live()).forEach((n) => console.log(n)); return 0; },
};
if (!commands[cmd]) { console.error(`unknown command: ${cmd}`); process.exitCode = 2; } else process.exitCode = await commands[cmd]();
