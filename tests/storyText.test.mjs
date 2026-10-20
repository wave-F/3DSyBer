import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { CLUES_ZH, PROBES_ZH, LINES, REPORTS, ENDINGS, DEATH_REPORT } from '../src/investigation/clues.js';
import { EN } from '../src/investigation/en.js';
import { RAW } from '../src/i18n.js';
import { dialogueLines, productionLines, VOICE_ROLES } from '../src/audio/dialogue.en.js';
import { VOICE_LINES } from '../src/audio/voiceEvents.js';
import { createVoiceMap } from '../src/audio/voiceMap.js';

test('直接修改原文和填写修改栏的中文均已回填，英文依据修订后的含义', () => {
  const raw = LINES[RAW];
  assert.equal(raw.opening[2].text, '一场简单的事故。审核完赶紧交单，北岸还有两件。');
  assert.equal(raw.start1[0].text, '先看看撞哪儿了。');
  assert.equal(raw.clueDReason[0].text, '陆世承，承岳集团的继承人。');
  assert.equal(EN.lines.clueDReason[0].text, 'Lu Shicheng. The heir to the Chengyue Group.');
  assert.equal(raw.clueDRaw[0].text, '程叙是经纬的工程师？');
  assert.equal(EN.lines.clueDRaw[0].text, 'Cheng Xu was an engineer at Meridian?');
  assert.equal(raw.clueRTime[0].text, '早了 0.38 秒。那时候车还没有发生碰撞。');
  assert.equal(EN.lines.clueRTime[0].text, '0.38 seconds early. The collision hadn’t happened yet.');
  assert.equal(raw.transferred[3].text, '零号保障是什么时候生效的？ 这里还有疑点');
  assert.equal(EN.lines.transferred[3].text, 'When did Zero Priority take effect? There are still questions here.');
});

test('线索、黑梦与报告保留中文改稿的增删和时序表述', () => {
  const clues = Object.fromEntries(CLUES_ZH.map((c) => [c.id, c]));
  const probes = Object.fromEntries(PROBES_ZH.map((c) => [c.id, c]));
  assert.equal(clues.debris.lines[1], '玻璃渣是这辆车的前挡。');
  assert.equal(EN.clues.debris.lines[1], 'The glass is from this car’s windshield.');
  assert.equal(clues.dRaw.lines[2], '黄色车辆原始记录');
  assert.equal(EN.clues.dRaw.lines[2], 'Yellow car raw record');
  assert.equal(probes.p1turn.lines[0], '自动驾驶系统控制向左转向');
  assert.equal(EN.probes.p1turn.lines[0], 'The autonomous driving system steers the car left');
  assert.equal(probes.p4halo.lines[2], '授予来源 URSA');
  assert.equal(EN.probes.p4halo.lines[2], 'Grant source: URSA');
  assert.equal(REPORTS.r2.revised.verdict, '复核暂停：因果链不完整');
  assert.equal(REPORTS.r4.lines[2], '事故报告发起早于零号保障授权、强制转向与撞击。');
  assert.equal(EN.reports.r4.lines[2], 'The accident report was initiated before the Zero Priority grant, the forced steering, and the impact.');
  assert.equal(DEATH_REPORT.lines[2], '违规滞留，被过往车辆撞击，当场死亡。');
});

test('时间轴与最终事故报告统一使用生成，不改变原有时间戳', () => {
  const time = CLUES_ZH.find((c) => c.id === 'rTime');
  assert.equal(time.lines[0], '初判报告生成：23:17:08.080');
  assert.equal(time.timeline[0].label, '报告生成');
  assert.equal(time.timeline[0].t, 8.080);
  assert.equal(EN.clues.rTime.lines[0], 'Initial report generated: 23:17:08.080');
  assert.equal(EN.clues.rTime.timeline[0].label, 'Report generated');
  assert.equal(DEATH_REPORT.stamps[1].label, '报告生成');
  assert.equal(DEATH_REPORT.stamps[1].t, '23:41:02.310');
  assert.equal(EN.death.stamps[1].label, 'Report generated');
});

test('所有静态对白的中英数组、字幕和配音制作稿逐句一致', () => {
  const raw = LINES[RAW];
  const all = dialogueLines({ includeSilent: true });
  for (const [group, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    assert.equal(EN.lines[group].length, list.length, group);
    for (let index = 0; index < list.length; index++) {
      const row = all.find((l) => l.group === group && l.index === index);
      assert.equal(row.source, list[index].text, `${group}[${index}] source`);
      assert.equal(row.text, EN.lines[group][index].text, `${group}[${index}] English`);
    }
  }
});

test('明确删除的对白、结局句与广告条款在两种语言中均不再展示', async () => {
  const raw = LINES[RAW];
  assert.deepEqual(raw.target.map((l) => l.text), ['得把这些带回去。']);
  assert.equal(raw.transferred.length, 5);
  assert.ok(!raw.transferred.some((l) => l.text === '特权会有人去吵。'));
  assert.equal(ENDINGS.r3.lines.length, 2);
  assert.equal(EN.endings.r3.lines.length, 2);
  const magazine = await readFile(new URL('../src/investigation/magazine.js', import.meta.url), 'utf8');
  assert.ok(!magazine.includes('零号生命保障协议'));
  assert.ok(!magazine.includes('Zero Priority Life Protection Protocol'));
});

test('中英文对话 AI 均叫 URSA，仍使用 device 配音通道', () => {
  const raw = LINES[RAW];
  for (const [group, index] of [['question2', 1], ['question3', 2], ['rootRead', 1]]) {
    assert.equal(raw[group][index].who, 'URSA');
    assert.equal(EN.lines[group][index].who, 'URSA');
    assert.equal(dialogueLines({ includeSilent: true }).find((l) => l.group === group && l.index === index).speaker, 'device');
  }
  assert.equal(VOICE_ROLES.device.name, 'URSA');
});

test('删句不重新编号，改写对白不播放旧录音，未改写对白仍可播放', () => {
  const production = productionLines();
  assert.equal(new Set(production.map((l) => l.id)).size, production.length);
  assert.ok(!production.some((l) => ['target_01', 'transferred_04'].includes(l.id)));
  assert.equal(production.find((l) => l.group === 'target').id, 'target_02');
  const voiceOf = createVoiceMap(LINES, VOICE_LINES);
  const raw = LINES[RAW];
  assert.equal(voiceOf(raw.target[0]), 'target_02');
  for (const group of ['clueDReason', 'clueDRaw', 'clueRTime', 'ready2']) assert.equal(voiceOf(raw[group][0]), `${group}_01`);
  assert.equal(voiceOf(raw.transferred[3]), 'transferred_05');
  assert.equal(voiceOf(raw.transferred[4]), 'transferred_06');
  // 新版录音覆盖改稿，但仍不能把过时录音绑定到改写句。
  assert.equal(createVoiceMap({ g: [{ text: '新台词' }] }, { g_01: { source: '旧台词' } })({ text: '新台词' }), undefined);
});

test('游戏源码不再使用 URSA 的中文旧译名或 Pivot 别名', async () => {
  const oldName = '\u67a2\u6838';
  async function check(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await check(url);
      else if (entry.name.endsWith('.js')) {
        const source = await readFile(url, 'utf8');
        assert.ok(!source.includes(oldName), url.pathname);
        assert.ok(!source.includes('URSA / Pivot'), url.pathname);
      }
    }
  }
  await check(new URL('../src/', import.meta.url));
});
