import * as THREE from 'three/webgpu';
import { sound } from '../audio/sound.js';
import { mrt, float, uv, vec2, vec3, color, smoothstep, sin, fract, texture, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { uiTime } from './clock.js';
import { tx } from '../i18n.js';

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
const tabName = (i) => (i === 0 ? tx('线索', 'CLUES') : tx('报告', 'REPORT'));

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
  lg.fillText('CIVIC ORDER SERVICES  ·  FRA-B1016', 512, 25);
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
  // 掉在地上时屏幕背后加一块不透明的黑底：否则透明屏幕会透出路面，字看不清
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x010407 }));
  backing.position.z = -0.0005;
  backing.visible = false;
  holder.add(backing);
  rig.visible = false;
  let flickT = 0;

  const imgs = new Map();
  const state = {
    open: false, k: 0,            // k：举起进度 0~1
    boot: 0,                      // 开机进度 0~1
    tab: 0, sel: 0,
    foldOpen: false,              // 线索页「之前的线索」是否展开（每次举起平板时收起）
    dirty: true, typeT: 0,
    // reports：[{ key, tag, source, lines, verdict, note, confirm }]；confirm：{ p, state: 'idle' | 'suspended' }
    data: { clues: [], reports: [], confirm: null, status: tx('调查中', 'INVESTIGATING') },
    // 鼠标交互：hover 为画布坐标；regions 为本帧可点击区域（绘制时重建）
    hover: null, regions: [],
    repSel: 0,                    // 报告页选中的报告
    glitch: 0,                    // 强干扰剩余时间（报告被质疑改写、接入画面开始时）
    hack: null,                   // 插卡接入画面：{ t, cfg, onDone }
    world: null,                  // 结局：平板掉在地上，固定在世界坐标 { pos, quat }，不再跟随相机
    typing: false,                // 本次绘制时有文字正在逐字 / 逐行打出（打字音效用）
  };
  const sway = { yaw: 0, pitch: 0, vx: 0, vy: 0 };
  let lastYaw = 0, lastPitch = 0;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

  function setData(d) { state.data = d; state.dirty = true; }
  // 线索页的行：本轮线索在前；之前轮次（old）收进一个折叠项，展开后列在折叠项下面
  function rows() {
    const all = state.data.clues;
    // 之前的线索按轮次排，同一轮里现场 / 车载数据在前、黑梦分析在后
    const rank = (c) => (c.showRound ?? c.round) * 2 + (c.probe ? 1 : 0);
    const old = all.filter((c) => c.old).sort((a, b) => rank(a) - rank(b));
    if (!old.length) return all;
    const fold = { fold: true, id: '__fold', count: old.length };
    return [...all.filter((c) => !c.old), fold, ...(state.foldOpen ? old : [])];
  }
  // 证据编号：在整份线索里的序号，不受折叠影响
  const evNo = (c) => String(state.data.clues.indexOf(c) + 1).padStart(2, '0');
  function toggleFold() {
    const fold = rows().findIndex((c) => c.fold);
    state.foldOpen = !state.foldOpen;
    state.sel = fold;   // 光标留在折叠项上
    state.typeT = 0;
    state.dirty = true;
  }
  function image(id) {
    if (!imgs.has(id)) {
      const im = new Image();
      im.onload = () => { state.dirty = true; };
      im.src = `${import.meta.env.BASE_URL}assets/gen/clue_${id}.jpg`;
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
    const { clues } = state.data;
    state.regions = [];
    state.actionOn = false;
    state.typing = false;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(40,110,160,0.07)';
    g.fillRect(0, 0, CW, CH);
    corners(24, 24, CW - 48, CH - 48, 46, C.cyan, 4);
    if (state.data.final) { drawFinal(state.data.final); return; }
    if (state.hack) { drawHack(); return; }

    // 顶栏
    text(tx('CASE FILE · 复核工单', 'CASE FILE · REVIEW'), 70, 104, 26, C.dim, 400, 'left', true);
    text(tx('桥面护栏撞击事故 · 1 人死亡', 'Bridge rail impact · 1 dead'), 70, 150, 40, C.white, 500);
    const ev = clues.filter((c) => !c.probe);
    const found = ev.filter((c) => c.done).length;
    text(tx(`线索 ${found} / ${ev.length}`, `CLUES ${found} / ${ev.length}`), CW - 70, 104, 26, C.dim, 400, 'right', true);
    text(state.data.status, CW - 70, 150, 36, C.cyan, 500, 'right');

    // 页签
    [0, 1].forEach((i) => {
      const t = tabName(i);
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
    text(tx('鼠标点击操作  ·  TAB 收起', 'Click  ·  TAB to close'), CW - 70, 224, 22, C.dim, 400, 'right');
    g.fillStyle = C.faint;
    g.fillRect(70, 262, CW - 140, 2);

    if (state.tab === 0) drawClues(rows());
    else drawReport();
  }

  // ---------- 结局：事故报告（自动打字、自动归档）----------
  // f：{ head, title, status, source, tag, lines, verdict, labels, typed（已打出的字数）, showVerdict }
  // 确认条读 state.data.confirm（由结局演出逐帧推进）
  function drawFinal(f) {
    text(f.head, 70, 104, 26, C.dim, 400, 'left', true);
    text(f.title, 70, 150, 40, C.white, 500);
    text(f.status, CW - 70, 150, 34, C.gold, 500, 'right');
    g.fillStyle = C.faint;
    g.fillRect(70, 190, CW - 140, 2);
    text(f.source, 70, 254, 22, C.dim, 400, 'left', true);
    text(f.tag, 70, 316, 46, C.white, 500);
    // 右上角两行时间：事故时间、报告生成（生成更早，红色）
    (f.stamps ?? []).forEach((s, i) => {
      if (f.typed <= 0) return;
      text(`${s.label}  ${s.t}`, CW - 70, 254 + i * 50, 26, s.tone === 'red' ? C.red : C.dim, 400, 'right', true);
    });

    // 逐字打出，末尾一个闪烁的光标
    let left = f.typed, ly = 410, caret = null;
    const maxW = CW - 70 - 98;
    for (const l of f.lines) {
      if (left <= 0) break;
      const s = l.slice(0, left);
      left -= l.length;
      g.fillStyle = C.cyan;
      g.fillRect(70, ly - 10, 14, 3);
      const rows = wrap(s, maxW, 34);
      rows.forEach((row, k) => text(row, 98, ly + k * 48, 34, '#d6effc'));
      caret = { x: 98 + measure(rows[rows.length - 1], 34) + 6, y: ly + (rows.length - 1) * 48 };
      ly += rows.length * 48 + 20;
    }
    const typing = f.typed < f.lines.join('').length;
    if (typing && f.typed > 0) state.typing = true;
    if (caret && typing && Math.floor(uiTime.value * 3) % 2 === 0) {
      g.fillStyle = C.cyan;
      g.fillRect(caret.x, caret.y - 30, 16, 36);
    }
    if (f.showVerdict) {
      g.fillStyle = 'rgba(255,207,106,0.35)';
      g.fillRect(70, 640, 640, 2);
      text(f.verdict, 70, 704, 42, C.gold, 500);
    }
    if (state.data.confirm) drawConfirm(70, false, f.labels);
    drawCracks();
  }

  // 摔裂的屏幕：从右上角放射出去的裂纹，固定种子
  const cracks = (() => {
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const ox = 1290, oy = 230, out = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.5;
      const pts = [[ox, oy]];
      let x = ox, y = oy, ang = a;
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const len = 40 + rnd() * 140;
        ang += (rnd() - 0.5) * 0.7;
        x += Math.cos(ang) * len; y += Math.sin(ang) * len;
        pts.push([x, y]);
      }
      out.push(pts);
    }
    return { ox, oy, lines: out };
  })();
  function drawCracks() {
    g.strokeStyle = 'rgba(210,240,255,0.32)';
    g.lineWidth = 2;
    for (const pts of cracks.lines) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.beginPath();
    g.arc(cracks.ox, cracks.oy, 34, 0.3, 4.6);
    g.stroke();
    g.fillStyle = 'rgba(210,240,255,0.18)';
    g.beginPath();
    g.arc(cracks.ox, cracks.oy, 12, 0, Math.PI * 2);
    g.fill();
  }

  // ---------- 插卡接入画面 ----------
  // 逐行出现的接入日志；读取段落有十六进制滚屏和进度条
  const HEX = '0123456789ABCDEF';
  function hexRow(seed) {
    let s = '', x = seed * 2654435761 >>> 0;
    for (let i = 0; i < 12; i++) { x = (x * 1103515245 + 12345) >>> 0; s += HEX[x >>> 28] + HEX[(x >>> 24) & 15] + ' '; }
    return s;
  }
  function drawHack() {
    const { t, cfg } = state.hack;
    text(cfg.head ?? 'CARD LINK · FIELD FORENSICS', 70, 104, 26, C.dim, 400, 'left', true);
    text(cfg.title, 70, 150, 40, C.white, 500);
    // 右上角：接入状态
    const blink = Math.floor(t * 4) % 2 === 0;
    const done = t >= (cfg.scan ? cfg.scan[1] : cfg.done);
    text(done ? tx('● 已接入', '● LINKED') : blink ? tx('● 接入中', '● LINKING') : tx('○ 接入中', '○ LINKING'), CW - 70, 150, 32, done ? '#40ff90' : C.gold, 500, 'right');
    g.fillStyle = C.faint;
    g.fillRect(70, 190, CW - 140, 2);

    // 左侧：日志
    let y = 260;
    for (const s of cfg.steps) {
      if (t < s.t) break;
      const color = s.tone === 'red' ? C.red : s.tone === 'gold' ? C.gold : '#d6effc';
      // 每行逐字打出
      const n = Math.min(s.text.length, Math.floor((t - s.t) * 60));
      if (n < s.text.length) state.typing = true;
      text('>', 70, y, 26, C.dim, 400, 'left', true);
      text(s.text.slice(0, n), 104, y, 28, color, s.tone ? 500 : 400);
      y += 56;
    }
    if (state.hack.held) text(tx('TAB 收起', 'TAB close'), CW - 70, CH - 70, 24, C.dim, 400, 'right');

    // 右侧：十六进制滚屏（没有 scan 段的画面只有日志）
    if (!cfg.scan) return;
    const [s0, s1] = cfg.scan;
    const x0 = 940, top = 240, rows = 10;
    if (t >= s0) {
      const p = Math.min(1, (t - s0) / (s1 - s0));
      const scroll = Math.floor(t * 30);
      for (let i = 0; i < rows; i++) {
        const live = p < 1;
        const row = live ? hexRow(scroll + i) : hexRow(i + 7);
        const addr = (0x7f00 + ((live ? scroll : 0) + i) * 16).toString(16).toUpperCase();
        text(addr, x0, top + i * 40, 20, C.dim, 400, 'left', true);
        text(row, x0 + 90, top + i * 40, 20, i === rows - 1 && live ? C.white : 'rgba(127,214,255,0.7)', 400, 'left', true);
      }
      // 进度条
      const by = top + rows * 40 + 20;
      g.fillStyle = 'rgba(127,214,255,0.15)';
      g.fillRect(x0, by, CW - 70 - x0, 10);
      g.fillStyle = p < 1 ? C.cyan : '#40ff90';
      g.fillRect(x0, by, (CW - 70 - x0) * p, 10);
      text(`${Math.floor(p * 100)}%`, CW - 70, by + 46, 24, p < 1 ? C.cyan : '#40ff90', 400, 'right', true);
    }
  }
  // cfg.hold：走完后停在最后一帧，直到平板收起
  function hack(cfg, onDone) {
    state.hack = { t: 0, cfg, onDone, held: false };
    state.glitch = 0.35;
    state.dirty = true;
  }

  function setTab(i) {
    if (i === state.tab) return;
    state.tab = i;
    state.typeT = 0;
    state.dirty = true;
  }

  function drawClues(clues) {
    const top = 300, rowH = Math.min(66, Math.floor((CH - 330) / Math.max(1, clues.length)));
    if (state.sel >= clues.length) state.sel = Math.max(0, clues.length - 1);
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
      const by = y + (rowH - 8) / 2 + 11;
      if (c.fold) {
        region(70, y, 470, rowH - 8, toggleFold);
        g.fillStyle = C.faint;
        g.fillRect(70, y - 5, 470, 1);
        text(state.foldOpen ? '▾' : '▸', 96, by - 1, 24, C.dim);
        text(tx(`之前的线索（${c.count}）`, `Earlier clues (${c.count})`), 150, by, rowH < 60 ? 25 : 28, on ? C.white : C.dim, on ? 500 : 400);
        return;
      }
      region(70, y, 470, rowH - 8, () => { if (state.sel !== i) { state.sel = i; state.typeT = 0; } });
      const icon = c.probe ? tx('梦', 'D') : c.data ? (c.locked ? tx('锁', 'L') : tx('数', '#')) : evNo(c);
      const iconColor = c.probe ? C.gold : c.data ? (c.locked ? C.red : '#40ff90') : c.done ? C.dim : C.faint;
      text(icon, 96, by - 1, 24, iconColor, 400, 'left', !c.probe && !c.data);
      text(c.done ? c.name : tx('？？？', '???'), 150, by, rowH < 60 ? 27 : 30, c.done ? (on ? C.white : '#bfe4f7') : C.faint, on ? 500 : 400);
      if (c.done && c.key) text('◆', 520, by - 2, 20, C.gold, 400, 'right');
    });

    // 详情
    const c = clues[state.sel];
    const x = 590;
    g.fillStyle = C.faint;
    g.fillRect(x - 24, 300, 2, CH - 360);
    if (!c) return;
    if (c.fold) {
      text(tx('之前的线索', 'Earlier clues'), x, 392, 46, C.white, 500);
      text(tx(`前几轮的 ${c.count} 条线索，结论已写进报告。`, `${c.count} clues from earlier rounds. Their findings are in the reports.`), x, 460, 26, C.dim);
      text(tx(state.foldOpen ? '点击或按 E 收起' : '点击或按 E 展开', state.foldOpen ? 'Click or press E to collapse' : 'Click or press E to expand'), x, 516, 26, C.cyan);
      return;
    }
    if (!c.done) {
      text(tx('未发现', 'UNKNOWN'), x, 360, 40, C.dim, 500);
      text(tx('该线索尚未分析。靠近可疑位置按住 E，或按 Q 扫描周围。', 'Not analyzed. Hold E on the mark, or press Q to scan.'), x, 420, 26, C.dim);
      return;
    }
    const head = c.probe ? tx('黑梦分析', 'BLACK DREAM') : c.data ? (c.locked ? tx('车载数据 · 权限不足', 'VEHICLE DATA · DENIED') : c.src ?? tx('车载数据 · 执行器缓存', 'VEHICLE DATA · ACTUATOR CACHE')) : tx(`证据 #${evNo(c)}`, `EVIDENCE #${evNo(c)}`);
    text(head, x, 336, 22, c.probe ? C.gold : c.locked ? C.red : c.data ? '#40ff90' : C.cyan, 400, 'left', true);
    text(c.name, x, 392, 46, C.white, 500);
    // 打字机效果：切换线索后逐行出现
    // 文字区宽度到证据图左侧为止，超出自动换行
    const noImage = c.probe || c.data;
    const maxW = noImage ? CW - 70 - (x + 28) : CW - 70 - 380 - 40 - (x + 28);
    const shown = Math.floor(state.typeT * 6);
    if (shown <= c.lines.length) state.typing = true;   // 结论行出现前都算在打字
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
      text(c.result, x, ry + 12, 32, c.locked ? C.red : C.gold, 500);
      if (c.action) drawAction(c.action, x, ry + 60);
      if (c.timeline) drawTimeline(c.timeline, x, ry + 112, Math.min(1, (state.typeT * 6 - c.lines.length - 1) / 3));
      if (c.prob == null) return;
      text(tx('概率', 'PROB'), x, ry + 66, 22, C.dim);
      g.fillStyle = 'rgba(255,207,106,0.2)';
      g.fillRect(x + 70, ry + 57, 260, 5);
      g.fillStyle = C.gold;
      g.fillRect(x + 70, ry + 57, 260 * c.prob * Math.min(1, (state.typeT * 6 - c.lines.length - 1) / 2), 5);
      text(`${Math.round(c.prob * 100)}%`, x + 350, ry + 66, 22, C.gold, 400, 'left', true);
    }
    // 证据图（黑梦分析、车载数据没有影像）
    if (noImage) return;
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
    text(`${tx('影像记录', 'STILL')} · EV-${evNo(c)}`, ix, iy + is + 44, 20, C.dim, 400, 'left', true);
  }

  // 线索详情下方的操作（插入根钥）：按住 E 或按住按钮读条，走满才确认
  function drawAction(a, x, y) {
    state.actionOn = true;
    const w = 560, h = 76;
    const hot = inside(x, y, w, h);
    const p = Math.max(0, Math.min(1, a.p || 0));
    g.fillStyle = hot ? 'rgba(255,207,106,0.16)' : 'rgba(255,207,106,0.08)';
    g.fillRect(x, y, w, h);
    if (p > 0) {
      g.fillStyle = 'rgba(255,207,106,0.32)';
      g.fillRect(x, y, w * p, h);
    }
    corners(x, y, w, h, 16, C.gold, 3);
    text(p > 0 ? a.holding : a.label, x + w / 2, y + h / 2 + 11, 30, hot || p > 0 ? C.white : C.gold, 500, 'center');
    region(x, y, w, h, null, { hold: true, cursor: 'pointer' });
  }

  // 时间轴：按真实间隔排开各时刻，p 为绘制进度（0~1）
  function drawTimeline(marks, x, y, p) {
    if (p <= 0) return;
    const w = CW - 70 - x - 40;
    const t0 = marks[0].t, t1 = marks[marks.length - 1].t;
    const px = (t) => x + 20 + ((t - t0) / (t1 - t0)) * (w - 40);
    g.fillStyle = C.dim;
    g.fillRect(x, y, w * p, 3);
    marks.forEach((m, i) => {
      const mx = px(m.t);
      if (mx > x + w * p) return;
      const col = m.tone === 'red' ? C.red : C.cyan;
      g.fillStyle = col;
      g.fillRect(mx - 2, y - 18, 4, 39);
      // 标签上下交错，挨得近的时刻不会叠在一起
      const up = i % 2 === 0;
      text(m.label, mx, up ? y - 30 : y + 58, 24, m.tone === 'red' ? C.red : '#d6effc', 500, 'center');
      text(m.t.toFixed(3).padStart(6, '0'), mx, up ? y - 62 : y + 90, 20, C.dim, 400, 'center', true);
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
    // 黑梦结束后报告逐字打出。约 24 字/秒，打完才出现确认按钮
    let budget = Math.floor(state.typeT * 24);
    const eat = (s) => {
      if (!s || budget <= 0) return '';
      const n = Math.min(s.length, budget);
      budget -= n;
      return s.slice(0, n);
    };
    const maxW = CW - 70 - (x + 28);
    // 被质疑改写：原行划掉，追加一行；原判定划掉，下面写新判定
    const rv = r.revisedOn ? r.revised : null;
    const lines = rv ? [...r.lines, rv.add] : r.lines;
    let ly = 460;
    let linesDone = true;
    lines.forEach((l, i) => {
      const vis = eat(l);
      if (!vis) { linesDone = false; return; }
      if (vis.length < l.length) linesDone = false;
      const struck = rv && rv.strike.includes(i) && vis.length === l.length;
      const added = rv && i === r.lines.length;
      g.fillStyle = added ? '#ff9a3a' : C.cyan;
      g.fillRect(x, ly - 10, 14, 3);
      wrap(vis, maxW, 30).forEach((row, k) => {
        text(row, x + 28, ly + k * 44, 30, struck ? C.dim : added ? '#ffb066' : '#d6effc');
        if (struck) strike(x + 28, ly + k * 44 - 10, measure(row, 30));
      });
      ly += 58;
    });
    let verdictDone = false;
    if (linesDone) {
      const vy = ly + 30;
      g.fillStyle = 'rgba(255,207,106,0.35)';
      g.fillRect(x, vy - 40, 520, 2);
      if (rv) {
        const oldV = eat(r.verdict);
        const newV = oldV.length === r.verdict.length ? eat(rv.verdict) : '';
        const note = newV.length === rv.verdict.length ? eat(rv.note) : '';
        if (oldV) {
          text(oldV, x, vy + 4, 28, C.dim, 500);
          if (oldV.length === r.verdict.length) strike(x, vy - 6, measure(r.verdict, 28, 500));
        }
        if (newV) text(newV, x, vy + 58, 36, '#ffb066', 500);
        if (note) text(note, x, vy + 110, 24, C.dim);
        verdictDone = note.length === (rv.note || '').length && newV.length === rv.verdict.length;
      } else {
        const verdict = eat(r.verdict);
        const note = verdict.length === r.verdict.length ? eat(r.note || '') : '';
        const hint = !r.note || note.length === r.note.length ? eat(r.hint || '') : '';
        if (verdict) text(verdict, x, vy + 10, 36, C.gold, 500);
        if (note) text(note, x, vy + 72, 24, C.dim);
        if (hint) text(hint, x, vy + (r.note ? 118 : 72), 24, C.cyan);
        verdictDone = verdict.length === r.verdict.length
          && note.length === (r.note || '').length
          && hint.length === (r.hint || '').length;
      }
    }
    if (!verdictDone) state.typing = true;
    if (r.confirm && verdictDone) drawConfirm(x, !!rv, r.confirm);
  }

  function strike(x, y, w) {
    g.fillStyle = '#ff6a4a';
    g.fillRect(x - 4, y, w + 8, 3);
  }

  // 「按住 E 确认」：左侧确认条 + 右侧「TAB 暂不确认」；文字来自报告的 confirm 配置（lb）
  // cf.text 为非待确认状态下的文字
  function drawConfirm(x, low, lb) {
    const cf = state.data.confirm;
    if (!cf) return;
    const by = low ? 870 : 820, bh = low ? 76 : 92;
    const full = CW - 70 - x;
    const idle = cf.state === 'idle';
    const split = idle && cf.onDecline;
    const bx = x, bw = split ? full * 0.66 : full;
    const warn = cf.state === 'suspended' || cf.state === 'talking';
    const done = cf.state === 'archived';
    g.fillStyle = warn ? 'rgba(255,138,26,0.10)' : 'rgba(255,207,106,0.08)';
    g.fillRect(bx, by, bw, bh);
    if ((idle || done) && cf.p > 0) {
      g.fillStyle = 'rgba(255,207,106,0.32)';
      g.fillRect(bx, by, bw * Math.min(1, cf.p), bh);
    }
    corners(bx, by, bw, bh, 18, warn ? '#ff9a3a' : C.gold, 3);
    const ty = by + bh / 2 + 12;
    if (idle) text(cf.p > 0 ? lb.holding : lb.hold, bx + bw / 2, ty, 34, C.gold, 500, 'center');
    else if (cf.text) text(cf.text, bx + bw / 2, ty, 30, warn ? '#ffb066' : C.gold, 500, 'center');
    if (!split) return;
    const dx = bx + bw + 24, dw = full - bw - 24;
    const hot = inside(dx, by, dw, bh);
    g.fillStyle = hot ? 'rgba(127,214,255,0.16)' : 'rgba(127,214,255,0.06)';
    g.fillRect(dx, by, dw, bh);
    corners(dx, by, dw, bh, 14, C.dim, 2);
    text(lb.decline, dx + dw / 2, ty, 28, hot ? C.white : C.cyan, 500, 'center');
    region(dx, by, dw, bh, () => cf.onDecline());
  }

  // 切到报告页并选中指定报告（新生成的报告重新打字）
  function showReport(key) {
    const i = state.data.reports.findIndex((r) => r.key === key);
    if (i < 0) return;
    state.tab = 1;
    state.repSel = i;
    state.typeT = 0;
    state.dirty = true;
  }

  // ---------- 鼠标 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canPoint = () => !state.world && state.open && state.k > 0.9 && state.boot >= 1 && !document.pointerLockElement;
  let onBlank = null;
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
  let pointerHold = false;
  addEventListener('pointerdown', (e) => {
    if (!canPoint() || e.button !== 0) return;
    const p = pick(e);
    const r = p && hitTest(p);
    if (r?.hold) pointerHold = true;
  });
  addEventListener('pointerup', () => { pointerHold = false; });
  addEventListener('pointercancel', () => { pointerHold = false; });
  addEventListener('click', (e) => {
    if (!canPoint()) return;
    if (e.target.closest('button')) return;
    const p = pick(e);
    // 点到平板外：能收起就收起（收起音）；当前收不起（待确认、接入中、过场）就是无效点击
    if (!p) { if (onBlank?.() === false) sound.play('ui/deny'); return; }
    const r = hitTest(p);
    if (r?.hold) return;
    // 点到可交互区域是确认音，点到平板空白是拒绝音
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
    const list = rows();
    const n = list.length;
    if (code === 'KeyA') setTab((state.tab + 1) % 2 === 0 ? 1 : 0);
    else if (code === 'KeyD') setTab((state.tab + 1) % 2);
    else if (code === 'KeyW' && state.tab === 0) { state.sel = (state.sel + n - 1) % n; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 0) { state.sel = (state.sel + 1) % n; state.typeT = 0; }
    else if (code === 'KeyW' && state.tab === 1) { const m = state.data.reports.length; state.repSel = (state.repSel + m - 1) % m; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 1) { const m = state.data.reports.length; state.repSel = (state.repSel + 1) % m; state.typeT = 0; }
    else if (code === 'KeyE' && state.tab === 0 && list[state.sel]?.fold) { sound.play('ui/click'); toggleFold(); return true; }
    else return false;
    sound.play('ui/hover');
    state.dirty = true;
    return true;
  }

  function toggle(on = !state.open) {
    if (on === state.open) return;
    sound.cloth();
    state.open = on;
    if (on) { state.boot = 0; state.typeT = 0; state.foldOpen = false; state.dirty = true; }
    else {
      state.hover = null;
      state.hack = null;
      document.body.style.cursor = '';
      pointerHold = false;
    }
  }

  // ---------- 每帧 ----------
  function update(dt) {
    const target = state.open ? 1 : 0;
    const speed = state.open ? 2.2 : 3.5;     // 举起约 0.45 秒，收起约 0.3 秒
    // 掉在地上时机身一直可见，open 只表示屏幕是否点亮
    state.k = state.world ? 1 : THREE.MathUtils.clamp(state.k + Math.sign(target - state.k) * dt * speed, 0, 1);
    rig.visible = state.k > 0;
    if (!rig.visible) return;
    const t = performance.now() / 1000;

    if (state.world) {
      rig.position.copy(state.world.pos);
      rig.quaternion.copy(state.world.quat);
      holder.position.set(0, 0, 0);
      holder.quaternion.identity();
    } else followCamera(dt, t);
    backing.visible = !!state.world;

    // 内容：举到位后开机，界面动画期间逐帧重绘
    if (state.open && state.k > 0.6) state.boot = Math.min(1, state.boot + dt * 1.8);
    // 开机、打字、确认进度、干扰期间逐帧重绘
    const animating = state.open && (state.boot < 1 || state.typeT < 10 || state.data.confirm?.p > 0 || state.glitch > 0 || !!state.data.final || (!!state.hack && !state.hack.held) || state.typing);
    if (state.open && state.boot >= 1) state.typeT += dt;
    // 接入画面：开机后计时，走完回调并回到普通页面
    if (state.hack && !state.hack.held && state.open && state.boot >= 1) {
      state.hack.t += dt;
      if (state.hack.t >= state.hack.cfg.done) {
        const f = state.hack.onDone;
        if (state.hack.cfg.hold) state.hack.held = true;
        else state.hack = null;
        state.typeT = 0;
        state.dirty = true;
        f?.();
      }
    }
    if (state.dirty || animating) {
      draw();
      applyBoot();
      tex.needsUpdate = true;
      state.dirty = false;
    }
    // 地上的平板：屏幕没点亮时完全不显示界面
    const a = state.world ? (state.open ? 1 : 0) : state.open ? 1 : state.k;
    screenMat.opacity = a;
    glassMat.opacity = state.world ? 1 : a;
    // 全息偶发闪烁：平均约 4 秒一次，持续不到 0.1 秒
    flickT -= dt;
    if (flickT <= 0 && Math.random() < dt * 0.25) flickT = 0.06 + Math.random() * 0.05;
    flicker.value = flickT > 0 ? 0.6 + Math.random() * 0.3 : 1;
    // 强干扰：亮度剧烈跳动，画面偏橙
    state.glitch = Math.max(0, state.glitch - dt);
    if (state.glitch > 0) flicker.value = Math.random() < 0.35 ? 0.15 : 1.4 + Math.random();
    tint.value.setRGB(1, 1, 1).lerp(_orange, Math.min(1, state.glitch * 3));
    // 状态灯呼吸（亮度略高于辉光阈值，带一点光晕）
    body.ledMat.color.setHex(0x30e0ff).multiplyScalar(1.2 + Math.sin(t * 2.4) * 0.8);
  }

  // 跟随相机：举起 / 收起动画 + 视角滞后 + 呼吸
  function followCamera(dt, t) {
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

    const x = state.open ? easeOutBack(state.k) : easeIn(state.k);
    holder.position.lerpVectors(HIDDEN.pos, SHOWN.pos, x);
    holder.position.x += sway.yaw * 0.25;
    holder.position.y += sway.pitch * 0.25 + Math.sin(t * 1.6) * 0.0025;
    qa.setFromEuler(HIDDEN.rot);
    qb.setFromEuler(new THREE.Euler(SHOWN.rot.x + sway.pitch * 0.6 + Math.sin(t * 1.1) * 0.006, sway.yaw * 0.6, Math.sin(t * 0.8) * 0.004));
    holder.quaternion.slerpQuaternions(qa, qb, Math.min(1, x));
  }

  return {
    uiScene,
    update,
    toggle,
    nav,
    setData,
    showReport,
    hack,
    showClue(id) {
      const c = state.data.clues.find((x) => x.id === id);
      if (!c) return;
      state.foldOpen = !!c.old;   // 跳到之前的线索时展开，跳到本轮线索时收起
      const i = rows().findIndex((x) => x.id === id);
      state.tab = 0; state.sel = i; state.typeT = 0; state.dirty = true;
    },
    get hacking() { return !!state.hack && !state.hack.held; },
    // 线索页正在显示、且结论已打出来的那条线索（没在看详情时为 null）
    get viewing() {
      if (!state.open || state.boot < 1 || state.hack || state.tab !== 0 || state.world) return null;
      const c = rows()[state.sel];
      if (!c || c.fold || state.typeT * 6 <= c.lines.length) return null;
      return c;
    },
    get actionHeld() { return pointerHold; },
    get actionVisible() { return !!state.actionOn; },
    // 屏幕点亮且有文字正在打出（开机扫描线期间不算）
    get typing() { return state.open && state.boot >= 1 && state.typing; },
    // 平板在世界里的位置（手持时在镜头前，结局时在地上）
    screenWorld(out) { holder.updateWorldMatrix(true, false); return holder.getWorldPosition(out); },
    glitch(sec = 0.5) { state.glitch = sec; state.dirty = true; },
    get open() { return state.open; },
    set onBlank(fn) { onBlank = fn; },
    get amount() { return state.world ? 0 : state.k; },   // 用于背景压暗与虚化（掉在地上时不压暗）
    // 结局：平板固定在世界坐标（屏幕先不亮，toggle(true) 点亮）；release 恢复跟随相机
    placeAt(pos, quat) {
      state.world = { pos: pos.clone(), quat: quat.clone() };
      state.open = false; state.hack = null; state.boot = 0; state.typeT = 0;
      state.hover = null; state.dirty = true;
    },
    release() { state.world = null; state.open = false; state.k = 0; },
  };
}
