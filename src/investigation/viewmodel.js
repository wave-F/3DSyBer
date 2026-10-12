import * as THREE from 'three/webgpu';
import { mrt, float, uv, color, smoothstep, sin, mx_noise_float, positionLocal } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uiTime } from './clock.js';

// 第一人称右手 + 手持法医扫描仪
// 手：人偶（CC0）的右前臂和手，用手枪握持动作的第一帧摆出握姿，其余身体部分裁掉
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
  // 待机：随手垂握，枪口朝下、略向内侧、手腕外翻，不像端枪
  idle: { pos: new THREE.Vector3(0.21, -0.215, -0.42), rot: new THREE.Euler(-0.36, 0.38, 0.4) },
  scan: { pos: new THREE.Vector3(0.11, -0.13, -0.46), rot: new THREE.Euler(0.1, 0.03, 0) },
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
  loadHand(holder);

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

  // 开始扫描动作：举起 → 0.25 秒时发射（回调中触发扫描波）→ 放下
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

    // 扫描动作曲线（共 2 秒）：0~0.5 举起，0.5 发射，0.5~1.2 保持，1.2~2.0 放下
    let scanW = 0;
    if (st.scanT >= 0) {
      st.scanT += dt;
      const t = st.scanT;
      scanW = t < 0.5 ? THREE.MathUtils.smootherstep(t / 0.5, 0, 1) : t < 1.2 ? 1 : 1 - THREE.MathUtils.smootherstep((t - 1.2) / 0.8, 0, 1);
      if (t >= 0.5 && st.onFire) { const f = st.onFire; st.onFire = null; f(emitterWorld(new THREE.Vector3())); device.flash = 1; }
      if (t >= 2.0) st.scanT = -1;
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

    // 发射头闪光、侧屏
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
  const body = new THREE.MeshStandardMaterial({ color: 0x1b1f25, roughness: 0.35, metalness: 0.8 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.3, metalness: 0.4 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.85, metalness: 0 });

  // 主体（枪管式），握把在下方
  const main = new THREE.Mesh(new RoundedBoxGeometry(0.044, 0.05, 0.19, 3, 0.012), body);
  main.position.set(0, 0.058, -0.06);
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.016, 0.13, 3, 0.006), shell);
  top.position.set(0, 0.088, -0.04);
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.1, 0.042, 3, 0.012), rubber);
  grip.position.set(0, 0.0, -0.005);
  grip.rotation.x = 0.28;
  // 前端发射头：金属环 + 镜头
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.035, 24), shell);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.058, -0.165);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x52d8ff, emissiveIntensity: 1.5, roughness: 0.1 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 24), lensMat);
  lens.position.set(0, 0.058, -0.1835);
  lens.rotation.y = Math.PI;
  const emitter = new THREE.Object3D();
  emitter.position.set(0, 0.058, -0.19);
  // 侧面灯带
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x52d8ff, emissiveIntensity: 2.5 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.004, 0.12), stripMat);
  strip.position.set(-0.0225, 0.065, -0.06);
  const strip2 = strip.clone();
  strip2.position.x = 0.0225;

  // 尾部朝向玩家的小屏
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 160;
  const ctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const scrMat = new THREE.MeshBasicMaterial({ map: tex });
  scrMat.color.setScalar(1.4);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.025), scrMat);
  scr.position.set(0, 0.075, 0.037);
  scr.rotation.x = -0.5;
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.032, 0.012, 2, 0.004), body);
  bezel.position.set(0, 0.073, 0.032);
  bezel.rotation.x = -0.5;

  // 发射头光晕（扫描时闪一下）
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), glowMat(0x52d8ff, 2));
  glow.position.copy(emitter.position);
  glow.rotation.y = Math.PI;

  g.add(main, top, grip, head, lens, strip, strip2, bezel, scr, glow, emitter);

  let lastDraw = 0, lastKey = '';
  const dev = {
    group: g, emitter, flash: 0,
    update(dt, progress, scanning) {
      lensMat.emissiveIntensity = 1.5 + dev.flash * 12 + (progress >= 0 ? 2 + Math.sin(performance.now() / 60) : 0);
      glow.material.opacity = dev.flash + (progress >= 0 ? 0.35 : 0);
      glow.scale.setScalar(1 + dev.flash * 1.5);
      // 侧屏最多 15fps 重绘
      const now = performance.now();
      const key = `${progress >= 0 ? Math.round(progress * 40) : -1}_${scanning}`;
      if (key === lastKey && now - lastDraw < 500) return;
      if (now - lastDraw < 66) return;
      lastKey = key; lastDraw = now;
      ctx.fillStyle = '#03080c';
      ctx.fillRect(0, 0, 256, 160);
      ctx.strokeStyle = 'rgba(82,216,255,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, 244, 148);
      ctx.fillStyle = '#52d8ff';
      ctx.font = '600 26px "SF Mono", Menlo, monospace';
      ctx.textBaseline = 'middle';
      if (progress >= 0) {
        ctx.beginPath();
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(255,207,106,0.25)';
        ctx.arc(64, 80, 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#ffcf6a';
        ctx.arc(64, 80, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
        ctx.fillStyle = '#ffcf6a';
        ctx.fillText('ANALYZE', 122, 62);
        ctx.fillText(`${Math.round(progress * 100)}%`, 122, 102);
      } else if (scanning) {
        ctx.fillText('SCANNING', 30, 62);
        ctx.fillRect(30, 96, 196 * ((now / 400) % 1), 10);
      } else {
        ctx.fillText('NCPD FX-7', 30, 56);
        ctx.fillStyle = 'rgba(82,216,255,0.6)';
        ctx.font = '400 20px "SF Mono", Menlo, monospace';
        ctx.fillText('READY', 30, 100);
        for (let i = 0; i < 14; i++) ctx.fillRect(130 + i * 8, 110 - (Math.sin(now / 300 + i) * 0.5 + 0.5) * 30, 5, 3);
      }
      tex.needsUpdate = true;
    },
  };
  return dev;
}

// ---------- 手 ----------
// 人偶（CC0）的右手，用手枪握持动作的第一帧摆出握姿；只保留手掌和手指，换成黑色皮手套材质
// 前臂不用人偶的，改为代码生成的风衣袖子 + 手套袖口
function loadHand(holder) {
  new GLTFLoader().load('/assets/mannequin.glb', (gltf) => {
    const model = gltf.scene;
    const clip = gltf.animations.find((c) => c.name === 'Pistol_Idle_Loop');
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixer.update(0);
    model.updateMatrixWorld(true);

    const keep = /^DEF-(hand|f_|thumb).*R$/;
    const glove = gloveMaterial();
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const bones = o.skeleton.bones;
      const idx = o.geometry.index.array;
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const ok = new Uint8Array(si.count);
      for (let i = 0; i < si.count; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        ok[i] = keep.test(bones[best].name) ? 1 : 0;
      }
      const tris = [];
      for (let i = 0; i < idx.length; i += 3) if (ok[idx[i]] && ok[idx[i + 1]] && ok[idx[i + 2]]) tris.push(idx[i], idx[i + 1], idx[i + 2]);
      o.geometry.setIndex(tris);
      o.material = glove;
      o.frustumCulled = false;
    });

    // 人偶面朝 +Z，转 180° 让手指向相机前方（-Z）；手腕放到握把后下方
    const wrap = new THREE.Group();
    wrap.rotation.y = Math.PI;
    wrap.add(model);
    holder.add(wrap);
    wrap.updateMatrixWorld(true);
    const handBone = model.getObjectByName('DEF-handR');
    const wrist = holder.worldToLocal(handBone.getWorldPosition(new THREE.Vector3()));
    const elbow = holder.worldToLocal(model.getObjectByName('DEF-forearmR').getWorldPosition(new THREE.Vector3()));
    const shift = new THREE.Vector3(0.004, -0.035, 0.045).sub(wrist);
    wrap.position.add(shift);
    wrist.add(shift);
    elbow.add(shift);

    // 袖子沿前臂方向：从手腕往肘部延伸并伸出画面
    const axis = elbow.clone().sub(wrist).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    // 袖口用哑光皮革，避免清漆在大曲面上反光成金属感
    const cuff = new THREE.Mesh(gloveCuffGeometry(), new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
    cuff.position.copy(wrist).addScaledVector(axis, 0.01);
    cuff.quaternion.copy(q);
    const sleeve = new THREE.Mesh(sleeveGeometry(), sleeveMaterial());
    sleeve.position.copy(wrist).addScaledVector(axis, 0.055);
    sleeve.quaternion.copy(q);
    holder.add(cuff, sleeve);

    // 手背上一枚很小的指示灯
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.003, 0.004), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x52d8ff, emissiveIntensity: 2 }));
    led.position.set(0, 0.045, 0.024);
    handBone.add(led);
  });
}

