import { test } from "node:test";
import assert from "node:assert/strict";
import { tabWidths, TAB_MAX, TAB_MIN, TAB_ACTIVE } from "../mods/omarchy-tabs/sizing.js";

const widths = (count, strip, panels = 0, zoom = 1) => {
  const { tab, active } = tabWidths(count, strip, panels, zoom);
  return [tab, active];
};

test("tabs share the measured strip less the panel buttons and +", () => {
  // 600 - 100 - 36 = 464px for five tabs: the active one keeps 128, the others get the minimum.
  assert.deepEqual(widths(5, 600, 100), [84, 128]);
  // 1000 - 36 = 964px: three tabs of 190 fit, so the strip doesn't fill the room.
  assert.deepEqual(widths(3, 1000), [TAB_MAX, TAB_MAX]);
});

test("tabs shrink toward the minimum before the strip scrolls", () => {
  // 836px for eight tabs: the active one gets 150 and the others 98 instead of 190, so all eight fit.
  assert.deepEqual(widths(8, 872), [98, TAB_ACTIVE]);
  // Too many to fit: every tab stops at the minimum, and the strip scrolls.
  assert.deepEqual(widths(10, 500), [TAB_MIN, TAB_MIN]);
});

test("tabs overflow only at the minimum, and the active tab gets at most TAB_ACTIVE, never less than the others", () => {
  for (let count = 2; count <= 12; count++) for (let strip = 200; strip <= 2400; strip += 37) {
    const [tab, active] = widths(count, strip), at = `${count} tabs, ${strip}px: ${tab}/${active}`;
    assert.ok(active >= tab && tab >= TAB_MIN && tab <= TAB_MAX, at);
    if (tab < TAB_ACTIVE) assert.ok(active <= TAB_ACTIVE, at);
    if (tab > TAB_MIN) assert.ok((count - 1) * tab + active <= strip - 36, at);
  }
});

test("measured widths account for UI zoom", () => {
  assert.deepEqual(widths(5, 1200, 200, 2), widths(5, 600, 100));
});

test("an empty or not yet measured strip uses the full width", () => {
  assert.deepEqual(widths(0, 0), [TAB_MAX, TAB_MAX]);
  assert.deepEqual(widths(5, 0), [TAB_MAX, TAB_MAX]);
  // One tab in a narrow strip takes what is left.
  assert.deepEqual(widths(1, 150), [114, 114]);
});
