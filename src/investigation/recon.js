import * as THREE from 'three/webgpu';
import { DECK_Y } from '../bridge.js';
import { CAR_POS, CAR_YAW } from '../crash.js';
import { hologramize } from './hologram.js';
import { createActor } from './actors.js';
import { markKeep } from './mask.js';
import { ROUNDS } from './clues.js';

const BLUE = 0x3fb8ff;
const ORANGE = 0xff8a1a;
const CAR_HOLO = 0.55; // 车辆全息亮度
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
// 黄色车辆：从右侧切入、刮擦后不减速，向北驶出重建范围
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
// 乘员甩出：EJECT_T0 头先探出驾驶员侧车窗，身体被带出；髋部走抛物线，EJECT_T1 时到达护栏缺口外 EDGE，之后继续抛体坠落
// 身体轴线（髋→头）始终对齐速度方向，头在前、腹部朝下
const EJECT_T0 = 2.75, EJECT_T1 = 3.1;
const EDGE = new THREE.Vector3(8.3, DECK_Y + 1.2, 1.3); // 髋部经过点：缺口外上空（护栏缺口 x = 7，z ∈ [-3.5, 2.5]）
const GRAVITY = 9.8;
const TURN_T = 0.12;              // 从坐姿转成头朝前的时间
const SPIN = 1.2;                 // 坠落时绕身体轴的慢转（rad/s）
const FALL_HIDE_Y = DECK_Y - 12;  // 髋部掉到桥面下这么深后隐藏
const B_GONE_T = 4.0;
export function createRecon(scene, crash) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  let ready = false;
  const s = { p: new THREE.Vector3(), yaw: 0 };

  const wrap = (obj) => { const g = new THREE.Group(); g.add(obj); root.add(g); return g; };
  let carA, carAc, carB;

  // 遇难者（蓝）：全息人偶 + 动作，加载完成后才显示
  let victim = null;
  const SEAT_HIP = new THREE.Vector3(-0.3, 0.12, -0.38); // 驾驶座髋部位置（车辆组本地坐标，左舵：驾驶座在 -Z 侧）
  let seatHipLocal = null;
  let flyHipLocal = null;
  const flyBasisInv = new THREE.Matrix4();
  const mW = new THREE.Matrix4();
  const qSeat = new THREE.Quaternion();
  const qFly = new THREE.Quaternion();
  const hip = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const xW = new THREE.Vector3();
  const zW = new THREE.Vector3();
  const offTmp = new THREE.Vector3();
  const qTmp = new THREE.Quaternion();
  const vTmp = new THREE.Vector3();
  const seatWorld = new THREE.Vector3();

  createActor(BLUE, [
    { t0: 0, t1: EJECT_T0, clip: 'Driving_Loop', mode: 'loop' },
    { t0: EJECT_T0, t1: 99, clip: 'Hit_Chest', mode: 'once' },
  ]).then((v) => {
    victim = v;
    root.add(victim.root);
    victim.root.visible = false;
    // 坐姿髋部高度，用来把人偶放进驾驶座
    seatHipLocal = victim.measure('Driving_Loop', 0, 'DEF-hips');
    // 飞行姿势（Hit_Chest 末帧）：髋部位置和"髋→头"轴，用来让头对准飞行方向
    const d = victim.duration('Hit_Chest') - 0.01;
    flyHipLocal = victim.measure('Hit_Chest', d, 'DEF-hips');
    const yL = victim.measure('Hit_Chest', d, 'DEF-head').sub(flyHipLocal).normalize();
    const zL = new THREE.Vector3(0, 0, 1).addScaledVector(yL, -yL.z).normalize(); // 人偶正面 +Z
    flyBasisInv.makeBasis(new THREE.Vector3().crossVectors(yL, zL), yL, zL).transpose();
  });

  // 轨迹线。事件只标在进度条上，场景里不放光柱。
  const lineMat = (hex) => markKeep(Object.assign(new THREE.LineBasicMaterial({ color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { fog: false }));
  const pathLine = (track, t0, t1, hex) => {
    const pts = [];
    for (let t = t0; t <= t1; t += 0.02) { track.sample(t, s); pts.push(new THREE.Vector3(s.p.x, DECK_Y + 0.08, s.p.z)); }
    const m = lineMat(hex);
    m.color.multiplyScalar(3);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
    root.add(line);
    return line;
  };
  pathLine(TRACK_A, 0, 2.75, BLUE);
  const pathB = pathLine(TRACK_B, 0, B_GONE_T, ORANGE);

  let actors = { carB: true };
  function setRound(n) {
    const r = ROUNDS[n];
    actors = r.actors;
    pathB.visible = actors.carB;
  }
  setRound(1);

  crash.onCarReady(({ pristine, crashed }) => {
    // 车辆只显示外壳（去掉内饰、底盘的轮廓线），亮度压低避免过曝
    carA = wrap(hologramize(pristine, BLUE, CAR_HOLO, { shell: true }));
    carAc = wrap(hologramize(crashed, BLUE, CAR_HOLO, { shell: true }));
    carB = wrap(hologramize(pristine, ORANGE, CAR_HOLO, { shell: true }));
    ready = true;
  });

  function placeCar(g, track, t) {
    track.sample(t, s);
    g.position.set(s.p.x, DECK_Y, s.p.z);
    g.rotation.set(0, s.yaw, 0);
  }

  function setTime(t) {
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
    carB.visible = actors.carB && t < B_GONE_T;
    placeCar(carB, TRACK_B, t);

    if (victim) updateVictim(t);
  }

  // 遇难者：撞击前坐在驾驶座（随车移动）；撞击后头先探出驾驶员侧车窗，身体被带出，越过护栏缺口坠落桥下后隐藏
  const eject0 = new THREE.Vector3();
  function updateVictim(t) {
    const car = t < IMPACT_T ? carA : carAc;
    const faceYaw = car.rotation.y + Math.PI / 2; // 人偶面朝 +Z，车头为组内 +X
    car.updateMatrixWorld(true);
    seatWorld.copy(SEAT_HIP).applyMatrix4(car.matrixWorld);
    qSeat.setFromAxisAngle(UP, faceYaw);
    if (t < EJECT_T0) {
      victim.root.visible = true;
      victim.root.quaternion.copy(qSeat);
      vTmp.copy(seatHipLocal).applyQuaternion(qSeat);
      victim.root.position.copy(seatWorld).sub(vTmp);
      victim.pose(t);
      return;
    }
    // 髋部抛体：从座位出发，EJECT_T1 时恰好经过 EDGE（撞击后车已停住，座位位置固定）
    eject0.copy(seatWorld);
    const span = EJECT_T1 - EJECT_T0;
    const tau = t - EJECT_T0;
    v0.subVectors(EDGE, eject0).divideScalar(span);
    v0.y += 0.5 * GRAVITY * span;
    hip.copy(eject0).addScaledVector(v0, tau);
    hip.y -= 0.5 * GRAVITY * tau * tau;
    vel.copy(v0);
    vel.y -= GRAVITY * tau;
    vel.normalize();
    // 头朝速度方向，腹部尽量朝下
    zW.set(0, -1, 0).addScaledVector(vel, vel.y);
    if (zW.lengthSq() < 1e-4) zW.set(v0.x, 0, v0.z);
    zW.normalize();
    xW.crossVectors(vel, zW);
    mW.makeBasis(xW, vel, zW).multiply(flyBasisInv);
    qFly.setFromRotationMatrix(mW);
    qTmp.setFromAxisAngle(vel, tau * SPIN);
    qFly.premultiply(qTmp);
    // 头先转出去：前 TURN_T 秒从坐姿过渡
    const b = THREE.MathUtils.smoothstep(tau, 0, TURN_T);
    victim.root.quaternion.slerpQuaternions(qSeat, qFly, b);
    offTmp.lerpVectors(seatHipLocal, flyHipLocal, b).applyQuaternion(victim.root.quaternion);
    victim.root.position.copy(hip).sub(offTmp);
    victim.root.visible = hip.y > FALL_HIDE_Y;
    victim.pose(t);
  }

  // 可分析的全息物体当前位置（物体中心）。不可见时返回 false
  const CENTER_Y = { carA: 0.6, carB: 0.6 };
  function targetPos(name, out) {
    if (!ready) return false;
    let obj = null;
    if (name === 'carA') obj = carA.visible ? carA : carAc;
    else if (name === 'carB') obj = carB.visible ? carB : null;
    if (!obj) return false;
    out.copy(obj.position);
    out.y = DECK_Y + CENTER_Y[name];
    return true;
  }

  return {
    root,
    setTime,
    setRound,
    targetPos,
    get ready() { return ready; },
  };
}
