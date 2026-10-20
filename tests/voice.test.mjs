import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LINES } from '../src/investigation/clues.js';
import { RAW } from '../src/i18n.js';
import { AUDITION_IDS, ENGLISH, VOICE_ROLES, PERFORMANCE_CUES, dialogueLines, productionLines, spokenText, synthesisText } from '../src/audio/dialogue.en.js';
import { ElevenLabs, castFromEnv, validateCast, speechRequest, generateLine, digest, auditionHTML, fmimportScript } from '../scripts/lib/voice.mjs';

const cast = { chen: 'test_chen_123456', dispatch: 'test_dispatch_123456', device: 'test_device_123456' };
// 新版制作工具链用当前稿检查；已发布旧录音在 dialogue.test.mjs 按 manifest 和中文快照独立验证。
const script = JSON.parse(readFileSync(new URL('./fixtures/voice-source.zh.json', import.meta.url), 'utf8'));
const lines = dialogueLines();
const options = { cast, model: 'eleven_v4', seed: 417, lines };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), '3dsyber-voice-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('新版英文稿覆盖当前 36 组、54 条有声台词，URSA 省略号保持沉默', () => {
  const before = JSON.stringify(LINES);
  const all = dialogueLines({ includeReserve: true, includeSilent: true });
  assert.equal(Object.keys(ENGLISH).length, 36);
  assert.equal(all.length, 56);
  assert.equal(lines.length, 54);
  assert.equal(new Set(all.map((l) => l.id)).size, 56);
  assert.ok(all.every((l) => !l.reserve));
  assert.deepEqual(all.filter((l) => l.silent).map((l) => l.id), ['afterRewind_01', 'rootRead_02']);
  assert.ok(lines.some((l) => l.group === 'archived'));
  assert.ok(lines.some((l) => l.group === 'transferred'));
  assert.ok(lines.every((l) => l.text.length && l.direction.length && !/[\u3400-\u9fff]/u.test(l.text)));
  assert.ok(lines.every((l) => l.group !== 'call' && !l.silent));
  for (const l of lines) {
    assert.equal(l.source, LINES[RAW][l.group][l.index].text);
    assert.equal(l.text, ENGLISH[l.group][l.index].text);
  }
  assert.equal(JSON.stringify(LINES), before);
});

test('全量制作包含两条动态引导与同一男主的非语言撞击痛呼，不合成终端静默', () => {
  const production = productionLines();
  assert.equal(production.length, 57);
  assert.equal(new Set(production.map((l) => l.id)).size, 57);
  assert.ok(!production.some((l) => l.silent || l.text === '...'));
  const pain = PERFORMANCE_CUES.find((l) => l.id === 'fatalImpact_01');
  assert.equal(pain.nonverbal, true);
  assert.equal(pain.channel, 'spoken');
  assert.equal(speechRequest(pain, { ...options, lines: production }).voiceId, cast.chen);
  assert.match(synthesisText(pain), /screams in pain/);
  assert.match(synthesisText(production.find((l) => l.speaker === 'dispatch')), /cold, detached/);
  assert.match(synthesisText(production.find((l) => l.speaker === 'device')), /robotic/);
  assert.equal(VOICE_ROLES.device.name, 'URSA');
  assert.deepEqual(production.filter((l) => l.speaker === 'device').map((l) => l.id), ['question2_02', 'question3_03']);
  assert.deepEqual(production.filter((l) => l.group === 'target').map((l) => l.id), ['target_02']);
  assert.deepEqual(production.filter((l) => l.group === 'transferred').map((l) => l.id),
    ['transferred_01', 'transferred_02', 'transferred_03', 'transferred_05', 'transferred_06']);
});

test('源台词变化时阻止旧英文配音静默继续制作', () => {
  const old = ENGLISH.opening[0].source;
  try {
    ENGLISH.opening[0].source = 'outdated reference';
    assert.throws(() => dialogueLines(), /Stale English voice script: opening_01/);
  } finally { ENGLISH.opening[0].source = old; }
});

