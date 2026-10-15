import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createDialoguePlayer } from '../src/audio/dialoguePlayer.js';
import { VOICE_LINES } from '../src/audio/voiceEvents.js';
import { dialogueLines } from '../src/audio/dialogue.en.js';
import { createVoiceMap } from '../src/audio/voiceMap.js';
import { LINES } from '../src/investigation/clues.js';
import { RAW, bi } from '../src/i18n.js';

const script = JSON.parse(readFileSync(new URL('./fixtures/voice-source.zh.json', import.meta.url), 'utf8'));

const flush = () => Promise.resolve();

function setup() {
  const calls = [], voices = [];
  const player = createDialoguePlayer({
    show: (line) => calls.push(['show', line.text]), hide: () => calls.push(['hide']),
    radioOn: () => calls.push(['radio-on']), radioOff: () => calls.push(['radio-off']),
    playVoice(line) {
      if (line.silent) return null;
      let resolve;
      const voice = { done: new Promise((r) => { resolve = r; }), finish: (ok = true) => resolve(ok), stop() { calls.push(['stop', line.text]); resolve(false); } };
      voices.push(voice);
      return voice;
    },
  });
  return { player, calls, voices };
}

test('字幕等待真实 FMOD 结束，不按短中文估时截断英文；完整序列完成后才 resolve', async () => {
  const { player, calls, voices } = setup();
  let completed = false;
  const done = player.say([{ text: '短', ms: 100 }, { text: '下一句' }]).then((ok) => { completed = ok; });
  player.update(15);
  assert.equal(completed, false);
  assert.equal(voices.length, 1);
  voices[0].finish();
  await flush();
  player.update(0.01);
  assert.equal(calls.at(-1)[0], 'hide');
  player.update(0.3);
  assert.equal(voices.length, 2);
  voices[1].finish();
  await flush();
  player.update(0.01);
  player.update(0.3);
  await done;
  assert.equal(completed, true);
  assert.equal(player.playing, false);
});

test('暂停时句间间隔、静默和剧情 Promise 都不推进', async () => {
  const { player, voices } = setup();
  const done = player.say([{ text: 'first' }, { text: 'second' }]);
  voices[0].finish();
  await flush();
  for (let i = 0; i < 100; i++) player.update(0);
  assert.equal(voices.length, 1);
  player.update(0.01);
  for (let i = 0; i < 100; i++) player.update(0);
  assert.equal(voices.length, 1);
  player.update(0.3);
  assert.equal(voices.length, 2);
  player.cancel();
  assert.equal(await done, false);
});

test('跳过 / hush 立即停声并 resolve false，不触发旧对话的成功续接', async () => {
  const { player, voices, calls } = setup();
  const done = player.say([{ text: 'old' }, { text: 'not reached' }], { radio: true });
  player.cancel();
  assert.equal(await done, false);
  assert.equal(calls.filter(([name]) => name === 'stop').length, 1);
  assert.equal(calls.filter(([name]) => name === 'radio-off').length, 1);
  voices[0].finish();
  await flush();
  player.update(100);
  assert.equal(voices.length, 1);
});

test('新对话中断旧对话，无并发叠声，旧异步结束信号不会结束新一句', async () => {
  const { player, voices } = setup();
  const old = player.say([{ text: 'old' }]);
  const next = player.say([{ text: 'new' }]);
  assert.equal(await old, false);
  voices[0].finish();
  await flush();
  player.update(100);
  assert.equal(player.playing, true);
  voices[1].finish();
  await flush();
  player.update(0.1);
  player.update(0.3);
  assert.equal(await next, true);
});

test('仪器沉默只显示原字幕；声音失败时仍能完成剧情', async () => {
  const { player, voices } = setup();
  const done = player.say([{ text: '仪器没有回答。', silent: true, ms: 200 }, { text: 'next', ms: 200 }]);
  assert.equal(voices.length, 0);
  player.update(0.21);
  player.update(0.3);
  assert.equal(voices.length, 1);
  voices[0].finish(false);
  await flush();
  player.update(0.21);
  player.update(0.3);
  assert.equal(await done, true);
});

test('发布的 65 条映射完整、时长有效，来源明确标记内部非商用', async () => {
  const lines = dialogueLines({ script });
  assert.equal(Object.keys(VOICE_LINES).length, 65);
  for (const l of lines) {
    const clip = VOICE_LINES[l.id];
    assert.equal(clip.path, `event:/voice/en/${l.id}`);
    assert.equal(clip.text, l.text);
    assert.equal(clip.source, l.source);
    assert.ok(clip.duration > 0);
  }
  const manifest = JSON.parse(await readFile(new URL('../Fmod/voice-en-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.usage, 'noncommercial-internal');
  assert.equal(manifest.clips.length, 65);
  assert.ok(manifest.clips.every((c) => c.accountTier === 'free' && c.usage === 'noncommercial'));
  const opening = manifest.clips.find((c) => c.id === 'opening_02');
  assert.ok(opening.edits.some((e) => e.type === 'trim-tail'));
  assert.ok(opening.wavDuration < opening.duration);
  assert.equal(VOICE_LINES.opening_02.duration, opening.wavDuration);
});

test('只有中文原文和录音原文一致的台词才播配音，改写过的台词不错配声音', () => {
  const voiceOf = createVoiceMap(LINES, VOICE_LINES);
  const raw = LINES[RAW];
  assert.equal(voiceOf(raw.opening[0]), 'opening_01');
  // 每个对上的 ID，原文都必须与当前台词一致
  let matched = 0;
  for (const [group, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    list.forEach((line) => {
      const id = voiceOf(line);
      if (!id) return;
      matched++;
      assert.equal(VOICE_LINES[id].source, line.text);
    });
  }
  assert.ok(matched > 0 && matched <= Object.keys(VOICE_LINES).length);
  // 录音原文和当前台词不同时不播
  const changed = { g: [{ text: '改写后的台词' }] };
  assert.equal(createVoiceMap(changed, { g_01: { source: '原来的台词' } })(changed.g[0]), undefined);
});

test('台词挪到别的组：全局唯一时仍播原录音，同组优先，多处相同时不播', () => {
  const clips = { a_01: { source: '挪走的一句' }, a_02: { source: '重复的一句' }, b_01: { source: '重复的一句' }, c_01: { source: '重复的一句' } };
  const script = { b: [{ text: '重复的一句' }], d: [{ text: '挪走的一句' }, { text: '重复的一句' }] };
  const voiceOf = createVoiceMap(script, clips);
  assert.equal(voiceOf(script.d[0]), 'a_01');      // 别组唯一
  assert.equal(voiceOf(script.b[0]), 'b_01');      // 同组优先
  assert.equal(voiceOf(script.d[1]), undefined);   // 全局三处相同，不猜
});

test('英文模式下 bi() 代理的台词也能找到同一条配音', () => {
  const zh = { g: [{ who: '陈墨', text: '到了。' }], fn: () => [] };
  const proxied = bi(zh, { g: [{ who: 'Chen Mo', text: "I'm here." }] });
  const voiceOf = createVoiceMap(proxied, { g_01: { source: '到了。' } });
  assert.equal(proxied[RAW], zh);
  assert.equal(voiceOf(zh.g[0]), 'g_01');
  // 模拟英文代理：取到的是包着原对象的新代理
  const wrapped = bi(zh.g[0], { text: "I'm here." });
  assert.notEqual(wrapped, zh.g[0]);
  assert.equal(voiceOf(wrapped), 'g_01');
});
