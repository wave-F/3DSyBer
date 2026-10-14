import * as THREE from 'three/webgpu';
import { mrt, float } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sound } from '../audio/sound.js';

// 第一人称一体模型：扫描枪、手套和前臂
// 手和设备放在叠加场景（与平板同一个），单独渲染，不会插进场景物体

const NO_MASK = mrt({ mask: float(0) });   // 加法发光物不遮挡背后的世界
const glowMat = (hex, k = 1) => {
  const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  m.color.multiplyScalar(k);
  m.mrtNode = NO_MASK;
  return m;
};

// 相机空间中的几个持握姿态（握把位置 + 朝向）
const POSE = {
  // 待机：比扫描姿态更低，枪口朝下，不像一直端着
  idle: { pos: new THREE.Vector3(0.21, -0.24, -0.42), rot: new THREE.Euler(-0.34, 0.12, -0.08) },
  scan: { pos: new THREE.Vector3(0.12, -0.15, -0.45), rot: new THREE.Euler(0.035, 0.05, -0.03) },
  // 分析沿用扫描的举起，手再往前伸一截
  reach: { pos: new THREE.Vector3(0.12, -0.15, -0.55), rot: new THREE.Euler(0.035, 0.05, -0.03) },
  hidden: { pos: new THREE.Vector3(0.24, -0.55, -0.3), rot: new THREE.Euler(-0.9, 0.2, 0.3) },
};

// 拿取证卡的手：姿态以卡头为原点（相机空间）。插卡时卡头推到卡槽位置
const CARD_POSE = {
  hidden: { pos: new THREE.Vector3(0.3, -0.5, -0.3), rot: new THREE.Euler(-0.9, 0.35, 0.4) },
  ready: { pos: new THREE.Vector3(0.05, -0.06, -0.36), rot: new THREE.Euler(0, 0.25, 0) },
};
const CARD_INSERT_DEPTH = 0.03;   // 卡头越过卡槽口的深度
const CARD_PULLBACK = 0.16;       // 推入前卡头停在卡槽外的距离
const CARD_TINT = 0.5;
const CARD_T = { lower: 0.3, raise: 0.45, push: 0.42, pull: 0.38, drop: 0.35 };

// 撬门：手握撬棍（占位方块，等模型做好替换）
// 原点在撬棍支点（B 柱边、门缝口），局部 -Z 指向门缝里，+Z 指向握柄
const PRY = {
  barLen: 0.66,      // 撬棍全长
  tipLen: 0.06,      // 支点往门缝里伸进去的长度
  grip: 0.56,        // 握手位置（离支点）
  hand: new THREE.Vector3(0.22, -0.3, -0.45),   // 相机空间：手大致的位置，决定撬棍朝向
  arm: new THREE.Vector3(0.35, -0.6, 0.7),      // 相机空间：前臂伸出画面的方向
  k: 1.3,            // 撬棍扳动角度 = (门角度 - 7°) × k
  pop: 15,           // 卡扣崩开时扳过头的角度
  pull: 0.06,        // 插入前尖端停在缝外的距离
  hidden: new THREE.Vector3(0.25, -0.5, 0.3),   // 相机空间：收到画面外的偏移
  T: { raise: 0.35, jab: 0.18, settle: 0.2 },
};

const dbg = { on: false, pos: new THREE.Vector3(0, 0, -0.4), rot: new THREE.Euler(), card: CARD_POSE, pry: PRY };
if (import.meta.env.DEV) window.__vm = dbg;

