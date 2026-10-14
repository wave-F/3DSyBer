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
import { AUDITION_IDS, ENGLISH, VOICE_ROLES, dialogueLines, spokenText, synthesisText } from '../src/audio/dialogue.en.js';
import { ElevenLabs, castFromEnv, validateCast, speechRequest, generateLine, digest, auditionHTML, fmimportScript } from '../scripts/lib/voice.mjs';

const cast = { chen: 'test_chen_123456', dispatch: 'test_dispatch_123456', device: 'test_device_123456' };
// 工具链用录音时的中文台词快照检查；游戏里的台词改过后，dialogueLines() 默认会报 stale，见下方测试
const script = JSON.parse(readFileSync(new URL('./fixtures/voice-source.zh.json', import.meta.url), 'utf8'));
const lines = dialogueLines({ script });
const options = { cast, model: 'eleven_v4', seed: 417, lines };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), '3dsyber-voice-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('完整英文稿覆盖 71 条，默认只制作已接入的 65 条口语，保留中文原文', () => {
  const before = JSON.stringify(LINES);
  const all = dialogueLines({ includeReserve: true, includeSilent: true, script });
  assert.equal(all.length, 71);
  assert.equal(lines.length, 65);
  assert.equal(new Set(all.map((l) => l.id)).size, 71);
  assert.equal(all.filter((l) => l.reserve).length, 4);
  assert.equal(all.filter((l) => l.silent).length, 2);
  assert.ok(lines.some((l) => l.group === 'archived'));
  assert.ok(lines.some((l) => l.group === 'transferred'));
  assert.ok(lines.every((l) => l.text.length && l.direction.length && !/[\u3400-\u9fff]/u.test(l.text)));
  assert.ok(lines.every((l) => l.group !== 'call' && !l.silent));
  assert.equal(JSON.stringify(LINES), before);
});

test('源台词变化时阻止旧英文配音静默继续制作', () => {
  const old = ENGLISH.opening[0].source;
  try {
    ENGLISH.opening[0].source = 'outdated reference';
    assert.throws(() => dialogueLines({ script }), /Stale English voice script: opening_01/);
  } finally { ENGLISH.opening[0].source = old; }
});

test('游戏台词已改写而配音稿未更新时，生成配音会被拦下', () => {
  assert.throws(() => dialogueLines(), /English dialogue groups no longer match LINES|Stale English voice script|line count changed/);
});

test('12 条试听涵盖三角色、内心独白和早晚情绪，陈墨始终是同一音色', () => {
  assert.equal(AUDITION_IDS.length, 12);
  const samples = lines.filter((l) => AUDITION_IDS.includes(l.id));
  assert.equal(samples.length, 12);
  assert.deepEqual(new Set(samples.map((l) => l.speaker)), new Set(['chen', 'dispatch', 'device']));
  assert.ok(samples.some((l) => l.channel === 'inner'));
  assert.ok(samples.some((l) => l.group === 'target'));
  for (const l of samples.filter((l) => l.speaker === 'chen')) assert.equal(speechRequest(l, options).voiceId, cast.chen);
  assert.equal(VOICE_ROLES.device.stability, 1);
});

test('API 只接收英文，表演标签不改显示稿，编号按字母数字念', () => {
  const l = lines[0];
  assert.equal(spokenText('B1234 P0 Cheng Xu'), 'B one two three four P zero Chung Shyu');
  assert.equal(l.text, 'B1234, you on site yet?');
  for (const l of lines) {
    const { request } = speechRequest(l, options);
    assert.equal(request.language_code, 'en');
    assert.equal(request.model_id, 'eleven_v4');
    assert.ok(!/[\u3400-\u9fff]/u.test(JSON.stringify(request)));
    assert.equal(request.voice_settings.speed, undefined); // v4 没有 speed/style 控件
  }
  const inner = lines.find((l) => l.channel === 'inner');
  assert.match(synthesisText(inner), /internal monologue/);
  assert.throws(() => synthesisText(dialogueLines({ includeSilent: true, script }).find((l) => l.silent)), /narrative silence/);
});

test('锁定的请求包含声音、上下文、语气及读音，改动会失效；不会跨角色拼接上下文', () => {
  const l = lines.find((l) => l.id === 'dream1_02');
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
  assert.equal(lookups.filter((p) => p.startsWith('event:')).length, 16); // 每次覆盖 8 条派单员台词
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
