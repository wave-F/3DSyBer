import * as THREE from 'three/webgpu';
import { mrt, float, uv, color, smoothstep, sin } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { uiTime } from './clock.js';

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
  idle: { pos: new THREE.Vector3(0.22, -0.32, -0.40), rot: new THREE.Euler(-0.48, 0.14, -0.10) },
  scan: { pos: new THREE.Vector3(0.12, -0.15, -0.45), rot: new THREE.Euler(0.035, 0.05, -0.03) },
  hidden: { pos: new THREE.Vector3(0.24, -0.55, -0.3), rot: new THREE.Euler(-0.9, 0.2, 0.3) },
};

const dbg = { on: false, pos: new THREE.Vector3(0, 0, -0.4), rot: new THREE.Euler() };
if (import.meta.env.DEV) window.__vm = dbg;

export function createViewmodel(overlayScene, camera) {
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

  // 分析扫光：设备发射头 → 线索的扇形光面，远端扫描线在目标上来回扫动
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  fanGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.5, 0, 0, 1, 1, 1]), 2));
  const fanMat = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const v = uv().y;
  const lines = sin(v.mul(60).sub(uiTime.mul(18))).mul(0.5).add(0.5).pow(4);
  fanMat.colorNode = color(0x52d8ff).mul(v.pow(1.2).mul(0.9).add(0.06).add(lines.mul(v).mul(0.4)).add(smoothstep(0.95, 1, v).mul(5)));
  fanMat.mrtNode = NO_MASK;
  const fan = new THREE.Mesh(fanGeo, fanMat);
  fan.frustumCulled = false;
  fan.visible = false;
  overlayScene.add(fan);

  const st = {
    hide: 1,                 // 0 显示，1 收起
    scanT: -1,               // 扫描动作计时，-1 表示未在扫描
    aim: 0,                  // 指向线索的权重
    target: null, progress: 0,
    bob: 0, lastPos: new THREE.Vector3(), speed: 0,
    sway: { y: 0, p: 0, vy: 0, vp: 0 }, lastYaw: 0, lastPitch: 0,
    onFire: null,
  };
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const eA = new THREE.Euler();

  // 开始扫描动作：0.5 秒举起，发射，保持，再用同样的 0.5 秒放下
  function scan(onFire) {
    if (st.scanT >= 0) return false;
    st.scanT = 0;
    st.onFire = onFire;
    return true;
  }

  // 正在分析的目标（null 表示不在分析）与进度
  function analyze(target, progress) {
    st.target = target;
    st.progress = progress;
  }

  function emitterWorld(out) {
    holder.updateMatrixWorld(true);
    return device.emitter.getWorldPosition(out);
  }

  function update(dt, visible) {
    // 收起/显示
    st.hide = THREE.MathUtils.clamp(st.hide + (visible ? -dt * 3 : dt * 5), 0, 1);
    rig.visible = st.hide < 1;
    camera.updateMatrixWorld();
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);

    // 移动速度 → 走路晃动
    const moved = vA.copy(camera.position).sub(st.lastPos).setY(0).length();
    st.lastPos.copy(camera.position);
    const sp = dt > 0 ? Math.min(moved / dt, 10) : 0;
    st.speed += (sp - st.speed) * Math.min(1, dt * 8);
    st.bob += dt * (1.6 + st.speed * 1.55);
    const amp = Math.min(1, st.speed / 4) * (st.speed > 6 ? 1.7 : 1);

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
      st.scanT += dt;
      const t = st.scanT;
      const downT = RAISE + HOLD;
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

    // 分析时设备转向线索（相机空间方向，限制最大偏转角）
    st.aim += ((st.target ? 1 : 0) - st.aim) * Math.min(1, dt * 10);
    if (st.target && st.aim > 0.01) {
      vC.copy(st.target).applyMatrix4(camera.matrixWorldInverse);
      vC.sub(vB).normalize();
      const yaw = THREE.MathUtils.clamp(Math.atan2(-vC.x, -vC.z), -0.9, 0.6);
      const pitch = THREE.MathUtils.clamp(Math.asin(vC.y), -0.6, 0.4);
      qC.setFromEuler(eA.set(pitch, yaw, 0, 'YXZ'));
      qA.slerp(qC, st.aim);
      vB.lerp(POSE.scan.pos, st.aim * 0.35);
    }

    // 走路晃动（8 字形）+ 呼吸 + 视角滞后
    const breathe = Math.sin(performance.now() / 1000 * 1.5) * 0.002;
    vB.x += Math.cos(st.bob) * 0.012 * amp + sw.y * 0.2;
    vB.y += -Math.abs(Math.sin(st.bob)) * 0.014 * amp + breathe + sw.p * 0.2;
    holder.position.copy(vB);
    qB.setFromEuler(eA.set(sw.p * 0.7 + Math.sin(st.bob * 2) * 0.01 * amp, sw.y * 0.7, Math.cos(st.bob) * 0.02 * amp));
    holder.quaternion.copy(qA).multiply(qB);
    if (dbg.on) { holder.position.copy(dbg.pos); holder.quaternion.setFromEuler(dbg.rot); }

    // 发射头闪光
    device.flash = Math.max(0, device.flash - dt * 1.5);
    device.update(dt, st.target ? st.progress : -1, st.scanT >= 0);

    // 扇形扫光
    fan.visible = !!st.target && st.aim > 0.5 && rig.visible;
    if (fan.visible) {
      const tip = emitterWorld(vA);
      const dir = vC.copy(st.target).sub(tip);
      const len = dir.length();
      dir.normalize();
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir);
      const r = Math.min(1.0, 0.35 + len * 0.09);
      const sweep = Math.sin(performance.now() / 1000 * 5) * r * 0.8;
      const center = st.target.clone().addScaledVector(up, sweep);
      const p = fanGeo.attributes.position;
      p.setXYZ(0, tip.x, tip.y, tip.z);
      p.setXYZ(1, center.x - right.x * r, center.y - right.y * r, center.z - right.z * r);
      p.setXYZ(2, center.x + right.x * r, center.y + right.y * r, center.z + right.z * r);
      p.needsUpdate = true;
    }
  }

  return { update, scan, analyze, emitterWorld, get scanning() { return st.scanT >= 0; } };
}

// ---------- 设备模型 ----------
// 握把原点在手掌中心；设备前方为 -Z，上方为 +Y
function buildDevice() {
  const g = new THREE.Group();
  const emitter = new THREE.Object3D();
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), glowMat(0x52d8ff, 2));
  glow.rotation.y = Math.PI;
  glow.material.opacity = 0;
  emitter.add(glow);
  g.add(emitter);
  let ready = false;
  new GLTFLoader().load('/assets/scanner-arm.glb', (gltf) => {
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
    group: g, emitter, flash: 0,
    update(dt, progress) {
      glow.material.opacity = ready ? dev.flash + (progress >= 0 ? 0.35 : 0) : 0;
      glow.scale.setScalar(1 + dev.flash * 1.5);
    },
  };
  return dev;
}
