import * as THREE from 'three/webgpu';
import { CAR_POS } from './crash.js';
import { DECK_Y } from './bridge.js';
import { POLICE_POS, POLICE_YAW } from './policeCar.js';

// 开场：高角度跟车 → 正面看停车 → 车内看任务 → 第一人称下车
// 坐着看向现场 → 转头伸手开门 → 侧身探出车门 → 起身退到门外 → 回身关门 → 转向事故车走两步，交还控制
// 关键帧坐标为警车组本地坐标（米，车头 +Z，驾驶门在 +X 侧）；h 为相对车头的水平朝向（+ 向驾驶门一侧），p 为俯仰（+ 抬头）
// 仅在鼠标锁定时推进（暂停即暂停）；空格跳过
const EYE = 1.7;
const KEYS = [
  { t: 0.0, pos: [0.50, 1.15, 0.00], h: 0.06, p: -0.05 },  // 驾驶座，看向前方事故现场
  { t: 1.8, pos: [0.50, 1.15, 0.00], h: 0.10, p: -0.04 },
  { t: 2.5, pos: [0.55, 1.13, 0.06], h: 1.05, p: -0.28 },  // 转头看车门把手
  { t: 3.4, pos: [0.80, 1.10, 0.28], h: 1.65, p: -0.10 },  // 门推开，身体转向门外（视线避开门板）
  { t: 4.2, pos: [1.38, 1.17, 0.30], h: 1.75, p: -0.22 },  // 低头从门框下钻出
  { t: 5.1, pos: [1.95, EYE, -0.15], h: 0.30, p: -0.10 },  // 起身，退到车门摆动范围外
  { t: 5.7, pos: [2.02, EYE, -0.22], h: -0.45, p: -0.32 }, // 回身看车门，关门
  { t: 6.5, pos: [2.10, EYE, -0.10], h: -0.20, p: -0.12 },
  { t: 7.8, pos: [2.30, EYE, 1.30], h: null, p: null },     // 转向事故车走两步（朝向在运行时算）
];
const DOOR = { open: [2.45, 3.35], close: [5.45, 6.0] };
const WALK = [6.5, 7.8]; // 走路段加一点头部起伏
const END = KEYS[KEYS.length - 1].t;

const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
// 均匀 Catmull-Rom（标量）
const cr = (a, b, c, d, u) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);

