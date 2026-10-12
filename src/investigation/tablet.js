import * as THREE from 'three/webgpu';
import { mrt, float, uv, vec2, vec3, color, smoothstep, sin, fract, texture, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { REPORT } from './clues.js';
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
const FIELD_TOTAL = REPORT.reduce((n, s) => n + s.fields.length, 0);
const TABS = ['线索', '事件', '结论'];

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
  lg.fillText('NCPD  ·  FORENSIC UNIT  ·  FX-7', 512, 25);
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

export function createTablet(camera, { onStamp } = {}) {
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
  screenMat.colorNode = rgb.mul(scan.add(band)).mul(flicker).mul(1.25);
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
    data: { clues: [], events: [], conclusion: null },
    // 鼠标交互：hover 为画布坐标；regions 为本帧可点击区域（绘制时重建）
    hover: null, regions: [],
    // 结案报告：填写内容、正在输入的字段、展开的下拉框、盖章动画进度
    report: {}, focus: null, drop: null, stamped: false, stampT: 0,
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
    text('CASE FILE · 案件档案', 70, 104, 26, C.dim, 400, 'left', true);
    text('湾岸线 B7 高架 · 车辆坠桥事故', 70, 150, 40, C.white, 500);
    const found = clues.filter((c) => c.done).length;
    text(`线索 ${found} / ${clues.length}`, CW - 70, 104, 26, C.dim, 400, 'right', true);
    text(state.stamped ? '已结案' : '调查中', CW - 70, 150, 36, state.stamped ? C.gold : C.cyan, 500, 'right');

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
    blurField();
    state.drop = null;
    state.tab = i;
    state.typeT = 0;
    state.dirty = true;
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
      } else if (inside(70, y, 470, rowH - 8)) {
        g.fillStyle = 'rgba(127,214,255,0.07)';
        g.fillRect(70, y, 470, rowH - 8);
      }
      region(70, y, 470, rowH - 8, () => { if (state.sel !== i) { state.sel = i; state.typeT = 0; } });
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

  // ---------- 结案报告 ----------
  const ROW_H = 70, LABEL_W = 150;
  const filledCount = () => REPORT.reduce((n, s) => n + s.fields.filter((f) => String(state.report[f.id] ?? '').trim()).length, 0);

  function drawReport() {
    const lock = state.stamped;
    const cols = [{ x: 70, w: 690 }, { x: 840, w: 690 }];
    let dropField = null, dropRect = null;
    REPORT.forEach((sec, si) => {
      const { x, w } = cols[si];
      text(sec.title, x, 310, 24, C.cyan, 500);
      g.fillStyle = C.faint;
      g.fillRect(x, 326, w, 1);
      sec.fields.forEach((f, i) => {
        const y = 340 + i * ROW_H;
        const r = drawField(f, x, y, w, lock);
        if (r) { dropField = f; dropRect = r; }
      });
    });

    // 底部：填写进度 + 盖章按钮
    const n = filledCount();
    const ready = n >= FIELD_TOTAL;
    text(`已填写 ${n} / ${FIELD_TOTAL}`, 70, 880, 24, ready ? C.gold : C.dim, 400, 'left', true);
    text(lock ? '报告已提交，案件归档。' : '根据收集到的线索填写报告，填写完整后盖章结案。', 70, 920, 22, C.dim);
    const bx = CW - 70 - 340, by = 840, bw = 340, bh = 92;
    const hot = ready && !lock && inside(bx, by, bw, bh);
    g.fillStyle = lock ? 'rgba(255,74,58,0.06)' : ready ? (hot ? 'rgba(255,207,106,0.3)' : 'rgba(255,207,106,0.14)') : 'rgba(127,214,255,0.04)';
    g.fillRect(bx, by, bw, bh);
    corners(bx, by, bw, bh, 18, lock ? C.red : ready ? C.gold : C.faint, 3);
    const label = lock ? '已 结 案' : ready ? '盖章结案' : `尚有 ${FIELD_TOTAL - n} 项未填`;
    text(label, bx + bw / 2, by + 58, ready || lock ? 34 : 26, lock ? C.red : ready ? (hot ? C.white : C.gold) : C.dim, 500, 'center');
    if (ready && !lock) region(bx, by, bw, bh, stamp);

    // 下拉框最后画，盖在其他字段上面（加法混合，先清空底下的内容）
    if (dropField) drawDropdown(dropField, dropRect);
    if (state.stamped) drawStamp();
  }

  // 返回值：展开的下拉框位置（在 drawReport 最后绘制）
  function drawField(f, x, y, w, lock) {
    const v = String(state.report[f.id] ?? '');
    text(f.label, x, y + 40, 26, v ? '#bfe4f7' : C.dim);
    const cx = x + LABEL_W, cw = w - LABEL_W;

    if (f.type === 'radio') {
      let ox = cx + 6;
      for (const opt of f.options) {
        const bw = 34 + measure(opt, 26) + 30;
        const on = v === opt;
        const hot = !lock && inside(ox, y + 6, bw, 50);
        g.strokeStyle = on ? C.gold : hot ? C.cyan : C.dim;
        g.lineWidth = 2;
        g.strokeRect(ox, y + 18, 22, 22);
        if (on) { g.fillStyle = C.gold; g.fillRect(ox + 5, y + 23, 12, 12); }
        text(opt, ox + 34, y + 39, 26, on ? C.white : hot ? '#d6effc' : C.dim, on ? 500 : 400);
        if (!lock) region(ox, y + 6, bw, 50, () => { state.report[f.id] = opt; });
        ox += bw;
      }
      return null;
    }

    const focus = state.focus === f.id;
    const open = state.drop === f.id;
    const hot = !lock && inside(cx, y + 4, cw, 52);
    g.fillStyle = focus || open ? 'rgba(127,214,255,0.14)' : hot ? 'rgba(127,214,255,0.08)' : 'rgba(127,214,255,0.03)';
    g.fillRect(cx, y + 4, cw, 50);
    g.fillStyle = focus || open ? C.cyan : v ? C.dim : C.faint;
    g.fillRect(cx, y + 52, cw, 2);

    if (f.type === 'text') {
      if (v) text(v, cx + 16, y + 40, 28, C.white, 500);
      else if (!focus) text(lock ? '—' : '点击输入', cx + 16, y + 39, 24, C.faint);
      if (focus && Math.floor(performance.now() / 500) % 2 === 0) {
        g.fillStyle = C.cyan;
        g.fillRect(cx + 16 + (v ? measure(v, 28, 500) : 0) + 3, y + 14, 3, 32);
      }
      if (!lock) region(cx, y + 4, cw, 52, (e) => focusField(f, e), { cursor: 'text' });
      return null;
    }

    // choice：下拉选择
    if (v) text(v, cx + 16, y + 40, 28, C.white, 500);
    else text(lock ? '—' : '请选择', cx + 16, y + 39, 24, C.faint);
    if (!lock) {
      text(open ? '▴' : '▾', cx + cw - 20, y + 39, 24, hot || open ? C.cyan : C.dim, 400, 'right');
      region(cx, y + 4, cw, 52, () => { blurField(); state.drop = open ? null : f.id; });
    }
    return open ? { x: cx, y, w: cw } : null;
  }

  function drawDropdown(f, r) {
    const ih = 54, h = f.options.length * ih + 12;
    // 下方放不下时向上展开
    const top = r.y + 58 + h > CH - 30 ? r.y - h - 2 : r.y + 58;
    g.clearRect(r.x - 4, top - 4, r.w + 8, h + 8);
    g.fillStyle = 'rgba(30,80,120,0.35)';
    g.fillRect(r.x, top, r.w, h);
    corners(r.x, top, r.w, h, 14, C.cyan, 2);
    region(r.x, top, r.w, h, () => {}, { drop: true }); // 点到空隙不关闭
    f.options.forEach((opt, i) => {
      const y = top + 6 + i * ih;
      const on = state.report[f.id] === opt;
      const hot = inside(r.x, y, r.w, ih);
      if (hot || on) { g.fillStyle = hot ? 'rgba(127,214,255,0.2)' : 'rgba(255,207,106,0.1)'; g.fillRect(r.x + 4, y, r.w - 8, ih); }
      text(opt, r.x + 20, y + 37, 26, on ? C.gold : hot ? C.white : '#bfe4f7', on ? 500 : 400);
      region(r.x, y, r.w, ih, () => { state.report[f.id] = opt; state.drop = null; }, { drop: true });
    });
  }

  function drawStamp() {
    const p = Math.min(1, state.stampT / 0.28);
    const s = 1 + 1.6 * (1 - p) ** 2;
    g.save();
    g.translate(1130, 600);
    g.rotate(-0.17);
    g.scale(s, s);
    g.globalAlpha = p * 0.9;
    g.strokeStyle = C.red;
    g.lineWidth = 8;
    g.strokeRect(-240, -95, 480, 190);
    g.lineWidth = 3;
    g.strokeRect(-222, -77, 444, 154);
    text('已 结 案', 0, 22, 88, C.red, 700, 'center');
    text('CASE CLOSED · NCPD', 0, 62, 22, C.red, 400, 'center', true);
    g.restore();
    g.globalAlpha = 1;
  }

  function stamp() {
    if (state.stamped) return;
    blurField();
    state.drop = null;
    state.stamped = true;
    state.stampT = 0;
    onStamp?.({ ...state.report });
  }

  // ---------- 文字输入 ----------
  // 画布不能直接打字，用一个透明的 input 接收键盘和输入法，内容同步画到平板上
  const input = document.createElement('input');
  input.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:30px;opacity:0;border:0;padding:0;font-size:16px;pointer-events:none;';
  input.autocomplete = 'off';
  document.body.appendChild(input);
  input.addEventListener('input', () => {
    if (state.focus) { state.report[state.focus] = input.value; state.dirty = true; }
  });
  input.addEventListener('blur', () => { state.focus = null; state.dirty = true; });

  function focusField(f, e) {
    state.drop = null;
    state.focus = f.id;
    input.maxLength = f.max ?? 20;
    input.value = String(state.report[f.id] ?? '');
    // 输入法候选框跟随点击位置
    input.style.left = `${e.clientX}px`;
    input.style.top = `${e.clientY + 12}px`;
    input.focus();
    const n = input.value.length;
    input.setSelectionRange(n, n);
  }
  function blurField() {
    if (document.activeElement === input) input.blur();
    state.focus = null;
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
    document.body.style.cursor = r ? (r.cursor ?? 'pointer') : '';
    state.dirty = true;
  });
  addEventListener('click', (e) => {
    if (!canPoint()) return;
    const p = pick(e);
    const r = p && hitTest(p);
    // 下拉框展开时，点到框外只关闭下拉框
    if (state.drop && !(r && r.drop)) state.drop = null;
    else if (r) r.fn(e);
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
  // 返回 true 表示按键已被平板处理
  function nav(code) {
    if (!state.open) return false;
    // 正在打字：按键都交给输入框，Enter / Esc 结束输入
    if (state.focus) {
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Escape') blurField();
      return true;
    }
    if (state.drop) {
      if (code === 'Escape') { state.drop = null; state.dirty = true; }
      return true;
    }
    const n = state.data.clues.length;
    if (code === 'KeyA') setTab((state.tab + TABS.length - 1) % TABS.length);
    else if (code === 'KeyD') setTab((state.tab + 1) % TABS.length);
    else if (code === 'KeyW' && state.tab === 0) { state.sel = (state.sel + n - 1) % n; state.typeT = 0; }
    else if (code === 'KeyS' && state.tab === 0) { state.sel = (state.sel + 1) % n; state.typeT = 0; }
    else return false;
    state.dirty = true;
    return true;
  }

  function toggle(on = !state.open) {
    state.open = on;
    if (on) { state.boot = 0; state.typeT = 0; state.dirty = true; }
    else {
      blurField();
      state.drop = null;
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
    if (state.stamped) state.stampT += dt;
    // 光标闪烁、盖章动画期间也逐帧重绘
    const animating = state.open && (state.boot < 1 || state.typeT < 2 || state.focus || (state.stamped && state.stampT < 0.5));
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
    // 状态灯呼吸（亮度略高于辉光阈值，带一点光晕）
    body.ledMat.color.setHex(0x30e0ff).multiplyScalar(1.2 + Math.sin(t * 2.4) * 0.8);
  }

  return {
    uiScene,
    update,
    toggle,
    nav,
    setData,
    get open() { return state.open; },
    get report() { return { ...state.report }; },
    get stamped() { return state.stamped; },
    get amount() { return state.k; },   // 用于背景压暗与虚化
  };
}
