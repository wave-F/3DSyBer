import * as THREE from 'three/webgpu';
import { uv, vec3, smoothstep, texture, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DECK_Y } from '../bridge.js';
import { sound } from '../audio/sound.js';
import { tx, onLang } from '../i18n.js';

// 地上的电子杂志（世界观补充，参考《底特律：变人》的杂志平板）
// 平时躺在事故车旁的玻璃渣里，屏幕待机调暗，隔一会儿亮一下推送；按 E 拾起 → 飞到镜头前阅读（不能走动、视角固定）→ A / D 翻页 → E 放回原位
// 在地上时属于主场景（受灯光、雾、屏幕反射影响）；拿起期间挪进平板的 uiScene（不会插进别的物体，背景虚化）

const W = 0.2, H = 0.2667;            // 屏幕尺寸（米），3:4 竖版
const BEZEL = 0.009;                  // 屏幕外黑边
const DEPTH = 0.007;                  // 机身厚度
const CW = 960, CH = 1280;            // 页面画布分辨率
const UP_T = 1.3, DOWN_T = 1.05;      // 拾起 / 放下动画时长（秒）
// 拾起手感（不显示手，只靠镜头 + 杂志路线）：镜头下蹲低头 → 杂志贴地往脚边滑一下 → 翻起 → 带着重量到面前
const CROUCH = 0.3;                   // 下蹲多少米
const LEAN = 0.08;                    // 下蹲时身体往杂志方向探
const SLIDE = 0.12;                   // 拾起前先贴地往脚边拖一下的距离
const PICK_RANGE = 3;                 // 准星多远内可以拾起（眼睛到杂志）
// 地上：平时自动调暗待机；隔一会儿像收到推送一样亮起一两秒再暗下去（不超过辉光阈值，不泛光）
const GLOW_DIM = 0.2;
const GLOW_PING = 0.9;
const PING_T = 2.2;                   // 一次推送亮多久（含淡入淡出）
const PING_GAP = [9, 16];             // 两次推送间隔（秒）
const GLOW_HAND = 1.0;                // 手里：白字不泛光，保证能读
// 摆放：事故车左侧（朝护栏那一侧）车门后方的玻璃渣里，像是撞击时从碎掉的车窗滑出来的；屏幕朝上，落地时转了个随意的角度
// 车在 CAR_POS (5.5, 0.2)，偏航 -0.75；这里约为车本地 (x -1.2, z -1.5)，在车身外约 0.35 m；
// 离脱落的左前轮（车本地 -1.9, -1.9）约 0.8 m，离"断裂护栏"线索约 1.4 m，玩家站在车尾左后方就能拾起
const GROUND_POS = new THREE.Vector3(5.64, DECK_Y + 0.0135 + DEPTH / 2, -1.72);   // 路面比 DECK_Y 高约 1 厘米
const GROUND_YAW = -0.9;
const HELD = { pos: new THREE.Vector3(0, -0.004, -0.32), pitch: -0.07 };

const SANS = '"PingFang SC", "Helvetica Neue", sans-serif';
const SERIF = '"Songti SC", "Times New Roman", serif';
const MONO = '"SF Mono", Menlo, monospace';
const C = { ink: '#f4f1ea', dim: 'rgba(244,241,234,0.62)', faint: 'rgba(244,241,234,0.14)', gold: '#ffc861', red: '#ff3b5c', cyan: '#6fe3ff', paper: '#0c0f16' };
const PAGES = 4;

