import * as THREE from 'three/webgpu';
import { DECK_Y } from '../bridge.js';
import { CAR_POS, CAR_YAW } from '../crash.js';
import { hologramize } from './hologram.js';
import { createActor } from './actors.js';
import { markKeep } from './mask.js';
import { addTireTracks } from '../tireTracks.js';
import { ROUNDS } from './clues.js';
import { uniform, vec3, float, uv, texture, attribute, abs, fract, step, smoothstep } from 'three/tsl';

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
// 死者车辆：接触前已开始转向（远离黄车）→ 侧面碰撞 → 打滑 → 撞断护栏
// 1.0~1.4 s 车头先偏、位置几乎不变，黑梦 2 的「A 车前轮」分析点（t = 1.15）看的就是这一段
const TRACK_A = new Track([
  { t: 0, x: -1.6, z: -62, yaw: STRAIGHT },
  { t: 1.0, x: -1.6, z: -31, yaw: STRAIGHT },
  { t: 1.15, x: -1.52, z: -27.3, yaw: -1.47 },
  { t: 1.4, x: -1.35, z: -21, yaw: -1.42 },
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
// 乘员甩出（惯性）：LURCH_T 车开始急减速，人没系安全带，保持此刻的车速继续前冲（车在身下减速，人相对车往前滑）
// 撞上仪表台 / 挡风玻璃（HIT0~HIT1）：水平速度损失到 KEEP，同时被向上弹起，腿被仪表台绊住 → 开始向前翻滚
// 之后是自由抛体 + 翻滚，四肢被离心力甩开、拖在翻滚方向后面
// 轨迹在加载时按固定步长积分成表，回放按 t 查表：拖动、倒放结果一致
const LURCH_T = 2.5;
const HIT0 = 0.08, HIT1 = 0.16;   // 相对 LURCH_T 的撞击窗口（秒）
const KEEP = 0.65;                // 穿出车体后保留的水平速度比例
const POP_VY = 4.0;               // 撞击窗口内获得的向上速度（m/s）
const POP_OUT = 2.5;              // 被 A 柱 / 车门框向外（+X，护栏缺口一侧）弹开的速度（m/s）
const GRAVITY = 9.8;
const PITCH_W = 6.0;              // 向前翻滚角速度（rad/s，约 1 圈/秒）
const ROLL_W = 2.2;               // 绕前进方向的侧滚（驾驶员从左侧带出）
const YAW_W = -0.9;               // 绕竖直轴的慢转
const SIM_DT = 1 / 600, SIM_LEN = 3.0;
const FALL_HIDE_Y = DECK_Y - 12;  // 髋部掉到桥面下这么深后隐藏
const B_GONE_T = 4.0;
// 零号保障：画成黄车占用的「保障通道」，而不是罩在车上的光环
// P0 是道路协同里的一条优先级数据，它的作用是清出路权，所以只画路面：
// 沿黄车路线向前铺一段车道宽的保留区（虚线边、极淡的填充、远端渐隐），加一行贴地的路面标字
// 颜色是冷灰白，亮度压在车辆全息体之下；虚线按路线里程固定在路面上，车往前开时像在一路征用前方路面
const P0_HALF = 1.5;              // 通道半宽（米），约一条车道
const P0_BACK = 2.6;              // 从车尾往后多铺的长度（米）
const P0_AHEAD = 18;              // 车头前方保留的长度（米）
const P0_SEG = 48;                // 通道沿路线的分段数
const P0_DASH = 1.2;              // 边线虚线周期（米）
const P0_Y = 0.05;                // 离桥面高度，避免与路面打架
const P0_TEXT_AHEAD = 5.5;        // 路面标字在车辆中心前方多远（米）
const P0_WRITE = 0.3;             // 黑梦 4 写入时通道从车尾铺到远端的时长（秒）

// 按里程查路线：把轨迹按固定时间步密集采样成「累计里程 → 位置」表，超出两端时沿端点切线外推
function buildArcTable(track, t1) {
  const N = Math.ceil(t1 / 0.002);
  const xs = new Float32Array(N + 1), zs = new Float32Array(N + 1), ds = new Float32Array(N + 1);
  const ts = new Float32Array(N + 1);
  const s = { p: new THREE.Vector3(), yaw: 0 };
  let d = 0;
  for (let i = 0; i <= N; i++) {
    const t = (t1 * i) / N;
    track.sample(t, s);
    if (i > 0) d += Math.hypot(s.p.x - xs[i - 1], s.p.z - zs[i - 1]);
    xs[i] = s.p.x; zs[i] = s.p.z; ds[i] = d; ts[i] = t;
  }
  // 端点切线（取一段距离外的点，避免轨迹两端速度为零时方向不稳）
  const dirAt = (i, j) => {
    const dx = xs[j] - xs[i], dz = zs[j] - zs[i];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const head = dirAt(0, Math.min(N, 20));
  const tail = dirAt(Math.max(0, N - 20), N);
  const total = d;
  // 里程 → 下标（二分）
  const find = (dist) => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ds[m] <= dist) lo = m; else hi = m; }
    return lo;
  };
  return {
    // 时间 → 里程
    distAt(t) {
      const f = THREE.MathUtils.clamp((t / t1) * N, 0, N);
      const i = Math.min(N - 1, Math.floor(f)), u = f - i;
      return ds[i] + (ds[i + 1] - ds[i]) * u;
    },
    // 里程 → 位置与切线方向（写入 out: {x, z, dx, dz}）
    at(dist, out) {
      if (dist <= 0) {
        out.dx = head[0]; out.dz = head[1];
        out.x = xs[0] + head[0] * dist; out.z = zs[0] + head[1] * dist;
        return out;
      }
      if (dist >= total) {
        out.dx = tail[0]; out.dz = tail[1];
        out.x = xs[N] + tail[0] * (dist - total); out.z = zs[N] + tail[1] * (dist - total);
        return out;
      }
      const i = find(dist);
      const seg = ds[i + 1] - ds[i];
      const u = seg > 1e-6 ? (dist - ds[i]) / seg : 0;
      out.x = xs[i] + (xs[i + 1] - xs[i]) * u;
      out.z = zs[i] + (zs[i + 1] - zs[i]) * u;
      // 切线取前后各约 1 m 的弦，平滑一些
      const a = find(Math.max(0, dist - 1)), b = Math.min(N, find(Math.min(total, dist + 1)) + 1);
      const dx = xs[b] - xs[a], dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dz);
      if (l > 1e-6) { out.dx = dx / l; out.dz = dz / l; }
      return out;
    },
  };
}

