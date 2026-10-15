import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createDialoguePlayer } from '../src/audio/dialoguePlayer.js';
import { VOICE_LINES } from '../src/audio/voiceEvents.js';
import { bindRecordedVoices, dialogueLines, recordedVoiceId } from '../src/audio/dialogue.en.js';
import { LINES } from '../src/investigation/clues.js';
import { getLang, isPlayer, setLang } from '../src/i18n.js';

const flush = () => Promise.resolve();

test('配音按未改写的中文绑定，不修改原稿，保留动态引导和静默', () => {
  const source = {
    opening: [{ text: '到了。' }, { text: '改写过的新台词' }],
    rootRead: [{ text: '终端没有再解释。', ms: 2200 }],
    archived: [{ text: '知道了。' }],
    transferred: [{ text: '知道了。' }],
    dreamGuide: (time) => [{ text: `倒回 ${time}` }],
  };
  const bound = bindRecordedVoices(source);
  assert.equal(bound.opening[0].voiceId, 'opening_02');
  assert.equal(source.opening[0].voiceId, undefined);
  assert.equal(bound.opening[1].voiceId, undefined);
  assert.equal(bound.rootRead[0].voiceId, undefined);
  assert.equal(bound.rootRead[0].ms, 2200);
  assert.equal(bound.archived[0].voiceId, 'archived_03');
  assert.equal(bound.transferred[0].voiceId, 'transferred_03');
  assert.equal(bound.dreamGuide, source.dreamGuide);
});

test('中英字幕切换和重复读取 Proxy 不会丢配音，改写句不套旧录音', () => {
  const previousDocument = globalThis.document;
  const previousLang = getLang();
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    setLang('zh');
    const ids = Object.fromEntries(Object.entries(LINES)
      .filter(([, lines]) => Array.isArray(lines))
      .map(([group, lines]) => [group, lines.map((l) => {
        assert.equal(l.voiceId ?? null, recordedVoiceId(group, l.text));
        return l.voiceId;
      })]));
    for (const lang of ['en', 'zh', 'en']) {
      setLang(lang);
      for (let read = 0; read < 2; read++) {
        for (const [group, expected] of Object.entries(ids)) {
          assert.deepEqual(LINES[group].map((l) => l.voiceId), expected);
        }
      }
      assert.equal(LINES.opening[1].text, lang === 'en' ? 'I’m here.' : '到了。');
      assert.equal(LINES.opening[1].voiceId, 'opening_02');
      assert.equal(LINES.dream1[0].voiceId, undefined);
      assert.equal(LINES.rootRead.at(-1).voiceId, undefined);
      assert.equal(LINES.target.at(-1).voiceId, undefined);
      assert.ok(LINES.dreamGuide('00:01.4').every((l) => !l.voiceId));
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
    assert.equal(LINES.opening[1].text, 'I’m here.');
    assert.equal(LINES.opening[1].voiceId, 'opening_02');
    assert.equal(LINES.cardRead[0].voiceId, 'cardRead_02');
    assert.equal(LINES.dream1[0].voiceId, undefined);
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
  const lines = dialogueLines();
  assert.equal(Object.keys(VOICE_LINES).length, 65);
  for (const l of lines) {
    const clip = VOICE_LINES[l.id];
    assert.equal(clip.path, `event:/voice/en/${l.id}`);
    assert.equal(clip.text, l.text);
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
