import assert from 'node:assert/strict';
import { test } from 'node:test';
import { separateTimelineSpans } from '../src/investigation/timelineLayout.js';
import { PROBES_ZH, ROUNDS } from '../src/investigation/clues.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('两个部分重叠的证据显示为两个黄块，留出 6px 间隙', () => {
  const spans = [[90, 140], [115, 165]];
  const before = structuredClone(spans);
  const layout = separateTimelineSpans(spans);
  close(layout[1][0] - layout[0][1], 6);
  assert.equal(layout[0][0], 90);
  assert.equal(layout[1][1], 165);
  assert.deepEqual(spans, before, '不修改原始时间窗口');
});

test('原本分开的证据位置不变，空时间轴和单个证据也可用', () => {
  const spans = [[20, 60], [80, 120]];
  assert.deepEqual(separateTimelineSpans(spans), spans);
  assert.deepEqual(separateTimelineSpans([]), []);
  assert.deepEqual(separateTimelineSpans([[30, 70]]), [[30, 70]]);
});

test('刚好相接或间隙太小的黄块也会分开', () => {
  for (const start of [60, 62, 65]) {
    const layout = separateTimelineSpans([[20, 60], [start, 100]]);
    close(layout[1][0] - layout[0][1], 6);
  }
});

test('完全同一时刻的多条证据仍各有独立的可见范围', () => {
  for (const count of [2, 3, 4]) {
    const layout = separateTimelineSpans(Array.from({ length: count }, () => [40, 120]));
    for (let i = 0; i < layout.length; i++) {
      assert.ok(layout[i][1] > layout[i][0]);
      if (i) close(layout[i][0] - layout[i - 1][1], 6);
    }
    assert.equal(layout[0][0], 40);
    assert.equal(layout.at(-1)[1], 120);
  }
});

test('证据顺序不按时间排序时，结果仍保持原索引，避免高亮/完成状态串位', () => {
  const layout = separateTimelineSpans([[115, 165], [90, 140], [200, 240]]);
  close(layout[0][0] - layout[1][1], 6);
  assert.equal(layout[1][0], 90);
  assert.deepEqual(layout[2], [200, 240]);
});

test('显示空间极小时缩小间隙，不出现负宽度或倒置', () => {
  const layout = separateTimelineSpans([[0, 2], [0, 2], [0, 2]]);
  for (let i = 0; i < layout.length; i++) {
    assert.ok(layout[i][1] > layout[i][0]);
    if (i) assert.ok(layout[i][0] > layout[i - 1][1]);
  }
  close(layout.at(-1)[1], 2);
});

test('全部四轮黑梦随屏宽留出两格间隙，异常中心仍在各自黄块内', () => {
  for (const width of [224, 400, 900]) {
    // 72 格、格间 CSS gap 为 3px；格距随时间轴宽度变化。
    const gap = (width + 3) / 72 * 2;
    for (const [round, cfg] of Object.entries(ROUNDS)) {
      const probes = PROBES_ZH.filter((c) => c.round === Number(round) && c.t != null);
      const spans = probes.map((c) => [
        Math.max(0, c.t - 0.25) / cfg.duration * width,
        Math.min(cfg.duration, c.t + 0.25) / cfg.duration * width,
      ]);
      const layout = separateTimelineSpans(spans, gap);
      const ordered = layout.toSorted((a, b) => a[0] - b[0]);
      for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i][0] - ordered[i - 1][1] >= gap - 1e-6);
      probes.forEach((c, i) => {
        const center = c.t / cfg.duration * width;
        assert.ok(center >= layout[i][0] && center <= layout[i][1], `round ${round}, ${c.id}, width ${width}`);
      });
    }
  }
});
