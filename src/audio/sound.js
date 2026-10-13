import { FmodRuntime } from './fmodRuntime.js';

// 游戏音频入口。所有调用在 FMOD 未就绪时都是空操作，音频出错不影响游戏流程。
// Event 路径与 Fmod/build-events.js 一致。

// 环境层：路径 → 探索时 / 黑梦里的音量
const AMBIENCE = {
  'event:/amb/rain': [1, 0.35],
  'event:/amb/traffic': [0.8, 0.2],
  'event:/amb/crowd': [0.55, 0.08],
  'event:/amb/restaurant': [0.5, 0.06],
};
const DUCK_SPEED = 1.5;   // 每秒音量变化

const fmod = new FmodRuntime();
const loops = new Map();   // 路径 → { inst, volume, target }
let dream = 0, dreamTarget = 0;

function guard(fn) {
  try { return fmod.ready ? fn() : undefined; } catch (error) { console.warn('[audio]', error.message); }
}

function startLoop(path, volume = 1) {
  return guard(() => {
    let l = loops.get(path);
    if (!l) {
      const inst = fmod.instance(path);
      inst.setVolume(volume);
      inst.start();
      l = { inst };
      loops.set(path, l);
    }
    return l.inst;
  });
}

function stopLoop(path) {
  guard(() => {
    const l = loops.get(path);
    if (!l) return;
    l.inst.stop(fmod.module.STUDIO_STOP_ALLOWFADEOUT);
    l.inst.release();
    loops.delete(path);
  });
}

export const sound = {
  preload() { fmod.preload().catch((e) => console.warn('[audio] preload', e.message)); },

  // 必须在用户手势（点击开始）里调用
  start() {
    fmod.initialize().then(() => {
      fmod.setMuted(document.hidden);
      for (const [path, [v]] of Object.entries(AMBIENCE)) startLoop(path, v);
    }).catch((e) => console.warn('[audio] init', e.message));
  },

  play(name, { volume = 1, pitch = 1 } = {}) {
    guard(() => fmod.play({ path: `event:/${name}`, volume, pitch }));
  },

  // 黑梦：环境退远，只剩雨
  setDream(on) { dreamTarget = on ? 1 : 0; },

  // 按住分析的持续音：progress 0..1 推高音高；null 停止
  analyze(progress) {
    const path = 'event:/scifi/analyze_loop';
    if (progress == null) { stopLoop(path); return; }
    const inst = startLoop(path, 0.9);
    guard(() => inst?.setPitch(0.85 + progress * 0.55));
  },

  update(dt) {
    guard(() => {
      if (dream !== dreamTarget) {
        dream += Math.sign(dreamTarget - dream) * Math.min(Math.abs(dreamTarget - dream), dt * DUCK_SPEED);
        for (const [path, [a, b]] of Object.entries(AMBIENCE)) loops.get(path)?.inst.setVolume(a + (b - a) * dream);
      }
      fmod.update();
    });
  },
};

document.addEventListener('visibilitychange', () => guard(() => fmod.setMuted(document.hidden)));