const smooth = (x) => x * x * (3 - 2 * x);
const fract = (x) => x - Math.floor(x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ramp = (u, a, b) => smooth(clamp01((u - a) / (b - a)));

export function createMagazine({ scene, uiScene, camera }) {
  // ---------- 机身 + 屏幕 ----------
  const pad = new THREE.Group();
  pad.name = '电子杂志';
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x15171c, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(W + BEZEL * 2, H + BEZEL * 2.6, DEPTH, 3, 0.0035), bodyMat);
  body.position.y = -BEZEL * 0.3;   // 下边框略宽，放刻字
  pad.add(body);

  // 下边框刻字
  const lc = document.createElement('canvas');
  lc.width = 512; lc.height = 32;
  const lg = lc.getContext('2d');
  lg.font = `500 20px ${MONO}`;
  lg.fillStyle = 'rgba(170,180,195,0.6)';
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  lg.fillText('METRO PULSE  ·  e-ZINE  M7', 256, 17);
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.0044), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false }));
  label.position.set(0, -H / 2 - BEZEL * 0.85, DEPTH / 2 + 0.0002);
  pad.add(label);

  const cvs = document.createElement('canvas');
  cvs.width = CW; cvs.height = CH;
  const g = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // 屏幕：页面 × 亮度 + 一道固定的玻璃反光
  const glow = uniform(GLOW_DIM);
  const flicker = uniform(1);
  const suv = uv();
  const diag = suv.x.mul(0.7).add(suv.y);
  const sheen = smoothstep(0.7, 0.8, diag).mul(smoothstep(0.98, 0.86, diag)).mul(0.012);
  const screenMat = new THREE.MeshBasicNodeMaterial();
  screenMat.colorNode = texture(tex, suv).rgb.mul(glow).mul(flicker).add(vec3(sheen));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  screen.position.z = DEPTH / 2 + 0.0003;
  pad.add(screen);

  // 地上的朝向：先放平（屏幕朝上），再绕竖轴转 yaw，再带一点点不平的歪斜
  // 开局用 GROUND_YAW；放回时不转回原角度，按放下那一刻的朝向平放（见 putDown）
  const groundQuat = new THREE.Quaternion();
  function setGroundYaw(yaw) {
    groundQuat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    groundQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    groundQuat.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02, 0, 0.015)));
  }
  setGroundYaw(GROUND_YAW);
  function placeOnGround() {
    if (pad.parent !== scene) scene.attach(pad);
    pad.position.copy(GROUND_POS);
    pad.quaternion.copy(groundQuat);
  }
  placeOnGround();

  // ---------- 状态 ----------
  // phase：ground（地上）| up（拾起中）| held（阅读）| down（放回中）
  const st = { phase: 'ground', t: 0, page: 0, from: 0, flip: 1, dir: 1, redraw: 0, drawT: 0 };
  const fromPos = new THREE.Vector3(), fromQuat = new THREE.Quaternion();
  const heldPos = new THREE.Vector3(), heldQuat = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const _e2 = new THREE.Euler(), _m = new THREE.Matrix4(), _ax = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let time = 0, flickT = 0;
  // 推送：ping 为本次亮起的计时（-1 = 待机中），pingWait 为距下一次的秒数
  let ping = -1, pingWait = 4, fromGlow = GLOW_DIM;
  const pingEnv = () => ping < 0 ? 0 : smooth(clamp01(ping / 0.15)) * (1 - smooth(clamp01((ping - (PING_T - 0.45)) / 0.45)));
  const groundGlow = () => THREE.MathUtils.lerp(GLOW_DIM, GLOW_PING, pingEnv());

  // 拾起 / 放下途中的关键姿态
  // 拾起：地上 → P1（贴地滑到脚边，略转一点）→ P2（翻起、离地，屏幕朝人）→ 手持
  // 放下：手持 → P2（压低、翻起姿态）→ 地上（一边先着地、放平，朝向就是放下时的朝向）
  const P1 = new THREE.Vector3(), P2 = new THREE.Vector3();
  const Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
  // 镜头：动画开始时的站姿，途中在此基础上下蹲、低头，结束时精确回到这里
  const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion();
  const camFwd = new THREE.Vector3();
  let camLook = 0, camPitch = 0, camYaw = 0;
  const _ec = new THREE.Euler(0, 0, 0, 'YXZ'), _g = new THREE.Vector3();

  // 手持位置：相机前方，跟随相机；带一点呼吸
  // cp / cq：按哪个镜头姿态算（拾起途中镜头在蹲，目标按站姿算，避免杂志跟着镜头一起沉）
  function heldPose(outPos, outQuat, cp = camera.position, cq = camera.quaternion) {
    outPos.copy(HELD.pos);
    outPos.y += Math.sin(time * 1.5) * 0.0018;
    outPos.applyQuaternion(cq).add(cp);
    _e.set(HELD.pitch + Math.sin(time * 1.1) * 0.006, 0, Math.sin(time * 0.8) * 0.004);
    outQuat.copy(cq).multiply(_q.setFromEuler(_e));
  }

  // 机身最低点比中心低多少（随姿态变）。用来让杂志翻起 / 放下时一条边贴着地面转，而不是插进路面
  function drop(q) {
    const dx = Math.abs(_ax.set(1, 0, 0).applyQuaternion(q).y) * (W / 2 + BEZEL);
    const dy = Math.abs(_ax.set(0, 1, 0).applyQuaternion(q).y) * (H / 2 + BEZEL * 1.6);
    const dz = Math.abs(_ax.set(0, 0, 1).applyQuaternion(q).y) * (DEPTH / 2);
    return dx + dy + dz;
  }
  let DROP0 = drop(groundQuat);
  function keepAboveGround() {
    const floor = GROUND_POS.y + drop(pad.quaternion) - DROP0;
    if (pad.position.y < floor) pad.position.y = floor;
  }

  // 记下站姿镜头，算好低头角度：看向杂志，但至少低一点、最多低 0.6 弧度，且不超过正下方
  function beginCam() {
    camPos.copy(camera.position);
    camQuat.copy(camera.quaternion);
    _ec.setFromQuaternion(camQuat, 'YXZ');
    const pitch = camPitch = _ec.x;
    camYaw = _ec.y;
    camFwd.set(GROUND_POS.x - camPos.x, 0, GROUND_POS.z - camPos.z);
    const dist = camFwd.length();
    if (dist > 1e-4) camFwd.divideScalar(dist);
    const toMag = Math.atan2(GROUND_POS.y - (camPos.y - CROUCH), Math.max(0.3, dist - LEAN));
    camLook = Math.max(0, Math.min(THREE.MathUtils.clamp(pitch - toMag, 0.12, 0.6), pitch + 1.4));
  }
  // c：下蹲程度，l：低头程度，roll：歪头
  // gw：视线追杂志的权重（0~1）。眼睛跟着杂志走，镜头的俯仰 / 左右往杂志方向偏一部分
  function applyCam(c, l, roll, gw = 0) {
    camera.position.copy(camPos).addScaledVector(camFwd, LEAN * c);
    camera.position.y -= CROUCH * c;
    let pitch = camPitch - camLook * l, yaw = camYaw;
    if (gw > 0) {
      _g.subVectors(pad.position, camera.position);
      const h = Math.hypot(_g.x, _g.z);
      pitch += (Math.atan2(_g.y, h) - pitch) * gw;
      if (h > 0.15) {
        const dy = THREE.MathUtils.euclideanModulo(Math.atan2(-_g.x, -_g.z) - yaw + Math.PI, Math.PI * 2) - Math.PI;
        yaw += THREE.MathUtils.clamp(dy, -0.35, 0.35) * gw;
      }
    }
    camera.quaternion.setFromEuler(_ec.set(THREE.MathUtils.clamp(pitch, -1.45, 1.45), yaw, roll));
  }
  function endCam() {
    camera.position.copy(camPos);
    camera.quaternion.copy(camQuat);
  }

  // 翻起姿态：屏幕朝向站姿镜头，再往竖直方向多立一点、歪一点（像被捏着一边拎起来）
  function flipQuat(out, at, roll) {
    _m.lookAt(camPos, at, UP);
    return out.setFromRotationMatrix(_m).multiply(_q.setFromEuler(_e2.set(0.3, 0, roll)));
  }

  // ---------- 输入 ----------
  addEventListener('wheel', (e) => {
    if (st.phase !== 'held' || !document.pointerLockElement || Math.abs(e.deltaY) < 4) return;
    turn(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  function turn(d) {
    const to = st.page + d;
    if (to < 0 || to >= PAGES || st.flip < 0.6) return false;
    st.from = st.page; st.page = to; st.dir = d; st.flip = 0;
    sound.play('ui/hover');
    return true;
  }

  // 返回 true 表示按键已被杂志处理（阅读期间的其他按键全部吞掉）
  function key(code) {
    if (st.phase !== 'held') return true;
    if (code === 'KeyA' || code === 'ArrowLeft') turn(-1);
    else if (code === 'KeyD' || code === 'ArrowRight') turn(1);
    else if (code === 'KeyE' || code === 'Backspace') putDown();
    return true;
  }

  function pickUp() {
    if (st.phase !== 'ground') return false;
    st.phase = 'up'; st.t = 0;
    st.page = 0; st.flip = 1;
    fromGlow = glow.value; ping = -1;   // 从当前亮度（待机或推送中）过渡到手持亮度
    fromPos.copy(pad.position); fromQuat.copy(pad.quaternion);
    uiScene.attach(pad);
    beginCam();
    // 贴地往人这边拖一下，顺手转一点；再翻起、离地
    const toCam = _v.set(camPos.x - GROUND_POS.x, 0, camPos.z - GROUND_POS.z).normalize();
    P1.copy(GROUND_POS).addScaledVector(toCam, SLIDE);
    Q1.setFromAxisAngle(UP, 0.2).multiply(groundQuat);
    P2.copy(P1).addScaledVector(toCam, 0.05);
    P2.y += 0.2;
    flipQuat(Q2, P2, 0.2);
    // 衣物声由扫描枪收起时播（viewmodel），这里不再重复
    return true;
  }
  function putDown() {
    if (st.phase !== 'held') return false;
    st.phase = 'down'; st.t = 0;
    pingWait = PING_GAP[0];
    fromPos.copy(pad.position); fromQuat.copy(pad.quaternion);
    beginCam();
    // 落点还是原处；朝向不转回去，顺着拿在手里的方向往前放平（顶边朝外），带一点随手的偏差
    setGroundYaw(_e.setFromQuaternion(camQuat, 'YXZ').y + (Math.random() - 0.5) * 0.3);
    DROP0 = drop(groundQuat);
    const toCam = _v.set(camPos.x - GROUND_POS.x, 0, camPos.z - GROUND_POS.z).normalize();
    P2.copy(GROUND_POS).addScaledVector(toCam, 0.03);
    P2.y += 0.18;
    flipQuat(Q2, P2, -0.15);
    sound.cloth();
    return true;
  }
  // 立即放回地上（切换模式、跳关时）
  function reset() {
    if (st.phase === 'ground') return;
    if (st.phase === 'up' || st.phase === 'down') endCam();
    st.phase = 'ground'; st.page = 0; st.flip = 1;
    placeOnGround();
  }

  // ---------- 每帧 ----------
  function update(dt) {
    time += dt;
    flickT -= dt;
    // 屏幕偶尔闪一下（泡了雨水的旧屏）：只在地上闪
    if (st.phase === 'ground' && flickT <= 0 && Math.random() < dt * 0.18) flickT = 0.05 + Math.random() * 0.08;
    flicker.value = flickT > 0 ? 0.35 + Math.random() * 0.4 : 1;
    // 地上待机时隔一会儿亮一次推送
    if (st.phase === 'ground') {
      if (ping >= 0) { ping += dt; if (ping >= PING_T) ping = -1; }
      else if ((pingWait -= dt) <= 0) { ping = 0; pingWait = PING_GAP[0] + Math.random() * (PING_GAP[1] - PING_GAP[0]); st.redraw = 1; }
    }

    if (st.phase === 'up' || st.phase === 'down') {
      const up = st.phase === 'up';
      st.t += dt;
      const dur = up ? UP_T : DOWN_T;
      const u = Math.min(1, st.t / dur);
      if (up) {
        // 镜头：先蹲下低头（低头略领先），杂志翻起时被"拎"得再沉一下，然后起身抬头；途中视线追着杂志
        const heave = Math.sin(clamp01((u - 0.28) / 0.22) * Math.PI) * 0.05;
        const c = ramp(u, 0, 0.3) - ramp(u, 0.45, 1) + heave;
        const l = ramp(u, 0, 0.26) - ramp(u, 0.4, 0.95);
        const gw = 0.45 * ramp(u, 0.05, 0.3) * (1 - ramp(u, 0.6, 0.95));
        // 杂志：三段互相重叠的插值串起来，速度连续
        heldPose(heldPos, heldQuat, camPos, camQuat);
        const w1 = ramp(u, 0, 0.22);                       // 贴地滑
        const w2 = ramp(u, 0.17, 0.46);                    // 翻起离地
        const w3 = ramp(u, 0.38, 1);                       // 到面前
        const w3r = ramp(u, 0.42, 0.97);                   // 转向比位移慢半拍，像被拖着
        pad.position.copy(fromPos).lerp(P1, w1).lerp(P2, w2).lerp(heldPos, w3);
        pad.position.y += Math.sin(w3 * Math.PI) * 0.05;  // 往上一提的弧线
        pad.quaternion.copy(fromQuat).slerp(Q1, w1).slerp(Q2, w2).slerp(heldQuat, w3r);
        // 途中左右甩一点；到位后有重量地往下沉一下再回来，带两下衰减的晃动
        const k = clamp01((u - 0.72) / 0.28), fade = (1 - k) * (1 - k);
        pad.position.y -= Math.sin(k * Math.PI * 2) * (1 - k) * 0.01;
        pad.quaternion.multiply(_q.setFromEuler(_e2.set(
          Math.sin(k * Math.PI * 2.5) * fade * 0.06,
          Math.sin(w3 * Math.PI) * 0.06,
          Math.sin(w3 * Math.PI) * 0.12 + Math.sin(k * Math.PI * 3) * fade * 0.03,
        )));
        keepAboveGround();
        applyCam(c, l, 0.025 * c, gw);
        glow.value = THREE.MathUtils.lerp(fromGlow, GLOW_HAND, w3);
      } else {
        // 镜头：蹲下低头放好，停一下再起身；途中视线追着杂志
        const c = ramp(u, 0, 0.35) - ramp(u, 0.62, 1);
        const l = ramp(u, 0, 0.3) - ramp(u, 0.6, 1);
        const gw = 0.45 * ramp(u, 0.1, 0.4) * (1 - ramp(u, 0.7, 1));
        const w1 = ramp(u, 0, 0.5);                        // 压低到脚边，翻起姿态
        const w2 = ramp(u, 0.38, 0.85);                    // 一边先着地，再放平
        pad.position.copy(fromPos).lerp(P2, w1).lerp(GROUND_POS, w2);
        pad.position.y += Math.sin(w1 * Math.PI) * 0.03;
        pad.quaternion.copy(fromQuat).slerp(Q2, w1).slerp(groundQuat, w2);
        // 落地时轻轻颠一下
        const k = clamp01((u - 0.8) / 0.2);
        pad.quaternion.multiply(_q.setFromEuler(_e2.set(Math.sin(k * Math.PI * 2) * (1 - k) * 0.03, 0, 0)));
        keepAboveGround();
        applyCam(c, l, -0.02 * c, gw);
        glow.value = THREE.MathUtils.lerp(GLOW_HAND, GLOW_DIM, w2);
      }
      if (u >= 1) {
        endCam();
        if (up) st.phase = 'held';
        else { st.phase = 'ground'; st.page = 0; st.flip = 1; placeOnGround(); }   // 放回地上：回到封面
      }
    } else if (st.phase === 'held') {
      heldPose(pad.position, pad.quaternion);
      glow.value = GLOW_HAND;
    } else glow.value = groundGlow();

    // 翻页过渡
    if (st.flip < 1) st.flip = Math.min(1, st.flip + dt / 0.42);

    // 重绘：拿在手里 30 帧 / 秒；地上走近（15 米内）12 帧 / 秒，远了不画
    const near = st.phase !== 'ground' || _v.copy(GROUND_POS).distanceTo(camera.position) < 15;
    const fps = st.phase === 'ground' && ping < 0 ? 12 : 30;   // 推送横幅滑动时也用 30 帧
    st.drawT -= dt;
    if (near && (st.drawT <= 0 || st.redraw)) {
      st.drawT = 1 / fps;
      st.redraw = 0;
      draw();
      tex.needsUpdate = true;
    }
  }

  // 加载界面期间轮流把杂志放进 uiScene，让手持状态的材质提前编译好（不然第一次拾起会卡一下）
  function warm(on) {
    if (st.phase !== 'ground') return;
    if (on) { if (pad.parent !== uiScene) uiScene.attach(pad); heldPose(pad.position, pad.quaternion); }
    else if (pad.parent !== scene) placeOnGround();
  }

  // ---------- 页面绘制 ----------
  const wrapCache = new Map();
  function font(size, weight = 400, family = SANS) { g.font = `${weight} ${size}px ${family}`; }
  function text(t, x, y, size, color, weight = 400, align = 'left', family = SANS) {
    font(size, weight, family);
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillText(t, x, y);
  }
  // 按宽度折行：中文逐字，英文按词；行首不放中文标点
  function wrap(str, maxW) {
    const key = `${g.font}|${maxW}|${str}`;
    if (wrapCache.has(key)) return wrapCache.get(key);
    const lines = [];
    for (const para of str.split('\n')) {
      const cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(para);
      // 中文逐字断行，但连续的数字 / 英文（如 38%）不拆开
      const tokens = cjk ? para.match(/[A-Za-z0-9%.\-+]+|\s+|./gu) : para.split(/(\s+)/);
      let line = '';
      for (const tk of tokens) {
        const test = line + tk;
        if (g.measureText(test).width > maxW && line.trim()) {
          if (cjk && /[，。、；：！？）」』”’]/.test(tk)) { line = test; continue; }
          lines.push(line.trimEnd());
          line = tk.trimStart();
        } else line = test;
      }
      lines.push(line.trimEnd());
    }
    wrapCache.set(key, lines);
    return lines;
  }
  // 段落：返回最后一行之后的 y
  function para(str, x, y, w, size, lh, color, weight = 400, family = SANS) {
    font(size, weight, family);
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    for (const l of wrap(str, w)) { g.fillText(l, x, y); y += lh; }
    return y;
  }
  function rule(x, y, w, color = C.faint, h = 2) { g.fillStyle = color; g.fillRect(x, y, w, h); }
  function tag(t, x, y, color) {
    font(22, 600, MONO);
    const w = g.measureText(t).width + 24;
    g.fillStyle = color;
    g.fillRect(x, y - 26, w, 34);
    text(t, x + 12, y, 22, '#0b0d12', 600, 'left', MONO);
    return w;
  }
  const imgs = new Map();
  function image(name) {
    if (!imgs.has(name)) {
      const im = new Image();
      im.onload = () => { st.redraw = 1; };
      im.src = `${import.meta.env.BASE_URL}assets/gen/${name}`;
      imgs.set(name, im);
    }
    const im = imgs.get(name);
    return im.complete && im.naturalWidth ? im : null;
  }
  // 按比例铺满（cover）
  function coverImage(im, x, y, w, h, zoom = 1, ox = 0, oy = 0) {
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight) * zoom;
    const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(im, x + (w - iw) / 2 + ox, y + (h - ih) / 2 + oy, iw, ih);
    g.restore();
  }

  // ---------- 封面：俯瞰高架，车流整齐得像排好的队，只有中间一条金色车道空着 ----------
  const VP = { x: 480, y: 600 };
  const LANES = [-720, -360, 0, 360, 720];
  const rnd = mulberry(7);
  const city = document.createElement('canvas');
  city.width = CW; city.height = CH;
  paintCity(city.getContext('2d'));
  const cars = LANES.map((_, i) => Array.from({ length: 13 }, (_, j) => ({ s: j / 13 + rnd() * 0.012, i })));
  const rain = Array.from({ length: 90 }, () => ({ x: rnd() * CW, y: rnd() * CH, l: 30 + rnd() * 60, v: 900 + rnd() * 700 }));

  function paintCity(c) {
    const sky = c.createLinearGradient(0, 0, 0, VP.y);
    sky.addColorStop(0, '#07060f');
    sky.addColorStop(0.55, '#1b0c2a');
    sky.addColorStop(1, '#4a1838');
    c.fillStyle = sky;
    c.fillRect(0, 0, CW, VP.y);
    // 远处的楼：剪影 + 零星亮窗
    for (let layer = 0; layer < 3; layer++) {
      const tone = ['#160d22', '#0f0918', '#08060d'][layer];
      let x = -20;
      while (x < CW + 20) {
        const w = 30 + rnd() * (50 + layer * 40);
        const h = 60 + rnd() * (160 + layer * 170);
        c.fillStyle = tone;
        c.fillRect(x, VP.y - h, w, h + 2);
        for (let wy = VP.y - h + 10; wy < VP.y - 6; wy += 9 + layer * 3) {
          for (let wx = x + 4; wx < x + w - 4; wx += 7 + layer * 3) {
            if (rnd() > 0.82 - layer * 0.04) {
              c.fillStyle = ['rgba(111,227,255,0.55)', 'rgba(255,90,170,0.5)', 'rgba(255,200,97,0.5)'][Math.floor(rnd() * 3)];
              c.fillRect(wx, wy, 2 + layer, 2 + layer);
            }
          }
        }
        // 楼顶霓虹
        if (rnd() > 0.7) {
          c.fillStyle = rnd() > 0.5 ? '#ff3b8c' : '#38e0ff';
          c.fillRect(x + w * 0.2, VP.y - h - 4, w * 0.6, 3);
        }
        x += w + rnd() * 6;
      }
    }
    // 地平线雾光
    const haze = c.createLinearGradient(0, VP.y - 120, 0, VP.y + 40);
    haze.addColorStop(0, 'rgba(255,80,140,0)');
    haze.addColorStop(1, 'rgba(255,110,150,0.35)');
    c.fillStyle = haze;
    c.fillRect(0, VP.y - 120, CW, 160);
    // 路面
    c.fillStyle = '#06070b';
    c.beginPath();
    c.moveTo(VP.x, VP.y);
    c.lineTo(VP.x + 900, CH); c.lineTo(VP.x - 900, CH);
    c.closePath(); c.fill();
    // 路外：桥下的暗处
    c.fillStyle = '#030305';
    c.beginPath(); c.moveTo(0, VP.y); c.lineTo(VP.x, VP.y); c.lineTo(VP.x - 900, CH); c.lineTo(0, CH); c.fill();
    c.beginPath(); c.moveTo(CW, VP.y); c.lineTo(VP.x, VP.y); c.lineTo(VP.x + 900, CH); c.lineTo(CW, CH); c.fill();
    // 湿路面倒影：竖向的霓虹拖影
    c.save();
    c.beginPath(); c.moveTo(VP.x, VP.y); c.lineTo(VP.x + 900, CH); c.lineTo(VP.x - 900, CH); c.closePath(); c.clip();
    for (let i = 0; i < 40; i++) {
      const x = rnd() * CW;
      const col = ['111,227,255', '255,90,170', '255,200,97'][Math.floor(rnd() * 3)];
      const gr = c.createLinearGradient(0, VP.y, 0, VP.y + 260 + rnd() * 300);
      gr.addColorStop(0, `rgba(${col},0.22)`);
      gr.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = gr;
      c.fillRect(x, VP.y, 2 + rnd() * 6, 600);
    }
    c.restore();
    // 车道线 + 护栏灯带
    const f = (y) => (y - VP.y) / (CH - VP.y);
    for (const bx of [-540, -180, 180, 540]) {
      for (let s = 0; s < 1; s += 0.06) {
        const y0 = VP.y + (CH - VP.y) * s ** 2.2, y1 = VP.y + (CH - VP.y) * (s + 0.03) ** 2.2;
        c.strokeStyle = 'rgba(220,230,255,0.25)';
        c.lineWidth = 1 + 3 * f(y1);
        c.beginPath(); c.moveTo(VP.x + bx * f(y0), y0); c.lineTo(VP.x + bx * f(y1), y1); c.stroke();
      }
    }
    for (const [bx, col] of [[-900, '#38e0ff'], [900, '#ff3b8c']]) {
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(VP.x, VP.y); c.lineTo(VP.x + bx, CH); c.stroke();
    }
  }

  function drawCover(t) {
    g.drawImage(city, 0, 0);
    const f = (s) => s ** 2.4;
    // 金色车道：空着，箭头一直往前流
    const gold = g.createLinearGradient(0, VP.y, 0, CH);
    gold.addColorStop(0, 'rgba(255,200,97,0.05)');
    gold.addColorStop(1, 'rgba(255,190,80,0.32)');
    g.fillStyle = gold;
    g.beginPath(); g.moveTo(VP.x, VP.y); g.lineTo(VP.x + 180, CH); g.lineTo(VP.x - 180, CH); g.closePath(); g.fill();
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const s = fract(i / 9 - t * 0.16);
      const k = f(s), y = VP.y + (CH - VP.y) * k, w = 150 * k, h = 50 * k;
      g.strokeStyle = `rgba(255,205,110,${0.15 + 0.6 * k})`;
      g.lineWidth = 2 + 10 * k;
      g.beginPath(); g.moveTo(VP.x - w, y + h); g.lineTo(VP.x, y); g.lineTo(VP.x + w, y + h); g.stroke();
    }
    // 车流：左两道迎面（白色车灯），右两道远去（红色尾灯），间距一模一样
    for (const lane of cars) {
      for (const car of lane) {
        const lx = LANES[car.i];
        if (lx === 0) continue;
        const toward = lx < 0;
        const s = fract(car.s + (toward ? 1 : -1) * t * 0.05);
        const k = f(s), y = VP.y + (CH - VP.y) * k, x = VP.x + lx * k;
        const r = 2 + 15 * k, gap = 55 * k;
        const col = toward ? '235,245,255' : '255,50,70';
        for (const sx of [-gap, gap]) {
          const gr = g.createRadialGradient(x + sx, y, 0, x + sx, y, r * 3);
          gr.addColorStop(0, `rgba(${col},${0.9})`);
          gr.addColorStop(0.25, `rgba(${col},0.35)`);
          gr.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = gr;
          g.fillRect(x + sx - r * 3, y - r * 3, r * 6, r * 6);
        }
      }
    }
    g.restore();
    // 雨
    g.strokeStyle = 'rgba(200,220,255,0.16)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const d of rain) {
      const y = (d.y + t * d.v) % (CH + 100) - 50;
      const x = (d.x + y * 0.18) % CW;
      g.moveTo(x, y); g.lineTo(x + d.l * 0.18, y + d.l);
    }
    g.stroke();

    // 文字压暗：顶部、底部
    let gr = g.createLinearGradient(0, 0, 0, 330);
    gr.addColorStop(0, 'rgba(5,4,10,0.85)'); gr.addColorStop(1, 'rgba(5,4,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, CW, 330);
    gr = g.createLinearGradient(0, CH - 520, 0, CH);
    gr.addColorStop(0, 'rgba(5,4,10,0)'); gr.addColorStop(0.5, 'rgba(5,4,10,0.75)'); gr.addColorStop(1, 'rgba(5,4,10,0.95)');
    g.fillStyle = gr; g.fillRect(0, CH - 520, CW, 520);

    // 刊头
    g.letterSpacing = '6px';
    text(tx('城脉', 'METRO'), 52, 196, tx(184, 150), C.ink, 800, 'left', tx(SERIF, SANS));
    g.letterSpacing = '0px';
    text(tx('METRO PULSE · 城市周刊', 'PULSE · THE CITY WEEKLY'), 58, 244, 26, C.dim, 500, 'left', MONO);
    text(tx('第 2187 期 · 雨季特刊', 'ISSUE 2187 · MONSOON'), CW - 52, 92, 24, C.dim, 500, 'right', MONO);
    // LIVE：实时更新的电子刊
    const on = Math.sin(t * 4) > -0.3;
    g.fillStyle = on ? C.red : 'rgba(255,59,92,0.35)';
    g.beginPath(); g.arc(CW - 158, 132, 9, 0, Math.PI * 2); g.fill();
    text('LIVE', CW - 52, 141, 26, C.ink, 700, 'right', MONO);

    // 右侧小标题
    let y = 330;
    for (const [a, b] of [
      [tx('枢核年度报告', 'URSA ANNUAL REPORT'), tx('道路事故率再降 38%', 'Road deaths down 38%')],
      [tx('承岳第三代', 'CHENGYUE HEIR'), tx('首次公开亮相', 'Steps into the light')],
    ]) {
      rule(CW - 330, y - 34, 50, C.gold, 4);
      text(a, CW - 330, y, 24, C.gold, 600, 'left', MONO);
      para(b, CW - 330, y + 40, 290, 32, 40, C.ink, 600);
      y += 150;
    }

    // 封面故事
    tag(tx('封面故事', 'COVER STORY'), 52, CH - 330, C.gold);
    text(tx('零号保障', 'ZERO PRIORITY'), 48, CH - 196, tx(132, 104), C.gold, 800);
    text(tx('生命，不该排队。', 'Life shouldn’t wait in line.'), 54, CH - 128, 46, C.ink, 600);
    text(tx('城市为谁让路？我们试乘了那条空着的车道 → P.2', 'Who does the city make way for? We rode the empty lane → P.2'), 54, CH - 74, 25, C.dim, 400);
  }

  // ---------- 第 2 页：枢核年度报告 ----------
  function drawFeature(t) {
    head(tx('城市', 'CITY'), 2);
    text(tx('枢核年度报告：', 'URSA annual report:'), 52, 196, 54, C.ink, 800);
    text(tx('道路事故率再降 38%', 'road deaths down 38%'), 52, 262, 54, C.gold, 800);
    para(tx('全城车辆调度交由枢核的第九年，堵车成了历史名词。剩下的事故，几乎都与“人”有关。',
      'Nine years into URSA dispatch, traffic jams are history. What accidents remain involve people.'),
    52, 318, CW - 104, 28, 42, C.dim);

    // 配图：调度中枢的路网图（中心节点 + 四条外伸线路，脉冲沿路网流动）
    const bx = 52, by = 400, bw = CW - 104, bh = 320;
    g.fillStyle = '#05101a';
    g.fillRect(bx, by, bw, bh);
    g.save();
    g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
    const cx = bx + bw / 2, cy = by + bh / 2;
    g.strokeStyle = 'rgba(111,227,255,0.12)';
    g.lineWidth = 1;
    for (let i = -12; i <= 12; i++) {
      g.beginPath(); g.moveTo(cx + i * 40 - 200, by); g.lineTo(cx + i * 40 + 200, by + bh); g.stroke();
      g.beginPath(); g.moveTo(bx, cy + i * 34); g.lineTo(bx + bw, cy + i * 34 - 60); g.stroke();
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const lane = i % 24 - 12, s = fract(i * 0.137 + t * (0.05 + (i % 5) * 0.012));
      const horiz = i % 2;
      const x = horiz ? bx + bw * s : cx + lane * 40 - 200 + 400 * s;
      const y = horiz ? cy + lane * 34 - 60 * s : by + bh * s;
      g.fillStyle = i % 7 === 0 ? 'rgba(255,200,97,0.9)' : 'rgba(150,235,255,0.8)';
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    g.strokeStyle = 'rgba(220,245,255,0.9)';
    g.lineWidth = 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.beginPath(); g.moveTo(cx + dx * 34, cy + dy * 34); g.lineTo(cx + dx * 150, cy + dy * 150); g.stroke();
    }
    const pulse = 1 + Math.sin(t * 2.2) * 0.12;
    g.fillStyle = 'rgba(220,245,255,0.95)';
    g.beginPath(); g.arc(cx, cy, 16 * pulse, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(111,227,255,${0.5 - fract(t * 0.5) * 0.5})`;
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 30 + fract(t * 0.5) * 120, 0, Math.PI * 2); g.stroke();
    g.restore();
    text(tx('URSA / 枢核 · 城市调度中枢实时路网', 'URSA live dispatch grid'), bx + 16, by + bh - 18, 20, 'rgba(111,227,255,0.8)', 500, 'left', MONO);

    // 正文两栏
    const colW = (CW - 104 - 40) / 2;
    const y0 = 780;
    let y = para(tx('经纬城市系统公司昨日发布年度报告：过去一年，全城道路事故率再降 38%，平均通勤时间缩短 11 分钟。报告指出，剩余事故中有 91% 涉及非法改装车辆或违规手动驾驶。',
      'Meridian Urban Systems’ annual report: accidents down 38%, commutes 11 minutes shorter. 91% of the accidents that remain involved modified vehicles or manual driving.'),
    52, y0, colW, 25, 38, C.ink);
    para(tx('“事故报告由枢核在现场数据回传的同时生成，复核员只需确认。”经纬发言人说。',
      '“URSA writes the report as the scene data comes in. Reviewers just confirm it,” said a spokesperson.'),
    52, y + 8, colW, 25, 38, C.dim);
    // 右栏：引语 + 人事动态
    const rx = 52 + colW + 40;
    rule(rx, y0 - 28, 60, C.gold, 5);
    y = para(tx('“把选择交给我们，把安全留给自己。”', '“Leave the choices to us. Keep the safety for yourself.”'), rx, y0 + 16, colW, tx(38, 32), tx(52, 44), C.gold, 700, SERIF);
    text(tx('—— 经纬城市系统公司', '— Meridian Urban Systems'), rx, y + 4, 22, C.dim, 500);
    const sy = y + 50;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(rx, sy, colW, CH - 80 - sy);
    text(tx('人事动态', 'STAFF NOTE'), rx + 20, sy + 40, 22, C.cyan, 600, 'left', MONO);
    para(tx('经纬宣布：原始数据审计岗位将于明年起逐步由枢核自动审计接替。“人工逐条核对原始记录，已经没有必要。”',
      'Raw-data audit engineers will be replaced by URSA self-audit next year. “Checking by hand is no longer necessary.”'),
    rx + 20, sy + 78, colW - 40, 22, 32, C.ink);
  }

  // ---------- 第 3 页：简讯 + 广告 ----------
  function drawBriefs(t) {
    head(tx('简讯', 'BRIEFS'), 3);
    const items = [
      [tx('财经', 'MONEY'), tx('承岳第三代首次公开亮相', 'Chengyue heir makes first public appearance'),
        tx('陆世承很少出现在镜头前。但承岳的名字，出现在这座城市许多资产的归属栏里。', 'Lu Shicheng rarely appears on camera. But the Chengyue name sits in the owner field of much of this city.')],
      [tx('招聘', 'JOBS'), tx('公序安全事务公司招募现场复核员', 'Civic Order Services is hiring Field Review Agents'),
        tx('签约即上岗，事故按工单结算，无需警务背景。“大多数时候，你只需要证明系统没有写错。”', 'Sign and start today. Paid per ticket, no police background needed. “Most days you just confirm the system got it right.”')],
      [tx('交通', 'TRAFFIC'), tx('高架雨天夜间限速下调', 'Night speed limits cut on elevated roads'),
        tx('枢核提示：雨季路面湿滑，请勿切换手动驾驶。违规车辆将自动记录。', 'URSA reminds drivers: roads are slick this season. Do not switch to manual. Violations are logged automatically.')],
    ];
    let y = 170;
    for (const [k, h, b] of items) {
      tag(k, 52, y + 10, C.cyan);
      y = para(h, 52, y + 66, CW - 104, 38, 48, C.ink, 700);
      y = para(b, 52, y + 4, CW - 104, 25, 38, C.dim);
      rule(52, y + 8, CW - 104);
      y += 50;
    }
    // 下半页广告：莲华诊所（城里的广告牌也在投）
    const ay = Math.max(y + 10, 760), ah = CH - 110 - ay;
    const im = image('mag_lotus.jpg');
    g.fillStyle = '#0b0d12';
    g.fillRect(52, ay, CW - 104, ah);
    if (im) coverImage(im, 52, ay, CW - 104, ah, 1.06 + Math.sin(t * 0.3) * 0.02, 0, 40);
    text(tx('广告', 'AD'), CW - 66, ay + 34, 20, 'rgba(255,255,255,0.7)', 500, 'right', MONO);
  }

  // ---------- 第 4 页：零号保障整版广告 ----------
  function drawAd(t) {
    g.fillStyle = '#050403';
    g.fillRect(0, 0, CW, CH);
    // 一条金色光带从远处铺到脚下，两侧的车灯全部熄着
    const vy = 560;
    const gr = g.createLinearGradient(0, vy, 0, CH);
    gr.addColorStop(0, 'rgba(255,200,97,0.0)');
    gr.addColorStop(0.3, 'rgba(255,200,97,0.25)');
    gr.addColorStop(1, 'rgba(255,190,80,0.75)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(CW / 2 - 6, vy); g.lineTo(CW / 2 + 6, vy); g.lineTo(CW / 2 + 260, CH); g.lineTo(CW / 2 - 260, CH); g.closePath(); g.fill();
    g.save();
    g.globalCompositeOperation = 'lighter';
    const sweep = fract(t * 0.25);
    const sy = vy + (CH - vy) * sweep ** 2;
    const band = g.createLinearGradient(0, sy - 80, 0, sy + 20);
    band.addColorStop(0, 'rgba(255,230,160,0)');
    band.addColorStop(1, 'rgba(255,230,160,0.35)');
    g.fillStyle = band;
    g.fillRect(0, sy - 80, CW, 100);
    g.restore();
    for (let i = 0; i < 26; i++) {
      const s = (i % 13) / 13 + 0.04, side = i < 13 ? -1 : 1;
      const k = s ** 2, y = vy + (CH - vy) * k, x = CW / 2 + side * (60 + 520 * k);
      g.fillStyle = 'rgba(140,130,120,0.18)';
      g.fillRect(x - 30 * k, y - 8 * k, 60 * k, 14 * k);
    }
    g.letterSpacing = '10px';
    text('ZERO PRIORITY', CW / 2, 180, 40, C.gold, 600, 'center', MONO);
    g.letterSpacing = '0px';
    text(tx('零号保障', 'Zero Priority'), CW / 2, 330, tx(140, 112), '#ffe2a6', 800, 'center', tx(SERIF, SANS));
    text(tx('世界为你让路。', 'The world makes way for you.'), CW / 2, 420, 44, C.ink, 500, 'center');
    // 小字（压在光带上，先垫一条暗底）
    const fb = g.createLinearGradient(0, CH - 190, 0, CH);
    fb.addColorStop(0, 'rgba(5,4,3,0)');
    fb.addColorStop(0.35, 'rgba(5,4,3,0.85)');
    fb.addColorStop(1, 'rgba(5,4,3,0.95)');
    g.fillStyle = fb;
    g.fillRect(0, CH - 190, CW, 190);
    font(19, 400);
    g.fillStyle = 'rgba(255,226,166,0.55)';
    g.textAlign = 'center';
    const fine = tx('零号生命保障协议 · 资格由枢核依据综合生命价值评估授予，无需申请。条款以系统解释为准。',
      'Zero Priority Life Protection Protocol. Eligibility is granted by URSA based on an overall life-value assessment. No application required. Terms as interpreted by the system.');
    let y = CH - 120;
    for (const l of wrap(fine, CW - 200)) { g.fillText(l, CW / 2, y); y += 30; }
  }

  // 内页的页眉
  function head(section, no) {
    g.fillStyle = C.paper;
    g.fillRect(0, 0, CW, CH);
    text(tx('城脉', 'METRO PULSE'), 52, 84, 30, C.ink, 800, 'left', tx(SERIF, SANS));
    text(section, CW - 52, 84, 24, C.gold, 600, 'right', MONO);
    rule(52, 108, CW - 104, C.faint, 2);
  }

  const DRAW = [drawCover, drawFeature, drawBriefs, drawAd];
  function drawPage(i, t) {
    g.save();
    DRAW[i](t);
    g.restore();
    g.letterSpacing = '0px';
  }
  function draw() {
    const t = time;
    if (st.flip >= 1) drawPage(st.page, t);
    else {
      // 翻页：旧页滑出、新页滑入，中间几条横向错位的故障条
      const e = smooth(st.flip);
      g.save();
      g.translate(-st.dir * e * CW, 0);
      drawPage(st.from, t);
      g.restore();
      g.save();
      g.translate(st.dir * (1 - e) * CW, 0);
      drawPage(st.page, t);
      g.restore();
      const amt = Math.sin(st.flip * Math.PI);
      for (let i = 0; i < 6; i++) {
        const y = Math.random() * CH, h = 6 + Math.random() * 40;
        g.drawImage(cvs, 0, y, CW, h, (Math.random() - 0.5) * 80 * amt, y, CW, h);
      }
    }
    // 推送横幅：地上亮起时从顶部滑下来
    const pe = st.phase === 'ground' ? pingEnv() : 0;
    if (pe > 0) {
      const bh = 168, by = 36 - (1 - pe) * (bh + 40);
      g.save();
      g.globalAlpha = pe;
      g.fillStyle = 'rgba(18,22,30,0.92)';
      g.beginPath(); g.roundRect(40, by, CW - 80, bh, 28); g.fill();
      g.fillStyle = C.gold;
      g.beginPath(); g.roundRect(72, by + 36, 56, 56, 14); g.fill();
      text('M', 100, by + 78, 34, '#0c0f16', 800, 'center', SANS);
      text(tx('城脉 · 新一期已送达', 'METRO PULSE · New issue'), 152, by + 62, 30, C.ink, 700);
      text(tx('零号保障：世界为你让路。', 'Zero Priority: the world makes way for you.'), 152, by + 108, 26, C.dim, 400);
      text(tx('刚刚', 'now'), CW - 72, by + 62, 22, C.dim, 500, 'right', MONO);
      g.restore();
    }
    // 页脚：页码（拿在手里才显示）
    if (st.phase !== 'ground') {
      for (let i = 0; i < PAGES; i++) {
        g.fillStyle = i === st.page ? C.ink : 'rgba(244,241,234,0.25)';
        g.fillRect(CW / 2 - PAGES * 18 + i * 36, CH - 40, 24, 5);
      }
      text(`${st.page + 1} / ${PAGES}`, CW - 52, CH - 30, 20, C.dim, 500, 'right', MONO);
    }
  }
  onLang(() => { wrapCache.clear(); st.redraw = 1; });

  const _target = { p: new THREE.Vector3(), radius: 0.3 };
  return {
    update,
    pickUp,
    putDown,
    reset,
    key,
    warm,
    range: PICK_RANGE,
    // 准星瞄准用：只有在地上时可以拾起
    get target() {
      if (st.phase !== 'ground') return null;
      _target.p.copy(GROUND_POS);
      _target.p.y += 0.03;
      return _target;
    },
    // 拾起 / 阅读 / 放回期间：屏蔽移动和其他操作
    get busy() { return st.phase !== 'ground'; },
    get held() { return st.phase === 'held'; },
    // 背景虚化程度 0~1
    get amount() {
      if (st.phase === 'held') return 1;
      if (st.phase === 'up') return smooth(Math.min(1, st.t / UP_T));
      if (st.phase === 'down') return 1 - smooth(Math.min(1, st.t / DOWN_T));
      return 0;
    },
    get page() { return st.page; },
    turn,
    // 开发调试：直接画某一页并返回画布（截图检查排版）
    debugPage(i, t = 2) {
      st.page = i; st.flip = 1; time = t;
      draw();
      tex.needsUpdate = true;
      return cvs;
    },
  };
}

// 固定种子的随机数：封面的楼群每次打开都一样
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
