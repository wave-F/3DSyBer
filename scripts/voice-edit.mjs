// 对已经生成的本机素材做有记录的短句剪辑，不请求云端，不改原始 API 音频。
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile, copyFile, writeFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readJSON, digest, masterVoice, matchVoiceLoudness, audioDuration, atomicWrite } from './lib/voice.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: f } = parseArgs({ options: { take: { type: 'string' }, id: { type: 'string' }, start: { type: 'string', default: '0' }, end: { type: 'string' }, reason: { type: 'string' }, 'match-published-loudness': { type: 'boolean' } } });
if (!/^[a-zA-Z0-9_-]+$/.test(f.take || '') || !/^[a-zA-Z0-9_]+$/.test(f.id || '') || !f.reason) throw new Error('Provide --take, --id, --end seconds and --reason.');
const start = Number(f.start), end = Number(f.end);
const directory = join(root, 'Fmod/voice-work.local/en', f.take);
const staged = await readJSON(join(directory, 'staged.json'));
const clip = staged?.find((c) => c.id === f.id);
if (!clip || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end - start < 0.2 || end > clip.duration || (start === 0 && end >= clip.duration)) throw new Error('Invalid clip or trim endpoints (absolute times in original API audio).');
if (digest(await readFile(clip.wav)) !== clip.wavSha256) throw new Error('WAV changed since staging; refusing to overwrite it.');
const backup = join(directory, 'edits', `${f.id}-${clip.wavSha256.slice(0, 12)}`);
await mkdir(backup, { recursive: true });
await copyFile(clip.wav, join(backup, 'before.wav'));
const cut = join(backup, 'cut.wav'), mastered = join(backup, 'mastered.wav');
const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', join(directory, `${f.id}.mp3`), '-ss', String(start), '-t', String(end - start), '-af', `afade=t=in:d=0.005,afade=t=out:st=${(end - start - 0.03).toFixed(3)}:d=0.03`, '-c:a', 'pcm_s24le', cut], { encoding: 'utf8' });
if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
let mastering;
if (f['match-published-loudness']) {
  const published = await readJSON(join(root, 'Fmod/voice-en-manifest.json'));
  const references = await readJSON(join(root, 'Fmod/voice-work.local/en', published.take, 'staged.json'));
  const reference = references?.find((c) => c.id === f.id);
  const provenance = published.clips.find((c) => c.id === f.id);
  if (!reference || reference.wavSha256 !== provenance?.wavSha256 || digest(await readFile(reference.wav)) !== reference.wavSha256) throw new Error('Missing or changed published loudness reference.');
  mastering = await matchVoiceLoudness(cut, mastered, reference.wav);
} else mastering = { targetLUFS: -18, truePeakLimitDB: -2, input: masterVoice(cut, mastered) };
const edit = { type: start ? 'trim-head-tail' : 'trim-tail', startSeconds: start, keepUntilSeconds: end, reason: f.reason, previousWavSha256: clip.wavSha256, originalAudioSha256: clip.sha256 };
await writeFile(join(backup, 'edit.json'), JSON.stringify(edit, null, 2));
// 用新文件名使 Studio 重新探测长度；原始 WAV / 原始 API 音频均保持不变。
const editedPath = clip.wav.replace(/\.wav$/, `_edit_${digest(await readFile(mastered)).slice(0, 8)}.wav`);
await copyFile(mastered, editedPath, constants.COPYFILE_EXCL);
clip.wav = editedPath;
clip.edits = [...(clip.edits || []), edit];
clip.wavSha256 = digest(await readFile(clip.wav));
clip.wavDuration = audioDuration(clip.wav);
clip.mastering = mastering;
await atomicWrite(join(directory, 'staged.json'), JSON.stringify(staged, null, 2) + '\n');
console.log(JSON.stringify({ id: clip.id, seconds: clip.wavDuration, backup, reason: f.reason, next: 'Refresh only this FMOD event instrument length, save/build the bank, then voice:publish.' }, null, 2));