test('新英文稿不混用旧中文快照；组、句数和原文不一致时，生成配音会被拦下', () => {
  const mismatch = /English dialogue groups no longer match LINES|Stale English voice script|line count changed/;
  assert.throws(() => dialogueLines({ script }), mismatch);
});

test('新版稿校验拒绝缺组、句数变化和改写原文', () => {
  // RAW 里包含动态引导函数，只复制数组型台词。
  const copy = () => Object.fromEntries(Object.entries(LINES[RAW])
    .filter(([, list]) => Array.isArray(list)).map(([group, list]) => [group, list.map((l) => ({ ...l }))]));
  const missing = copy();
  delete missing.ready1;
  assert.throws(() => dialogueLines({ script: missing }), /groups no longer match/);
  const count = copy();
  count.opening.pop();
  assert.throws(() => dialogueLines({ script: count }), /line count changed: opening/);
  const changed = copy();
  changed.opening[0].text = '改写后的台词';
  assert.throws(() => dialogueLines({ script: changed }), /Stale English voice script: opening_01/);
});

test('新版 11 条试听涵盖三角色、内心独白和早晚情绪，陈墨始终是同一音色', () => {
  assert.equal(AUDITION_IDS.length, 11);
  const samples = lines.filter((l) => AUDITION_IDS.includes(l.id));
  assert.equal(samples.length, 11);
  assert.deepEqual(new Set(samples.map((l) => l.speaker)), new Set(['chen', 'dispatch', 'device']));
  assert.ok(samples.some((l) => l.channel === 'inner'));
  assert.ok(samples.some((l) => l.group === 'target'));
  for (const l of samples.filter((l) => l.speaker === 'chen')) assert.equal(speechRequest(l, options).voiceId, cast.chen);
  assert.equal(VOICE_ROLES.device.stability, 1);
});

test('API 只接收英文，表演标签不改显示稿，编号按字母数字念', () => {
  const l = lines[0];
  assert.equal(spokenText('B1016 P0 Cheng Xu'), 'B one zero one six P0 Chung Shyu');
  assert.equal(l.text, 'B1016, are you on scene?');
  for (const l of lines) {
    const { request } = speechRequest(l, options);
    assert.equal(request.language_code, 'en');
    assert.equal(request.model_id, 'eleven_v4');
    assert.ok(!/[\u3400-\u9fff]/u.test(JSON.stringify(request)));
    assert.equal(request.voice_settings.speed, undefined); // v4 没有 speed/style 控件
  }
  const inner = lines.find((l) => l.channel === 'inner');
  assert.match(synthesisText(inner), /internal monologue/);
  assert.throws(() => synthesisText({ id: 'silent-caption', silent: true }), /narrative silence/);
});

test('锁定的请求包含声音、上下文、语气及读音，改动会失效；不会跨角色拼接上下文', () => {
  const l = lines.find((l) => l.id === 'archived_05');
  const a = speechRequest(l, options), b = speechRequest(l, options);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.request.seed, b.request.seed);
  assert.ok(a.request.previous_text);
  assert.ok(a.request.next_text);
  assert.notEqual(a.fingerprint, speechRequest({ ...l, tag: 'angry' }, options).fingerprint);
  assert.notEqual(a.fingerprint, speechRequest(l, { ...options, cast: { ...cast, chen: 'another_voice' } }).fingerprint);
  const opening = speechRequest(lines[1], options);
  assert.equal(opening.request.previous_text, undefined);
  assert.equal(opening.request.next_text, undefined);
});

test('音色必须配置为三个不同 ID；不会偷偷用默认或中文音色', () => {
  assert.throws(() => validateCast({}), /ELEVENLABS_VOICE_CHEN/);
  assert.throws(() => validateCast({ ...cast, device: cast.dispatch }), /distinct/);
  assert.doesNotThrow(() => validateCast(cast));
  assert.deepEqual(castFromEnv({ ELEVENLABS_VOICE_CHEN: ' chen ' }), { chen: 'chen', dispatch: '', device: '' });
  assert.throws(() => new ElevenLabs(''), /Missing ELEVENLABS_API_KEY/);
});

