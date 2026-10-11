import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { DECK_Y, HALF_W, HALF_L } from './bridge.js';
import { carCollider } from './crash.js';

const EYE = 1.7;
const RADIUS = 0.35;
const WALK = 4;
const RUN = 8;

export function createPlayer(camera, domElement, overlay) {
  const controls = new PointerLockControls(camera, domElement);
  camera.position.set(-0.5, DECK_Y + EYE, 11);
  camera.lookAt(4, DECK_Y + 0.6, 1);

  overlay.addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => overlay.classList.add('hidden'));
  controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

  const keys = {};
  addEventListener('keydown', (e) => { keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  return function update(dt) {
    if (!controls.isLocked) return;
    const speed = (keys.ShiftLeft || keys.ShiftRight ? RUN : WALK) * dt;
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const len = Math.hypot(f, s) || 1;
    controls.moveForward((f / len) * speed);
    controls.moveRight((s / len) * speed);

    const p = camera.position;
    // 限制在桥面护栏以内
    const limit = HALF_W - 0.4 - RADIUS;
    p.x = Math.min(limit, Math.max(-limit, p.x));
    p.z = Math.min(HALF_L - 1, Math.max(-HALF_L + 1, p.z));
    p.y = DECK_Y + EYE;
    pushOutOfCar(p);
  };
}

// 将玩家从车体旋转包围盒中推出
function pushOutOfCar(p) {
  const c = carCollider;
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  const wx = p.x - c.x, wz = p.z - c.z;
  let lx = cos * wx - sin * wz;
  let lz = sin * wx + cos * wz;
  const minX = c.minX - RADIUS, maxX = c.maxX + RADIUS;
  const minZ = c.minZ - RADIUS, maxZ = c.maxZ + RADIUS;
  if (lx < minX || lx > maxX || lz < minZ || lz > maxZ) return;

  const pens = [lx - minX, maxX - lx, lz - minZ, maxZ - lz];
  const i = pens.indexOf(Math.min(...pens));
  if (i === 0) lx = minX;
  else if (i === 1) lx = maxX;
  else if (i === 2) lz = minZ;
  else lz = maxZ;

  p.x = c.x + cos * lx + sin * lz;
  p.z = c.z - sin * lx + cos * lz;
}
