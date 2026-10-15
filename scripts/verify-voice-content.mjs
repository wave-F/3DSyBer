// 可选的内容转写检查，会消耗 ASR 额度；只给出差异，不把识别结果当成人工表演验收。
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { digest, readJSON } from './lib/voice.mjs';
import { productionLines, spokenText } from '../src/audio/dialogue.en.js';

const root = fileURLToPath(new URL('../', import.meta.url));
loadEnvFile(join(root, '.env.local'));
const { values } = parseArgs({ options: { take: { type: 'string', default: 'internal-v1' }, id: { type: 'string', multiple: true }, 'confirm-cost': { type: 'boolean' } } });
if (!/^[a-zA-Z0-9_-]+$/.test(values.take)) throw new Error('Invalid take.');
const source = join(root, 'Fmod/voice-work.local/en', values.take);
const staged = await readJSON(join(source, 'staged.json'));
const lines = productionLines().filter((l) => !l.nonverbal && (!values.id || values.id.includes(l.id)));
const clips = lines.map((l) => {
  const clip = staged.find((c) => c.id === l.id);
  if (!clip) throw new Error(`Missing staged ${l.id}`);
  return { ...clip, text: spokenText(l.text) };
});
const hash = digest(JSON.stringify(clips.map((c) => [c.id, c.wavSha256, c.text]))).slice(0, 16);
const directory = join(source, 'content-check', hash);
await mkdir(directory, { recursive: true });
const gap = join(directory, 'gap.wav'), merged = join(directory, 'review.wav');
const responseFile = join(directory, 'transcript.json');
let transcript = await readJSON(responseFile);
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr);
}
const quote = (p) => `file '${p.replaceAll("'", "'\\''")}'`;
if (!transcript) {
  if (!values['confirm-cost']) throw new Error('ASR consumes credits. Pass --confirm-cost to authorize one request.');
  // concat 的输入必须相同采样格式，不能把 s16 gap 当成 s24 解码而导致时间轴漂移。
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '0.5', '-c:a', 'pcm_s24le', gap]);
  await writeFile(join(directory, 'concat.txt'), clips.flatMap((c) => [quote(c.wav), quote(gap)]).join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(directory, 'concat.txt'), '-c:a', 'pcm_s16le', merged]);
  await writeFile(join(directory, 'pending.json'), JSON.stringify({ seconds: clips.reduce((n, c) => n + c.wavDuration + 0.5, 0), ids: clips.map((c) => c.id) }), { flag: 'wx' });
  const form = new FormData();
  form.set('model_id', 'scribe_v2'); form.set('language_code', 'en');
  form.set('tag_audio_events', 'true'); form.set('diarize', 'false');
  form.set('file', new Blob([await readFile(merged)], { type: 'audio/wav' }), 'review.wav');
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY.trim() }, body: form, signal: AbortSignal.timeout(180000), redirect: 'error' });
  if (!response.ok) throw new Error(`ASR HTTP ${response.status}. No automatic retry.`);
  transcript = await response.json();
  await writeFile(responseFile, JSON.stringify(transcript, null, 2));
}
const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const normalize = (text) => spokenText(text).toLowerCase()
  .replace(/\b0\.(\d+)\b/g, (_, fraction) => 'zero point ' + [...fraction].map((d) => digits[Number(d)]).join(' '))
  .replace(/\bblack dream\b/g, 'blackdream').replace(/\bnorthbank\b/g, 'north bank').replace(/\broot key\b/g, 'rootkey')
  .replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next[j + 1] = Math.min(row[j + 1] + 1, next[j] + 1, row[j] + (a[i] === b[j] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
let offset = 0;
const total = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', merged], { encoding: 'utf8' }).stdout);
const gapDuration = (total - clips.reduce((n, c) => n + c.wavDuration, 0)) / clips.length;
if (!Number.isFinite(gapDuration) || gapDuration < 0 || gapDuration > 1) throw new Error('Invalid review timeline.');
const report = clips.map((clip) => {
  const end = offset + clip.wavDuration;
  const words = (transcript.words || []).filter((w) => w.type === 'word' && (w.start + w.end) / 2 >= offset && (w.start + w.end) / 2 < end + 0.25);
  const recognized = words.map((w) => w.text).join(' ');
  const expectedWords = normalize(clip.text), recognizedWords = normalize(recognized);
  const edits = distance(expectedWords, recognizedWords);
  offset = end + gapDuration;
  return { id: clip.id, expected: clip.text, recognized, edits, errorRate: edits / Math.max(1, expectedWords.length) };
});
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checked: report.length, flagged: report.filter((r) => r.edits > 0), report: join(directory, 'report.json') }, null, 2));
