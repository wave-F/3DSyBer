import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('杂志不生成悬浮提示，普通线索与黑梦分析点的标记不受影响', async () => {
  const source = await readFile(new URL('../src/investigation/state.js', import.meta.url), 'utf8');
  const markerList = source.match(/function markerList\(showClues, showProbes, analysisClue\) \{[\s\S]*?\n  \}(?=\n\n  function updateExplore)/)?.[0];
  assert.ok(markerList);
  const p = { distanceTo: () => 2 };
  const context = {
    clues: [{ id: 'front', p, unlocked: true, round: 1, done: false, scanFlash: true }],
    probes: [{ id: 'p1turn', p, inTime: true, name: '前轮', done: false }],
    project: () => ({ x: 100, y: 200, front: true }),
    camera: { position: {} }, round: 1, NEAR_RANGE: 5, aimed: null, aimedProbe: null,
    // 即使杂志可交互，绘制标记也不应读取它。
    mag: { get target() { assert.fail('Magazine must not generate HUD markers'); } },
  };
  const markers = runInNewContext(`${markerList}\nmarkerList(true, true, null)`, context);
  assert.deepEqual(Array.from(markers, (m) => m.id), ['front', 'p1turn']);
  assert.ok(markers.every((m) => m.show));
  assert.equal(markers[0].flash, true);
  const hidden = runInNewContext(`${markerList}\nmarkerList(false, false, null)`, context);
  assert.ok(hidden.every((m) => !m.show));
  assert.ok(!source.includes('magReveal'));
  assert.match(source, /magAimed\) \{ holdKey = false; startRead\(\); \}/);
  assert.match(source, /magAimed = .*aimAt\(\[magT\], mag.range\)/);
});

test('杂志仅在准星对准时显示拾取提示', async () => {
  const source = await readFile(new URL('../src/investigation/state.js', import.meta.url), 'utf8');
  const tap = source.match(/const tap = doorAimed \?[\s\S]*?\n      : null;/)?.[0];
  assert.ok(tap);
  const context = {
    doorAimed: false, portAimed: false, keyAimed: false, magAimed: false,
    magT: { p: {} },
    project: () => ({ x: 100, y: 200, front: true }),
    tx: (zh) => zh,
  };
  assert.equal(runInNewContext(`${tap}\ntap`, context), null);
  const prompt = runInNewContext(`${tap}\ntap`, { ...context, magAimed: true });
  assert.equal(prompt.name, '电子杂志 · 拾起');
  assert.equal(prompt.front, true);
  assert.match(source, /if \(!analysisClue && tap\) ui\.setAnalysis\(tap, 0, 'tap'\)/);
});
