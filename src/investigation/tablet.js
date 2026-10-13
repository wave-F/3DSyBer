import * as THREE from 'three/webgpu';
import { sound } from '../audio/sound.js';
import { mrt, float, uv, vec2, vec3, color, smoothstep, sin, fract, texture, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { uiTime } from './clock.js';

const NO_MASK = mrt({ mask: float(0) }); // 玻璃和界面是加法发光，不遮挡背后的世界

// 实体平板：金属机身 + 黑色玻璃边框，中间是透明屏幕，界面以全息形式显示在玻璃上
// 平板放在独立的 uiScene 里单独渲染，再在后期叠加到画面上：不会插进车身或墙里

const W = 0.48, H = 0.3;            // 屏幕（可显示区域）尺寸（米），16:10
const BEZEL = 0.012;                // 黑色玻璃边框宽度
const RIM = 0.0045;                 // 金属边框正面宽度
const DEPTH = 0.0075;               // 机身厚度
const CW = 1600, CH = 1000;         // 界面画布分辨率
const SHOWN = { pos: new THREE.Vector3(0, -0.012, -0.375), rot: new THREE.Euler(-0.06, 0, 0) };
const HIDDEN = { pos: new THREE.Vector3(0.22, -0.5, -0.32), rot: new THREE.Euler(-1.25, 0.25, 0.35) };
const C = { cyan: '#7fd6ff', dim: 'rgba(127,214,255,0.45)', faint: 'rgba(127,214,255,0.12)', gold: '#ffcf6a', white: '#eaf6ff', red: '#ff4a3a' };
const SANS = '"PingFang SC", "Helvetica Neue", sans-serif';
const TABS = ['线索', '事件', '报告'];

const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const easeIn = (x) => x * x * x;

// 圆角矩形路径（shape 为 THREE.Shape 或 THREE.Path）
function roundRect(shape, w, h, r) {
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}
// 圆角矩形环（外框减去内框）
function ringShape(ow, oh, or, iw, ih, ir) {
  const s = roundRect(new THREE.Shape(), ow, oh, or);
  s.holes.push(roundRect(new THREE.Path(), iw, ih, ir));
  return s;
}

// 机身：正面与屏幕玻璃齐平（z = 0.0025），厚度向后
function buildBody() {
  const group = new THREE.Group();
  const iw = W + BEZEL * 2, ih = H + BEZEL * 2;      // 黑色边框外沿
  const ow = iw + RIM * 2, oh = ih + RIM * 2;        // 机身外沿
  const front = 0.0025;

  // 金属边框：深空灰阳极氧化铝，倒角边缘会映出环境光
  const metal = new THREE.MeshPhysicalMaterial({ color: 0x555c66, metalness: 0.9, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.25 });
  const bevel = 0.0016;
  const rimGeo = new THREE.ExtrudeGeometry(ringShape(ow - bevel * 2, oh - bevel * 2, 0.024, iw - 0.002, ih - 0.002, 0.016), {
    depth: DEPTH - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 14,
  });
  rimGeo.translate(0, 0, front - DEPTH + bevel);
  group.add(new THREE.Mesh(rimGeo, metal));

  // 黑色玻璃边框（屏幕外圈），略低于金属边框
  const blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x030405, metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(ringShape(iw, ih, 0.016, W, H, 0.004), 14), blackGlass);
  bezel.position.z = front - 0.0004;
  group.add(bezel);

  // 前置摄像头：上边框中间
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0021, 24), new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, roughness: 0.05, clearcoat: 1 }));
  lens.position.set(0, ih / 2 - BEZEL / 2, front - 0.0002);
  const glint = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 16), new THREE.MeshBasicMaterial({ color: 0x1a2c4a }));
  glint.position.set(0.0005, ih / 2 - BEZEL / 2 + 0.0005, front - 0.0001);
  group.add(lens, glint);

  // 状态灯：下边框右侧，青色呼吸
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x30e0ff });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 16), ledMat);
  led.position.set(iw / 2 - 0.03, -ih / 2 + BEZEL / 2, front - 0.0001);
  group.add(led);

  // 下边框刻字
  const lc = document.createElement('canvas');
  lc.width = 1024; lc.height = 48;
  const lg = lc.getContext('2d');
  lg.font = '500 30px "SF Mono", Menlo, monospace';
  lg.fillStyle = 'rgba(150,170,190,0.55)';
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  lg.fillText('CIVIC ORDER SERVICES  ·  FRA-B1234', 512, 25);
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0047), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false }));
  label.position.set(0, -ih / 2 + BEZEL / 2, front - 0.0001);
  group.add(label);

  // 按键：顶边电源键、右侧音量键
  const btnGeo = new RoundedBoxGeometry(0.032, 0.0022, 0.0034, 2, 0.001);
  const power = new THREE.Mesh(btnGeo, metal);
  power.position.set(-ow / 2 + 0.06, oh / 2 + 0.0006, front - DEPTH / 2);
  const volGeo = new RoundedBoxGeometry(0.0022, 0.024, 0.0034, 2, 0.001);
  const volUp = new THREE.Mesh(volGeo, metal);
  volUp.position.set(ow / 2 + 0.0006, oh / 2 - 0.05, front - DEPTH / 2);
  const volDn = volUp.clone();
  volDn.position.y -= 0.03;
  group.add(power, volUp, volDn);

  return { group, ledMat };
}

