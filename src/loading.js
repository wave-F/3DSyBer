import * as THREE from 'three/webgpu';
import { getLang, setLang, onLang, tx } from './i18n.js';

// 加载界面（index.html 的 #loading）：真实加载进度 → 着色器预热 → 点击任意位置开始 → 黑场淡出
// 进度前 85% 来自 three.js 默认加载管理器（所有 GLTF / 贴图 / HDR 都走它），后 15% 是渲染预热：
// 资源到齐后，等画面连续若干帧不卡（WebGPU 第一次渲染要编译管线），避免进游戏第一秒掉帧
// main.js 第一个 import 本文件，保证在其他模块开始加载资源前挂上回调

const ASSET_SHARE = 0.85;
const SETTLE_MS = 600;       // 加载数到齐后再等这么久没有新文件，才算资源加载完
const IDLE_MS = 5000;        // 一直没有任何文件开始加载时，也视为加载完
const WARM_FRAMES = 15;      // 预热：连续这么多帧都不卡
const WARM_DT = 50;          // 不卡：帧间隔小于这个毫秒数
const WARM_MAX_MS = 10000;   // 预热最长等待
const BLACK_MS = 700;        // 点击后黑场盖满
const HOLD_MS = 450;         // 全黑再停一下，再开始露出开场
const FADE_MS = 3600;        // 黑场淡出（与 index.html 的 .fading 一致）

// 文件名 → 状态文字
const LABELS = [
  [/supercar/, '事故车辆', 'VEHICLE'], [/police/, '警车', 'POLICE CAR'], [/bldg|building/, '城市建筑', 'BUILDINGS'], [/mannequin/, '人物', 'FIGURE'],
  [/\.hdr/, '环境光照', 'LIGHTING'], [/scanner|fps-arm|card-insert|pry-arm/, '调查设备', 'TOOLS'], [/draco/, '模型解码器', 'DECODER'], [/\.(jpe?g|png|webp)/, '材质贴图', 'TEXTURES'],
];
const COPY = {
  zh: { init: '正在载入程序', load: '正在加载', prep: '正在准备画面', ready: '准备就绪', fallback: '场景资源' },
  en: { init: 'LOADING', load: 'LOADING', prep: 'PREPARING', ready: 'READY', fallback: 'ASSETS' },
};
const t = (k) => COPY[getLang()][k];
const labelOf = (url) => {
  const row = LABELS.find(([re]) => re.test(url));
  return row ? row[getLang() === 'en' ? 2 : 1] : t('fallback');
};
const paintStatus = (kind, url) => {
  if (kind === 'init') stEl.textContent = t('init');
  else if (kind === 'load') stEl.textContent = `${t('load')} · ${labelOf(url)}`;
  else if (kind === 'extra') stEl.textContent = `${t('load')} · ${tx(extraLabel, extraLabelEN)}`;
  else if (kind === 'prep') stEl.textContent = t('prep');
  else stEl.textContent = t('ready');
};

const root = document.getElementById('loading');
const stEl = root.querySelector('.ld-bar .st');
const pcEl = root.querySelector('.ld-bar .pc');
const fillEl = root.querySelector('.ld-bar .fill');

let loaded = 0, total = 0;
// 加载管理器之外要等的任务（声音：FMOD Bank 装入、采样解码、循环预备），算进资源阶段
let extraDone = 0, extraTotal = 0, extraLabel = '', extraLabelEN = '';
const t0 = performance.now();
let lastChange = t0;
let assetsDone = false, warmStart = 0, good = 0, lastFrame = 0;
let shown = 0, ready = false, started = false;
let startFn = null, wakeFn = null, denyFn = null;
let fadeAt = 0;
let phase = 'init';
let lastUrl = '';

const m = THREE.DefaultLoadingManager;
m.onStart = m.onProgress = (url, l, t) => {
  loaded = l; total = t;
  lastChange = performance.now();
  lastUrl = url;
  phase = 'load';
  paintStatus('load', url);
};
m.onError = (url) => console.warn('[loading] 加载失败', url);

