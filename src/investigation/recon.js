import * as THREE from 'three/webgpu';
import { DECK_Y } from '../bridge.js';
import { CAR_POS, CAR_YAW, SHEET_POS, SHEET_YAW } from '../crash.js';
import { hologramize, hologramMaterial } from './hologram.js';
import { createActor } from './actors.js';
import { markKeep } from './mask.js';
import { EVENTS } from './clues.js';

const BLUE = 0x3fb8ff;
const ORANGE = 0xff8a1a;
const UP = new THREE.Vector3(0, 1, 0);

// 关键帧轨迹：位置用 Catmull-Rom 平滑插值，朝向线性插值
// 车辆组的朝向约定与现场车辆一致：yaw = -π/2 时车头朝 +Z
class Track {
  constructor(keys) {
    this.keys = keys;
    this.curve = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(k.x, 0, k.z)), false, 'centripetal');
  }
  sample(t, out) {
    const k = this.keys;
    if (t <= k[0].t) { out.p.set(k[0].x, 0, k[0].z); out.yaw = k[0].yaw ?? 0; return out; }
    const last = k.length - 1;
    if (t >= k[last].t) { out.p.set(k[last].x, 0, k[last].z); out.yaw = k[last].yaw ?? 0; return out; }
    let i = 0;
    while (t > k[i + 1].t) i++;
    const u = (t - k[i].t) / (k[i + 1].t - k[i].t);
    this.curve.getPoint((i + u) / last, out.p);
    out.yaw = (k[i].yaw ?? 0) + ((k[i + 1].yaw ?? 0) - (k[i].yaw ?? 0)) * u;
    return out;
  }
}

const STRAIGHT = -Math.PI / 2;
// 死者车辆：被切入 → 制动 → 侧面碰撞 → 打滑 → 撞断护栏
const TRACK_A = new Track([
  { t: 0, x: -1.6, z: -62, yaw: STRAIGHT },
  { t: 1.0, x: -1.6, z: -31, yaw: STRAIGHT },
  { t: 1.4, x: -1.35, z: -21, yaw: -1.52 },
  { t: 1.9, x: 0.3, z: -11, yaw: -1.22 },
  { t: 2.3, x: 2.8, z: -4.5, yaw: -0.95 },
  { t: 2.6, x: 5.3, z: -0.4, yaw: -0.78 },
  { t: 2.75, x: CAR_POS.x, z: CAR_POS.z, yaw: CAR_YAW },
]);
// 黄色车辆：从右侧切入、刮擦后回正离开
const TRACK_B = new Track([
  { t: 0, x: -4.9, z: -66, yaw: STRAIGHT },
  { t: 1.1, x: -4.9, z: -30, yaw: -1.5 },
  { t: 1.4, x: -3.5, z: -21, yaw: -1.4 },
  { t: 1.7, x: -3.4, z: -15, yaw: -1.62 },
  { t: 2.2, x: -4.3, z: -6, yaw: -1.68 },
  { t: 3.0, x: -4.4, z: 12, yaw: STRAIGHT },
  { t: 4.0, x: -4.4, z: 40, yaw: STRAIGHT },
]);
const IMPACT_T = 2.6;
const EJECT_T0 = 2.75, EJECT_T1 = 3.3;
const B_GONE_T = 4.0;
// 返回现场的人员（时间跳跃后，约 1 分钟）
const WALKER = new Track([
  { t: 4.2, x: -3.4, z: 18 },
  { t: 6.3, x: 4.2, z: 1.8 },
  { t: 7.2, x: 4.2, z: 1.8 },
  { t: 7.5, x: 2.9, z: 4.8 },
  { t: 8.0, x: 2.9, z: 4.8 },
  { t: 8.2, x: 2.4, z: 5.9 },
  { t: 10, x: -2.2, z: 18 },
]);
const WALKER_T0 = 4.2;
const HAZARD_T = 7.0;