export function createTablet(camera) {
  const uiScene = new THREE.Scene();
  const rig = new THREE.Group();        // 跟随相机
  const holder = new THREE.Group();     // 举起/收起动画 + 晃动
  rig.add(holder);
  uiScene.add(rig);

  // 实体机身：金属边框 + 黑色玻璃边框 + 摄像头、状态灯、按键
  const body = buildBody();
  holder.add(body.group);

  // 透明屏幕玻璃：极淡的蓝色 + 一道斜向反光
  const glassMat = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const diag = uv().x.mul(0.6).add(uv().y);
  const sheen = smoothstep(0.62, 0.75, diag).mul(smoothstep(0.95, 0.78, diag)).mul(0.035);
  glassMat.colorNode = color(0x0e2a3a).mul(0.6).add(vec3(sheen));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), glassMat);

  // 界面：透明底的画布，加法混合，黑色部分完全透明
  const cvs = document.createElement('canvas');
  cvs.width = CW; cvs.height = CH;
  const g = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // 全息显示：RGB 轻微错位（色散）+ 细扫描线 + 缓慢下扫的亮带 + 偶发闪烁
  const screenMat = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const flicker = uniform(1);
  const suv = uv();
  const ca = vec2(0.0009, 0);
  // 画布是非预乘透明，颜色要乘上各自的透明度，否则透明区域也会发光
  const sR = texture(tex, suv.add(ca)), sG = texture(tex, suv), sB = texture(tex, suv.sub(ca));
  const rgb = vec3(sR.r.mul(sR.a), sG.g.mul(sG.a), sB.b.mul(sB.a));
  const scan = sin(suv.y.mul(1100)).mul(0.5).add(0.5).mul(0.14).add(0.86);
  const band = fract(suv.y.add(uiTime.mul(0.12))).pow(30).mul(0.35);
  const tint = uniform(new THREE.Color(1, 1, 1));
  const _orange = new THREE.Color(1.6, 0.75, 0.25);
  screenMat.colorNode = rgb.mul(scan.add(band)).mul(flicker).mul(tint).mul(1.25);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  screen.position.z = 0.002;
  for (const m of [glassMat, screenMat]) m.mrtNode = NO_MASK;
  holder.add(glass, screen);
  rig.visible = false;
  let flickT = 0;

  const imgs = new Map();
  const state = {
    open: false, k: 0,            // k：举起进度 0~1
    boot: 0,                      // 开机进度 0~1
    tab: 0, sel: 0,
    dirty: true, typeT: 0,
    // reports：[{ key, tag, source, lines, verdict, note, confirm }]；confirm：{ p, state: 'idle' | 'suspended' }
    data: { clues: [], events: [], reports: [], confirm: null, status: '调查中' },
    // 鼠标交互：hover 为画布坐标；regions 为本帧可点击区域（绘制时重建）
    hover: null, regions: [],
    repSel: 0,                    // 报告页选中的报告
    glitch: 0,                    // 强干扰剩余时间（双闪打断确认时）
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

  // 点击区域：opts.drop 标记下拉框内的选项，opts.cursor 为悬停时的鼠标样式
  function region(x, y, w, h, fn, opts = {}) { state.regions.push({ x, y, w, h, fn, ...opts }); }
  const inside = (x, y, w, h) => {
    const p = state.hover;
    return !!p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  };
  function hitTest(p) {
    for (let i = state.regions.length - 1; i >= 0; i--) {
      const r = state.regions[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r;
    }
    return null;
  }
  function measure(t, size, weight = 400) {
    g.font = `${weight} ${size}px ${SANS}`;
    return g.measureText(t).width;
  }

  function draw() {
    const { clues, events } = state.data;
    state.regions = [];
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(40,110,160,0.07)';
    g.fillRect(0, 0, CW, CH);
    corners(24, 24, CW - 48, CH - 48, 46, C.cyan, 4);

    // 顶栏
    text('CASE FILE · 复核工单', 70, 104, 26, C.dim, 400, 'left', true);
    text('桥面护栏撞击事故 · 1 人死亡', 70, 150, 40, C.white, 500);
    const ev = clues.filter((c) => !c.probe);
    const found = ev.filter((c) => c.done).length;
    text(`线索 ${found} / ${ev.length}`, CW - 70, 104, 26, C.dim, 400, 'right', true);
    text(state.data.status, CW - 70, 150, 36, C.cyan, 500, 'right');

    // 页签
    TABS.forEach((t, i) => {
      const x = 70 + i * 190;
      const on = i === state.tab;
      const hot = !on && inside(x, 186, 170, 54);
      g.fillStyle = on ? 'rgba(127,214,255,0.22)' : hot ? 'rgba(127,214,255,0.12)' : 'rgba(127,214,255,0.05)';
      g.fillRect(x, 186, 170, 54);
      g.fillStyle = on ? C.cyan : C.faint;
      g.fillRect(x, 238, 170, 3);
      text(t, x + 85, 224, 28, on || hot ? C.white : C.dim, on ? 500 : 400, 'center');
      region(x, 186, 170, 54, () => setTab(i));
    });
    text('鼠标点击操作  ·  TAB 收起', CW - 70, 224, 22, C.dim, 400, 'right');
    g.fillStyle = C.faint;
    g.fillRect(70, 262, CW - 140, 2);

    if (state.tab === 0) drawClues(clues);
    else if (state.tab === 1) drawEvents(events);
    else drawReport();
  }

  function setTab(i) {
    if (i === state.tab) return;
    state.tab = i;
    state.typeT = 0;
    state.dirty = true;
  }

  function drawClues(clues) {
    const top = 300, rowH = Math.min(66, Math.floor((CH - 330) / Math.max(1, clues.length)));
    clues.forEach((c, i) => {
      const y = top + i * rowH;
      const on = i === state.sel;
      if (on) {
        g.fillStyle = 'rgba(127,214,255,0.16)';
        g.fillRect(70, y, 470, rowH - 8);
        g.fillStyle = C.cyan;
        g.fillRect(70, y, 5, rowH - 8);
      } else if (inside(70, y, 470, rowH - 8)) {
        g.fillStyle = 'rgba(127,214,255,0.07)';
        g.fillRect(70, y, 470, rowH - 8);
      }
      region(70, y, 470, rowH - 8, () => { if (state.sel !== i) { state.sel = i; state.typeT = 0; } });
      const by = y + (rowH - 8) / 2 + 11;
      text(c.probe ? '梦' : String(i + 1).padStart(2, '0'), 96, by - 1, 24, c.probe ? C.gold : c.done ? C.dim : C.faint, 400, 'left', !c.probe);
      text(c.done ? c.name : '？？？', 150, by, rowH < 60 ? 27 : 30, c.done ? (on ? C.white : '#bfe4f7') : C.faint, on ? 500 : 400);
      if (c.done && c.key) text('◆', 520, by - 2, 20, C.gold, 400, 'right');
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
    text(c.probe ? '黑梦分析' : `证据 #${String(state.sel + 1).padStart(2, '0')}`, x, 336, 22, c.probe ? C.gold : C.cyan, 400, 'left', true);
    text(c.name, x, 392, 46, C.white, 500);
    // 打字机效果：切换线索后逐行出现
    // 文字区宽度到证据图左侧为止，超出自动换行
    const maxW = c.probe ? CW - 70 - (x + 28) : CW - 70 - 380 - 40 - (x + 28);
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
    // 证据图（黑梦分析没有影像）
    if (c.probe) return;
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
      text('收集全部关键线索后按 R 启动黑梦，在时间轴上记录关键时刻。', 70, 420, 26, C.dim);
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

  // ---------- 报告 ----------
  // 左侧按时间列出已有报告，右侧显示选中的报告（逐行打出）
  function drawReport() {
    const reps = state.data.reports;
    const top = 300, rowH = 96;
    reps.forEach((r, i) => {
      const y = top + i * rowH;
      const on = i === state.repSel;
      if (on) {
        g.fillStyle = 'rgba(127,214,255,0.16)';
        g.fillRect(70, y, 420, rowH - 12);
        g.fillStyle = C.cyan;
        g.fillRect(70, y, 5, rowH - 12);
      } else if (inside(70, y, 420, rowH - 12)) {
        g.fillStyle = 'rgba(127,214,255,0.07)';
        g.fillRect(70, y, 420, rowH - 12);
      }
      region(70, y, 420, rowH - 12, () => { if (state.repSel !== i) { state.repSel = i; state.typeT = 0; } });
      text(r.tag, 100, y + 40, 30, on ? C.white : '#bfe4f7', on ? 500 : 400);
      text(r.source, 100, y + 72, 20, C.dim);
    });

    const r = reps[state.repSel];
    const x = 560;
    g.fillStyle = C.faint;
    g.fillRect(x - 24, 300, 2, CH - 360);
    if (!r) return;
    text(r.source, x, 336, 22, C.dim, 400, 'left', true);
    text(r.tag, x, 392, 46, C.white, 500);
    const shown = Math.floor(state.typeT * 5);
    const maxW = CW - 70 - (x + 28);
    let ly = 460;
    r.lines.forEach((l, i) => {
      if (i >= shown) return;
      g.fillStyle = C.cyan;
      g.fillRect(x, ly - 10, 14, 3);
      wrap(l, maxW, 30).forEach((row, k) => text(row, x + 28, ly + k * 44, 30, '#d6effc'));
      ly += 58;
    });
    if (shown > r.lines.length) {
      const vy = 460 + r.lines.length * 58 + 30;
      g.fillStyle = 'rgba(255,207,106,0.35)';
      g.fillRect(x, vy - 40, 520, 2);
      text(r.verdict, x, vy + 10, 36, C.gold, 500);
      if (r.note) text(r.note, x, vy + 72, 24, C.dim);
    }
    if (r.confirm && shown > r.lines.length + 1) drawConfirm(x);
  }

  // 「按住 E 确认归档」：确认进度条；被打断后显示挂起
  function drawConfirm(x) {
    const cf = state.data.confirm;
    if (!cf) return;
    const bx = x, by = 820, bw = CW - 70 - x, bh = 92;
    const suspended = cf.state === 'suspended';
    g.fillStyle = suspended ? 'rgba(255,138,26,0.10)' : 'rgba(255,207,106,0.08)';
    g.fillRect(bx, by, bw, bh);
    if (!suspended && cf.p > 0) {
      g.fillStyle = 'rgba(255,207,106,0.32)';
      g.fillRect(bx, by, bw * cf.p, bh);
    }
    corners(bx, by, bw, bh, 18, suspended ? '#ff9a3a' : C.gold, 3);
    if (suspended) text('复核挂起 · 现场出现未登记色值', bx + bw / 2, by + 58, 32, '#ffb066', 500, 'center');
    else text(cf.p > 0 ? '确认归档中…' : '按住 E 确认归档', bx + bw / 2, by + 58, 34, C.gold, 500, 'center');
  }

  // 切到报告页并选中指定报告（新生成的报告重新打字）
  function showReport(key) {
    const i = state.data.reports.findIndex((r) => r.key === key);
    if (i < 0) return;
    state.tab = 2;
    state.repSel = i;
    state.typeT = 0;
    state.dirty = true;
  }

  // ---------- 鼠标 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canPoint = () => state.open && state.k > 0.9 && state.boot >= 1 && !document.pointerLockElement;
  // 屏幕坐标 → 平板画布坐标（未指向平板时返回 null）
  function pick(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    uiScene.updateMatrixWorld();
    const hit = raycaster.intersectObject(screen, false)[0];
    return hit ? { x: hit.uv.x * CW, y: (1 - hit.uv.y) * CH } : null;
  }
  addEventListener('mousemove', (e) => {
    if (!canPoint()) return;
    state.hover = pick(e);
    const r = state.hover && hitTest(state.hover);
    if (r && !(r.x === state.hoverRegion?.x && r.y === state.hoverRegion?.y)) sound.play('ui/hover');
    state.hoverRegion = r;
    document.body.style.cursor = r ? (r.cursor ?? 'pointer') : '';
    state.dirty = true;
  });
  addEventListener('click', (e) => {
    if (!canPoint()) return;
    const p = pick(e);
    const r = p && hitTest(p);
    // 点到可交互区域是确认音，点到平板空白或平板外是拒绝音
    sound.play(r ? 'ui/click' : 'ui/deny');
    if (r) r.fn(e);
    // 立即重绘，点击区域马上更新（不等下一帧，连续快速点击也不会点到旧区域）
    draw();
    tex.needsUpdate = true;
    state.dirty = false;
  });

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
        text('CIVIC ORDER · FIELD REVIEW OS', CW / 2, CH / 2, 40, C.cyan, 400, 'center', true);
      }
      return;
    }
    g.fillStyle = C.cyan;
    g.fillRect(0, cut - 3, CW, 4);
    g.fillStyle = 'rgba(127,214,255,0.25)';
    g.fillRect(0, cut - 40, CW, 37);
  }

  // ---------- 输入 ----------
  // 返回 true 表示按键已被平板处理
  function nav(code) {
    if (!state.open) return false;
    const n = state.data.clues.length;
    if (code === 'KeyA') setTab((state.tab + TABS.length - 1) % TABS.length);
    else if (code === 'KeyD') setTab((state.tab + 1) % TABS.length);
    else if (code === 'KeyW' && state.tab === 0) { state.sel = (state.sel + n - 1) % n; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 0) { state.sel = (state.sel + 1) % n; state.typeT = 0; }
    else if (code === 'KeyW' && state.tab === 2) { const m = state.data.reports.length; state.repSel = (state.repSel + m - 1) % m; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 2) { const m = state.data.reports.length; state.repSel = (state.repSel + 1) % m; state.typeT = 0; }
    else return false;
    sound.play('ui/hover', { volume: 1.6 });
    state.dirty = true;
    return true;
  }

  function toggle(on = !state.open) {
    state.open = on;
    if (on) { state.boot = 0; state.typeT = 0; state.dirty = true; }
    else {
      state.hover = null;
      document.body.style.cursor = '';
    }
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
    // 开机、打字、确认进度、干扰期间逐帧重绘
    const animating = state.open && (state.boot < 1 || state.typeT < 2.5 || state.data.confirm?.p > 0 || state.glitch > 0);
    if (state.open && state.boot >= 1) state.typeT += dt;
    if (state.dirty || animating) {
      draw();
      applyBoot();
      tex.needsUpdate = true;
      state.dirty = false;
    }
    const a = state.open ? 1 : state.k;
    screenMat.opacity = a;
    glassMat.opacity = a;
    // 全息偶发闪烁：平均约 4 秒一次，持续不到 0.1 秒
    flickT -= dt;
    if (flickT <= 0 && Math.random() < dt * 0.25) flickT = 0.06 + Math.random() * 0.05;
    flicker.value = flickT > 0 ? 0.6 + Math.random() * 0.3 : 1;
    // 强干扰：亮度剧烈跳动，画面偏橙（双闪打断确认）
    state.glitch = Math.max(0, state.glitch - dt);
    if (state.glitch > 0) flicker.value = Math.random() < 0.35 ? 0.15 : 1.4 + Math.random();
    tint.value.setRGB(1, 1, 1).lerp(_orange, Math.min(1, state.glitch * 3));
    // 状态灯呼吸（亮度略高于辉光阈值，带一点光晕）
    body.ledMat.color.setHex(0x30e0ff).multiplyScalar(1.2 + Math.sin(t * 2.4) * 0.8);
  }

  return {
    uiScene,
    update,
    toggle,
    nav,
    setData,
    showReport,
    glitch(sec = 0.5) { state.glitch = sec; state.dirty = true; },
    get open() { return state.open; },
    get amount() { return state.k; },   // 用于背景压暗与虚化
  };
}
