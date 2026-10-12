import * as THREE from 'three/webgpu';
import { mrt, float } from 'three/tsl';

const NO_MASK = mrt({ mask: float(0) }); // 玻璃和界面是加法发光，不遮挡背后的世界

// 底特律风格的透明玻璃平板：几乎看不见的玻璃 + 发光的界面内容
// 平板放在独立的 uiScene 里单独渲染，再在后期叠加到画面上：不会插进车身或墙里

const W = 0.48, H = 0.3;            // 平板尺寸（米），16:10
const CW = 1600, CH = 1000;         // 界面画布分辨率
const SHOWN = { pos: new THREE.Vector3(0, -0.012, -0.36), rot: new THREE.Euler(-0.06, 0, 0) };
const HIDDEN = { pos: new THREE.Vector3(0.22, -0.5, -0.32), rot: new THREE.Euler(-1.25, 0.25, 0.35) };
const C = { cyan: '#7fd6ff', dim: 'rgba(127,214,255,0.45)', faint: 'rgba(127,214,255,0.12)', gold: '#ffcf6a', white: '#eaf6ff' };
const TABS = ['线索', '事件', '结论'];

const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const easeIn = (x) => x * x * x;

export function createTablet(camera) {
  const uiScene = new THREE.Scene();
  const rig = new THREE.Group();        // 跟随相机
  const holder = new THREE.Group();     // 举起/收起动画 + 晃动
  rig.add(holder);
  uiScene.add(rig);

  // 玻璃：极淡的蓝色 + 发光细边
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x0e2a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  glassMat.color.multiplyScalar(0.6);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), glassMat);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fe4ff, transparent: true, blending: THREE.AdditiveBlending, depthTest: false });
  edgeMat.color.multiplyScalar(1.6);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, 0.006)), edgeMat);

  // 界面：透明底的画布，加法混合，黑色部分完全透明
  const cvs = document.createElement('canvas');
  cvs.width = CW; cvs.height = CH;
  const g = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  screenMat.color.setScalar(1.25);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  screen.position.z = 0.002;
  for (const m of [glassMat, edgeMat, screenMat]) m.mrtNode = NO_MASK;
  holder.add(glass, edge, screen);
  rig.visible = false;

  const imgs = new Map();
  const state = {
    open: false, k: 0,            // k：举起进度 0~1
    boot: 0,                      // 开机进度 0~1
    tab: 0, sel: 0,
    dirty: true, typeT: 0,
    data: { clues: [], events: [], conclusion: null },
  };
  const sway = { yaw: 0, pitch: 0, vx: 0, vy: 0 };
  let lastYaw = 0, lastPitch = 0;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

  function setData(d) { state.data = d; state.dirty = true; }
  function image(id) {
    if (!imgs.has(id)) {
      const im = new Image();
      im.onload = () => { state.dirty = true; };
      im.src = `/assets/gen/clue_${id}.jpg`;
      imgs.set(id, im);
    }
    return imgs.get(id);
  }

  // ---------- 界面绘制 ----------
  function text(t, x, y, size, color, weight = 400, align = 'left', mono = false) {
    g.font = `${weight} ${size}px ${mono ? '"SF Mono", Menlo, monospace' : '"PingFang SC", "Helvetica Neue", sans-serif'}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillText(t, x, y);
  }
  function wrap(str, maxW, size) {
    g.font = `400 ${size}px "PingFang SC", "Helvetica Neue", sans-serif`;
    const rows = [];
    let line = '';
    for (const ch of str) {
      if (line && g.measureText(line + ch).width > maxW) { rows.push(line); line = ''; }
      line += ch;
    }
    rows.push(line);
    return rows;
  }
  function corners(x, y, w, h, len, color, lw = 3) {
    g.strokeStyle = color; g.lineWidth = lw;
    g.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      g.moveTo(cx + dx * len, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * len);
    }
    g.stroke();
  }

  function draw() {
    const { clues, events, conclusion } = state.data;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(40,110,160,0.07)';
    g.fillRect(0, 0, CW, CH);
    corners(24, 24, CW - 48, CH - 48, 46, C.cyan, 4);

    // 顶栏
    text('CASE FILE · 案件档案', 70, 104, 26, C.dim, 400, 'left', true);
    text('湾岸线 B7 高架 · 车辆坠桥事故', 70, 150, 40, C.white, 500);
    const found = clues.filter((c) => c.done).length;
    text(`线索 ${found} / ${clues.length}`, CW - 70, 104, 26, C.dim, 400, 'right', true);
    text(conclusion ? '已结案' : '调查中', CW - 70, 150, 36, conclusion ? C.gold : C.cyan, 500, 'right');

    // 页签
    TABS.forEach((t, i) => {
      const x = 70 + i * 190;
      const on = i === state.tab;
      g.fillStyle = on ? 'rgba(127,214,255,0.22)' : 'rgba(127,214,255,0.05)';
      g.fillRect(x, 186, 170, 54);
      g.fillStyle = on ? C.cyan : C.faint;
      g.fillRect(x, 238, 170, 3);
      text(t, x + 85, 224, 28, on ? C.white : C.dim, on ? 500 : 400, 'center');
    });
    text('A / D 切换  ·  W / S 选择  ·  TAB 收起', CW - 70, 224, 22, C.dim, 400, 'right');
    g.fillStyle = C.faint;
    g.fillRect(70, 262, CW - 140, 2);

    if (state.tab === 0) drawClues(clues);
    else if (state.tab === 1) drawEvents(events);
    else drawConclusion(conclusion, events);
  }

  function drawClues(clues) {
    const top = 300, rowH = 66;
    clues.forEach((c, i) => {
      const y = top + i * rowH;
      const on = i === state.sel;
      if (on) {
        g.fillStyle = 'rgba(127,214,255,0.16)';
        g.fillRect(70, y, 470, rowH - 8);
        g.fillStyle = C.cyan;
        g.fillRect(70, y, 5, rowH - 8);
      }
      text(String(i + 1).padStart(2, '0'), 96, y + 42, 24, c.done ? C.dim : C.faint, 400, 'left', true);
      text(c.done ? c.name : '？？？', 150, y + 43, 30, c.done ? (on ? C.white : '#bfe4f7') : C.faint, on ? 500 : 400);
      if (c.done && c.key) text('◆', 520, y + 41, 20, C.gold, 400, 'right');
    });

    // 详情
    const c = clues[state.sel];
    const x = 590;
    g.fillStyle = C.faint;
    g.fillRect(x - 24, 300, 2, CH - 360);
    if (!c) return;
    if (!c.done) {
      text('未发现', x, 360, 40, C.dim, 500);
      text('该线索尚未分析。靠近可疑位置按住 E，或按 Q 扫描周围。', x, 420, 26, C.dim);
      return;
    }
    text(`证据 #${String(state.sel + 1).padStart(2, '0')}`, x, 336, 22, C.cyan, 400, 'left', true);
    text(c.name, x, 392, 46, C.white, 500);
    // 打字机效果：切换线索后逐行出现
    // 文字区宽度到证据图左侧为止，超出自动换行
    const maxW = CW - 70 - 380 - 40 - (x + 28);
    const shown = Math.floor(state.typeT * 6);
    let ly = 448;
    c.lines.forEach((l, i) => {
      const rows = wrap(l, maxW, 27);
      if (i < shown) {
        g.fillStyle = C.cyan;
        g.fillRect(x, ly - 9, 14, 3);
        rows.forEach((r, k) => text(r, x + 28, ly + k * 40, 27, '#d6effc'));
      }
      ly += rows.length * 40 + 14;
    });
    if (shown > c.lines.length) {
      const ry = ly + 16;
      g.fillStyle = 'rgba(255,207,106,0.35)';
      g.fillRect(x, ry - 34, 400, 2);
      text(c.result, x, ry + 12, 32, C.gold, 500);
      text('概率', x, ry + 66, 22, C.dim);
      g.fillStyle = 'rgba(255,207,106,0.2)';
      g.fillRect(x + 70, ry + 57, 260, 5);
      g.fillStyle = C.gold;
      g.fillRect(x + 70, ry + 57, 260 * c.prob * Math.min(1, (state.typeT * 6 - c.lines.length - 1) / 2), 5);
      text(`${Math.round(c.prob * 100)}%`, x + 350, ry + 66, 22, C.gold, 400, 'left', true);
    }
    // 证据图
    const im = image(c.id);
    const ix = CW - 70 - 380, iy = 300, is = 380;
    if (im.complete && im.naturalWidth) {
      g.globalAlpha = 0.9;
      g.drawImage(im, ix, iy, is, is);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let yy = iy; yy < iy + is; yy += 4) g.fillRect(ix, yy, is, 1);
    }
    corners(ix - 10, iy - 10, is + 20, is + 20, 26, C.cyan, 3);
    text(`影像记录 · EV-${String(state.sel + 1).padStart(2, '0')}`, ix, iy + is + 44, 20, C.dim, 400, 'left', true);
  }

  function drawEvents(events) {
    const rec = events.filter((e) => e.recorded);
    if (!rec.length) {
      text('尚无事件记录', 70, 360, 40, C.dim, 500);
      text('收集全部关键线索后按 R 进入事件重建，在时间轴上记录关键时刻。', 70, 420, 26, C.dim);
      return;
    }
    g.fillStyle = C.faint;
    g.fillRect(118, 320, 2, events.length * 110 - 40);
    events.forEach((e, i) => {
      const y = 330 + i * 110;
      g.beginPath();
      g.arc(119, y + 2, 10, 0, Math.PI * 2);
      g.fillStyle = e.recorded ? C.gold : 'rgba(255,207,106,0.15)';
      g.fill();
      text(e.recorded ? e.ts : '--:--.-', 160, y + 12, 26, e.recorded ? C.cyan : C.faint, 400, 'left', true);
      text(e.recorded ? e.label : '未记录', 330, y + 12, 32, e.recorded ? C.white : C.faint, 500);
      if (e.recorded) text(e.fact, 330, y + 56, 25, '#bfe4f7');
    });
  }

  function drawConclusion(con, events) {
    if (!con) {
      text('调查进行中', 70, 360, 40, C.dim, 500);
      text('完成事件重建后，这里会给出案件结论。', 70, 420, 26, C.dim);
      return;
    }
    text('结论', 70, 340, 26, C.dim, 400, 'left', true);
    text(con.verdict, 70, 420, 64, C.gold, 500);
    text(`概率 ${Math.round(con.prob * 100)}%`, 70, 480, 28, C.cyan, 400, 'left', true);
    // 自动换行
    g.font = '400 30px "PingFang SC", sans-serif';
    let line = '', y = 570;
    for (const ch of con.summary) {
      if (g.measureText(line + ch).width > CW - 160) { text(line, 70, y, 30, '#d6effc'); line = ''; y += 50; }
      line += ch;
    }
    text(line, 70, y, 30, '#d6effc');
  }

  // 开机效果：扫描线从上往下刷出内容，开头有闪烁
  function applyBoot() {
    const b = state.boot;
    if (b >= 1) return;
    const cut = CH * Math.min(1, Math.max(0, (b - 0.25) / 0.75));
    g.clearRect(0, cut, CW, CH - cut);
    if (b < 0.25) {
      g.clearRect(0, 0, CW, CH);
      if (Math.floor(b * 40) % 2 === 0) {
        corners(24, 24, CW - 48, CH - 48, 46, C.cyan, 4);
        text('NCPD · FORENSIC OS', CW / 2, CH / 2, 40, C.cyan, 400, 'center', true);
      }
      return;
    }
    g.fillStyle = C.cyan;
    g.fillRect(0, cut - 3, CW, 4);
    g.fillStyle = 'rgba(127,214,255,0.25)';
    g.fillRect(0, cut - 40, CW, 37);
  }

  // ---------- 输入 ----------
  function nav(code) {
    if (!state.open) return false;
    const n = state.data.clues.length;
    if (code === 'KeyA') { state.tab = (state.tab + TABS.length - 1) % TABS.length; state.typeT = 0; }
    else if (code === 'KeyD') { state.tab = (state.tab + 1) % TABS.length; state.typeT = 0; }
    else if (code === 'KeyW' && state.tab === 0) { state.sel = (state.sel + n - 1) % n; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 0) { state.sel = (state.sel + 1) % n; state.typeT = 0; }
    else return false;
    state.dirty = true;
    return true;
  }

  function toggle(on = !state.open) {
    state.open = on;
    if (on) { state.boot = 0; state.typeT = 0; state.dirty = true; }
  }

  // ---------- 每帧 ----------
  function update(dt) {
    const target = state.open ? 1 : 0;
    const speed = state.open ? 2.2 : 3.5;     // 举起约 0.45 秒，收起约 0.3 秒
    state.k = THREE.MathUtils.clamp(state.k + Math.sign(target - state.k) * dt * speed, 0, 1);
    rig.visible = state.k > 0;
    if (!rig.visible) return;

    // 跟随相机
    camera.updateMatrixWorld();
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);

    // 视角转动时平板稍微滞后（弹簧），加上呼吸起伏
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    let dy = e.y - lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const dp = e.x - lastPitch;
    lastYaw = e.y; lastPitch = e.x;
    sway.vx += (-dy * 1.2 - sway.yaw) * 60 * dt - sway.vx * 10 * dt;
    sway.vy += (-dp * 1.2 - sway.pitch) * 60 * dt - sway.vy * 10 * dt;
    sway.yaw += sway.vx * dt;
    sway.pitch += sway.vy * dt;
    sway.yaw = THREE.MathUtils.clamp(sway.yaw, -0.08, 0.08);
    sway.pitch = THREE.MathUtils.clamp(sway.pitch, -0.08, 0.08);

    const t = performance.now() / 1000;
    const x = state.open ? easeOutBack(state.k) : easeIn(state.k);
    holder.position.lerpVectors(HIDDEN.pos, SHOWN.pos, x);
    holder.position.x += sway.yaw * 0.25;
    holder.position.y += sway.pitch * 0.25 + Math.sin(t * 1.6) * 0.0025;
    qa.setFromEuler(HIDDEN.rot);
    qb.setFromEuler(new THREE.Euler(SHOWN.rot.x + sway.pitch * 0.6 + Math.sin(t * 1.1) * 0.006, sway.yaw * 0.6, Math.sin(t * 0.8) * 0.004));
    holder.quaternion.slerpQuaternions(qa, qb, Math.min(1, x));

    // 内容：举到位后开机，界面动画期间逐帧重绘
    if (state.open && state.k > 0.6) state.boot = Math.min(1, state.boot + dt * 1.8);
    const animating = state.open && (state.boot < 1 || state.typeT < 2);
    if (state.open && state.boot >= 1) state.typeT += dt;
    if (state.dirty || animating) {
      draw();
      applyBoot();
      tex.needsUpdate = true;
      state.dirty = false;
    }
    const a = state.open ? 1 : state.k;
    screenMat.opacity = a;
    edgeMat.opacity = a;
    glassMat.opacity = a;
  }

  return {
    uiScene,
    update,
    toggle,
    nav,
    setData,
    get open() { return state.open; },
    get amount() { return state.k; },   // 用于背景压暗与虚化
  };
}
