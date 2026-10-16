// 局部替换已发布的配音：只把指定的几句换成新 take，其余录音、事件 GUID、混音都不动。
// 分两步，可以在不同电脑上做：
//   prepare（有原始 MP3 的电脑，不需要 FMOD）：去首尾静音 → -18 LUFS 响度处理（内心独白再降 inner-gain dB）
//     → 写 WAV 和 patch.json 到 Fmod/3DSyBer/Assets/voice/en/<take>/，随 git 提交。
//     node scripts/voice-patch.mjs prepare --take chris-a --id opening_02 --id start1_01 ... [--inner-gain -5]
//   apply（装了 FMOD Studio 2.03.14 的电脑，不需要 API key 和 MP3）：FMOD 只更新对应事件 → 构建 Bank → 更新映射与 manifest。
//     node scripts/voice-patch.mjs apply --take chris-a
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { readJSON, atomicWrite, digest, masterVoice, audioDuration } from './lib/voice.mjs';
import { VOICE_LINES } from '../src/audio/voiceEvents.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: {
  take: { type: 'string' }, id: { type: 'string', multiple: true }, 'inner-gain': { type: 'string', default: '-5' },
} });
const mode = positionals[0];
if (!['prepare', 'apply'].includes(mode) || !/^[a-zA-Z0-9_-]{1,40}$/.test(flags.take || '')) throw new Error('Usage: voice-patch.mjs prepare --take <take> --id <line> ... | apply --take <take>');
const relative = `Fmod/3DSyBer/Assets/voice/en/${flags.take}`;
const destination = join(root, relative);
const patchPath = join(destination, 'patch.json');

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message || r.stderr}`);
}

if (mode === 'prepare') {
  if (!flags.id?.length) throw new Error('prepare needs at least one --id.');
  const innerGain = Number(flags['inner-gain']);
  if (!Number.isFinite(innerGain) || innerGain > 0 || innerGain < -20) throw new Error('--inner-gain must be between -20 and 0 dB.');
  const work = join(root, 'Fmod/voice-work.local/en', flags.take);
  await mkdir(destination, { recursive: true });
  const clips = [];
  for (const id of flags.id) {
    if (!VOICE_LINES[id]) throw new Error(`Not a published line: ${id}`);
    const metadata = await readJSON(join(work, `${id}.json`));
    if (!metadata) throw new Error(`Missing generated clip: ${id}`);
    const mp3 = join(work, `${id}.mp3`);
    if (digest(await readFile(mp3)) !== metadata.sha256) throw new Error(`Damaged clip: ${id}`);
    if (metadata.source !== VOICE_LINES[id].source) throw new Error(`Script changed since publish: ${id}`);
    // 去掉首尾 -50 dB 以下的静音，前后各留 60 ms 呼吸
    const trimmed = join(destination, `${id}.trim.wav`);
    const silence = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06';
    ffmpeg(['-i', mp3, '-af', `${silence},areverse,${silence},areverse`, trimmed]);
    const mastered = join(destination, `${id}.master.wav`);
    try { await unlink(mastered); } catch {}
    const levels = masterVoice(trimmed, mastered);
    const wav = join(destination, `${id}.wav`);
    const gain = metadata.channel === 'inner' ? innerGain : 0;
    ffmpeg(['-i', mastered, '-af', `volume=${gain}dB`, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s24le', wav]);
    await unlink(trimmed); await unlink(mastered);
    clips.push({ ...metadata, review: 'unreviewed-internal-draft', event: `event:/voice/en/${id}`, wavDuration: Number(audioDuration(wav).toFixed(3)), mastering: { targetLUFS: -18 + gain, truePeakLimitDB: -2, input: levels, trimmedSilence: true }, wavSha256: digest(await readFile(wav)) });
    console.log(`${id}\t${clips.at(-1).wavDuration}s\t${metadata.channel}${gain ? ` ${gain} dB` : ''}`);
  }
  await atomicWrite(patchPath, JSON.stringify({ take: flags.take, voiceId: clips[0].voiceId, innerGainDB: innerGain, clips }, null, 2) + '\n');
  console.log(`Prepared ${clips.length} WAVs and ${relative}/patch.json. Commit them, then run "apply --take ${flags.take}" on a machine with FMOD Studio.`);
} else {
  const patch = await readJSON(patchPath);
  if (!patch?.clips?.length) throw new Error(`Missing ${relative}/patch.json; run prepare first.`);
  const entries = [];
  for (const c of patch.clips) {
    if (!VOICE_LINES[c.id] || c.source !== VOICE_LINES[c.id].source) throw new Error(`Script changed since prepare: ${c.id}`);
    const file = join(destination, `${c.id}.wav`);
    if (digest(await readFile(file)) !== c.wavSha256) throw new Error(`WAV changed since prepare: ${c.id}`);
    entries.push({ id: c.id, channel: c.channel, file });
  }
  // FMOD：只更新已有事件的音频，不新建、不移出 Bank，保留 GUID、增益、效果器。
  const studio = `var voiceEntries = ${JSON.stringify(entries, null, 2)};
