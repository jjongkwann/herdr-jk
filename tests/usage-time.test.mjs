import assert from 'node:assert/strict';
import { test } from 'node:test';
import { H, DAY, clock, pace, resets, resetsShort } from '../mods/omarchy-ai-usage/time.js';

test('usage pace stays within the quota window', t => {
  const now = Date.parse('2030-01-01T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const window = hours => ({ span: 5 * H, resets_at: new Date(now + hours * H).toISOString() });
  assert.equal(pace(window(2.5)), 0.5);
  assert.equal(pace(window(6)), 0);
  assert.equal(pace(window(-1)), 1);
  assert.equal(pace({}), null);
});

test('usage countdown rounds provider timestamps and handles elapsed windows', t => {
  const now = Date.parse('2030-01-01T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  assert.equal(resetsShort({ resets_at: new Date(now + H + 30 * 60e3 - 500).toISOString() }), '1h 30m');
  assert.equal(resetsShort({ resets_at: new Date(now - H).toISOString() }), '0h 0m');
  assert.equal(resetsShort({ resets_at: new Date(now + 3 * DAY).toISOString() }), '3d');
  assert.equal(resetsShort({}), '');
  assert.equal(resets({}), '');
});

test('times read in 12-hour form', () => {
  const at = (h, m) => new Date(2026, 10, 4, h, m).getTime();
  assert.equal(clock(at(0, 0)), '12:00 AM');
  assert.equal(clock(at(9, 5)), '9:05 AM');
  assert.equal(clock(at(12, 30)), '12:30 PM');
  assert.equal(clock(at(23, 59)), '11:59 PM');
});
