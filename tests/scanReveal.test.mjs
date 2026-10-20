import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createScanReveal } from '../src/investigation/scanReveal.js';

const create = () => createScanReveal({ range: 40, showTime: 2 });

test('扫描提示工具只有在扫描波经过后才触发', () => {
  const reveal = create();
  reveal.beginScan();
  reveal.update(0.1, 15, true, 10);
  assert.equal(reveal.visible, false);
  reveal.update(0.1, 15, true, 16);
  assert.equal(reveal.visible, true);
  assert.equal(reveal.takeFlash(), true);
  assert.equal(reveal.takeFlash(), false);
});

test('扫描提示保持两秒，同一次波不会不断刷新显示时间', () => {
  const reveal = create();
  reveal.beginScan();
  reveal.update(0.1, 15, true, 16);
  reveal.takeFlash();
  reveal.update(1.9, 15, true, 40);
  assert.equal(reveal.visible, true);
  reveal.update(0.2, 15, true, 50);
  assert.equal(reveal.visible, false);
  assert.equal(reveal.takeFlash(), false);
});

test('超过 40 米或没有扫描波时不触发，下一次扫描可以重新发现', () => {
  const reveal = create();
  reveal.beginScan();
  reveal.update(0.1, 41, true, 60);
  assert.equal(reveal.visible, false);
  reveal.update(0.1, 15, false, Infinity);
  assert.equal(reveal.visible, false);
  reveal.update(0.1, 15, true, 20);
  assert.equal(reveal.visible, true);
  reveal.update(3, 15, false, Infinity);
  reveal.beginScan();
  reveal.update(0.1, 15, true, 20);
  assert.equal(reveal.visible, true);
  assert.equal(reveal.takeFlash(), true);
});

test('交互物不可用时清除扫描提示，恢复后可以再次扫描', () => {
  const reveal = create();
  reveal.beginScan();
  reveal.update(0.1, 10, true, 20);
  reveal.update(0.1, Infinity, true, 20, false);
  assert.equal(reveal.visible, false);
  assert.equal(reveal.takeFlash(), false);
  reveal.beginScan();
  reveal.update(0.1, 10, true, 20);
  assert.equal(reveal.visible, true);
  reveal.clear();
  assert.equal(reveal.visible, false);
});

test('暂停时不缩短扫描提示时长', () => {
  const reveal = create();
  reveal.update(0.1, 10, true, 20);
  for (let i = 0; i < 100; i++) reveal.update(0, 10, false, Infinity);
  assert.equal(reveal.visible, true);
  reveal.update(2.1, 10, false, Infinity);
  assert.equal(reveal.visible, false);
});

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