(function () {
  var project = studio.project;
  voiceEntries.forEach(function (line) {
    var event = project.lookup('event:/voice/en/' + line.id);
    if (!event) throw new Error('Missing event: ' + line.id);
    if (event.timeline.modules.length !== 1 || !event.timeline.modules[0].isOfExactType('SingleSound')) throw new Error('Inspect manually authored voice timeline: ' + line.id);
  });
  voiceEntries.forEach(function (line) {
    var file = project.importAudioFile(line.file);
    if (!file || !(file.length > 0)) throw new Error('Missing or empty voice file: ' + line.file);
    var sound = project.lookup('event:/voice/en/' + line.id).timeline.modules[0];
    sound.audioFile = file; sound.start = 0; sound.startOffset = 0; sound.timelockedOffset = 0; sound.length = file.length; sound.looping = false;
  });
  project.save();
  console.log('Voice patch: ' + voiceEntries.length + ' events updated.');
})();
`;
  const work = join(root, 'Fmod/voice-work.local');
  await mkdir(work, { recursive: true });
  const scriptPath = join(work, `patch-${flags.take}.js`);
  await atomicWrite(scriptPath, studio);
  const executable = process.env.FMOD_STUDIO_BIN || '/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio';
  const r = spawnSync(executable, ['--platform', 'minimal', '-script', scriptPath, join(root, 'Fmod/3DSyBer/3DSyBer.fspro')], { cwd: root, env: { ...process.env, FMODSTUDIOCMDLINE: '1' }, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error(`FMOD Studio script failed. Install FMOD Studio 2.03.14 or set FMOD_STUDIO_BIN. ${r.error?.message || ''}`);
  const build = spawnSync('node', ['scripts/fmod.mjs', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('audio:build failed');

  // 游戏映射：只改这些句子的时长；manifest：替换片段记录、记下局部替换、更新 Bank 指纹。
  const registry = structuredClone(VOICE_LINES);
  for (const c of patch.clips) registry[c.id].duration = c.wavDuration;
  await atomicWrite(join(root, 'src/audio/voiceEvents.js'), `// Generated by voice:publish. Source and license: Fmod/voice-en-manifest.json\nexport const VOICE_LINES = ${JSON.stringify(registry, null, 2)};\n`);
  const manifestPath = join(root, 'Fmod/voice-en-manifest.json');
  const manifest = await readJSON(manifestPath);
  manifest.patches = (manifest.patches || []).filter((p) => p.take !== patch.take);
  manifest.patches.push({ take: patch.take, voiceId: patch.voiceId, ids: patch.clips.map((c) => c.id), innerGainDB: patch.innerGainDB, note: 'Partial recast; remaining lines keep the original take until regenerated.' });
  for (const c of patch.clips) manifest.clips[manifest.clips.findIndex((x) => x.id === c.id)] = c;
  manifest.bankSha256 = digest(await readFile(join(root, 'public/fmod/VoiceEN.bank')));
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Patched ${patch.clips.length} lines into the game from take ${patch.take}. Run npm run test:voice, then npm run build.`);
}