// 黑色皮手套：低饱和深色、细密皮纹（粗糙度噪声）、清漆层带出湿润的霓虹高光
function gloveMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x121214, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0x30343a), sheenRoughness: 0.6 });
  const grain = mx_noise_float(positionLocal.mul(900)).mul(0.5).add(0.5);
  m.roughnessNode = grain.mul(0.25).add(0.42);
  return m;
}

// 深色风衣面料：哑光、带一点绒面光泽
function sleeveMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.95, metalness: 0, sheen: 0.35, sheenColor: new THREE.Color(0x2a2e34), sheenRoughness: 0.8, side: THREE.DoubleSide });
}

// 袖子：沿 +Y 延伸的锥形筒，袖口外翻一圈，表面有随机褶皱
function sleeveGeometry() {
  const L = 0.42;
  const geo = new THREE.CylinderGeometry(0.052, 0.066, L, 28, 24, true);
  geo.translate(0, L / 2, 0);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const y = v.y;
    let k = 1 + Math.sin(a * 3 + y * 28) * 0.05 * Math.min(1, y / 0.08) + Math.sin(a * 7 - y * 40) * 0.025;
    k += Math.exp(-((y - 0.06) ** 2) / 0.0008) * 0.06;
    if (y < 0.012) k += 0.06;
    v.x *= k; v.z *= k;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const inner = geo.clone();
  inner.scale(0.96, 1, 0.96);
  const idx = inner.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  inner.computeVertexNormals();
  return mergeGeometries([geo, inner]);
}

// 手套袖口：贴着手腕的短筒，比袖子细
function gloveCuffGeometry() {
  const geo = new THREE.CylinderGeometry(0.036, 0.043, 0.075, 24, 1, true);
  geo.translate(0, 0.0375, 0);
  return geo;
}
