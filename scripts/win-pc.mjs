#!/usr/bin/env node
// Installs this Mac's Herdr setup on the Windows PC. Run it on the Mac.
//
//   node scripts/win-pc.mjs stage              builds the package from ~/.config/herdr-app and proves it on a
//                                              scratch home on the PC; the live install stays as it is
//   node scripts/win-pc.mjs apply [--dry-run]  backs up what it changes, then installs what stage proved
//   node scripts/win-pc.mjs rollback [backup]  undoes an apply from its backup (default: the latest)
//   node scripts/win-pc.mjs backups            lists the backups on the PC
//
// scripts/win-pc/remote.mjs does the work on the PC, in %TEMP%\herdr-win-pc.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchFiles } from "./patches.mjs";
import { FONTS, MODS, SHARED_TREES, TREES, packaged, stripLayout } from "./win-pc/core.mjs";

const MACHINE = "win-pc";
const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(homedir(), ".config", "herdr-app");
// Fixes the Windows install needs that this Mac's install may not have yet.
const PACKAGE_PATCHES = ["shepherdr/3.1.41/windows-coordinator"];

function hcExec(args, timeout = 590) {
  const r = spawnSync("hc", ["exec", "--on", MACHINE, "--json", "--timeout", String(timeout), "--", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw new Error(`hc exec failed: ${r.stdout}${r.stderr}`); }
  const text = (b64) => Buffer.from(b64 ?? "", "base64").toString("utf8").replaceAll("\r\n", "\n");
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr), timedOut: out.timed_out };
}

// The work folder on the PC, with forward slashes (scp and node both take them).
function workFolder() {
  const r = hcExec(["node", "-p", "require('path').join(process.env.TEMP,'herdr-win-pc').replaceAll('\\\\','/')"], 30);
  if (r.code !== 0) throw new Error(`can't reach ${MACHINE}: ${r.stderr}`);
  return r.stdout.trim();
}

function remote(work, ...args) {
  const r = hcExec(["node", `${work}/remote.mjs`, ...args]);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.timedOut) throw new Error(`${args[0]} on ${MACHINE} ran out of time`);
  return r.code;
}

function applyPatch(root, name) {
  const file = join(HERE, "..", "patches", `${name}.patch`);
  const skip = patchFiles(readFileSync(file, "utf8")).filter((f) => !existsSync(join(root, f.path))).map((f) => `--exclude=${f.path}`);
  const git = (...flags) => spawnSync("git", ["apply", "--whitespace=nowarn", ...skip, ...flags, file],
    { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolve(root)) } });
  if (git("-R", "--check").status === 0) return;
  const r = git();
  if (r.status !== 0) throw new Error(`${name} does not apply: ${r.stderr}`);
}

// The package: payload/ (files laid out as in the install root), fonts/ and mac.json.
function buildPackage(dir) {
  const payload = join(dir, "payload");
  const copy = (rel) => cpSync(join(INSTALL, rel), join(payload, rel), {
    recursive: true, dereference: true, filter: (src) => packaged(relative(INSTALL, src)),
  });
  [...MODS.map((mod) => `mods/${mod}`), ...TREES, ...SHARED_TREES, "layouts/omarchy.svg"].forEach(copy);
  PACKAGE_PATCHES.forEach((name) => applyPatch(payload, name));

  const { layout, removed } = stripLayout(JSON.parse(readFileSync(join(INSTALL, "layouts", "omarchy.json"), "utf8")));
  writeFileSync(join(payload, "layouts", "omarchy.json"), JSON.stringify(layout, null, 2));
  console.log(`Layout: left out ${removed.join(", ")}`);

  mkdirSync(join(dir, "fonts"));
  for (const { file } of FONTS) cpSync(join(homedir(), "Library", "Fonts", file), join(dir, "fonts", file));
  const read = (name) => JSON.parse(readFileSync(join(INSTALL, name), "utf8"));
  writeFileSync(join(dir, "mac.json"), JSON.stringify({ keys: read("keys.json"), settings: read("settings.json") }));
}

function stage() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-win-pc-"));
  try {
    const pkg = join(dir, "package");
    mkdirSync(pkg);
    buildPackage(pkg);
    const tgz = join(dir, "package.tgz");
    const tar = spawnSync("tar", ["czf", tgz, "-C", pkg, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" }, encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
    const id = createHash("sha256").update(readFileSync(tgz)).digest("hex");
    writeFileSync(join(dir, "package.sha256"), id);
    console.log(`Package: ${(readFileSync(tgz).length / 1048576).toFixed(0)} MB, ${id.slice(0, 12)}`);

    const work = workFolder();
    const made = hcExec(["node", "-e", `require('fs').mkdirSync(${JSON.stringify(work)},{recursive:true})`], 30);
    if (made.code !== 0) throw new Error(made.stderr);
    const files = [tgz, join(dir, "package.sha256"), join(HERE, "win-pc", "remote.mjs"), join(HERE, "win-pc", "core.mjs"), join(HERE, "win-pc", "shim.cs")];
    const scp = spawnSync("scp", ["-q", ...files, `${MACHINE}:/${work}/`], { encoding: "utf8" });
    if (scp.status !== 0) throw new Error(`scp failed: ${scp.stderr}`);

    for (const phase of ["scratch", "prepare", "check", "finish"]) {
      const code = remote(work, phase);
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main([cmd, ...rest]) {
  if (cmd === "stage") return stage();
  if (["apply", "rollback", "backups"].includes(cmd)) return remote(workFolder(), cmd, ...rest);
  console.error("usage: node scripts/win-pc.mjs stage | apply [--dry-run] | rollback [backup] | backups");
  return 2;
}

process.exitCode = main(process.argv.slice(2));
