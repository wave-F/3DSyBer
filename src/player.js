import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { DECK_Y, HALF_W } from './bridge.js';
import { carCollider } from './crash.js';
import { policeCollider } from './policeCar.js';
import { CORDON, CORDON_MARGIN } from './cordon.js';
import { sound } from './audio/sound.js';

const EYE = 1.7;
const RADIUS = 0.35;
const WALK = 4;
const RUN = 8;
const TURN_ANGLE = 0.35;    // 原地累计转动约 20° 才触发，避免细小视角抖动反复响
const TURN_INTERVAL = 0.35;

export function createPlayer(camera, domElement, overlay) {
  const controls = new PointerLockControls(camera, domElement);
  // 出生在事故车的另一侧（-Z）。+X 贴护栏，走不过去，所以只翻到车头这一面。
  camera.position.set(-0.5, DECK_Y + EYE, carCollider.z - 10.8);
  camera.lookAt(carCollider.x, DECK_Y + 0.6, carCollider.z);

  overlay.addEventListener('click', () => controls.lock());
  // keepOverlayHidden：打开平板时主动释放鼠标，不弹出暂停层
  controls.keepOverlayHidden = false;
  controls.showPause = () => { controls.keepOverlayHidden = false; overlay.classList.remove('hidden'); };
  controls.addEventListener('lock', () => { controls.keepOverlayHidden = false; overlay.classList.add('hidden'); });
  controls.addEventListener('unlock', () => { if (!controls.keepOverlayHidden) overlay.classList.remove('hidden'); });
  // 重新锁定失败（浏览器限制）时回到暂停层，点击继续
  document.addEventListener('pointerlockerror', () => controls.showPause());

  const keys = {};
  addEventListener('keydown', (e) => { keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  // 设备晃动和脚步共用这一份步相，不再分别按时间 / 步长计数。
  const gait = { phase: 0, speed: 0, amplitude: 0 };
  let moving = 0, turnCooldown = 0;
  const last = camera.position.clone();
  const turnRotation = camera.quaternion.clone();
  function resetFoley() {
    moving = turnCooldown = 0;
    gait.speed = gait.amplitude = 0;
    last.copy(camera.position);
    turnRotation.copy(camera.quaternion);
  }
  controls.addEventListener('unlock', () => {
    for (const code of Object.keys(keys)) keys[code] = false;
    resetFoley();
  });
  controls.addEventListener('lock', resetFoley);

  // 沿用设备的 8 字晃动速度；每次竖直下沉到最低点（π/2 + nπ）落一步。
  // 实际位移只用于判断是否真的在走、平滑晃动速度；停步和原地转身补衣物声。
  function footsteps(dt) {
    const d = Math.hypot(camera.position.x - last.x, camera.position.z - last.z);
    last.copy(camera.position);
    // 开场镜头会把相机一下子放到下车点。超过一帧能走的距离就只对齐，不当成脚步。
    if (d > 1.2) { resetFoley(); return; }
    gait.speed += (Math.min(d / dt, 10) - gait.speed) * Math.min(1, dt * 8);
    const before = Math.floor((gait.phase + Math.PI / 2) / Math.PI);
    gait.phase += dt * (1.6 + gait.speed * 1.55);
    gait.amplitude = Math.min(1, gait.speed / 4) * (gait.speed > 6 ? 1.7 : 1);
    turnCooldown = Math.max(0, turnCooldown - dt);
    if (d > 0.002) {
      moving = 0.15;
      if (Math.floor((gait.phase + Math.PI / 2) / Math.PI) > before) sound.step();
      turnRotation.copy(camera.quaternion);   // 移动中的转身已有逐步衣物声，不额外连续叠加
    } else {
      if (moving > 0 && (moving -= dt) <= 0) sound.cloth();
      // 看净转角而非逐帧角度总和，来回的小抖动不会最终累积成一次转身。
      if (camera.quaternion.angleTo(turnRotation) >= TURN_ANGLE && turnCooldown === 0) {
        sound.cloth();
        turnRotation.copy(camera.quaternion);
        turnCooldown = TURN_INTERVAL;
      }
    }
  }

  function update(dt, moveScale = 1) {
    if (!controls.isLocked || !controls.enabled || dt <= 0 || moveScale <= 0) { resetFoley(); return; }
    const speed = (keys.ShiftLeft || keys.ShiftRight ? RUN : WALK) * dt * moveScale;
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const len = Math.hypot(f, s) || 1;
    controls.moveForward((f / len) * speed);
    controls.moveRight((s / len) * speed);

    const p = camera.position;
    // 限制在桥面护栏以内
    const limit = HALF_W - 0.4 - RADIUS;
    p.x = Math.min(limit, Math.max(-limit, p.x));
    // 前后限制在两道警戒线之间
    p.z = Math.min(CORDON.z1 - CORDON_MARGIN, Math.max(CORDON.z0 + CORDON_MARGIN, p.z));
    p.y = DECK_Y + EYE;
    for (const c of COLLIDERS) pushOutOfBox(p, c);
    footsteps(dt);
  }
  update.controls = controls;
  update.gait = gait;
  return update;
}

const COLLIDERS = [carCollider, policeCollider];

// 将玩家从车体旋转包围盒中推出
function pushOutOfBox(p, c) {
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
