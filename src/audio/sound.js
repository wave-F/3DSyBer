import { FmodRuntime } from './fmodRuntime.js';
import { EVENTS, FOLEY, SNAPSHOTS } from './events.js';
import { VOICE_LINES } from './voiceEvents.js';

// 游戏音频入口。所有调用在 FMOD 未就绪时都是空操作，音频出错不影响游戏流程。
// 音量只以 Studio 的 Bank 为准；游戏不设事件增益或 VCA 音量，只切换 Studio 的 Snapshot。

const MUSIC = 'event:/music/menu';

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

// 雨打在楼上：两种素材在各栋楼立面上交替使用，每个实例随机起点，避免同相叠加
const RAIN_HITS = ['event:/amb/Amb_5_rain', 'event:/amb/Amb_6_rain'];
const RAIN_HIT_RANGE = 45;   // 与 Studio 里事件的最大距离一致：更远的楼永远听不到，不建实例
let rainSpots = [];

// 广告牌换图：与 Studio 里 world/billboard_update 的最大距离一致
const BILLBOARD_RANGE = 60;
let billboards = [], billboardDwell = 9;

// 开场才用到、但在加载界面里经 streamsLoaded 开流预热并恢复暂停的循环
const PREPARED = ['event:/vehicle/drive_out', 'event:/vehicle/drive_in'];
const READY_TIMEOUT = 30000;   // 声音预载最多拖住加载界面这么久，失败或超时都不影响进游戏

const fmod = new FmodRuntime();
const rainInstances = [];
let booting = null, musicWanted = true, worldStarted = false, audioReady = null;
let audioStarted = null, dialoguePaused = false, radarTimer = 0;
const position = { x: 0, y: 0, z: 0 }, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 };

function guard(fn) {
  try { return fmod.ready ? fn() : undefined; } catch (error) { console.warn('[audio]', error.message); }
}

// 加载界面里先创建暂停实例，再由 streamsLoaded 静音开流预热，点击开始只取消暂停
function prepareWorld() {
  // 先把全部事件描述查好缓存，第一次触发时不再查找
  for (const { path } of EVENTS) {
    try { fmod.description(path); } catch { /* 试听清单里有不在 Bank 的事件（如 test/ping） */ }
  }
  for (const path of BEDS) fmod.prepareLoop(path);
  for (const [path, position] of Object.entries(EMITTERS)) fmod.prepareLoop(path, position);
  for (const path of PREPARED) fmod.prepareLoop(path);
  if (rainInstances.length) return;
  rainSpots.forEach((p, i) => {
    const path = RAIN_HITS[i % RAIN_HITS.length];
    const inst = fmod.prepareInstance(path, p, (it) => {
      fmod.check(it.setTimelinePosition(Math.floor(Math.random() * 60000)), `offset ${path}`);
      fmod.check(it.setPitch(0.94 + Math.random() * 0.12), `pitch ${path}`);
    });
    if (inst) rainInstances.push(inst);
  });
}

function startWorld() {
  for (const path of BEDS) fmod.startLoop(path);
  for (const [path, position] of Object.entries(EMITTERS)) fmod.startLoop(path, position);
  for (const inst of rainInstances) fmod.check(inst.setPaused(false), 'rain hits');
  worldStarted = true;
}

// 点到轴对齐盒子的距离
function distanceToBox(p, box) {
  const dx = Math.max(box.x[0] - p.x, 0, p.x - box.x[1]);
  const dz = Math.max(box.z[0] - p.z, 0, p.z - box.z[1]);
  return Math.hypot(dx, p.y - box.y, dz);
}

