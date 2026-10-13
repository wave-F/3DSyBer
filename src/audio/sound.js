import { FmodRuntime } from './fmodRuntime.js';
import { SNAPSHOTS, VCAS } from './events.js';

// 游戏音频入口。所有调用在 FMOD 未就绪时都是空操作，音频出错不影响游戏流程。
// 音量与状态混音全部在 FMOD Mixer 里：总线 / Snapshot / VCA（Fmod/setup-mix.js）。

// 2D 立体声铺底：跟着头走，不随视角转动
const BEDS = ['event:/amb/rain', 'event:/amb/traffic'];

// 3D 点声源：世界坐标（米）。桥面 y = 20、x ∈ [-7, 7]，玩家在 z ∈ [-45, 67] 之间活动；
// 出生时面朝 +Z，+X 在玩家左手边（事故车撞断护栏的一侧）
const EMITTERS = {
  'event:/amb/Amb_1': { x: 26, y: 2, z: 22 },     // 城市低频轰鸣：+X 侧桥下街面
  'event:/amb/Amb_2': { x: -22, y: 3, z: 6 },     // 街面零碎活动：-X 侧楼脚
  'event:/amb/Amb_3': { x: 20, y: 2, z: 52 },     // 人群：+X 侧前方两栋楼之间的街口
  'event:/amb/Amb_4': { x: -70, y: 25, z: -60 },  // 远处城市整体：-X 侧后方楼群
};

const fmod = new FmodRuntime();
const position = { x: 0, y: 0, z: 0 }, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 };

function guard(fn) {
  try { return fmod.ready ? fn() : undefined; } catch (error) { console.warn('[audio]', error.message); }
}

export const sound = {
  preload() { fmod.preload().catch((e) => console.warn('[audio] preload', e.message)); },

  // 必须在用户手势（点击开始）里调用
  start() {
    fmod.initialize().then(() => guard(() => {
      fmod.setMuted(document.hidden);
      for (const path of BEDS) fmod.startLoop(path);
      for (const [path, position] of Object.entries(EMITTERS)) fmod.startLoop(path, position);
    })).catch((e) => console.warn('[audio] init', e.message));
  },

  play(name, { volume = 1, pitch = 1 } = {}) {
    guard(() => fmod.play({ path: `event:/${name}`, volume, pitch }));
  },

  // 黑梦：城市退远，只剩闷住的雨
  setDream(on) { guard(() => fmod.setSnapshot(SNAPSHOTS.dream, on)); },

  // 平板举起：环境让位给 UI
  setTablet(on) { guard(() => fmod.setSnapshot(SNAPSHOTS.tablet, on)); },

  // VCA 音量 0..1：ambience / sfx / ui
  setVolume(name, volume) { guard(() => fmod.setVcaVolume(VCAS[name], volume)); },
  getVolume(name) { return guard(() => fmod.getVcaVolume(VCAS[name])) ?? 1; },

  // 按住分析的持续音：progress 0..1 推高音高；null 停止
  analyze(progress) {
    const path = 'event:/scifi/analyze_loop';
    guard(() => {
      if (progress == null) { fmod.stopLoop(path); return; }
      const inst = fmod.startLoop(path);
      inst.setVolume(0.9);
      inst.setPitch(0.85 + progress * 0.55);
    });
  },

  // 听者跟随相机：位置 + 朝向（three.js 相机看向自身 -Z）
  update(dt, camera) {
    guard(() => {
      if (camera) {
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        position.x = e[12]; position.y = e[13]; position.z = e[14];
        forward.x = -e[8]; forward.y = -e[9]; forward.z = -e[10];
        up.x = e[4]; up.y = e[5]; up.z = e[6];
        fmod.setListener(position, forward, up);
      }
      fmod.update();
    });
  },
};

document.addEventListener('visibilitychange', () => guard(() => fmod.setMuted(document.hidden)));
if (import.meta.env.DEV) window.__sound = sound;
