import * as THREE from 'three/webgpu';

// 可复现的伪随机数
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 远景楼外立面：深色 + 稀疏暖光窗（大部分窗是黑的）
export function farWindowTexture(seed, cols, rows) {
  const r = rng(seed);
  const cw = 16, ch = 16;
  const [c, g] = canvas(cols * cw, rows * ch);
  g.fillStyle = '#08090b';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = r();
      if (p < 0.07) g.fillStyle = `rgba(255,${190 + r() * 30 | 0},${110 + r() * 40 | 0},${0.5 + r() * 0.5})`;
      else if (p < 0.085) g.fillStyle = 'rgba(190,225,255,0.8)';
      else if (p < 0.09) g.fillStyle = 'rgba(255,80,200,0.9)';
      else g.fillStyle = '#0c0e11';
      g.fillRect(x * cw + 3, y * ch + 5, cw - 6, ch - 8);
    }
  }
  return toTexture(c);
}

// 亮窗的室内效果：暖光房间、百叶窗、半拉窗帘、电视蓝光
export function litWindowTextures() {
  const S = 128;
  const make = (draw) => { const [c, g] = canvas(S, S); draw(g); return toTexture(c); };
  const room = (g, top, bottom) => {
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  };
  return [
    make((g) => { // 暖光房间 + 家具剪影
      room(g, '#ffe2b0', '#8a5a30');
      g.fillStyle = 'rgba(20,10,5,0.85)';
      g.fillRect(10, 86, 50, 42);
      g.fillRect(84, 70, 30, 58);
    }),
    make((g) => { // 百叶窗
      room(g, '#ffd9a0', '#b07a40');
      g.fillStyle = 'rgba(30,18,8,0.75)';
      for (let y = 0; y < S; y += 10) g.fillRect(0, y, S, 4);
    }),
    make((g) => { // 半拉窗帘
      room(g, '#fff0d0', '#c09060');
      g.fillStyle = 'rgba(60,20,20,0.92)';
      g.fillRect(0, 0, 38, S);
      g.fillRect(96, 0, 32, S);
    }),
    make((g) => { // 电视蓝光
      room(g, '#3a5a88', '#0c1830');
      g.fillStyle = 'rgba(170,220,255,0.9)';
      g.fillRect(70, 60, 40, 26);
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.fillRect(20, 80, 40, 48);
    }),
  ];
}

// 霓虹管招牌：深色底板 + 彩色辉光 + 白色灯管芯
export function neonSignTexture(text, color, vertical) {
  const chars = [...text];
  const size = 160;
  let c, g;
  if (vertical) {
    [c, g] = canvas(size, size * chars.length + 40);
  } else {
    const [m, mg] = canvas(8, 8);
    mg.font = 'bold 110px "Helvetica Neue", "PingFang SC", sans-serif';
    [c, g] = canvas(Math.ceil(mg.measureText(text).width) + 90, size);
  }
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#120a16');
  bg.addColorStop(1, '#07050a');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.lineWidth = 5;
  g.strokeRect(12, 12, c.width - 24, c.height - 24);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const drawText = (fn) => {
    if (vertical) chars.forEach((ch, i) => fn(ch, c.width / 2, 20 + size / 2 + i * size));
    else fn(text, c.width / 2, c.height / 2 + 6);
  };
  g.font = vertical ? 'bold 116px "PingFang SC", sans-serif' : 'bold 110px "Helvetica Neue", "PingFang SC", sans-serif';
  g.lineWidth = 12;
  g.shadowBlur = 30;
  drawText((t, x, y) => g.strokeText(t, x, y));
  // 灯管芯：带一点本色的浅色，避免过曝成纯白
  g.fillStyle = `color-mix(in srgb, ${color} 45%, white)`;
  g.shadowBlur = 10;
  drawText((t, x, y) => g.fillText(t, x, y));
  return toTexture(c);
}

// 灯箱招牌：亮色底 + 深色字（日式小店常见）
export function lightboxTexture(text, bgColor, textColor, vertical) {
  const chars = [...text];
  const size = 150;
  const [c, g] = vertical ? canvas(size, size * chars.length + 30) : canvas(size * chars.length * 0.95 + 60, size);
  g.fillStyle = bgColor;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, 0, c.width, 8);
  g.fillRect(0, c.height - 8, c.width, 8);
  g.fillStyle = textColor;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 112px "PingFang SC", sans-serif';
  if (vertical) chars.forEach((ch, i) => g.fillText(ch, c.width / 2, 15 + size / 2 + i * size));
  else g.fillText(text, c.width / 2, c.height / 2 + 4);
  return toTexture(c);
}