function buildP0(arc) {
  const group = new THREE.Group();
  group.visible = false;
  const glow = uniform(1);    // 整体亮度
  const reveal = uniform(1);  // 通道从车尾铺到远端的进度（0~1），黑梦 4 写入时用
  const textK = uniform(1);   // 路面标字亮度
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false };
  const TINT = vec3(0.74, 0.82, 0.9);

  // 通道：一条沿路线的三角带，每帧按当前车位重算顶点
  const verts = (P0_SEG + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const dist = new Float32Array(verts);    // 路线里程（米），给虚线用，固定在路面上
  const along = new Float32Array(verts);   // 0 车尾 → 1 远端
  const uvs = new Float32Array(verts * 2); // x：0 左边线 → 1 右边线
  const index = [];
  for (let i = 0; i <= P0_SEG; i++) {
    const f = i / P0_SEG;
    along[i * 2] = f; along[i * 2 + 1] = f;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = f;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = f;
    if (i < P0_SEG) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const distAttr = new THREE.BufferAttribute(dist, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('p0dist', distAttr);
  geo.setAttribute('p0along', new THREE.BufferAttribute(along, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);

  const laneMat = markKeep(new THREE.MeshBasicNodeMaterial(add));
  {
    const f = attribute('p0along', 'float');
    const d = attribute('p0dist', 'float');
    const across = abs(uv().x.mul(2).sub(1));                  // 0 中线 → 1 边线
    const edge = smoothstep(0.955, 0.985, across);              // 边线约 5 cm
    const dash = step(0.45, fract(d.div(P0_DASH)));             // 虚线，固定在路面里程上
    const fill = float(0.035).add(across.pow(6).mul(0.04));     // 极淡的填充，靠边略亮
    const ends = smoothstep(0, 0.05, f).mul(float(1).sub(smoothstep(0.55, 1, f)));
    const shown = step(f, reveal);                               // 写入时只显示已铺到的部分
    const front = float(1).sub(smoothstep(0, 0.06, abs(f.sub(reveal)))).mul(float(1).sub(step(0.999, reveal))).mul(0.5); // 正在铺的前沿
    laneMat.colorNode = TINT.mul(edge.mul(dash).mul(0.5).add(fill).add(front)).mul(ends).mul(shown).mul(glow);
  }
  const lane = new THREE.Mesh(geo, laneMat);
  lane.frustumCulled = false;

  // 路面标字：像路面标线一样平铺在通道里，字头朝行驶方向（从车后方看是正的）
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 92px "SF Mono", Menlo, monospace';
  g.fillText('P0', 256, 62);
  g.font = '500 38px "PingFang SC", sans-serif';
  g.fillText('零号保障 · 让行区', 256, 150);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const textMat = markKeep(new THREE.MeshBasicNodeMaterial(add));
  textMat.colorNode = TINT.mul(texture(map).a).mul(textK).mul(glow).mul(0.45);
  const text = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.825), textMat);
  text.rotation.x = -Math.PI / 2; // 平放后，贴图的「上」朝向本地 -Z
  const textHolder = new THREE.Group();
  textHolder.add(text);
  textHolder.position.y = DECK_Y + P0_Y + 0.005;

  group.add(lane, textHolder);
  const pt = { x: 0, z: 0, dx: 0, dz: 1 };
  return {
    group,
    // t：回放时间（黄车所在位置）；k：亮度倍数；r：铺开进度；tk：标字亮度
    set(t, k, r, tk) {
      const d0 = arc.distAt(t);
      const a = d0 - P0_BACK, b = d0 + P0_AHEAD;
      for (let i = 0; i <= P0_SEG; i++) {
        const dd = a + ((b - a) * i) / P0_SEG;
        arc.at(dd, pt);
        // 左法线（行驶方向的左侧）：(dz, -dx)
        const nx = pt.dz * P0_HALF, nz = -pt.dx * P0_HALF;
        const j = i * 6;
        pos[j] = pt.x + nx; pos[j + 1] = DECK_Y + P0_Y; pos[j + 2] = pt.z + nz;
        pos[j + 3] = pt.x - nx; pos[j + 4] = DECK_Y + P0_Y; pos[j + 5] = pt.z - nz;
        dist[i * 2] = dd; dist[i * 2 + 1] = dd;
      }
      posAttr.needsUpdate = true;
      distAttr.needsUpdate = true;
      arc.at(d0 + P0_TEXT_AHEAD, pt);
      textHolder.position.x = pt.x;
      textHolder.position.z = pt.z;
      // 让本地 -Z 对准行驶方向：(−sinθ, −cosθ) = (dx, dz)
      textHolder.rotation.y = Math.atan2(-pt.dx, -pt.dz);
      glow.value = k;
      reveal.value = r;
      textK.value = tk;
    },
  };
}

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
  const qSeat = new THREE.Quaternion();
  const qBody0 = new THREE.Quaternion();  // LURCH_T 时的身体朝向（之后不再跟随车转）
  const qTmp = new THREE.Quaternion();
  const hip = new THREE.Vector3();
  const vTmp = new THREE.Vector3();
  const seatWorld = new THREE.Vector3();
  const fwd = new THREE.Vector3();        // 甩出时水平前进方向
  const pitchAxis = new THREE.Vector3();
  const dTmp = new THREE.Vector3();

  createActor(BLUE, [
    { t0: 0, t1: 99, clip: 'Driving_Loop', mode: 'loop' },
  ]).then((v) => {
    victim = v;
    root.add(victim.root);
    victim.root.visible = false;
    // 坐姿髋部高度，用来把人偶放进驾驶座
    seatHipLocal = victim.measure('Driving_Loop', 0, 'DEF-hips');
  });

  // 座位（髋部）世界坐标：按轨迹直接算，不依赖车辆模型
  function seatAt(t, out) {
    TRACK_A.sample(t, s);
    out.copy(SEAT_HIP).applyAxisAngle(UP, s.yaw);
    out.x += s.p.x; out.y += DECK_Y; out.z += s.p.z;
    return s.yaw;
  }

  // 髋部轨迹表：从 LURCH_T 起积分
  const simN = Math.ceil(SIM_LEN / SIM_DT) + 1;
  const simPos = new Float32Array(simN * 3);
  {
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    const yaw0 = seatAt(LURCH_T, p);
    qBody0.setFromAxisAngle(UP, yaw0 + Math.PI / 2);
    // 初速度 = 此刻车速（水平）
    TRACK_A.sample(LURCH_T - 0.005, s); a.copy(s.p);
    TRACK_A.sample(LURCH_T + 0.005, s); b.copy(s.p);
    const vel = b.sub(a).divideScalar(0.01);
    vel.y = 0;
    fwd.copy(vel).normalize();
    pitchAxis.crossVectors(UP, fwd).normalize(); // 绕它正转：头向前下方翻
    const hitLen = HIT1 - HIT0;
    const keepStep = Math.pow(KEEP, SIM_DT / hitLen);
    for (let i = 0; i < simN; i++) {
      simPos[i * 3] = p.x; simPos[i * 3 + 1] = p.y; simPos[i * 3 + 2] = p.z;
      const tau = i * SIM_DT;
      if (tau >= HIT0 && tau < HIT1) {
        vel.x *= keepStep; vel.z *= keepStep;
        vel.y += POP_VY * SIM_DT / hitLen;
        vel.x += POP_OUT * SIM_DT / hitLen;
      }
      if (tau >= HIT0) vel.y -= GRAVITY * SIM_DT; // 撞击前人还在座位上，被座椅托住
      p.addScaledVector(vel, SIM_DT);
    }
  }
  function simHip(tau, out) {
    const f = THREE.MathUtils.clamp(tau / SIM_DT, 0, simN - 1.001);
    const i = Math.floor(f), u = f - i, j = i * 3;
    out.set(
      simPos[j] + (simPos[j + 3] - simPos[j]) * u,
      simPos[j + 1] + (simPos[j + 4] - simPos[j + 1]) * u,
      simPos[j + 2] + (simPos[j + 5] - simPos[j + 2]) * u,
    );
    return out;
  }
  // 角速度在撞击窗口内从 0 线性升到 w，返回累计角度
  function spinAngle(tau, w) {
    if (tau <= HIT0) return 0;
    const L = HIT1 - HIT0;
    if (tau < HIT1) return w * (tau - HIT0) ** 2 / (2 * L);
    return w * (L / 2 + tau - HIT1);
  }

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
  // 第二段黑梦才有黄车，胎痕跟着这条路线铺在回放里，探索时不显示
  const bSkids = addTireTracks(root, TRACK_B.curve, { offsets: [-0.85, 0.85], width: 0.265, seed: 811, opacity: 0.75, keep: true });

  // 零号保障：黄车前方的保障通道 + 路面标字，跟着黄车走（见 buildP0）
  // actors.p0 为出现时刻：黑梦 3 为 0（看起来一直都有），黑梦 4 在两车接近时被写入，通道从车尾一路铺到前方
  const p0 = buildP0(buildArcTable(TRACK_B, B_GONE_T));
  root.add(p0.group);

  let actors = { carB: true };
  function setRound(n) {
    const r = ROUNDS[n];
    actors = r.actors;
    pathB.visible = actors.carB;
    bSkids.forEach((m) => { m.visible = !!actors.carB; });
    p0.group.visible = false;
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
    const appear = actors.p0;
    p0.group.visible = appear != null && carB.visible && t >= appear;
    if (p0.group.visible) {
      // 写入：不闪不爆，通道在 P0_WRITE 秒内从车尾铺到远端，边线短暂提亮后回落；标字在通道铺过它之后淡入
      const k = appear > 0 ? t - appear : Infinity;
      const r = Math.min(1, k / P0_WRITE);
      const lift = 1 + 0.6 * Math.exp(-k * 5);
      const textAt = (P0_BACK + P0_TEXT_AHEAD) / (P0_BACK + P0_AHEAD);
      const tk = THREE.MathUtils.clamp((k - textAt * P0_WRITE) / 0.15, 0, 1);
      p0.set(t, lift, r, tk);
    }

    if (victim) updateVictim(t);
  }

  // 遇难者：撞击前坐在驾驶座（随车移动）；车急减速后按惯性前冲，撞穿前挡后翻滚着越过护栏缺口坠落桥下，然后隐藏
  function updateVictim(t) {
    const R = victim.root;
    if (t < LURCH_T) {
      const yaw = seatAt(t, seatWorld);
      qSeat.setFromAxisAngle(UP, yaw + Math.PI / 2); // 人偶面朝 +Z，车头为组内 +X
      R.visible = true;
      R.quaternion.copy(qSeat);
      vTmp.copy(seatHipLocal).applyQuaternion(qSeat);
      R.position.copy(seatWorld).sub(vTmp);
      victim.pose(t);
      return;
    }
    const tau = t - LURCH_T;
    simHip(tau, hip);
    // 翻滚：绕水平轴向前翻 + 绕前进方向侧滚 + 绕竖直轴慢转（都在撞击窗口内起转）
    R.quaternion.copy(qBody0);
    qTmp.setFromAxisAngle(UP, spinAngle(tau, YAW_W)); R.quaternion.premultiply(qTmp);
    qTmp.setFromAxisAngle(fwd, spinAngle(tau, ROLL_W)); R.quaternion.premultiply(qTmp);
    qTmp.setFromAxisAngle(pitchAxis, spinAngle(tau, PITCH_W)); R.quaternion.premultiply(qTmp);
    vTmp.copy(seatHipLocal).applyQuaternion(R.quaternion);
    R.position.copy(hip).sub(vTmp);
    R.visible = hip.y > FALL_HIDE_Y;
    victim.pose(LURCH_T); // 底子停在坐姿，四肢由下面的程序化姿势接管
    flail(tau);
  }

  // 四肢程序化姿势（根节点本地方向：+Z 正面，+Y 上，+X 人偶左侧）
  // 撞击瞬间：上身前扑、手臂向前甩出；翻滚中：四肢被甩开并拖在翻滚方向后面（手臂过头偏后，腿伸直偏前），带衰减的乱摆
  const LIMBS = [
    // bone, 撞击瞬间方向, 翻滚中方向, 摆动相位
    ['DEF-spine003', [0, 0.65, 0.75], [0.1, 0.95, 0.3], 0.0],
    ['DEF-head', [0, 0.45, 0.9], [0.15, 0.9, -0.35], 1.3],
    ['DEF-upper_armL', [0.35, 0.3, 0.9], [0.85, 0.45, -0.15], 0.4],
    ['DEF-forearmL', [0.3, 0.45, 0.85], [0.6, 0.75, 0.3], 1.1],
    ['DEF-upper_armR', [-0.3, 0.2, 0.95], [-0.7, 0.65, 0.2], 2.2],
    ['DEF-forearmR', [-0.2, 0.5, 0.85], [-0.4, 0.3, 0.85], 2.9],
    ['DEF-thighL', [0.15, -0.15, 1], [0.35, -0.45, 0.8], 3.4],
    ['DEF-shinL', [0.15, -0.9, 0.3], [0.2, -0.95, 0.1], 4.0],
    ['DEF-thighR', [-0.1, -0.05, 1], [-0.15, -0.8, 0.5], 4.7],
    ['DEF-shinR', [-0.1, -0.85, 0.4], [-0.1, -0.6, -0.75], 5.5],
  ].map(([bone, a, b, ph]) => [bone, new THREE.Vector3(...a).normalize(), new THREE.Vector3(...b).normalize(), ph]);
  function flail(tau) {
    const w = THREE.MathUtils.smoothstep(tau, HIT0 - 0.03, HIT0 + 0.05);
    if (w <= 0) return;
    const k = THREE.MathUtils.smoothstep(tau, HIT1, HIT1 + 0.35);
    const after = Math.max(0, tau - HIT1);
    const amp = (0.4 * Math.exp(-after / 0.7) + 0.12) * k;
    for (const [bone, a, b, ph] of LIMBS) {
      dTmp.lerpVectors(a, b, k);
      dTmp.x += amp * Math.sin(after * 7.3 + ph);
      dTmp.y += amp * 0.6 * Math.sin(after * 5.1 + ph * 1.7);
      dTmp.z += amp * Math.sin(after * 8.9 + ph * 2.3);
      victim.aim(bone, dTmp, w);
    }
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

  // A 车在回放开头（t = 0）的位置，进入黑梦时镜头转向这里。不依赖模型是否加载完
  function startPos(out) {
    TRACK_A.sample(0, s);
    return out.set(s.p.x, DECK_Y + CENTER_Y.carA, s.p.z);
  }

  return {
    root,
    setTime,
    setRound,
    targetPos,
    startPos,
    get ready() { return ready; },
  };
}
