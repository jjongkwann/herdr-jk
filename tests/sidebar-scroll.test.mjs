import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const mod of ['spaces', 'agents']) {
  const source = (await readFile(new URL(`../mods/omarchy-${mod}/scroll-rail.js`, import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace(/^const rectangle = .*;$/m, 'const rectangle = null;');
  const { ScrollRail } = await import(`data:text/javascript;base64,${Buffer.from('const settings = () => ({ zoom: 1 });\n' + source).toString('base64')}#${mod}`);
  test(`${mod}: native measurements account for 120% zoom`, async () => {
    const { ScrollRail: ZoomedRail } = await import(`data:text/javascript;base64,${Buffer.from('const settings = () => ({ zoom: 1.2 });\n' + source).toString('base64')}#zoom-${mod}`);
    const rail = new ZoomedRail();
    const cx = { notify() {} };
    rail.measure('viewport', 360, cx);
    rail.measure('content', 600, cx);
    rail.scroll(-10000);
    assert.equal(rail.maximum(), 200);
    assert.equal(rail.offset, 200);
  });
  test(`${mod}: wheel and trackpad offsets stay inside the scrollable range`, () => {
    const rail = new ScrollRail();
    const cx = { notify() {} };
    rail.measure('viewport', 300, cx);
    rail.measure('content', 442, cx);
    assert.equal(rail.scroll(-0.5), true);
    assert.equal(rail.offset, 0.5);
    rail.scroll(-1000);
    assert.equal(rail.offset, 142);
    assert.equal(rail.scroll(-1), false);
    rail.scroll(1000);
    assert.equal(rail.offset, 0);
    assert.equal(rail.scroll(1), false);
  });
  test(`${mod}: removing rows or resizing clamps the current offset`, () => {
    const rail = new ScrollRail();
    let notifications = 0;
    const cx = { notify() { notifications++; } };
    rail.measure('content', 500, cx);
    rail.measure('viewport', 100, cx);
    rail.scroll(-200);
    rail.measure('content', 150, cx);
    assert.equal(rail.offset, 50);
    rail.measure('viewport', 200, cx);
    assert.equal(rail.maximum(), 0);
    assert.equal(rail.offset, 0);
    assert.equal(rail.scroll(-10), false);
    rail.measure('viewport', 200, cx);
    assert.equal(notifications, 4);
  });
}

test('omarchy-agents and omarchy-spaces carry the same scroll-rail.js', async () => {
  const read = mod => readFile(new URL(`../mods/omarchy-${mod}/scroll-rail.js`, import.meta.url), 'utf8');
  assert.equal(await read('spaces'), await read('agents'));
});