test('每条仅请求一次，可断点续跑，不覆盖不同演员或不同文本的旧 take', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const bytes = Buffer.from('ID3' + 'test-audio'.repeat(30));
  const api = { synthesize: async () => { calls++; return { audio_base64: bytes.toString('base64'), alignment: null }; } };
  const a = await generateLine(directory, lines[0], options, api, () => 1.25);
  assert.equal(a.review, 'unreviewed');
  assert.equal(a.sha256, digest(bytes));
  assert.equal(a.duration, 1.25);
  const b = await generateLine(directory, lines[0], options, api, () => assert.fail('Cache should not be re-probed'));
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
  await assert.rejects(generateLine(directory, lines[0], { ...options, seed: 999 }, api), /different text, voice or settings/);
  assert.equal(calls, 1);
  const metadata = JSON.parse(await readFile(join(directory, `${lines[0].id}.json`), 'utf8'));
  assert.equal(metadata.model, 'eleven_v4');
});

test('网络中断后留下不确定请求记录，第二次不会重复扣费', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const api = { synthesize: async () => { calls++; throw new Error('connection lost'); } };
  await assert.rejects(generateLine(directory, lines[0], options, api), /connection lost/);
  await assert.rejects(generateLine(directory, lines[0], options, api), /Uncertain previous request/);
  assert.equal(calls, 1);
});

test('响应已落盘但本地处理失败时，从响应恢复，不重新调用 TTS', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const api = { synthesize: async () => { calls++; return { audio_base64: Buffer.from('audio'.repeat(40)).toString('base64') }; } };
  await assert.rejects(generateLine(directory, lines[0], options, api, () => { throw new Error('ffprobe missing'); }), /ffprobe missing/);
  const clip = await generateLine(directory, lines[0], options, api, () => 2);
  assert.equal(clip.duration, 2);
  assert.equal(calls, 1);
});

test('缓存损坏时停止，不静默覆盖或重复生成', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const api = { synthesize: async () => { calls++; return { audio_base64: Buffer.from('audio'.repeat(40)).toString('base64') }; } };
  await generateLine(directory, lines[0], options, api, () => 2);
  await writeFile(join(directory, `${lines[0].id}.mp3`), 'damaged');
  await assert.rejects(generateLine(directory, lines[0], options, api), /Damaged cached take/);
  assert.equal(calls, 1);
});

test('HTTP 请求不重试、不跟随重定向，不在报错中泄露密钥', async () => {
  const calls = [];
  const api = new ElevenLabs('secret-test-key', async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 401, text: async () => 'invalid secret-test-key' };
  });
  await assert.rejects(api.synthesize(cast.chen, { text: 'Hello.' }), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes('secret-test-key'));
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
  assert.match(calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//);
});

test('免费账号在任何付费生成之前被拦截，模型不可用时不降级', async () => {
  const api = new ElevenLabs('test-key');
  const calls = [];
  api.request = async (path) => { calls.push(path); return { tier: 'free', status: 'free' }; };
  await assert.rejects(api.preflight('eleven_v4', cast, 100), /active paid/);
  assert.deepEqual(calls, ['/v1/user/subscription']);
  api.request = async (path) => path.includes('subscription') ? { tier: 'starter', status: 'active', character_count: 0, character_limit: 30000 } : [{ model_id: 'eleven_multilingual_v2', can_do_text_to_speech: true }];
  await assert.rejects(api.preflight('eleven_v4', cast, 100), /No automatic model downgrade/);
});

test('内部非商用标志才能允许 Free，免费素材不能命中商用缓存', async () => {
  const api = new ElevenLabs('test-key');
  api.request = async (path) => path.includes('subscription')
    ? { tier: 'free', status: 'free', character_limit: 10000, character_count: 0 }
    : [{ model_id: 'eleven_v4', can_do_text_to_speech: true }];
  api.voices = async () => Object.values(cast).map((voice_id) => ({ voice_id }));
  await assert.rejects(api.preflight('eleven_v4', cast, 100), /active paid/);
  assert.equal((await api.preflight('eleven_v4', cast, 100, { nonCommercial: true })).tier, 'free');
  assert.notEqual(speechRequest(lines[0], options).fingerprint, speechRequest(lines[0], { ...options, nonCommercial: true }).fingerprint);
});

