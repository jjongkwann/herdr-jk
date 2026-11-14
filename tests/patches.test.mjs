import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, compareVersions, expandRoot, inRange, parseHeader, patchFiles, rootFor } from '../scripts/patches.mjs';

const PATCH = `Subject: Chat: macOS clipboard
Owner: shepherdr
Versions: >=3.1.5 <3.1.29

diff --git a/mods/chat/attach.js b/mods/chat/attach.js
index 1..2 100644
--- a/mods/chat/attach.js
+++ b/mods/chat/attach.js
@@ -1 +1 @@
-a
+b
diff --git a/mods/chat/new.swift b/mods/chat/new.swift
new file mode 100644
--- /dev/null
+++ b/mods/chat/new.swift
@@ -0,0 +1 @@
+c
`;

test('reads the header above the first diff', () => {
  assert.deepEqual(parseHeader(PATCH), { subject: 'Chat: macOS clipboard', owner: 'shepherdr', versions: '>=3.1.5 <3.1.29', root: null });
  assert.equal(parseHeader('diff --git a/x b/x\n').versions, '*');
  assert.equal(parseHeader(`Root: ~/.config/herdr-core\n\n${PATCH}`).root, '~/.config/herdr-core');
});

test('a patch applies under its Root, which --root <Root>=<dir> can move; else under the default root', () => {
  const home = '/Users/me', app = '/Users/me/.config/herdr-app';
  assert.equal(expandRoot('~/.config/herdr-core', home), '/Users/me/.config/herdr-core');
  assert.equal(expandRoot('/srv/x/', home), '/srv/x');
  assert.equal(rootFor({ root: null }, app, {}, home), app);
  assert.equal(rootFor({ root: '~/.config/herdr-core' }, app, {}, home), '/Users/me/.config/herdr-core');
  assert.equal(rootFor({ root: '~/.config/herdr-core' }, app, { '/Users/me/.config/herdr-core': '/tmp/core' }, home), '/tmp/core');
  assert.equal(rootFor({ root: '~/.config/herdr-core' }, '/tmp/app', {}, home), '/Users/me/.config/herdr-core', '--root <dir> moves only the default');
});

test('lists the files a patch changes, and the ones it adds', () => {
  assert.deepEqual(patchFiles(PATCH), [{ path: 'mods/chat/attach.js', created: false }, { path: 'mods/chat/new.swift', created: true }]);
});

test('compares versions part by part, as numbers', () => {
  assert.equal(compareVersions('3.1.34', '3.1.5'), 1);
  assert.equal(compareVersions('3.1.5', '3.1.5'), 0);
  assert.equal(compareVersions('3.1', '3.1.0'), 0);
});

test('a range holds when every comparator does', () => {
  assert.ok(inRange('3.1.5', '>=3.1.5 <3.1.29'));
  assert.ok(!inRange('3.1.34', '>=3.1.5 <3.1.29'));
  assert.ok(inRange('3.1.40', '>=3.1.34'));
  assert.ok(inRange('3.1.5', '3.1.5') && !inRange('3.1.6', '3.1.5'));
  assert.ok(inRange(null, '*'));
  assert.ok(!inRange(null, '>=3.1.5'));
});

test('another version is not applicable, never a conflict', () => {
  assert.equal(classify({ applicable: false, targets: true, reverse: false, forward: false }), 'not applicable');
  assert.equal(classify({ applicable: false, targets: false }), 'not applicable');
  assert.equal(classify({ applicable: null, targets: false }), 'target missing');
  assert.equal(classify({ applicable: true, targets: true, reverse: true }), 'applied');
  assert.equal(classify({ applicable: true, targets: true, reverse: false, forward: true }), 'missing');
  assert.equal(classify({ applicable: true, targets: true, reverse: false, forward: false }), 'conflict');
});