export const sound = {
  // 楼体立面上的雨声点（city.js 生成）。area：玩家能到的范围 { x: [min, max], z: [min, max], y: 耳高 }
  setRainSpots(spots, area) {
    rainSpots = spots.filter((p) => distanceToBox(p, area) < RAIN_HIT_RANGE);
  },

  // 广告大屏（city.js 收集）：{ x, y, z, phase }，每 dwell 秒按自己的相位换一次图
  setBillboards(screens, area, dwell) {
    billboards = screens.filter((p) => distanceToBox(p, area) < BILLBOARD_RANGE).map((p) => ({ ...p, k: null }));
    billboardDwell = dwell;
  },

  // 网页一打开就调用（雨声点要先 setRainSpots）：初始化 FMOD、装入全部 Bank、解码采样、预备好所有循环。
  // 返回的 Promise 在全部就绪（或失败 / 超时）时完成，加载界面等它；永远不会 reject。
  preload() {
    audioReady ??= Promise.race([
      // 菜单音乐只预备、不播放。加载会卡，播出来会跟着断。
      fmod.preload().then(() => guard(() => { if (musicWanted) fmod.prepareLoop(MUSIC); }))
        .then(() => fmod.loaded).then(() => guard(() => {
        fmod.setMuted(document.hidden);
        prepareWorld();
        return fmod.streamsLoaded([...fmod.loops.values(), ...rainInstances]);
      })),
      new Promise((resolve) => setTimeout(resolve, READY_TIMEOUT)),
    ]).catch((e) => console.warn('[audio] preload', e.message));
    return audioReady;
  },

  // 加载界面的任意点击 / 按键：只恢复音频输出。菜单音乐不在这里播。
  unlock() {
    fmod.initialize();   // 已初始化时在手势里同步恢复输出
    booting ??= fmod.preload().catch((e) => { booting = null; console.warn('[audio] init', e.message); });
  },

  // 点击开始（用户手势里调用）：音乐淡出 + 进入游戏音效 + 取消暂停已预备好的环境循环。
  // 加载界面已经等过 preload，这里没有装 Bank、开流之类的重活
  start() {
    musicWanted = false;
    fmod.initialize();
    guard(() => {
      fmod.stopLoop(MUSIC);
      fmod.play({ path: 'event:/ui/enter_game' });
      if (fmod.complete) startWorld();
    });
    // 万一点击时还没全部就绪（预载超时），就绪后再开
    audioStarted = Promise.resolve(sound.preload()).then(() => guard(() => {
      if (!worldStarted) { prepareWorld(); startWorld(); }
    }));
  },

  // position：3D 事件的世界坐标；不传则按 2D 播放
  play(name, { pitch = 1, position } = {}) {
    guard(() => fmod.play({ path: `event:/${name}`, pitch, position }));
  },

  // 2D 循环：on = true 开始，false 停止（Studio 的 AHDSR 淡出；immediate 立即切断）
  // 场景声在 Main Bank 装完前不启动，避免每帧报缺事件
  loop(name, on, { immediate = false } = {}) {
    const path = `event:/${name}`;
    guard(() => (on ? fmod.complete && fmod.startLoop(path) : fmod.stopLoop(path, immediate)));
  },

  // 跟着物体走的 3D 声源（循环或单发）：每帧传当前位置，第一次调用时开始；null 停止
  follow(name, position, { immediate = false } = {}) {
    const path = `event:/${name}`;
    guard(() => {
      if (!position) fmod.stopLoop(path, immediate);
      else if (!fmod.complete) return;
      else if (fmod.loops.has(path)) fmod.moveLoop(path, position);
      else fmod.startLoop(path, position);
    });
  },

  // 每帧用世界时间检查大屏换图（世界时间冻结时不换，也不出声）
  updateBillboards(time) {
    for (const b of billboards) {
      const k = Math.floor((time + b.phase) / billboardDwell);
      if (b.k !== null && k !== b.k && worldStarted) sound.play('world/billboard_update', { position: b });
      b.k = k;
    }
  },

  voice(id) {
    const clip = VOICE_LINES[id];
    if (!clip) return null; // 叙述性静默和未接入通话没有音频。
    let cancelled = false, handle = null;
    const done = Promise.resolve(audioStarted).then(() => {
      if (cancelled || !fmod.ready) return false;
      handle = fmod.playVoice(clip.path, dialoguePaused);
      return handle?.done ?? false;
    }).catch((error) => { console.warn('[voice]', error.message); return false; });
    return { done, stop() { cancelled = true; handle?.stop(); } };
  },

  setDialoguePaused(paused) {
    if (dialoguePaused === paused) return;
    dialoguePaused = paused;
    guard(() => fmod.setVoicesPaused(paused));
  },

  // 一步一个单次事件；踩在水洼上换成水脚步。跑步加快的是触发频率，素材音高 / 随机变化仍由 Studio 控制。
  step(water = false) {
    sound.play(water ? FOLEY.water : FOLEY.step);
    sound.cloth();
  },

  cloth() { sound.play(FOLEY.cloth); },

  // 黑梦：城市退远，只剩闷住的雨；世界声音带混响，脚步高切
  setDream(on) { guard(() => fmod.setSnapshot(SNAPSHOTS.dream, on)); },

  // 平板举起：环境让位给 UI
  setTablet(on) { guard(() => fmod.setSnapshot(SNAPSHOTS.tablet, on)); },

  // 开场坐在警车里：车外声音高切
  setCarInterior(on) { guard(() => fmod.setSnapshot(SNAPSHOTS.carInterior, on)); },

  // 暂停层出现 / 消失：面板音 + 整个游戏世界高切
  setPause(on) {
    sound.play(on ? 'ui/panel_open' : 'ui/panel_close');
    guard(() => fmod.setSnapshot(SNAPSHOTS.pause, on));
  },

  // Q 雷达发射瞬间：高切一下马上恢复（恢复曲线在 Studio 的 AHDSR 里），2 秒后释放实例
  radarDuck() {
    guard(() => {
      fmod.setSnapshot(SNAPSHOTS.radar, false);
      fmod.setSnapshot(SNAPSHOTS.radar, true);
    });
    clearTimeout(radarTimer);
    radarTimer = setTimeout(() => guard(() => fmod.setSnapshot(SNAPSHOTS.radar, false)), 2000);
  },

  // 按住分析的持续音：progress 0..1 推高音高；null 停止
  analyze(progress) {
    const path = 'event:/scifi/analyze_loop';
    guard(() => {
      if (progress == null) { fmod.stopLoop(path); return; }
      const inst = fmod.startLoop(path);
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
if (import.meta.env.DEV) {
  window.__fmod = fmod;
  window.__sound = Object.assign(sound, {
    debug: () => ({ spots: rainSpots, playing: rainInstances.length, billboards: billboards.length, loops: [...fmod.loops.keys()], complete: fmod.complete }),
  });
}
