import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { VOICE_ROLES, synthesisText, spokenText } from '../../src/audio/dialogue.en.js';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function atomicWrite(path, value) {
  const temporary = `${path}.partial`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}

export function castFromEnv(env) {
  return Object.fromEntries(Object.entries(VOICE_ROLES).map(([role, { env: name }]) => [role, (env[name] || '').trim()]));
}

export function validateCast(cast) {
  for (const [role, settings] of Object.entries(VOICE_ROLES)) {
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(cast[role] || '')) throw new Error(`Set ${settings.env} to a real voice ID from npm run voice:voices. Do not use a voice name.`);
  }
  if (new Set(Object.values(cast)).size !== 3) throw new Error('Choose three distinct voices. Chen Mo uses the same voice for spoken lines and inner monologue.');
}

export function speechRequest(l, { cast, model, seed, lines, nonCommercial = false }) {
  const role = VOICE_ROLES[l.speaker];
  const request = {
    text: synthesisText(l), model_id: model, language_code: 'en',
    voice_settings: { stability: role.stability, similarity_boost: role.similarity },
    seed: (seed + Number.parseInt(digest(l.id).slice(0, 8), 16)) >>> 0,
  };
  // 只借用同一段里相邻、同一人的英文，绝不把中文或叙述性静默送入 TTS。
  const previous = lines.find((x) => x.group === l.group && x.index === l.index - 1 && x.speaker === l.speaker && x.channel === l.channel && !x.silent);
  const next = lines.find((x) => x.group === l.group && x.index === l.index + 1 && x.speaker === l.speaker && x.channel === l.channel && !x.silent);
  if (previous) request.previous_text = spokenText(previous.text);
  if (next) request.next_text = spokenText(next.text);
  const voiceId = cast[l.speaker];
  const fingerprint = digest(JSON.stringify({ source: l.source, direction: l.direction, voiceId, usage: nonCommercial ? 'noncommercial' : 'commercial', output: 'mp3_44100_128', request }));
  return { voiceId, request, fingerprint };
}

export class ElevenLabs {
  constructor(key, fetcher = fetch) {
    if (!key?.trim()) throw new Error('Missing ELEVENLABS_API_KEY. Set it in the project .env.local; never put it in VITE_* or in chat.');
    this.key = key.trim();
    this.fetcher = fetcher;
  }

