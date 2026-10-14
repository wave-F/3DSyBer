// 离线英文配音制作。没有 --confirm-cost 时绝不发起合成；默认只做 12 条试听。
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { AUDITION_IDS, VOICE_ROLES, dialogueLines } from '../src/audio/dialogue.en.js';
import { ElevenLabs, castFromEnv, validateCast, speechRequest, cachedLine, generateLine, readJSON, digest, atomicWrite, auditionHTML, fmimportScript, masterVoice, audioDuration } from './lib/voice.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'Fmod/voice-work.local');

export async function main(args = process.argv.slice(2)) {
  try { loadEnvFile(join(root, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { values: flags, positionals } = parseArgs({ args, allowPositionals: true, options: {
    take: { type: 'string', default: 'a' }, model: { type: 'string', default: 'eleven_v4' },
    seed: { type: 'string', default: '417' }, id: { type: 'string', multiple: true }, search: { type: 'string' },
    'max-characters': { type: 'string', default: '2000' }, 'include-reserve': { type: 'boolean' },
    'confirm-cost': { type: 'boolean' }, 'approved-cast': { type: 'boolean' },
    'approved-audio': { type: 'boolean' }, help: { type: 'boolean' },
    'non-commercial': { type: 'boolean' }, 'allow-unreviewed': { type: 'boolean' },
  } });
  const mode = positionals[0] || 'plan';
  if (flags.help) {
    console.log('voice.mjs plan|voices|audition|generate|stage|publish [--take a] [--id opening_01] [--confirm-cost] [--max-characters 2000]\nFull production: generate --approved-cast --confirm-cost --max-characters 10000\nInternal noncommercial use: explicitly add --non-commercial; free audio is never relabeled commercial.\nStage reviewed full take: stage --approved-audio; internal drafts may use --non-commercial --allow-unreviewed.\nAfter FMOD build/sync: publish with the same --take, model and usage flags.');
    return;
  }
  if (!['plan', 'voices', 'audition', 'generate', 'stage', 'publish'].includes(mode) || positionals.length > 1) throw new Error('Unknown command. Use node scripts/voice.mjs --help.');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(flags.take)) throw new Error('Invalid --take. Use letters, numbers, underscores or hyphens.');
  if (!['eleven_v4', 'eleven_v3'].includes(flags.model)) throw new Error('This acting script requires eleven_v4 or eleven_v3. No silent fallback to a non-expressive model.');
  const seed = Number(flags.seed), budget = Number(flags['max-characters']);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid --seed.');
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100000) throw new Error('Invalid --max-characters (1–100000).');
  if (mode === 'voices') {
    const voices = await new ElevenLabs(process.env.ELEVENLABS_API_KEY).voices(flags.search);
    for (const v of voices) console.log(`${v.voice_id}\t${v.name}\t${JSON.stringify(v.labels || {})}\t${v.description || ''}`);
    console.log('Only available standard-rate voices are listed. Choose distinct voices and set the three ELEVENLABS_VOICE_* variables in .env.local.');
    return;
  }
  const all = dialogueLines({ includeReserve: flags['include-reserve'] });
  let selected = mode === 'audition' ? all.filter((l) => AUDITION_IDS.includes(l.id)) : all;
  if (flags.id) {
    for (const id of flags.id) if (!selected.some((l) => l.id === id)) throw new Error(`Unknown or excluded line: ${id}`);
    selected = selected.filter((l) => flags.id.includes(l.id));
  }
  if (mode === 'stage' && flags.id) throw new Error('Stage requires a complete production take, not --id subsets.');
  const directory = join(work, 'en', flags.take);
  const cast = castFromEnv(process.env);
  const castFile = await readJSON(join(root, 'Fmod/voice-cast.en.json'));
  for (const role of Object.keys(cast)) cast[role] ||= castFile?.voices?.[role]?.id || '';
  const options = { cast, model: flags.model, seed, lines: all, nonCommercial: !!flags['non-commercial'] };
  const characters = selected.reduce((n, l) => n + speechRequest(l, options).request.text.length, 0);
  console.log(`${mode}: ${selected.length} English lines, ${characters} input characters including acting tags. Model: ${flags.model}; take: ${flags.take}.`);

  async function reviewPage() {
    const rendered = new Set();
    for (const l of all) if (await readJSON(join(directory, `${l.id}.json`))) rendered.add(l.id);
    await atomicWrite(join(directory, 'index.html'), auditionHTML(all, rendered, flags.take));
  }

  if (mode === 'plan') {
    await mkdir(directory, { recursive: true });
    const plan = { language: 'en-US', model: flags.model, subtitleChanges: false, roles: VOICE_ROLES, audition: AUDITION_IDS, lines: all };
    await atomicWrite(join(directory, 'script.en.json'), JSON.stringify(plan, null, 2) + '\n');
    const rows = all.map((l) => `### ${l.id} · ${VOICE_ROLES[l.speaker].name} · ${l.channel}\n\n${l.text}\n\n> ${l.direction}\n`);
    await atomicWrite(join(directory, 'script.en.md'), '# English voice script\n\nUnreviewed localization and acting directions. Subtitles unchanged.\n\n' + rows.join('\n'));
    await reviewPage();
    console.log(`Script and review page: ${directory}\nNo network requests or paid generation.`);
    return;
  }
  validateCast(cast);

  if (mode === 'publish') {
    const staged = await readJSON(join(directory, 'staged.json'));
    if (!Array.isArray(staged) || staged.length !== all.length) throw new Error('Complete staging is required before publishing.');
    const bank = await readFile(join(root, 'public/fmod/VoiceEN.bank'));
    if (!bank.length) throw new Error('Build and sync VoiceEN.bank before publishing.');
    const registry = {};
    for (const l of all) {
      const clip = staged.find((c) => c.id === l.id);
      const metadata = await cachedLine(directory, l, options);
      if (!metadata || clip?.fingerprint !== metadata.fingerprint || digest(await readFile(clip.wav)) !== clip.wavSha256) throw new Error(`Staged voice changed: ${l.id}`);
      registry[l.id] = { path: clip.event, duration: clip.wavDuration, text: l.text, speaker: l.speaker, channel: l.channel };
    }
    const provenance = { provider: 'ElevenLabs', model: flags.model, usage: options.nonCommercial ? 'noncommercial-internal' : 'commercial', take: flags.take, licenseNotice: options.nonCommercial ? 'Generated on the ElevenLabs Free plan. Noncommercial use only; regenerate under a paid plan before any commercial use. Public sharing requires the attribution required by ElevenLabs.' : 'Verify account and voice permissions before distribution.', cast: castFile, bankSha256: digest(bank), clips: staged.map(({ wav, ...metadata }) => metadata) };
    await atomicWrite(join(root, 'src/audio/voiceEvents.js'), `// Generated by voice:publish. Source and license: Fmod/voice-en-manifest.json\nexport const VOICE_LINES = ${JSON.stringify(registry, null, 2)};\n`);
    await atomicWrite(join(root, 'Fmod/voice-en-manifest.json'), JSON.stringify(provenance, null, 2) + '\n');
    console.log(`Published ${staged.length} FMOD voice mappings. Usage: ${provenance.usage}. No TTS requests.`);
    return;
  }

  if (mode === 'stage') {
    if (!flags['approved-audio'] && !(flags['allow-unreviewed'] && flags['non-commercial'])) throw new Error('Listen to every production clip first, then explicitly pass --approved-audio. Internal noncommercial drafts may explicitly use --non-commercial --allow-unreviewed.');
    const clips = [];
    for (const l of selected) {
      const metadata = await cachedLine(directory, l, options);
      if (!metadata) throw new Error(`Missing ${l.id}; complete the take before staging.`);
      clips.push({ line: l, metadata });
    }
    // 每个 take 分开，不覆盖上一轮的 WAV；不启动 Studio、不复制 Bank、不改现有混音。
    const destination = join(root, 'Fmod/3DSyBer/Assets/voice/en', flags.take);
    const entries = clips.map(({ line: l }) => ({ id: l.id, channel: l.channel, file: join(destination, `${l.id}.wav`) }));
    for (const e of entries) {
      try { await readFile(e.file); throw new Error(`Staged WAV already exists: ${e.file}. Keep it or stage a new --take.`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(destination, { recursive: true });
    const measurements = entries.map((e) => masterVoice(join(directory, `${e.id}.mp3`), e.file));
    const staged = [];
    for (let i = 0; i < entries.length; i++) staged.push({ ...clips[i].metadata, review: flags['approved-audio'] ? 'user-approved' : 'unreviewed-internal-draft', event: `event:/voice/en/${entries[i].id}`, wav: entries[i].file, wavDuration: audioDuration(entries[i].file), mastering: { targetLUFS: -18, truePeakLimitDB: -2, input: measurements[i] }, wavSha256: digest(await readFile(entries[i].file)) });
    await atomicWrite(join(directory, 'staged.json'), JSON.stringify(staged, null, 2) + '\n');
    const mixScript = await readFile(join(root, 'Fmod/voice-mix.js'), 'utf8');
    await atomicWrite(join(directory, 'import-fmod.js'), fmimportScript(entries) + '\n' + mixScript);
    console.log(`Staged ${entries.length} mono 48 kHz/24-bit WAVs. Resampling does not add source detail.\nAdd-only Studio import script: ${join(directory, 'import-fmod.js')}\nNot executed. Save current Studio edits first; audition, mix and runtime integration remain separate steps.`);
    return;
  }

  if (!flags['confirm-cost']) throw new Error('No audio generated. Add --confirm-cost to authorize these synthesis requests (they consume ElevenLabs credits).');
  if (mode === 'generate' && !flags['approved-cast']) throw new Error('Approve the 12-line audition first, then pass --approved-cast for full production.');
  const pending = [];
  for (const l of selected) if (!await cachedLine(directory, l, options)) pending.push(l);
  if (!pending.length) { await reviewPage(); console.log('All requested clips are cached. No network requests.'); return; }
  const newCharacters = pending.reduce((n, l) => n + speechRequest(l, options).request.text.length, 0);
  if (newCharacters > budget) throw new Error(`${newCharacters} new input characters exceed --max-characters ${budget}. No synthesis requests sent. This is an input-size guard, not a guaranteed monetary price cap.`);
  const api = new ElevenLabs(process.env.ELEVENLABS_API_KEY);
  const account = await api.preflight(flags.model, cast, newCharacters, options);
  console.log(`Account verified (${account.tier}); usage: ${options.nonCommercial ? 'noncommercial internal' : 'commercial'}; ${account.remaining} included credits reported before generation. No automatic retries or voice/model substitutions.`);
  await mkdir(directory, { recursive: true });
  try {
    for (const l of pending) {
      const clip = await generateLine(directory, l, options, api);
      console.log(`${l.id}\t${clip.duration.toFixed(2)}s\t${l.speaker}\tunreviewed`);
    }
  } finally { await reviewPage(); }
  console.log(`Review in a browser: ${join(directory, 'index.html')}\nAudio is unreviewed and is not published to the game.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(`[voice] ${error.message}`); process.exitCode = 1; });
}