// 高速公路指示牌
export function highwaySignTexture(lines) {
  const [c, g] = canvas(1024, 384);
  g.fillStyle = '#0b4a33';
  g.fillRect(0, 0, 1024, 384);
  g.strokeStyle = '#e8f0ea';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 996, 356);
  g.fillStyle = '#f2f6f2';
  g.textBaseline = 'middle';
  g.font = 'bold 120px "PingFang SC", sans-serif';
  g.fillText(lines[0], 50, 130);
  g.font = 'bold 72px "Helvetica Neue", sans-serif';
  g.fillText(lines[1], 54, 270);
  g.font = 'bold 200px "Helvetica Neue", sans-serif';
  g.textAlign = 'right';
  g.fillText(lines[2], 980, 200);
  return toTexture(c);
}

// LED 点阵跑马灯（水平可平铺）
export function tickerTexture(text, color) {
  const [c, g] = canvas(2048, 64);
  g.fillStyle = '#050403';
  g.fillRect(0, 0, 2048, 64);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.font = 'bold 50px "PingFang SC", "Helvetica Neue", sans-serif';
  g.fillText(text, 20, 34);
  g.fillStyle = '#050403';
  for (let x = 0; x < 2048; x += 4) g.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 2048, 1);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// 楼顶企业标志：黑底（加法混合 = 透明）+ 霓虹立体字 + 下方细线
export function logoTexture(text, color, sub = '') {
  const [m, mg] = canvas(8, 8);
  mg.font = 'bold 150px "Helvetica Neue", "PingFang SC", sans-serif';
  const w = Math.ceil(mg.measureText(text).width) + 120;
  const [c, g] = canvas(w, sub ? 280 : 220);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 150px "Helvetica Neue", "PingFang SC", sans-serif';
  g.shadowColor = color;
  g.shadowBlur = 40;
  g.fillStyle = color;
  g.fillText(text, w / 2, 110);
  g.shadowBlur = 12;
  g.fillStyle = `color-mix(in srgb, ${color} 55%, white)`;
  g.fillText(text, w / 2, 110);
  if (sub) {
    g.font = 'bold 44px "Helvetica Neue", "PingFang SC", sans-serif';
    g.shadowBlur = 16;
    g.fillStyle = color;
    g.fillText(sub, w / 2, 230);
  }
  return toTexture(c);
}

// 巨型建筑编号
export function idTexture(text, color) {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 20;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 300px "Helvetica Neue", sans-serif';
  g.fillText(text, 256, 270);
  return toTexture(c);
}

// 加载 public/assets 下的贴图
const loader = new THREE.TextureLoader();
export function loadTexture(name, srgb = true) {
  const t = loader.load(`/assets/${name}`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// 水洼遮罩：可平铺的灰度斑块
export function puddleTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const r = rng(31);
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, rad = 10 + r() * 60;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 车道线：透明底，只画线（沿 v 方向重复）
export function laneTexture() {
  const [c, g] = canvas(512, 512);
  const line = (x, w, color, dashed) => {
    g.fillStyle = color;
    if (dashed) {
      g.fillRect(x - w / 2, 0, w, 200);
    } else {
      g.fillRect(x - w / 2, 0, w, 512);
    }
  };
  line(14, 6, '#d8d8d8', false);
  line(498, 6, '#d8d8d8', false);
  line(256 - 5, 4, '#e0b030', false);
  line(256 + 5, 4, '#e0b030', false);
  line(135, 5, '#cfcfcf', true);
  line(377, 5, '#cfcfcf', true);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 血迹：不规则深红色斑块
export function bloodTexture(seed) {
  const r = rng(seed);
  const [c, g] = canvas(256, 256);
  for (let i = 0; i < 14; i++) {
    const x = 128 + (r() - 0.5) * 110;
    const y = 128 + (r() - 0.5) * 110;
    const rad = 20 + r() * 50;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(150,10,14,0.95)');
    grad.addColorStop(0.75, 'rgba(110,6,10,0.9)');
    grad.addColorStop(1, 'rgba(80,0,4,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

// 烟雾粒子
export function smokeTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}
