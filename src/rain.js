import * as THREE from 'three/webgpu';
import { DECK_Y, HALF_W, puddleAt } from './bridge.js';

const COUNT = 6000;
const AREA = 40;      // 以玩家为中心的水平范围
const TOP = 25;       // 玩家上方高度
const SPEED = 22;
const LEN = 0.45;
export const WIND = new THREE.Vector3(1.5, 0, 0.6);   // 烟、雾也按这个风向飘

// 落地溅射：只在玩家附近的桥面上生成，雨线落到路面时抽样触发
const SPLASH_MAX = 1200;      // 同时存在的飞溅水珠上限
const SPLASH_RANGE = 11;      // 离相机多远内才溅
const SPLASH_CHANCE = 0.3;    // 落地雨滴中触发溅射的比例
const GRAVITY = 9.8;
const STREAK = 0.04;          // 水珠拖尾 = 速度 × 这个时长

// 雨线：跟随相机的线段，CPU 每帧更新
export function buildRain(scene, camera) {
  const pos = new Float32Array(COUNT * 6);
  const drops = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    drops[i * 3] = (Math.random() - 0.5) * AREA;
    drops[i * 3 + 1] = Math.random() * TOP;
    drops[i * 3 + 2] = (Math.random() - 0.5) * AREA;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb6cc, transparent: true, opacity: 0.15, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);

  const splash = buildSplashes(scene);

  const dir = new THREE.Vector3(WIND.x, -SPEED, WIND.z).normalize();
  return function update(dt) {
    const cx = camera.position.x, cz = camera.position.z;
    const floor = DECK_Y - 1;
    const r2 = SPLASH_RANGE * SPLASH_RANGE;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      const before = drops[k + 1];
      drops[k] += WIND.x * dt;
      drops[k + 1] -= SPEED * dt;
      drops[k + 2] += WIND.z * dt;
      // 水平方向在玩家周围循环
      const x = cx + wrap(drops[k] - cx, AREA);
      const z = cz + wrap(drops[k + 2] - cz, AREA);
      // 穿过路面的这一帧：近处的桥面上溅起水花
      if (before >= 0 && drops[k + 1] < 0 && Math.abs(x) < HALF_W - 0.5) {
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < r2 && Math.random() < SPLASH_CHANCE) splash.spawn(x, z);
      }
      if (drops[k + 1] + DECK_Y < floor) drops[k + 1] += TOP + 1;
      const y = DECK_Y + drops[k + 1];
      const j = i * 6;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      pos[j + 3] = x - dir.x * LEN; pos[j + 4] = y - dir.y * LEN; pos[j + 5] = z - dir.z * LEN;
    }
    geo.attributes.position.needsUpdate = true;
    splash.update(dt);
  };
}

// 飞溅水珠：每次落地向四周弹出几颗，抛物线飞行后消失。画成沿速度方向的短线，和雨线同一种语言
function buildSplashes(scene) {
  const pos = new Float32Array(SPLASH_MAX * 6);
  const p = new Float32Array(SPLASH_MAX * 3);   // 位置
  const v = new Float32Array(SPLASH_MAX * 3);   // 速度
  const life = new Float32Array(SPLASH_MAX);    // 剩余寿命，<= 0 为空闲
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xdce8f4, transparent: true, opacity: 0.75, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);

  function emit(x, z, angle, speed, up, ttl) {
    const i = cursor;
    cursor = (cursor + 1) % SPLASH_MAX;   // 满了就覆盖最老的
    const k = i * 3;
    p[k] = x; p[k + 1] = DECK_Y + 0.02; p[k + 2] = z;
    v[k] = Math.cos(angle) * speed + WIND.x * 0.15;
    v[k + 1] = up;
    v[k + 2] = Math.sin(angle) * speed + WIND.z * 0.15;
    life[i] = ttl;
  }

  return {
    spawn(x, z) {
      const wet = puddleAt(x, z);
      // 每次 1–3 颗；水洼里飞得更高更远
      const n = 1 + (Math.random() * 3 | 0);
      const base = Math.random() * Math.PI * 2;
      for (let c = 0; c < n; c++) {
        const a = base + (c / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const speed = (wet ? 0.25 : 0.18) + Math.random() * 0.2;
        const up = (wet ? 0.5 : 0.4) + Math.random() * (wet ? 0.3 : 0.2);   // 小雨：最高约 1–3 cm
        emit(x, z, a, speed, up, 2 * up / GRAVITY);   // 寿命 = 落回地面的时间
      }
    },
    update(dt) {
      for (let i = 0; i < SPLASH_MAX; i++) {
        const k = i * 3, j = i * 6;
        if (life[i] > 0) {
          life[i] -= dt;
          v[k + 1] -= GRAVITY * dt;
          p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
        }
        if (life[i] <= 0 || p[k + 1] < DECK_Y) {
          life[i] = 0;
          // 空闲槽位缩成一个点藏在桥面下
          pos[j] = pos[j + 3] = 0; pos[j + 1] = pos[j + 4] = DECK_Y - 5; pos[j + 2] = pos[j + 5] = 0;
          continue;
        }
        pos[j] = p[k]; pos[j + 1] = p[k + 1]; pos[j + 2] = p[k + 2];
        pos[j + 3] = p[k] - v[k] * STREAK;
        pos[j + 4] = Math.max(DECK_Y + 0.01, p[k + 1] - v[k + 1] * STREAK);
        pos[j + 5] = p[k + 2] - v[k + 2] * STREAK;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

function wrap(v, size) {
  return ((((v + size / 2) % size) + size) % size) - size / 2;
}
