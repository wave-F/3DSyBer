import * as THREE from 'three/webgpu';

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
const BLACK_MS = 650;        // 点击后黑场盖满
const FADE_MS = 1100;        // 黑场淡出（与 index.html 的 .fading 一致）

// 文件名 → 状态文字
const LABELS = [
  [/supercar/, '事故车辆'], [/police/, '警车'], [/bldg|building/, '城市建筑'], [/mannequin/, '人物'],
  [/\.hdr/, '环境光照'], [/scanner|card-arm/, '调查设备'], [/draco/, '模型解码器'], [/\.(jpe?g|png|webp)/, '材质贴图'],
];
const labelOf = (url) => LABELS.find(([re]) => re.test(url))?.[1] ?? '场景资源';

const root = document.getElementById('loading');
const stEl = root.querySelector('.ld-bar .st');
const pcEl = root.querySelector('.ld-bar .pc');
const fillEl = root.querySelector('.ld-bar .fill');

let loaded = 0, total = 0;
const t0 = performance.now();
let lastChange = t0;
let assetsDone = false, warmStart = 0, good = 0, lastFrame = 0;
let shown = 0, ready = false, started = false;
let startFn = null, wakeFn = null, denyFn = null;

const m = THREE.DefaultLoadingManager;
m.onStart = m.onProgress = (url, l, t) => {
  loaded = l; total = t;
  lastChange = performance.now();
  stEl.textContent = `正在加载 · ${labelOf(url)}`;
};
m.onError = (url) => console.warn('[loading] 加载失败', url);

function frame(now) {
  if (!assetsDone) {
    const settled = total > 0 && loaded >= total && now - lastChange > SETTLE_MS;
    if (settled || (total === 0 && now - t0 > IDLE_MS)) {
      assetsDone = true;
      warmStart = now;
      stEl.textContent = '正在准备画面';
    }
  } else if (!ready) {
    // 预热：统计连续不卡的帧
    good = lastFrame && now - lastFrame < WARM_DT ? good + 1 : 0;
  }
  lastFrame = now;

  const target = !assetsDone
    ? ASSET_SHARE * (total ? loaded / total : 0)
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
    stEl.textContent = '准备就绪';
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
root.addEventListener('click', () => {
  if (!ready) { if (!started) denyFn?.(); return; }   // 还没就绪：无效点击
  ready = false;
  started = true;
  root.style.pointerEvents = 'none';
  root.classList.add('closing');
  startFn?.();
  setTimeout(() => root.classList.add('fading'), BLACK_MS);
  setTimeout(() => root.classList.add('gone'), BLACK_MS + FADE_MS);
});

export const loading = {
  onStart(fn) { startFn = fn; },
  onWake(fn) { wakeFn = fn; },
  onDeny(fn) { denyFn = fn; },
  get done() { return root.classList.contains('gone'); },
};