test('可分页列出账号音色，丢失游标时不会死循环', async () => {
  const api = new ElevenLabs('test-key');
  const pages = [];
  api.request = async (path) => { pages.push(path); return pages.length === 1 ? { voices: [{ voice_id: 'first' }], has_more: true, next_page_token: 'next' } : { voices: [{ voice_id: 'second' }], has_more: false }; };
  assert.equal((await api.voices()).length, 2);
  assert.ok(pages[1].includes('next_page_token=next'));
  api.request = async () => ({ voices: [], has_more: true });
  await assert.rejects(api.voices(), /pagination/);
});

test('试听页区分真实音频与待生成文本，FMOD 脚本只新增、不重建混音', () => {
  const html = auditionHTML(lines.slice(0, 2), new Set([lines[0].id]), 'a');
  assert.equal((html.match(/<audio /g) || []).length, 1);
  assert.match(html, /Audio not generated/);
  assert.match(html, /Unreviewed/);
  const script = fmimportScript([{ id: 'opening_01', file: '/asset.wav', channel: 'radio' }]);
  assert.match(script, /bank:\/VoiceEN/);
  assert.match(script, /Existing voice events/);
  assert.ok(!script.includes('deleteObject'));
  assert.ok(!script.includes('.volume ='));
  assert.ok(!script.includes('Snapshot'));
});

test('接线员广播只处理 radio 路由，保留推子，重复执行不堆叠效果器', async () => {
  const effects = [{ isOfExactType: (type) => type === 'MixerBusFader' }];
  const lookups = [];
  let saves = 0;
  const route = {
    effectChain: {
      effects,
      addEffect(type) { const effect = { isOfExactType: (name) => name === type }; effects.push(effect); return effect; },
    },
    set volume(_) { assert.fail('Do not overwrite dispatcher bus gain'); },
  };
  const studio = { project: {
    lookup(path) {
      lookups.push(path);
      if (path === 'bus:/DIALOGUE/radio') return route;
      if (path.startsWith('event:/voice/en/')) return { mixerInput: { output: { getPath: () => 'bus:/DIALOGUE/radio' } } };
      assert.fail(`Unrelated route touched: ${path}`);
    },
    save() { saves++; },
  } };
  const script = await readFile(new URL('../Fmod/dispatcher-radio.js', import.meta.url), 'utf8');
  for (let i = 0; i < 2; i++) runInNewContext(script, { studio, console: { log() {} } });
  assert.equal(saves, 2);
  assert.equal(effects.length, 4); // 原推子 + EQ + 压缩 + 轻饱和
  const eq = effects.find((e) => e.isOfExactType('MultibandEqEffect'));
  assert.equal(eq.frequencyA, 400);
  assert.equal(eq.frequencyB, 3400);
  assert.equal(eq.gainC, 2);
  const compressor = effects.find((e) => e.isOfExactType('CompressorEffect'));
  assert.equal(compressor.ratio, 4);
  assert.equal(compressor.attackTime, 4);
  assert.equal(effects.find((e) => e.isOfExactType('DistortionEffect')).level, 0.05);
  assert.equal(lookups.filter((p) => p.startsWith('event:')).length, 14); // 每次覆盖 7 条派单员台词；call2_03 已改成男主独白
});