export function createViewmodel(overlayScene, camera, gait = { phase: 0, amplitude: 0 }) {
  const rig = new THREE.Group();       // 跟随相机
  const holder = new THREE.Group();    // 握把位置，所有动作都作用在这里
  rig.add(holder);
  overlayScene.add(rig);

  // 叠加场景的灯光：冷色主光 + 霓虹色轮廓光，和雨夜环境一致
  overlayScene.add(new THREE.HemisphereLight(0x7890a8, 0x0a0d10, 0.55));
  const key = new THREE.DirectionalLight(0xbfe6ff, 0.7);
  key.position.set(1, 2, 1);
  const rimC = new THREE.DirectionalLight(0x30e0ff, 1.6);
  rimC.position.set(3, 0.5, -1);
  const rimM = new THREE.DirectionalLight(0xff3aa0, 1.0);
  rimM.position.set(-3, 0.3, -1);
  rig.add(key, rimC, rimM);

  const device = buildDevice();
  holder.add(device.group);

  // 拿取证卡的手（另一个模型）：扫描枪放下到画面外后换上，插卡、拔卡后再换回
  const cardHolder = new THREE.Group();
  cardHolder.visible = false;
  rig.add(cardHolder);
  new GLTFLoader().load('/assets/card-arm.glb', (gltf) => {
    const model = gltf.scene;
    // 卡头朝 -Z；模型平移到卡头位于原点（卡头在模型中约为 (0.035, 0.492, 0.496)）
    const S = 0.45;
    model.rotation.y = Math.PI;
    model.scale.setScalar(S);
    model.position.set(0.035, -0.492, 0.496).multiplyScalar(S);
    // 贴图比扫描枪手套亮，压暗到同一档
    model.traverse((o) => { if (o.isMesh) o.material.color.multiplyScalar(CARD_TINT); });
    cardHolder.add(model);
  }, undefined, (error) => console.error('Failed to load card arm:', error));
  // phase：null | lower | raise | push | hold | pull | drop
  const card = { phase: null, t: 0, target: new THREE.Vector3(), cb: null, hide: false };
  const cpA = new THREE.Vector3(), cpB = new THREE.Vector3(), cqA = new THREE.Quaternion(), cqB = new THREE.Quaternion();
  const insertPos = new THREE.Vector3();
  const insertRot = new THREE.Euler();

  // target：卡槽口在相机空间的位置；dir：插入方向（相机空间，指向车身内）；up：相机空间的竖直方向
  // 插到底时回调 onInserted。准备姿态停在卡槽外，沿插入方向推进
  const _lm = new THREE.Matrix4();
  function insertCard(target, dir, up, onInserted) {
    card.target.copy(target);
    insertPos.copy(target).addScaledVector(dir, CARD_INSERT_DEPTH);
    insertRot.setFromRotationMatrix(_lm.lookAt(new THREE.Vector3(), dir, up));
    CARD_POSE.ready.pos.copy(target).addScaledVector(dir, -CARD_PULLBACK);
    CARD_POSE.ready.rot.copy(insertRot);
    card.phase = 'lower'; card.t = 0; card.cb = onInserted;
  }
  // 倒放：拔出、放下到画面外，再换回扫描枪
  function removeCard(onDone) {
    card.phase = 'pull'; card.t = 0; card.cb = onDone;
  }
  function poseCard(a, b, u) {
    const e = THREE.MathUtils.smootherstep(u, 0, 1);
    cpA.lerpVectors(a.pos, b.pos, e);
    cqA.setFromEuler(a.rot).slerp(cqB.setFromEuler(b.rot), e);
    cardHolder.position.copy(cpA);
    cardHolder.quaternion.copy(cqA);
  }
  function updateCard(dt) {
    if (!card.phase) { cardHolder.visible = false; return; }
    card.t += dt;
    const P = card.phase;
    const ins = { pos: insertPos, rot: insertRot };
    const next = (n) => { card.phase = n; card.t = 0; };
    const fire = () => { const f = card.cb; card.cb = null; f?.(); };
    if (P === 'lower') {
      // 扫描枪先收到画面外（st.hide 走满）
      cardHolder.visible = false;
      if (st.hide >= 1 && card.t >= CARD_T.lower) next('raise');
    } else if (P === 'raise') {
      cardHolder.visible = true;
      poseCard(CARD_POSE.hidden, CARD_POSE.ready, card.t / CARD_T.raise);
      if (card.t >= CARD_T.raise) next('push');
    } else if (P === 'push') {
      poseCard(CARD_POSE.ready, ins, card.t / CARD_T.push);
      if (card.t >= CARD_T.push) { next('hold'); fire(); }
    } else if (P === 'hold') {
      poseCard(ins, ins, 1);
    } else if (P === 'pull') {
      poseCard(ins, CARD_POSE.ready, card.t / CARD_T.pull);
      if (card.t >= CARD_T.pull) next('drop');
    } else if (P === 'drop') {
      poseCard(CARD_POSE.ready, CARD_POSE.hidden, card.t / CARD_T.drop);
      if (card.t >= CARD_T.drop) { card.phase = null; cardHolder.visible = false; fire(); }
    }
    // 平板举起时手被挡在后面，直接隐藏，避免前臂压在平板边框上
    if (card.hide) cardHolder.visible = false;
  }

  // ---------- 撬门：手握撬棍 ----------
  // phase：null | raise | jab | settle | drive（由 state 每帧传入撬门时间和门角度）
  const pryHolder = new THREE.Group();
  pryHolder.visible = false;
  rig.add(pryHolder);
  const pryProp = buildPryProp();
  pryHolder.add(pryProp.group);
  const pv = { phase: null, t: 0, F: new THREE.Vector3(), q0: new THREE.Quaternion(), sign: 1, onHit: null, onReady: null, driveT: 0, deg: 7 };
  const pOff = new THREE.Vector3(), pSlide = new THREE.Vector3(), pq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), pe = new THREE.Euler();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  // F：支点在相机空间的位置；out：车门向外张开的方向（相机空间）
  function pryStart(F, out, { onHit, onReady } = {}) {
    pv.F.copy(F);
    const toHand = PRY.hand.clone().sub(F).normalize();
    pv.q0.setFromRotationMatrix(_lm.lookAt(toHand, new THREE.Vector3(), Y_AXIS));   // 局部 +Z 指向手
    const inv = pv.q0.clone().invert();
    // 绕局部 Y 正转时尖端往局部 -X 走：选符号让尖端朝车门外侧顶
    pv.sign = out.clone().applyQuaternion(inv).x < 0 ? 1 : -1;
    pryProp.armPivot.quaternion.setFromUnitVectors(Y_AXIS, PRY.arm.clone().normalize().applyQuaternion(inv));
    pv.phase = 'raise'; pv.t = 0; pv.onHit = onHit; pv.onReady = onReady;
  }
  function pryDrive(t, deg) { pv.driveT = t; pv.deg = deg; }
  function pryEnd() { pv.phase = null; pryHolder.visible = false; }

  function updatePryVm(dt) {
    if (!pv.phase) { pryHolder.visible = false; return; }
    pv.t += dt;
    pryHolder.visible = true;
    const { T } = PRY;
    const ss = THREE.MathUtils.smootherstep;
    pOff.set(0, 0, 0);
    let slide = 0, lever = 0, pitch = 0, roll = 0;
    if (pv.phase === 'raise') {
      // 从画面右下抬上来，尖端停在缝外
      const u = ss(pv.t / T.raise, 0, 1);
      pOff.copy(PRY.hidden).multiplyScalar(1 - u);
      pitch = -0.6 * (1 - u);
      slide = PRY.pull;
      if (pv.t >= T.raise) { pv.phase = 'jab'; pv.t = 0; }
    } else if (pv.phase === 'jab') {
      // 往缝里一捅（加速插入）
      const u = Math.min(1, pv.t / T.jab);
      slide = PRY.pull * (1 - u * u);
      if (pv.t >= T.jab) { pv.phase = 'settle'; pv.t = 0; pv.onHit?.(); }
    } else if (pv.phase === 'settle') {
      // 顶到底弹一下，再攥紧
      const u = Math.min(1, pv.t / T.settle);
      slide = 0.008 * Math.sin(u * Math.PI);
      pOff.y = -0.004 * Math.sin(u * Math.PI);
      if (pv.t >= T.settle) { pv.phase = 'drive'; pv.t = 0; pv.driveT = 0; pv.deg = 7; const f = pv.onReady; pv.onReady = null; f?.(); }
    } else {
      const t = pv.driveT;
      const POP = 1.38;
      if (t < POP) {
        // 撬棍角度跟门角度走；越到后面越僵持，手抖越大
        lever = PRY.k * (pv.deg - 7);
        const tension = THREE.MathUtils.clamp((pv.deg - 7) / 7, 0, 1);
        const a = t < 0.8 ? 0.0012 : 0.0025 + 0.002 * (t - 0.8) / (POP - 0.8);
        pOff.x += a * Math.sin(t * 113);
        pOff.y += a * Math.sin(t * 97 + 1.3) - 0.01 * tension;
        roll = -0.04 * tension;
      } else {
        // 卡扣崩开：扳过头、尖端滑出门缝、手被惯性带回右下，再放下到画面外
        const p = t - POP;
        lever = PRY.k * 6 + PRY.pop * (1 - Math.pow(1 - Math.min(1, p / 0.08), 3));
        slide = 0.07 * ss(p / 0.15, 0, 1);
        const r = ss(p / 0.22, 0, 1);
        pOff.set(0.06, -0.05, 0.08).multiplyScalar(r);
        roll = -0.04 + 0.15 * r;
        const d = ss((t - 1.6) / 0.5, 0, 1);
        pOff.lerp(PRY.hidden, d);
        pitch = -0.6 * d;
        if (t >= 2.1) pryHolder.visible = false;
      }
    }
    pq.copy(pv.q0).multiply(_pq.setFromEuler(pe.set(pitch, pv.sign * lever * Math.PI / 180, roll)));
    pSlide.set(0, 0, slide).applyQuaternion(pq);
    pryHolder.position.copy(pv.F).add(pOff).add(pSlide);
    pryHolder.quaternion.copy(pq);
  }

  const st = {
    hide: 1,                 // 0 显示，1 收起
    scanT: -1,               // 扫描动作计时，-1 表示未在扫描
    aim: 0,                  // 指向线索的权重，松开后沿同一条曲线收回
    aimDir: new THREE.Vector3(0, 0, -1),
    target: null, progress: 0,
    sway: { y: 0, p: 0, vy: 0, vp: 0 }, lastYaw: 0, lastPitch: 0,
    onFire: null,
    shown: false, aiming: false,
  };
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
  const vB = new THREE.Vector3();
  const eA = new THREE.Euler();

  // 开始扫描动作：0.5 秒举起，发射，保持，再用同样的 0.5 秒放下
  function scan(onFire) {
    if (st.scanT >= 0) return false;
    st.scanT = 0;
    st.onFire = onFire;
    if (st.shown) sound.cloth();
    return true;
  }

  // 正在分析的目标（null 表示不在分析）与进度
  function analyze(target, progress) {
    if (target && target !== st.target) device.flash = Math.max(device.flash, 0.25);
    if (target && progress >= 1 && st.progress < 1) device.flash = 0.8;
    st.target = target;
    st.progress = progress;
  }

  function emitterWorld(out) {
    holder.updateMatrixWorld(true);
    return device.emitter.getWorldPosition(out);
  }

  function update(dt, visible) {
    // 插卡期间扫描枪收在画面外。衣物声只在拿出、收起、举枪、放下时响一次。
    visible = visible && !card.phase;
    const aiming = !!st.target;
    if (dt > 0 && (visible !== st.shown || (visible && aiming !== st.aiming))) sound.cloth();
    st.shown = visible;
    st.aiming = aiming;
    // 收起/显示
    st.hide = THREE.MathUtils.clamp(st.hide + (visible ? -dt * 3 : dt * 5), 0, 1);
    holder.visible = st.hide < 1;
    rig.visible = holder.visible || !!card.phase || !!pv.phase;
    camera.updateMatrixWorld();
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);

    // 与 player.js 的落脚触发读取同一份步相，走 / 跑切换和减速不会错拍。
    const { phase: bob, amplitude: amp } = gait;

    // 视角转动的滞后（弹簧）
    eA.setFromQuaternion(camera.quaternion, 'YXZ');
    let dy = eA.y - st.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const dp = eA.x - st.lastPitch;
    st.lastYaw = eA.y; st.lastPitch = eA.x;
    const sw = st.sway;
    sw.vy += (-dy * 1.5 - sw.y) * 70 * dt - sw.vy * 11 * dt;
    sw.vp += (-dp * 1.5 - sw.p) * 70 * dt - sw.vp * 11 * dt;
    sw.y = THREE.MathUtils.clamp(sw.y + sw.vy * dt, -0.1, 0.1);
    sw.p = THREE.MathUtils.clamp(sw.p + sw.vp * dt, -0.1, 0.1);

    // 举起和放下同一条 0.5 秒曲线。发射后先保持，扫描过了再放下，不在发射当帧落回待机
    const RAISE = 0.5;
    const HOLD = 1.4;
    const LOWER = 0.5;
    let scanW = 0;
    if (st.scanT >= 0) {
      const before = st.scanT;
      st.scanT += dt;
      const t = st.scanT;
      const downT = RAISE + HOLD;
      if (before < downT && t >= downT && visible && !aiming && st.aim <= 0.001) sound.cloth();
      scanW = t < RAISE
        ? THREE.MathUtils.smootherstep(t / RAISE, 0, 1)
        : t < downT
          ? 1
          : 1 - THREE.MathUtils.smootherstep((t - downT) / LOWER, 0, 1);
      if (t >= RAISE && st.onFire) { const f = st.onFire; st.onFire = null; f(emitterWorld(new THREE.Vector3())); device.flash = 1; }
      if (t >= downT + LOWER) st.scanT = -1;
    }

    // 姿态混合：待机 → 扫描 → 收起
    vB.lerpVectors(POSE.idle.pos, POSE.scan.pos, scanW);
    qA.setFromEuler(POSE.idle.rot).slerp(qB.setFromEuler(POSE.scan.rot), scanW);
    const h = THREE.MathUtils.smoothstep(st.hide, 0, 1);
    vB.lerp(POSE.hidden.pos, h);
    qA.slerp(qB.setFromEuler(POSE.hidden.rot), h);

    // 分析时举起并转向线索。结束后目标会被清掉，沿最后的方向用 0.5 秒放下，避免弹 UI 时闪回待机
    const AIM_TIME = 0.5;
    st.aim = THREE.MathUtils.clamp(st.aim + (st.target ? dt : -dt) / AIM_TIME, 0, 1);
    const aimW = THREE.MathUtils.smootherstep(st.aim, 0, 1);
    if (st.target) {
      st.aimDir.copy(st.target).applyMatrix4(camera.matrixWorldInverse).sub(vB);
      if (st.aimDir.lengthSq() > 1e-6) st.aimDir.normalize();
    }
    if (aimW > 0.001) {
      vB.lerp(POSE.reach.pos, aimW);
      qA.slerp(qB.setFromEuler(POSE.reach.rot), aimW);
      const yaw = THREE.MathUtils.clamp(Math.atan2(-st.aimDir.x, -st.aimDir.z), -0.9, 0.6);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(st.aimDir.y, -1, 1)), -0.6, 0.4);
      qC.setFromEuler(eA.set(pitch, yaw, 0, 'YXZ'));
      qA.slerp(qC, aimW * 0.55);
    }

    // 走路晃动（8 字形）+ 呼吸 + 视角滞后
    const breathe = Math.sin(performance.now() / 1000 * 1.5) * 0.002;
    vB.x += Math.cos(bob) * 0.012 * amp + sw.y * 0.2;
    vB.y += -Math.abs(Math.sin(bob)) * 0.014 * amp + breathe + sw.p * 0.2;
    holder.position.copy(vB);
    qB.setFromEuler(eA.set(sw.p * 0.7 + Math.sin(bob * 2) * 0.01 * amp, sw.y * 0.7, Math.cos(bob) * 0.02 * amp));
    holder.quaternion.copy(qA).multiply(qB);
    if (dbg.on) { holder.position.copy(dbg.pos); holder.quaternion.setFromEuler(dbg.rot); }

    device.flash = Math.max(0, device.flash - dt * 4);
    device.update(dt, visible && !!st.target, st.progress);
    updateCard(dt);
    updatePryVm(dt);
  }

  return {
    update, scan, analyze, emitterWorld, insertCard, removeCard,
    pryStart, pryDrive, pryEnd,
    setCardHidden(on) { card.hide = on; },
    get scanning() { return st.scanT >= 0; },
    get cardPhase() { return card.phase; },
  };
}