export function createIntro({ camera, police, controls, inv }) {
  const g = police.group;
  g.updateMatrixWorld(true);
  const yaw0 = g.rotation.y;

  // 最后一帧：看向事故车
  const last = KEYS[KEYS.length - 1];
  const endWorld = g.localToWorld(new THREE.Vector3(...last.pos));
  const toCar = new THREE.Vector3(CAR_POS.x, CAR_POS.y + 0.6, CAR_POS.z).sub(endWorld);
  last.h = Math.atan2(toCar.x, toCar.z) - yaw0;
  last.p = Math.atan2(toCar.y, Math.hypot(toCar.x, toCar.z));
  // 朝向展开成连续角度，避免插值绕远路
  for (let i = 1; i < KEYS.length; i++) {
    while (KEYS[i].h - KEYS[i - 1].h > Math.PI) KEYS[i].h -= Math.PI * 2;
    while (KEYS[i].h - KEYS[i - 1].h < -Math.PI) KEYS[i].h += Math.PI * 2;
  }

  const CHASE = 7;
  const PARK = 4.2;
  const Z0 = -110;   // 跟车起点
  const Z1 = -34;    // 跟车结束，接着滑进车位
  let phase = 'chase';
  let t = 0;
  let playing = true;
  const local = new THREE.Vector3();
  const look = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function placeCar(z) {
    g.position.set(POLICE_POS.x, POLICE_POS.y, z);
    g.rotation.y = POLICE_YAW;
  }

  function sample(time) {
    let i = 0;
    while (i < KEYS.length - 2 && time >= KEYS[i + 1].t) i++;
    const k1 = KEYS[i], k2 = KEYS[i + 1];
    const k0 = KEYS[Math.max(0, i - 1)], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)];
    let u = clamp01((time - k1.t) / (k2.t - k1.t));
    if (i === 0) u = u * u;                      // 起步缓入
    if (i === KEYS.length - 2) u = 1 - (1 - u) * (1 - u); // 收尾缓出
    const v = (f) => cr(f(k0), f(k1), f(k2), f(k3), u);
    local.set(v((k) => k.pos[0]), v((k) => k.pos[1]), v((k) => k.pos[2]));
    let h = v((k) => k.h), p = v((k) => k.p);
    // 坐着时轻微呼吸；走路时头部起伏
    if (time < 2.3) local.y += Math.sin(time * 1.9) * 0.006;
    if (time > WALK[0]) {
      const w = clamp01((time - WALK[0]) / 0.3) * clamp01((WALK[1] - time) / 0.3);
      local.y += Math.abs(Math.sin((time - WALK[0]) * 5.2)) * 0.035 * w - 0.015 * w;
      h += Math.sin((time - WALK[0]) * 2.6) * 0.012 * w;
    }
    camera.position.copy(g.localToWorld(local));
    euler.set(p, yaw0 + h + Math.PI, 0);
    camera.quaternion.setFromEuler(euler);

    const open = smooth(clamp01((time - DOOR.open[0]) / (DOOR.open[1] - DOOR.open[0])));
    // 关门：先慢后快，最后一下带上
    const c = clamp01((time - DOOR.close[0]) / (DOOR.close[1] - DOOR.close[0]));
    police.setDoor(open * (1 - c * c * c));
  }

  function finish() {
    if (!playing) return;
    playing = false;
    placeCar(POLICE_POS.z);
    if (phase === 'brief') inv.closeArrival();
    sample(END);
    police.setDoor(0);
    inv.endIntro();
  }

  function frameChase() {
    const u = smooth(clamp01(t / CHASE));
    placeCar(Z0 + (Z1 - Z0) * u);
    camera.position.set(g.position.x - 3.5, DECK_Y + 18, g.position.z - 16);
    look.set(g.position.x, DECK_Y + 1.4, g.position.z + 12);
    camera.lookAt(look);
  }

  function framePark() {
    const u = 1 - (1 - clamp01(t / PARK)) ** 2;
    placeCar(Z1 + (POLICE_POS.z - Z1) * u);
    camera.position.set(0.4, DECK_Y + 1.7, -5.5);
    look.set(g.position.x, DECK_Y + 1.15, g.position.z + 1.5);
    camera.lookAt(look);
  }

  addEventListener('keydown', (e) => {
    if (!playing) return;
    if (e.code === 'Space' && (controls.isLocked || phase === 'brief')) finish();
    if (phase === 'brief' && e.code === 'Tab' && !e.repeat) {
      inv.closeArrival();
      phase = 'exit';
      t = 1.55;
      sample(t);
    }
  });

  inv.startIntro();
  placeCar(Z0);
  police.setDoor(0);

  return {
    get playing() { return playing; },
    seek(time) { t = time; sample(t); },   // 开发调试：定格下车镜头的某一秒
    update(dt) {
      if (!playing) return;
      // 测试按钮直接跳到别的阶段时，开场作废
      if (inv.debug.mode !== 'explore') { finish(); return; }
      if (phase !== 'brief' && !controls.isLocked) return;
      if (phase === 'brief') return;
      t += dt;
      if (phase === 'chase') {
        frameChase();
        if (t >= CHASE) { phase = 'park'; t = 0; }
      } else if (phase === 'park') {
        framePark();
        if (t >= PARK) {
          placeCar(POLICE_POS.z);
          phase = 'brief';
          sample(0);
          inv.openArrival();
        }
      } else if (t >= END) finish();
      else sample(t);
    },
  };
}