export function createRecon(scene, crash) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  let ready = false;
  const s = { p: new THREE.Vector3(), yaw: 0 };

  const wrap = (obj) => { const g = new THREE.Group(); g.add(obj); root.add(g); return g; };
  let carA, carAc, carB;

  // 遇难者（蓝）与返回现场的人（橙）：全息人偶 + 动作，加载完成后才显示
  let victim = null, walker = null;
  const head = new THREE.Vector3(Math.cos(SHEET_YAW), 0, -Math.sin(SHEET_YAW)); // 盖布上头部朝向
  const lie = { yaw: 0, pos: new THREE.Vector3() };
  const ejectFrom = new THREE.Vector3(5.1, DECK_Y + 0.9, 0.7); // 事件标注位置
  const SEAT_HIP = new THREE.Vector3(-0.3, 0.12, -0.38); // 驾驶座髋部位置（车辆组本地坐标，左舵：驾驶座在 -Z 侧）
  let seatHipLocal = null;
  const qTmp = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  const vTmp = new THREE.Vector3();
  const seatWorld = new THREE.Vector3();

  Promise.all([
    createActor(BLUE, [
      { t0: 0, t1: EJECT_T0, clip: 'Driving_Loop', mode: 'loop' },
      { t0: EJECT_T0, t1: EJECT_T0 + 0.2, clip: 'Hit_Chest', mode: 'once' },
      { t0: EJECT_T0 + 0.2, t1: EJECT_T1, clip: 'Roll', mode: 'loop', rate: 1.4 },
      { t0: EJECT_T1, t1: 99, clip: 'Death01', mode: 'once', offset: 1.5, rate: 1.2 },
    ]),
    createActor(ORANGE, [
      { t0: WALKER_T0, t1: 6.3, clip: 'Jog_Fwd_Loop', mode: 'loop', rate: 1.3 },
      { t0: 6.3, t1: 7.2, clip: 'Interact', mode: 'once', rate: 2.2 },
      { t0: 7.2, t1: 7.5, clip: 'Walk_Loop', mode: 'loop', rate: 1.6 },
      { t0: 7.5, t1: 8.0, clip: 'Crouch_Idle_Loop', mode: 'loop' },
      { t0: 8.0, t1: 99, clip: 'Walk_Loop', mode: 'loop', rate: 1.4 },
    ]),
  ]).then(([v, w]) => {
    victim = v; walker = w;
    root.add(victim.root, walker.root);
    victim.root.visible = walker.root.visible = false;
    // 校准：倒地动作最后一帧，让"髋→头"方向对齐盖布的头部方向，躯干中心落在盖布上
    const d = victim.duration('Death01') - 0.01;
    const hip = victim.measure('Death01', d, 'DEF-hips');
    const hd = victim.measure('Death01', d, 'DEF-head');
    const axis = hd.clone().sub(hip).setY(0);
    lie.yaw = Math.atan2(head.x, head.z) - Math.atan2(axis.x, axis.z);
    const center = hip.clone().add(hd).multiplyScalar(0.5).setY(0).applyAxisAngle(UP, lie.yaw);
    lie.pos.copy(SHEET_POS).addScaledVector(head, 0.3).sub(center).setY(DECK_Y + 0.02);
    // 坐姿髋部高度，用来把人偶放进驾驶座
    seatHipLocal = victim.measure('Driving_Loop', 0, 'DEF-hips');
  });

  // 轨迹线 + 事件光柱
  const lineMat = (hex) => markKeep(Object.assign(new THREE.LineBasicMaterial({ color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { fog: false }));
  const pathLine = (track, t0, t1, hex) => {
    const pts = [];
    for (let t = t0; t <= t1; t += 0.02) { track.sample(t, s); pts.push(new THREE.Vector3(s.p.x, DECK_Y + 0.08, s.p.z)); }
    const m = lineMat(hex);
    m.color.multiplyScalar(3);
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
  };
  pathLine(TRACK_A, 0, 2.75, BLUE);
  pathLine(TRACK_B, 0, B_GONE_T, ORANGE);

  // 事件位置（供界面标注）
  const eventPos = EVENTS.map((ev) => {
    if (ev.t >= WALKER_T0) { WALKER.sample(ev.t, s); return new THREE.Vector3(s.p.x, DECK_Y + 2.2, s.p.z); }
    if (ev.t >= EJECT_T0) return ejectFrom.clone().setY(DECK_Y + 2.2);
    TRACK_A.sample(ev.t, s);
    return new THREE.Vector3(s.p.x, DECK_Y + 2.2, s.p.z);
  });
  const pillarGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6);
  pillarGeo.translate(0, -1.1, 0);
  for (const p of eventPos) {
    const pillar = new THREE.Mesh(pillarGeo, hologramMaterial(0xffffff, 1.5));
    pillar.position.copy(p);
    root.add(pillar);
  }

  // 双闪（返回人员打开后闪烁）
  const hazardMat = hologramMaterial(0xffaa30, 3);
  const hazards = [];

  crash.onCarReady(({ pristine, crashed }) => {
    carA = wrap(hologramize(pristine, BLUE));
    carAc = wrap(hologramize(crashed, BLUE));
    carB = wrap(hologramize(pristine, ORANGE));
    for (const z of [-0.95, 0.95]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.25), hazardMat);
      h.position.set(-2.05, 0.65, z);
      carAc.add(h);
      hazards.push(h);
    }
    ready = true;
  });

  function placeCar(g, track, t) {
    track.sample(t, s);
    g.position.set(s.p.x, DECK_Y, s.p.z);
    g.rotation.set(0, s.yaw, 0);
  }

  function setTime(t, blink) {
    if (!ready) return;
    // 死者车辆：撞击前用完好模型，撞击后换成变形模型；撞击瞬间有一次抖动
    carA.visible = t < IMPACT_T;
    carAc.visible = t >= IMPACT_T;
    placeCar(carA, TRACK_A, t);
    placeCar(carAc, TRACK_A, t);
    if (t >= IMPACT_T && t < IMPACT_T + 0.25) {
      const k = 1 - (t - IMPACT_T) / 0.25;
      carAc.rotation.x = Math.sin(t * 90) * 0.05 * k;
      carAc.rotation.z = Math.sin(t * 70) * 0.04 * k;
    }
    carB.visible = t < B_GONE_T;
    placeCar(carB, TRACK_B, t);
    hazards.forEach((h) => { h.visible = t >= HAZARD_T && blink; });

    if (victim) updateVictim(t);
    if (walker) updateWalker(t);
  }

  // 遇难者：撞击前坐在驾驶座（随车移动），之后沿抛物线甩出并翻滚，落地后与盖布重合
  function updateVictim(t) {
    victim.root.visible = true;
    const car = t < IMPACT_T ? carA : carAc;
    const carYaw = car.rotation.y;
    if (t < EJECT_T0) {
      car.updateMatrixWorld(true);
      seatWorld.copy(SEAT_HIP).applyMatrix4(car.matrixWorld);
      victim.root.rotation.set(0, carYaw + Math.PI / 2, 0); // 人偶面朝 +Z，车头为组内 +X
      vTmp.set(seatHipLocal.x, seatHipLocal.y, seatHipLocal.z).applyAxisAngle(UP, carYaw + Math.PI / 2);
      victim.root.position.copy(seatWorld).sub(vTmp);
    } else {
      const u = Math.min(1, (t - EJECT_T0) / (EJECT_T1 - EJECT_T0));
      car.updateMatrixWorld(true);
      seatWorld.copy(SEAT_HIP).applyMatrix4(car.matrixWorld);
      seatWorld.y = DECK_Y;
      victim.root.position.lerpVectors(seatWorld, lie.pos, u);
      victim.root.position.y += Math.sin(u * Math.PI) * 1.3;
      // 空中翻滚，接近落地时转正到倒地朝向
      qYaw.setFromAxisAngle(UP, THREE.MathUtils.lerp(carYaw + Math.PI / 2, lie.yaw, u));
      eTmp.set(u * Math.PI * 2.2, 0, u * 1.2);
      qTmp.setFromEuler(eTmp).slerp(new THREE.Quaternion(), THREE.MathUtils.smoothstep(u, 0.55, 1));
      victim.root.quaternion.copy(qYaw).multiply(qTmp);
    }
    victim.pose(t);
  }

  // 返回人员：位置沿轨迹，移动时面向前进方向，停下时面向车辆/遇难者
  function updateWalker(t) {
    walker.root.visible = t >= WALKER_T0;
    if (!walker.root.visible) return;
    WALKER.sample(t, s);
    const prev = WALKER.sample(Math.max(WALKER_T0, t - 0.05), { p: new THREE.Vector3(), yaw: 0 }).p;
    const v = s.p.clone().sub(prev);
    walker.root.position.set(s.p.x, DECK_Y, s.p.z);
    if (v.length() > 0.02) walker.root.rotation.y = Math.atan2(v.x, v.z);
    else walker.root.rotation.y = t < 7.3 ? Math.atan2(CAR_POS.x - s.p.x, CAR_POS.z - s.p.z) : Math.atan2(SHEET_POS.x - s.p.x, SHEET_POS.z - s.p.z);
    walker.pose(t);
  }

  return {
    root,
    setTime,
    eventPos,
    get ready() { return ready; },
  };
}
