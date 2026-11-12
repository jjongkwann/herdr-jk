import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inputRow, bubbleSpot } from '../mods/omarchy-voice-live/spot.js';

test('voice bubble sits on the rule above the last prompt line, else the last line with text', () => {
  const claude = ['❯ 지난 질문', '⏺ 답', '', '────────────', '❯ ', '────────────', '  status'];
  assert.equal(inputRow(claude), 3);
  assert.equal(inputRow(['› codex 입력', '  footer']), 0);
  assert.equal(inputRow(['jk% ls', 'a b', 'jk% ', '', '']), 2);
  assert.equal(inputRow(['', '']), -1);
});

test('voice bubble goes just above its row, centered on the tab node', () => {
  // The node from 82 to 1401: terminal rows from 126 to 1387, 78 rows of 16.17 px.
  const spot = bubbleSpot({ top: 82, bottom: 1401, centerX: 1405.5 }, 78, 72, { border: 2, header: 30, padding: 12 }, { width: 64, height: 30 });
  assert.deepEqual(spot, { x: 1374, y: 1258 });
});