  async request(path, body) {
    let response;
    try {
      response = await this.fetcher(`https://api.elevenlabs.io${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'xi-api-key': this.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(180000), redirect: 'error',
      });
    } catch {
      throw new Error('ElevenLabs connection failed or timed out. No automatic retry: check generation history before retrying a paid request.');
    }
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(this.key, '[redacted]').slice(0, 600);
      throw new Error(`ElevenLabs HTTP ${response.status}: ${detail}. No automatic retry.`);
    }
    return response.json();
  }

  async voices(search = '') {
    const voices = [], pages = new Set();
    let cursor;
    do {
      const query = new URLSearchParams({ page_size: '100', include_custom_rates: 'false' });
      if (search) query.set('search', search);
      if (cursor) query.set('next_page_token', cursor);
      const result = await this.request(`/v2/voices?${query}`);
      if (!Array.isArray(result.voices)) throw new Error('Invalid ElevenLabs voice listing.');
      voices.push(...result.voices);
      if (!result.has_more) break;
      cursor = result.next_page_token;
      if (!cursor || pages.has(cursor) || pages.size >= 20) throw new Error('Voice pagination did not finish. Use --search to narrow it.');
      pages.add(cursor);
    } while (cursor);
    return voices;
  }

  async preflight(model, cast, characters, { nonCommercial = false } = {}) {
    validateCast(cast);
    const account = await this.request('/v1/user/subscription');
    const freeAllowed = nonCommercial && account.tier === 'free' && account.status === 'free';
    if (!freeAllowed && (!account.tier || ['free', 'trial'].includes(account.tier) || !['active', 'trialing'].includes(account.status))) {
      throw new Error('An active paid ElevenLabs plan is required for this commercial game workflow. No audio was generated.');
    }
    const remaining = account.character_limit - account.character_count;
    if (!Number.isFinite(remaining) || remaining < characters) throw new Error(`Insufficient included credits (${remaining}); this tool will not intentionally enter overages.`);
    const models = await this.request('/v1/models');
    if (!Array.isArray(models) || !models.some((m) => m.model_id === model && m.can_do_text_to_speech)) {
      throw new Error(`${model} is not available to this account. No automatic model downgrade; review the cast/model first.`);
    }
    const voices = await this.voices();
    for (const id of Object.values(cast)) {
      const voice = voices.find((v) => v.voice_id === id);
      if (!voice || (voice.sharing?.rate > 0) || (voice.sharing?.fiat_rate > 0)) throw new Error(`Voice ${id} is unavailable or has a custom rate. Choose an available standard-rate voice.`);
    }
    this.accountTier = account.tier;
    return { tier: account.tier, remaining };
  }

  synthesize(voiceId, request) {
    return this.request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, request);
  }
}

export function audioDuration(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' });
  if (result.error) throw new Error(`ffprobe is required: ${result.error.message}`);
  const seconds = Number(result.stdout?.trim());
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds < 0.1 || seconds > 180) throw new Error(`Invalid voice audio: ${path}`);
  return seconds;
}

export function masterVoice(source, destination) {
  const analysis = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', source, '-af', 'aformat=channel_layouts=mono,loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  if (analysis.error || analysis.status !== 0) throw new Error(`Voice loudness analysis failed: ${source}`);
  const match = analysis.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (!match) throw new Error(`Missing loudness measurements: ${source}`);
  const levels = JSON.parse(match[0]);
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) if (!Number.isFinite(Number(levels[key]))) throw new Error(`Invalid or silent audio: ${source}`);
  const filter = `aformat=channel_layouts=mono,loudnorm=I=-18:TP=-2:LRA=11:measured_I=${levels.input_i}:measured_TP=${levels.input_tp}:measured_LRA=${levels.input_lra}:measured_thresh=${levels.input_thresh}:offset=${levels.target_offset}:linear=true`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', source, '-af', filter, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s24le', destination], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Voice mastering failed: ${destination}: ${result.error?.message || result.stderr}`);
  return levels;
}

export async function cachedLine(directory, l, options) {
  const { fingerprint } = speechRequest(l, options);
  const metadata = await readJSON(join(directory, `${l.id}.json`));
  if (!metadata) return null;
  if (metadata.fingerprint !== fingerprint) throw new Error(`Take already exists with different text, voice or settings: ${l.id}. Use a new --take; old audio will not be overwritten.`);
  const bytes = await readFile(join(directory, `${l.id}.mp3`));
  if (digest(bytes) !== metadata.sha256 || !Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error(`Damaged cached take: ${l.id}. Inspect it before retrying.`);
  return metadata;
}

export async function generateLine(directory, l, options, api, probe = audioDuration) {
  await mkdir(directory, { recursive: true });
  const cached = await cachedLine(directory, l, options);
  if (cached) return { ...cached, cached: true };
  const { voiceId, request, fingerprint } = speechRequest(l, options);
  const responsePath = join(directory, `${l.id}.response.json`);
  const pendingPath = join(directory, `${l.id}.pending.json`);
  let saved = await readJSON(responsePath);
  if (saved && saved.fingerprint !== fingerprint) throw new Error(`Unfinished take has different settings: ${l.id}. Use a new --take.`);
  if (!saved) {
    if (await readJSON(pendingPath)) throw new Error(`Uncertain previous request for ${l.id}. Check ElevenLabs history and recover the audio before explicitly removing its .pending.json file. Do not blindly retry.`);
    // 支付请求发出前落盘；网络断开或进程退出时不会下一次无声地重复扣费。
    await writeFile(pendingPath, JSON.stringify({ fingerprint, voiceId, request, startedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
    const response = await api.synthesize(voiceId, request);
    saved = { fingerprint, response };
    await atomicWrite(responsePath, JSON.stringify(saved));
  }
  const base64 = saved.response?.audio_base64;
  if (typeof base64 !== 'string' || !base64.length) throw new Error(`ElevenLabs returned no audio for ${l.id}; response retained for inspection.`);
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 32) throw new Error(`Empty or truncated voice: ${l.id}`);
  const audioPath = join(directory, `${l.id}.mp3`);
  await atomicWrite(audioPath, bytes);
  const duration = probe(audioPath);
  const metadata = {
    id: l.id, group: l.group, speaker: l.speaker, channel: l.channel,
    text: l.text, source: l.source, direction: l.direction,
    provider: 'elevenlabs', model: options.model, voiceId, fingerprint,
    usage: options.nonCommercial ? 'noncommercial' : 'commercial', accountTier: api.accountTier || 'unknown',
    seed: request.seed, sha256: digest(bytes), duration, review: 'unreviewed',
    createdAt: new Date().toISOString(),
  };
  await atomicWrite(join(directory, `${l.id}.json`), JSON.stringify(metadata, null, 2) + '\n');
  await unlink(pendingPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  return metadata;
}

export function fmimportScript(entries) {
  return `// Generated by voice:stage. Add-only: never rebuild existing events or touch their mix.\nvar lines = ${JSON.stringify(entries, null, 2)};\nvar ws = studio.project.workspace;\nvar existing = [];\nlines.forEach(function (line) {\n    if (studio.project.lookup('event:/voice/en/' + line.id)) existing.push(line.id);\n});\nif (existing.length) throw new Error('Existing voice events; inspect/update them manually: ' + existing.join(', '));\n// Validate all assets before creating anything.\nvar files = lines.map(function (line) {\n    var file = studio.project.importAudioFile(line.file);\n    if (!file) throw new Error('Missing ' + line.file);\n    return file;\n});\nvar bank = studio.project.lookup('bank:/VoiceEN');\nif (!bank) {\n    bank = studio.project.create('Bank');\n    bank.name = 'VoiceEN';\n    bank.folder = ws.masterBankFolder;\n}\nfunction bus(name) {\n    var b = studio.project.lookup('bus:/DIALOGUE/' + name);\n    if (b) return b;\n    var parent = studio.project.lookup('bus:/DIALOGUE');\n    if (!parent) {\n        parent = studio.project.create('MixerGroup');\n        parent.name = 'DIALOGUE';\n        parent.output = ws.mixer.masterBus;\n    }\n    b = studio.project.create('MixerGroup');\n    b.name = name;\n    b.output = parent;\n    return b;\n}\nfunction folder(parent, name) {\n    var f = parent.getItem(name);\n    if (!f) { f = studio.project.create('EventFolder'); f.name = name; f.folder = parent; }\n    return f;\n}\nvar target = folder(folder(ws.masterEventFolder, 'voice'), 'en');\nlines.forEach(function (line, i) {\n    var e = studio.project.create('Event');\n    e.name = line.id;\n    e.folder = target;\n    e.mixerInput.output = bus(line.channel);\n    e.relationships.banks.add(bank);\n    var sound = e.masterTrack.addSound(e.timeline, 'SingleSound', 0, files[i].length);\n    sound.audioFile = files[i];\n    sound.looping = false;\n});\nstudio.project.save();\nconsole.log('Imported ' + lines.length + ' English voice events into VoiceEN. Existing ambience, Foley, effects and snapshots untouched.');\n`;
}

const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function auditionHTML(lines, rendered, take) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>English voice review · ${escapeHTML(take)}</title>
<style>body{font:16px/1.6 system-ui;max-width:960px;margin:40px auto;padding:0 24px;background:#101820;color:#e6eef2}article{padding:22px 0;border-top:1px solid #354650}small{color:#a3b6c0}audio{display:block;width:100%;margin-top:14px}p{margin:8px 0}h1{font-size:26px}.pending{color:#f2bf70}</style>
<h1>English dialogue · take ${escapeHTML(take)}</h1><p>Unreviewed AI performances. Check identity, acting, pronunciation, missing/extra words and clipping before approving. Dry audio: radio/device processing belongs in FMOD. Subtitles are unchanged.</p>
${lines.map((l) => `<article><small>${escapeHTML(l.id)} · ${escapeHTML(VOICE_ROLES[l.speaker].name)} · ${escapeHTML(l.channel)}</small><p>${escapeHTML(l.text)}</p><small>${escapeHTML(l.direction)}</small>${rendered.has(l.id) ? `<audio controls preload="none" src="${encodeURIComponent(l.id)}.mp3"></audio>` : '<p class="pending">Audio not generated.</p>'}</article>`).join('\n')}
<script>document.addEventListener('play',function(e){if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(function(a){if(a!==e.target)a.pause()})},true)</script></html>`;
}
