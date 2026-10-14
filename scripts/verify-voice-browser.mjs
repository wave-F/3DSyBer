// 真实 Chrome + FMOD WASM 冒烟测试，不生成语音、不调用云接口、不使用个人浏览器资料。
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'Fmod/voice-work.local');
await mkdir(work, { recursive: true });
const profile = await mkdtemp(join(work, 'browser-test-'));
const server = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
let chrome, ws;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools did not start.')), 30000);
    chrome.once('error', (error) => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', (chunk) => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const port = new URL(endpoint).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  let onLoad = null;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Page.loadEventFired') onLoad?.();
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Audio page navigation timed out.')), 30000);
    onLoad = () => { clearTimeout(timer); resolve(); };
  });
  await send('Page.navigate', { url: origin + '/audio.html' });
  await loaded;
  await send('Page.bringToFront');
  const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, userGesture: true, expression: `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 20000;
    while (!window.__audioPreview) { if (Date.now() > deadline) throw new Error('Audio page did not initialize'); await wait(50); }
    const fmod = window.__audioPreview;
    await fmod.preload();
    await fmod.initialize();
    // SDK 在 initialize 中注册点击恢复处理器；使用页面真实入口触发输出驱动接线。
    document.querySelector('#initialize').click();
    await wait(250);
    const { VOICE_LINES } = await import('/src/audio/voiceEvents.js');
    const entries = Object.entries(VOICE_LINES);
    const lengths = [];
    for (const [id, clip] of entries) {
      const out = {};
      fmod.check(fmod.description(clip.path).getLength(out), 'length ' + id);
      if (!(out.val > 0)) throw new Error('Empty FMOD event ' + id);
      lengths.push({ id, milliseconds: out.val });
    }
    const cancelled = fmod.playVoice(VOICE_LINES.question2_01.path);
    cancelled.stop();
    if (await cancelled.done !== false) throw new Error('Cancel did not resolve false');
    const voice = fmod.playVoice(VOICE_LINES.opening_02.path);
    await wait(180);
    fmod.setVoicesPaused(true); fmod.update();
    const inst = [...fmod.voices.keys()][0];
    const before = {}, after = {};
    fmod.check(inst.getTimelinePosition(before), 'position before pause');
    await wait(350); fmod.update();
    fmod.check(inst.getTimelinePosition(after), 'position while paused');
    if (Math.abs(after.val - before.val) > 50) throw new Error('Voice advanced while paused');
    fmod.setVoicesPaused(false);
    const finished = await Promise.race([voice.done, wait(10000).then(() => {
      const states = [...fmod.voices.keys()].map((v) => { const s = {}, p = {}, t = {}; v.getPlaybackState(s); v.getPaused(p); v.getTimelinePosition(t); return { state: s.val, paused: p.val, timeline: t.val }; });
      throw new Error('Voice did not finish: ' + JSON.stringify({ states, stopped: fmod.module.STUDIO_PLAYBACK_STOPPED, hidden: document.hidden, status: document.querySelector('#status').textContent }));
    })]);
    if (!finished) throw new Error('Voice failed');
    const dispatcher = fmod.playVoice(VOICE_LINES.opening_01.path);
    if (!await Promise.race([dispatcher.done, wait(10000).then(() => { throw new Error('Dispatcher radio voice did not finish'); })])) throw new Error('Dispatcher radio voice failed');
    const device = fmod.playVoice(VOICE_LINES.question2_06.path);
    if (!await Promise.race([device.done, wait(10000).then(() => { throw new Error('Device voice did not finish'); })])) throw new Error('Device voice failed');
    return { ready: fmod.ready, loadedVoiceEvents: entries.length, positiveLengths: lengths.length, cancel: true, pause: true, resumeAndFinish: true, dispatcherRadioPlayback: true, remainingVoiceHandles: fmod.voices.size, lengths };
  })()` });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  const evidence = result.result.value;
  await writeFile(join(work, 'browser-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ ...evidence, lengths: `${evidence.lengths.length} event lengths recorded in Fmod/voice-work.local/browser-smoke.json` }, null, 2));
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise((resolve) => { chrome.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