// ---------- 撬棍 + 手（占位方块） ----------
// 原点在支点，撬棍沿 +Z 指向握柄；armPivot 在握手处，前臂沿其局部 +Y 伸出
// 正式模型做好后：替换 group 里的内容，保持同样的原点和朝向即可
function buildPryProp() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.7, roughness: 0.45 });
  const tape = new THREE.MeshStandardMaterial({ color: 0xc9a416, roughness: 0.7 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.85 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, PRY.barLen), steel);
  bar.position.z = PRY.barLen / 2 - PRY.tipLen;
  // 弯头爪：在缝里的那一截往下勾
  const claw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.05), steel);
  claw.position.set(0, -0.01, -PRY.tipLen);
  claw.rotation.x = 0.5;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.16), tape);
  grip.position.z = PRY.grip;
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.1), glove);
  fist.position.set(0, 0.012, PRY.grip);
  const armPivot = new THREE.Group();
  armPivot.position.z = PRY.grip;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.042, 0.36, 12), sleeve);
  arm.position.y = 0.21;
  armPivot.add(arm);
  g.add(bar, claw, grip, fist, armPivot);
  return { group: g, armPivot };
}

// ---------- 设备模型 ----------
// 握把原点在手掌中心；设备前方为 -Z，上方为 +Y
function buildDevice() {
  const g = new THREE.Group();
  const emitter = new THREE.Object3D();
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.014, 32), glowMat(0x9edeea, 0.8));
  glow.rotation.y = Math.PI;
  glow.material.opacity = 0;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0016, 6, 48), glowMat(0x9edeea, 1.2));
  ring.position.z = -0.003;
  ring.material.opacity = 0;
  const spill = new THREE.PointLight(0x9edeea, 0, 0.18, 2);
  spill.position.z = 0.025;
  emitter.add(glow, ring, spill);
  g.add(emitter);
  let ready = false;
  new GLTFLoader().load('/assets/scanner-arm.glb?v=3', (gltf) => {
    const model = gltf.scene;
    // Align this asset's diagonal barrel with -Z, pivoting about its grip.
    model.rotation.set(-0.19, -2.61, 0);
    model.scale.setScalar(0.45);
    model.position.set(0, 0.32, 0.27).multiplyScalar(-0.45).applyQuaternion(model.quaternion);
    g.add(model);
    emitter.position.set(-0.10, 0.59, 0.47).multiplyScalar(0.45).applyQuaternion(model.quaternion).add(model.position);
    ready = true;
  }, undefined, (error) => console.error('Failed to load scanner arm:', error));
  const dev = {
    group: g, emitter, flash: 0, power: 0,
    update(dt, analyzing, progress) {
      const target = analyzing ? (progress >= 1 ? 0.28 : 0.7) : 0;
      dev.power = THREE.MathUtils.damp(dev.power, target, analyzing ? 12 : 22, dt);
      const power = ready ? Math.min(1, dev.power + dev.flash) : 0;
      ring.material.opacity = ready ? 0.07 + power * 0.75 : 0;
      glow.material.opacity = power * 0.24;
      spill.intensity = power * 0.004;
    },
  };
  return dev;
}
