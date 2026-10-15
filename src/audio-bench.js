import './audio-bench.css';
import { FmodRuntime } from './audio/fmodRuntime.js';
import { BANKS, EVENTS, SNAPSHOTS, VCAS } from './audio/events.js';

const fmod = new FmodRuntime();
const status = document.querySelector('#status');
const indicator = document.querySelector('#indicator');
const initialize = document.querySelector('#initialize');
const stop = document.querySelector('#stop');
const volume = document.querySelector('#volume');
const controls = [];
let busy = false, frame, disposed = false;

function setStatus(text, state = '') {
  status.textContent = text;
  indicator.className = `indicator ${state}`;
}
function report(error) {
  console.error('[Audio preview]', error);
  setStatus(`音频错误：${error.message || error}。可点击按钮重试。`, 'error');
}
function refresh() {
  initialize.disabled = busy;
  initialize.textContent = fmod.ready ? '音频已启用' : busy ? '初始化中…' : '启用音频';
  stop.disabled = !fmod.ready || busy;
  for (const button of controls) button.disabled = busy;
}
async function run(action) {
  if (busy || disposed) return;
  busy = true;
  refresh();
  try {
    const wasReady = fmod.ready;
    await fmod.initialize();
    await fmod.loaded;   // 先装入 Frontend，其余 Bank 随后补齐
    if (disposed) return;
    // 首次启用只读 Studio 的 VCA 值，不用默认 100% 推子覆盖已调好的混音。
    if (!wasReady) {
      for (const [path, { input, out }] of vcaInputs) {
        const value = fmod.getVcaVolume(path);
        input.value = value;
        out.value = `${Math.round(value * 100)}%`;
        input.disabled = false;
      }
      volume.disabled = false;
    }
    fmod.setMuted(document.hidden);
    if (!document.hidden) action();
  } catch (error) { report(error); }
  finally { busy = false; refresh(); }
}
initialize.addEventListener('click', () => run(() => setStatus('FMOD 已就绪 · 选择一个事件开始试听', 'ready')));
stop.addEventListener('click', () => {
  fmod.stopOneShots();
  setStatus('已停止全部试听', 'ready');
});
volume.addEventListener('input', () => {
  document.querySelector('#volume-value').value = `${Math.round(Number(volume.value) * 100)}%`;
  fmod.setVolume(Number(volume.value));
});
volume.disabled = true;

// 混音：VCA 推子 + Snapshot 开关，FMOD 就绪后才生效
const vcaInputs = new Map();
const vcaLabels = { ambience: '环境 Ambience', sfx: '音效 SFX', ui: '界面 UI', dialogue: '英文配音 Dialogue', music: '音乐 Music' };
for (const [key, path] of Object.entries(VCAS)) {
  const label = document.createElement('label');
  label.className = 'volume';
  const input = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.01, value: 1, disabled: true });
  const out = document.createElement('output');
  out.value = '100%';
  input.addEventListener('input', () => {
    out.value = `${Math.round(Number(input.value) * 100)}%`;
    try { fmod.setVcaVolume(path, Number(input.value)); } catch (error) { report(error); }
  });
  vcaInputs.set(path, { input, out });
  label.append(vcaLabels[key], input, out);
  document.querySelector('#vcas').append(label);
}
const snapshotLabels = { dream: '黑梦 Dream', tablet: '平板 Tablet', carInterior: '车内 CarInterior', pause: '暂停 Pause', radar: '雷达 Radar' };
for (const [key, path] of Object.entries(SNAPSHOTS)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = snapshotLabels[key];
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => run(() => {
    const on = !button.classList.contains('on');
    fmod.setSnapshot(path, on);
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    setStatus(`${on ? '开启' : '关闭'} · ${path}`, 'ready');
  }));
  controls.push(button);
  document.querySelector('#snapshots').append(button);
}

document.querySelector('#banks').textContent = BANKS.join(' / ');
document.querySelector('#event-count').textContent = `${String(EVENTS.length).padStart(2, '0')} EVENTS`;
for (const [index, event] of EVENTS.entries()) {
  const card = document.createElement('article');
  card.className = 'event';
  const number = document.createElement('span');
  number.className = 'number';
  number.textContent = String(index + 1).padStart(2, '0');
  const detail = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = event.label;
  const path = document.createElement('code');
  path.textContent = event.path;
  const description = document.createElement('p');
  description.textContent = event.description;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = event.bank;
  detail.append(title, path, description, tag);
  const play = document.createElement('button');
  play.className = 'play primary';
  play.type = 'button';
  play.textContent = '▶ 播放';
  play.setAttribute('aria-label', `播放${event.label}`);
  play.addEventListener('click', () => run(() => {
    fmod.play(event);
    setStatus(`已触发 · ${event.path}`, 'ready');
  }));
  controls.push(play);
  card.append(number, detail, play);
  document.querySelector('#events').append(card);
}

void fmod.preload().then(() => {
  if (!fmod.ready && !busy && !disposed) setStatus('预载完成 · 点击启用音频或播放事件');
}).catch(report);

function tick() {
  if (disposed) return;
  try { fmod.update(); } catch (error) { report(error); return; }
  frame = requestAnimationFrame(tick);
}
tick();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) fmod.stopOneShots();
  fmod.setMuted(document.hidden);
});
function dispose() {
  disposed = true;
  cancelAnimationFrame(frame);
  fmod.dispose();
}
addEventListener('pagehide', (event) => {
  if (event.persisted) { fmod.stopOneShots(); fmod.setMuted(true); }
  else dispose();
});
addEventListener('pageshow', () => { if (!disposed) fmod.setMuted(document.hidden); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
if (import.meta.env.DEV) window.__audioPreview = fmod;
