import assert from 'node:assert/strict';
import { test } from 'node:test';
import { H, DAY, clock, pace, resets, resetsCompact, resetsShort } from '../mods/omarchy-ai-usage/time.js';

const M = 60e3;

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

test('the top bar reset shows the time left in days and hours, hours and minutes, or minutes', t => {
  const now = new Date(2030, 10, 19, 12, 0).getTime();
  t.mock.method(Date, 'now', () => now);
  const left = ms => resetsCompact({ resets_at: new Date(now + ms).toISOString() });
  assert.equal(left(2 * DAY + 5 * H), '2d 5h');
  assert.equal(left(2 * DAY), '2d 0h', 'an exact number of days keeps its hours');
  assert.equal(left(5 * H + 10 * M), '5h 10m');
  assert.equal(left(42 * M), '42m');
  assert.equal(left(DAY), '1d 0h', 'exactly a day is days and hours');
  assert.equal(left(DAY - M), '23h 59m', 'a minute under a day is hours and minutes');
  assert.equal(left(H), '1h 0m', 'exactly an hour is hours and minutes');
  assert.equal(left(H - M), '59m', 'a minute under an hour is minutes only');
  // The API reports resets a fraction of a second before the minute.
  assert.equal(left(2 * H + 10 * M - 500), '2h 10m');
});

test('the top bar reset rounds the time left down', t => {
  const now = new Date(2030, 10, 19, 12, 0, 20).getTime();
  t.mock.method(Date, 'now', () => now);
  const until = (...at) => resetsCompact({ resets_at: new Date(2030, 10, ...at).toISOString() });
  assert.equal(until(21, 17, 59), '2d 5h', '2d 5h 58m 40s');
  assert.equal(until(19, 17, 11), '5h 10m', '5h 10m 40s');
  assert.equal(until(19, 12, 43), '42m', '42m 40s');
  assert.equal(until(19, 12, 1), '0m', 'the last minute is still ahead');
});

test('the top bar shows no reset for a resets_at it cannot use', t => {
  const now = new Date(2030, 10, 19, 12, 0).getTime();
  t.mock.method(Date, 'now', () => now);
  for (const resets_at of ['later', 'next week', '', null, undefined]) assert.equal(resetsCompact({ resets_at }), '');
  assert.equal(resetsCompact({}), '');
  assert.equal(resetsCompact({ resets_at: new Date(now).toISOString() }), '', 'a reset due now says nothing');
  assert.equal(resetsCompact({ resets_at: new Date(now - H).toISOString() }), '', 'a reset already past says nothing');
});

test('times read in 12-hour form', () => {
  const at = (h, m) => new Date(2026, 10, 4, h, m).getTime();
  assert.equal(clock(at(0, 0)), '12:00 AM');
  assert.equal(clock(at(9, 5)), '9:05 AM');
  assert.equal(clock(at(12, 30)), '12:30 PM');
  assert.equal(clock(at(23, 59)), '11:59 PM');
});
