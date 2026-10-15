import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDialoguePlayer } from '../src/audio/dialoguePlayer.js';
import { VOICE_LINES } from '../src/audio/voiceEvents.js';
import { createVoiceMap } from '../src/audio/voiceMap.js';
import { LINES } from '../src/investigation/clues.js';
import { RAW, bi, getLang, isPlayer, setLang } from '../src/i18n.js';

const script = JSON.parse(readFileSync(new URL('./fixtures/voice-source.zh.json', import.meta.url), 'utf8'));

const flush = () => Promise.resolve();

test('配音按未改写的中文绑定，不修改原稿，保留动态引导和静默', () => {
  const source = {
    opening: [{ text: '到了。' }, { text: '改写过的新台词' }],
    rootRead: [{ text: '终端没有再解释。', ms: 2200 }],
    archived: [{ text: '知道了。' }],
    transferred: [{ text: '知道了。' }],
    dreamGuide: (time) => [{ text: `倒回 ${time}` }],
  };
  const before = JSON.stringify(source);
  const voiceOf = createVoiceMap(source, VOICE_LINES);
  assert.equal(voiceOf(source.opening[0]), 'opening_02');
  assert.equal(voiceOf(source.opening[1]), undefined);
  assert.equal(voiceOf(source.rootRead[0]), undefined);
  assert.equal(voiceOf(source.archived[0]), 'archived_03');
  assert.equal(voiceOf(source.transferred[0]), 'transferred_03');
  assert.equal(voiceOf(source.dreamGuide('00:01.4')[0]), undefined);
  assert.equal(JSON.stringify(source), before);
});

test('中英字幕切换和重复读取 Proxy 不会丢配音，改写句不套旧录音', () => {
  const previousDocument = globalThis.document;
  const previousLang = getLang();
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    setLang('zh');
    const voiceOf = createVoiceMap(LINES, VOICE_LINES);
    const ids = Object.fromEntries(Object.entries(LINES)
      .filter(([, lines]) => Array.isArray(lines))
      .map(([group, lines]) => [group, lines.map((l) => {
        const id = voiceOf(l);
        if (id) assert.equal(VOICE_LINES[id].source, l.text);
        return id;
      })]));
    for (const lang of ['en', 'zh', 'en']) {
      setLang(lang);
      for (let read = 0; read < 2; read++) {
        for (const [group, expected] of Object.entries(ids)) {
          assert.deepEqual(LINES[group].map(voiceOf), expected);
        }
      }
      assert.equal(LINES.opening[1].text, lang === 'en' ? 'I’m here.' : '到了。');
      assert.equal(voiceOf(LINES.opening[1]), 'opening_02');
      assert.equal(voiceOf(LINES.opening[0]), undefined); // 呼号已改为 B1016，不套 B1234 的录音
      assert.equal(voiceOf(LINES.cardRead[0]), 'cardRead_02');
      assert.equal(voiceOf(LINES.keyFound[1]), 'keyFound_03');
      assert.equal(voiceOf(LINES.rootRead[1]), 'rootRead_03');
      assert.equal(voiceOf(LINES.dream1[0]), undefined);
      assert.equal(voiceOf(LINES.rootRead.at(-1)), undefined);
      assert.equal(voiceOf(LINES.target.at(-1)), undefined);
      assert.ok(LINES.dreamGuide('00:01.4').every((l) => !voiceOf(l)));
      assert.ok(isPlayer(LINES.opening[1].who));
      assert.equal(isPlayer(LINES.opening[0].who), false);
    }
  } finally {
    setLang(previousLang);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('启动时已保存英文语言也能正确绑定配音', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    globalThis.localStorage = { getItem: () => 'en' };
    globalThis.document = { documentElement: { dataset: {} } };
    const { LINES } = await import(${JSON.stringify(new URL('../src/investigation/clues.js', import.meta.url).href)});
    const { VOICE_LINES } = await import(${JSON.stringify(new URL('../src/audio/voiceEvents.js', import.meta.url).href)});
    const { createVoiceMap } = await import(${JSON.stringify(new URL('../src/audio/voiceMap.js', import.meta.url).href)});
    const voiceOf = createVoiceMap(LINES, VOICE_LINES);
    assert.equal(LINES.opening[1].text, 'I’m here.');
    assert.equal(voiceOf(LINES.opening[1]), 'opening_02');
    assert.equal(voiceOf(LINES.cardRead[0]), 'cardRead_02');
    assert.equal(voiceOf(LINES.opening[0]), undefined);
    assert.equal(voiceOf(LINES.dream1[0]), undefined);
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

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
  // 已发布录音独立于待补录的新英文稿：按 manifest 和录音时的中文快照核对。
  const manifest = JSON.parse(await readFile(new URL('../Fmod/voice-en-manifest.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(VOICE_LINES).length, 65);
  assert.equal(manifest.clips.length, 65);
  assert.deepEqual(new Set(Object.keys(VOICE_LINES)), new Set(manifest.clips.map((l) => l.id)));
  for (const l of manifest.clips) {
    const clip = VOICE_LINES[l.id];
    assert.equal(clip.path, `event:/voice/en/${l.id}`);
    assert.equal(clip.text, l.text);
    assert.equal(clip.source, l.source);
    assert.equal(clip.source, script[l.group][Number(l.id.match(/_(\d+)$/)[1]) - 1].text);
    assert.equal(clip.speaker, l.speaker);
    assert.equal(clip.channel, l.channel);
    assert.equal(clip.duration, l.wavDuration);
    assert.ok(clip.duration > 0);
  }
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
  assert.equal(voiceOf(raw.opening[0]), undefined); // B1016 与已录的 B1234 不一致
  assert.equal(voiceOf(raw.opening[1]), 'opening_02');
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
