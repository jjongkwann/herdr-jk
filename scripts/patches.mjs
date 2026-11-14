#!/usr/bin/env node
// Local patches for installed mods this repo doesn't own (patches/README.md): which ones an install
// has, and applying the missing ones. git apply does the work.
//
//   node scripts/patches.mjs status [--root <dir>] [--root <Root>=<dir>]
//   node scripts/patches.mjs apply [--root <dir>] [--root <Root>=<dir>] [names…]
//
// --root <dir> is the install root the patches' paths are relative to (default ~/.config/herdr-app),
// where the owner's version is read too. A patch whose header names another (Root: ~/.config/herdr-core)
// applies there; --root <Root>=<dir> moves that one (--root ~/.config/herdr-core=/tmp/core). A name
// is a patch's path under patches/ without .patch (shepherdr/3.1.34/tasks-agy-brief), or a folder of
// them (shepherdr/3.1.34). Exits 1 while any patch is missing or conflicts.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PATCHES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "patches");

// The "Key: value" lines above a patch's first diff: { subject, owner, versions, root }. root is the
// install root its paths are relative to, as written ("~/.config/herdr-core"); null: the default root.
export function parseHeader(text) {
  const head = text.split(/^diff --git /m)[0];
  const field = (k) => new RegExp(`^${k}:[ \\t]*(.+)$`, "mi").exec(head)?.[1].trim() ?? null;
  return { subject: field("Subject"), owner: field("Owner"), versions: field("Versions") ?? "*", root: field("Root") };
}

// A root as a header or --root writes it, as a full path ("~/…" is under the home folder).
export function expandRoot(path, home = homedir()) {
  return resolve(String(path).replace(/^~(?=$|\/)/, home));
}

// Where a patch applies: its header's Root (or where --root <Root>=<dir> moved it, in `moved`, by
// full path), else the default root.
export function rootFor(header, root, moved = {}, home = homedir()) {
  if (!header.root) return root;
  const at = expandRoot(header.root, home);
  return moved[at] ?? at;
}

// The files a patch changes, relative to the install root; `created` when it adds the file.
export function patchFiles(text) {
  return text.split(/^(?=diff --git )/m).filter((part) => part.startsWith("diff --git ")).map((part) => {
    const path = /^\+\+\+ b\/(.+)$/m.exec(part)?.[1] ?? /^diff --git a\/(\S+) b\//.exec(part)[1];
    return { path, created: /^--- \/dev\/null$/m.test(part) };
  });
}

export function compareVersions(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Whether a version is in a range: "*", "3.1.5", or comparators that all hold (">=3.1.5 <3.1.29").
export function inRange(version, range) {
  if (!range || range.trim() === "*") return true;
  if (!version) return false;
  return range.trim().split(/\s+/).every((c) => {
    const [, op, v] = /^(>=|<=|>|<|=)?(.+)$/.exec(c);
    const d = compareVersions(version, v);
    return { ">=": d >= 0, "<=": d <= 0, ">": d > 0, "<": d < 0 }[op] ?? d === 0;
  });
}

// What a patch is on an install. applicable: whether the installed version is in its range (null: the
// version can't be read); targets: whether the files it changes are there.
export function classify({ applicable, targets, reverse, forward }) {
  if (applicable === false) return "not applicable";
  if (!targets) return "target missing";
  if (applicable === null) return "not applicable";
  if (reverse) return "applied";
  return forward ? "missing" : "conflict";
}

// Where an owner's installed version is read, under the install root; null when it can't be.
const VERSION_OF = {
  shepherdr: (root) => /^VERSION = "([^"]+)"/m.exec(read(join(root, "bin", "shepherdr")) ?? "")?.[1] ?? null,
};

function read(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function listPatches(dir = PATCHES) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listPatches(p) : e.name.endsWith(".patch") ? [p] : [];
  }).sort();
}

// git apply in the install root; a repository above it is never taken for the root's own.
function gitApply(root, file, ...flags) {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolve(root)) };
  return spawnSync("git", ["apply", "--whitespace=nowarn", ...flags, file], { cwd: root, env, encoding: "utf8" });
}

// The owner's version is read under the default root (Shepherdr's bin/shepherdr), wherever the patch applies.
export function check(root, file, moved = {}) {
  const text = readFileSync(file, "utf8");
  const header = parseHeader(text);
  const version = header.owner && VERSION_OF[header.owner] ? VERSION_OF[header.owner](root) : null;
  const at = rootFor(header, root, moved);
  const targets = patchFiles(text).every((f) => f.created || existsSync(join(at, f.path)));
  const applicable = version || header.versions === "*" ? inRange(version, header.versions) : null;
  const ok = (...flags) => gitApply(at, file, "--check", ...flags).status === 0;
  const reverse = targets && applicable && ok("-R");
  const forward = targets && applicable && !reverse && ok();
  return { name: relative(PATCHES, file).replace(/\.patch$/, ""), file, ...header, version, at,
    state: classify({ targets, applicable, reverse, forward }) };
}

function line(p, root) {
  const why = p.state === "not applicable" ? `  (for ${p.owner} ${p.versions}; installed: ${p.version ?? "unknown"})` : "";
  return `  ${p.state.padEnd(15)} ${p.name}${p.at !== root ? `  (in ${p.at})` : ""}${why}`;
}

function summary(list) {
  const n = (s) => list.filter((p) => p.state === s).length;
  return `${n("applied")} applied, ${n("missing")} missing, ${n("conflict")} conflict, ${n("not applicable")} not applicable, ${n("target missing")} target missing`;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  let root = join(homedir(), ".config", "herdr-app");
  const names = [], moved = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--root") {
      const v = rest[++i] ?? "", eq = v.indexOf("=");
      if (eq > 0) moved[expandRoot(v.slice(0, eq))] = expandRoot(v.slice(eq + 1));
      else root = resolve(v);
    } else names.push(rest[i].replace(/\.patch$/, "").replace(/\/$/, ""));
  }
  if (!["status", "apply"].includes(cmd) || (cmd === "status" && names.length)) {
    console.error("usage: node scripts/patches.mjs status [--root <dir>] [--root <Root>=<dir>]\n"
      + "       node scripts/patches.mjs apply [--root <dir>] [--root <Root>=<dir>] [names…]");
    return 2;
  }
  let list = listPatches().map((f) => check(root, f, moved));
  if (names.length) {
    const unknown = names.filter((n) => !list.some((p) => p.name === n || p.name.startsWith(n + "/")));
    if (unknown.length) {
      console.error(`no such patch: ${unknown.join(", ")}`);
      return 2;
    }
    list = list.filter((p) => names.some((n) => p.name === n || p.name.startsWith(n + "/")));
  }
  console.log(`Patches for ${root}`);
  if (cmd === "apply") {
    list = list.map((p) => {
      if (p.state !== "missing") return p;
      const r = gitApply(p.at, p.file);
      if (r.status !== 0) return { ...p, state: "conflict", note: r.stderr.trim() };
      return { ...check(root, p.file, moved), note: "applied now" };
    });
  }
  for (const p of list) {
    console.log(line(p, root) + (p.note ? `  ${p.note === "applied now" ? "(applied now)" : p.note}` : "")
      + (cmd === "apply" && p.state === "conflict" && !p.note ? "  (left alone: needs a manual port)" : ""));
  }
  console.log(summary(list));
  return list.some((p) => p.state === "missing" || p.state === "conflict") ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
