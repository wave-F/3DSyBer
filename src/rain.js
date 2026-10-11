import * as THREE from 'three/webgpu';
import { DECK_Y } from './bridge.js';

const COUNT = 6000;
const AREA = 40;      // 以玩家为中心的水平范围
const TOP = 25;       // 玩家上方高度
const SPEED = 22;
const LEN = 0.45;
const WIND = new THREE.Vector3(1.5, 0, 0.6);

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

  const dir = new THREE.Vector3(WIND.x, -SPEED, WIND.z).normalize();
  return function update(dt) {
    const cx = camera.position.x, cz = camera.position.z;
    const floor = DECK_Y - 1;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      drops[k] += WIND.x * dt;
      drops[k + 1] -= SPEED * dt;
      drops[k + 2] += WIND.z * dt;
      if (drops[k + 1] + DECK_Y < floor) drops[k + 1] += TOP + 1;
      // 水平方向在玩家周围循环
      const x = cx + wrap(drops[k] - cx, AREA);
      const y = DECK_Y + drops[k + 1];
      const z = cz + wrap(drops[k + 2] - cz, AREA);
      const j = i * 6;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      pos[j + 3] = x - dir.x * LEN; pos[j + 4] = y - dir.y * LEN; pos[j + 5] = z - dir.z * LEN;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

function wrap(v, size) {
  return ((((v + size / 2) % size) + size) % size) - size / 2;
}