test('女 AI 合成链仅处理 device，总线推子不变，重复执行不堆叠', async () => {
  const effects = [{ isOfExactType: (type) => type === 'MixerBusFader' }];
  const route = { effectChain: { effects, addEffect(type) {
    const effect = { isOfExactType: (name) => name === type }; effects.push(effect); return effect;
  } }, set volume(_) { assert.fail('Do not overwrite device bus gain'); } };
  let saves = 0;
  const studio = { project: { lookup(path) {
    if (path === 'bus:/DIALOGUE/device') return route;
    assert.ok(['event:/voice/en/question2_02', 'event:/voice/en/question3_03'].includes(path));
    return { mixerInput: { output: { getPath: () => 'bus:/DIALOGUE/device' } } };
  }, save() { saves++; } } };
  const script = await readFile(new URL('../Fmod/device-ai.js', import.meta.url), 'utf8');
  for (let i = 0; i < 2; i++) runInNewContext(script, { studio, console: { log() {} } });
  assert.equal(saves, 2);
  assert.equal(effects.length, 5);
  assert.equal(effects.find((e) => e.isOfExactType('FlangerEffect')).mix, 24);
  assert.equal(effects.find((e) => e.isOfExactType('ChorusEffect')).mix, 18);
});

test('重配音更新保留事件 GUID 和手工增益，旧事件只退出 Bank，复杂时间线先拦截', async () => {
  const script = await readFile(new URL('../Fmod/recast-events.js', import.meta.url), 'utf8');
  const bank = { id: 'voice-bank' }, route = {}, file = { length: 4.2 };
  let saves = 0, retired = 0;
  const instrument = { isOfExactType: (type) => type === 'SingleSound', volume: -3 };
  const current = { id: 'keep-guid', name: 'opening_01', timeline: { modules: [instrument] }, mixerInput: {}, banks: [{ id: bank.id }], getPath: () => 'event:/voice/en/opening_01' };
  const old = { name: 'obsolete_01', banks: [{ id: bank.id }], getPath: () => 'event:/voice/en/obsolete_01', relationships: { banks: { remove(b) { assert.equal(b, bank); retired++; } } } };
  const folder = { getItem: () => folder };
  const studio = { project: { workspace: { masterEventFolder: folder },
    lookup(path) { return path === 'bank:/VoiceEN' ? bank : path === 'bus:/DIALOGUE/radio' ? route : path === 'event:/voice/en/opening_01' ? current : null; },
    importAudioFile: () => file, save() { saves++; },
    model: { Event: { findInstances: () => [current, old, { getPath: () => 'event:/amb/rain' }] } },
    create() { assert.fail('Existing event must not be rebuilt'); },
  } };
  const context = { studio, console: { log() {} }, voiceEntries: [{ id: 'opening_01', channel: 'radio', file: '/new.wav' }] };
  runInNewContext(script, context);
  assert.equal(current.id, 'keep-guid');
  assert.equal(instrument.volume, -3);
  assert.equal(instrument.audioFile, file);
  assert.equal(instrument.length, 4.2);
  assert.equal(current.mixerInput.output, route);
  assert.equal(saves, 1);
  assert.equal(retired, 1);
  current.timeline.modules.push(instrument);
  assert.throws(() => runInNewContext(script, context), /Inspect manually authored/);
  assert.equal(saves, 1);
});

test('CLI 默认不收费；参数无效、未确认试听或未批准音频时停止', () => {
  const env = {
    ...process.env, ELEVENLABS_API_KEY: 'test-not-real',
    ELEVENLABS_VOICE_CHEN: cast.chen, ELEVENLABS_VOICE_DISPATCH: cast.dispatch, ELEVENLABS_VOICE_DEVICE: cast.device,
  };
  const run = (args) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/voice.mjs', import.meta.url)), ...args], { env, encoding: 'utf8' });
  // 游戏台词改过、配音稿还没跟上时，CLI 任何命令都先停下，不会花钱生成旧稿
  let stale = false;
  try { dialogueLines(); } catch { stale = true; }
  if (stale) {
    const result = run(['audition', '--confirm-cost']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no longer match LINES|Stale English voice script|line count changed/);
    return;
  }
  for (const [args, message] of [
    [['audition'], /confirm-cost/],
    [['generate', '--confirm-cost'], /approved-cast/],
    [['stage'], /approved-audio/],
    [['plan', '--take', '../unsafe'], /Invalid --take/],
    [['plan', '--id', 'unknown'], /Unknown or excluded/],
    [['plan', '--model', 'eleven_multilingual_v2'], /requires eleven_v4 or eleven_v3/],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});
