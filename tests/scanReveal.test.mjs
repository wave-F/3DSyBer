import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScanReveal } from '../src/investigation/scanReveal.js';

const create = () => createScanReveal({ range: 40, showTime: 2 });

test('杂志等交互物只有在扫描波经过后才出现提示', () => {
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

test('拿起杂志或进入不可交互状态后清除扫描提示，放下后可以再次扫描', () => {
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