function frame(now) {
  if (!assetsDone) {
    const filesDone = total > 0 ? loaded >= total : now - t0 > IDLE_MS;
    if (filesDone && extraDone < extraTotal) { phase = 'extra'; paintStatus('extra'); }
    const settled = filesDone && extraDone >= extraTotal && now - lastChange > SETTLE_MS;
    if (settled) {
      assetsDone = true;
      warmStart = now;
      phase = 'prep';
      paintStatus('prep');
    }
  } else if (!ready) {
    // 预热：统计连续不卡的帧
    good = lastFrame && now - lastFrame < WARM_DT ? good + 1 : 0;
  }
  lastFrame = now;

  const target = !assetsDone
    ? ASSET_SHARE * (total + extraTotal ? (loaded + extraDone) / (total + extraTotal) : 0)
    : ASSET_SHARE + (1 - ASSET_SHARE) * Math.max(Math.min(1, good / WARM_FRAMES), Math.min(1, (now - warmStart) / WARM_MAX_MS));
  // 只增不减（新文件加入时 loaded / total 会回落），平滑追赶；最后一小段直接补满
  if (target > shown) shown += (target - shown) * 0.12;
  if (target >= 1 && shown > 0.995) shown = 1;
  fillEl.style.width = `${(shown * 100).toFixed(2)}%`;
  pcEl.textContent = `${Math.floor(shown * 100)}%`;

  if (assetsDone && shown >= 0.999) {
    shown = 1;
    fillEl.style.width = '100%';
    pcEl.textContent = '100%';
    phase = 'ready';
    paintStatus('ready');
    // 先让 100% 停一下，再藏进度条，藏完才允许点击并显示开始提示
    setTimeout(() => root.classList.add('hide-bar'), 400);
    setTimeout(() => { ready = true; root.classList.add('ready'); }, 400 + 650);
    return;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 加载期间的任意点击 / 按键都是用户手势：交给 wakeFn 启动音频（菜单音乐）
// 就绪后的点击就是「开始」，不再先起音乐
const wake = () => { if (!started && !ready) wakeFn?.(); };
root.addEventListener('pointerdown', wake);
addEventListener('keydown', wake);

// 点击开始：必须在点击事件里同步调用 startFn（锁定鼠标需要用户手势）
function paintLangButtons() {
  const en = getLang() === 'en';
  root.dataset.lang = getLang();
  root.querySelector('.ld-lang').textContent = en ? '中文' : 'EN';
  const pause = document.getElementById('lang-btn');
  if (pause) pause.textContent = en ? '中文' : 'EN';
  const ov = document.getElementById('overlay');
  if (!ov) return;
  ov.querySelector('h1').textContent = tx('已暂停', 'PAUSED');
  ov.querySelector('.sub').textContent = tx('点击继续', 'CLICK TO CONTINUE');
  ov.querySelector('.ov-move').textContent = tx('WASD 移动 · Shift 奔跑 · 鼠标环顾 · Esc 暂停', 'WASD move · Shift run · Mouse look · Esc pause');
  ov.querySelector('.ov-look').textContent = tx('靠近可疑处按住 E 分析 · 找不到线索时按 Q 扫描', 'Hold E on a mark to analyze · Press Q to scan');
}
paintLangButtons();
paintStatus(phase, lastUrl);
onLang(() => { paintLangButtons(); paintStatus(phase, lastUrl); });

function toggleLang(e) {
  e.stopPropagation();
  e.preventDefault();
  setLang(getLang() === 'zh' ? 'en' : 'zh');
}
root.querySelector('.ld-lang').addEventListener('click', toggleLang);
document.getElementById('lang-btn').addEventListener('click', toggleLang);

function beginGame() {
  ready = false;
  started = true;
  root.style.pointerEvents = 'none';
  root.classList.add('closing');
  startFn?.();
  setTimeout(() => { fadeAt = performance.now(); root.classList.add('fading'); }, BLACK_MS + HOLD_MS);
  setTimeout(() => root.classList.add('gone'), BLACK_MS + HOLD_MS + FADE_MS);
}

root.addEventListener('click', () => {
  if (!ready) { if (!started) denyFn?.(); return; }   // 还没就绪：无效点击
  beginGame();
});

export const loading = {
  onStart(fn) { startFn = fn; },
  onWake(fn) { wakeFn = fn; },
  onDeny(fn) { denyFn = fn; },
  // 资源阶段额外等一个任务完成（成功或失败都算完成）
  waitFor(promise, label, en = label) {
    extraTotal++;
    extraLabel = label;
    extraLabelEN = en;
    Promise.resolve(promise).finally(() => { extraDone++; lastChange = performance.now(); });
  },
  get done() { return root.classList.contains('gone'); },
  // 距离黑幕完全揭开还剩多少毫秒；还没开始淡出时为 null
  get fadeLeft() {
    if (!fadeAt) return null;
    return Math.max(0, FADE_MS - (performance.now() - fadeAt));
  },
};
