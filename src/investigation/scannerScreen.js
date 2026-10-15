import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { neonEnvironment } from './scannerMaterial.js';

// 扫描枪背面（朝向玩家的一端）的小屏幕：圆角边框 + 玻璃面 + Canvas 实时绘制
// 坐标是握把原点空间（viewmodel.js 的 device group）：前方 -Z，上方 +Y
// 机头背面在 z ≈ -0.006 处基本是平的，x ±0.022、y 0.050~0.082；屏幕盖住原模型背面的凹槽
const SCREEN_POS = new THREE.Vector3(0, 0.0685, -0.0055);
const BEZEL = { w: 0.042, h: 0.028, d: 0.004 };
const GLASS = { w: 0.0365, h: 0.0225 };

const CW = 256;
const CH = 176;
const FPS = 20;

const COLOR = {
  ready: '#5fd8e8',
  sweep: '#9ef3ff',
  analyze: '#ff4fb0',
  match: '#7dffc8',
};

export function createScannerScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const group = new THREE.Group();
  group.position.copy(SCREEN_POS);

  const bezel = new THREE.Mesh(
    new RoundedBoxGeometry(BEZEL.w, BEZEL.h, BEZEL.d, 3, 0.0018),
    new THREE.MeshPhysicalMaterial({
      color: 0x0c0f13, roughness: 0.38, metalness: 0.7,
      clearcoat: 0.4, clearcoatRoughness: 0.25,
      envMap: neonEnvironment(), envMapIntensity: 0.5,
    }),
  );
  // 屏幕：黑色玻璃底 + 自发光画面，上面还能映出一点灯条
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(GLASS.w, GLASS.h),
    new THREE.MeshPhysicalMaterial({
      color: 0x010203, roughness: 0.12, metalness: 0,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1,
      envMap: neonEnvironment(), envMapIntensity: 0.35,
    }),
  );
  glass.position.z = BEZEL.d / 2 + 0.0002;
  group.add(bezel, glass);

  let acc = 1;
  let t = 0;
  let sweepT = -1;   // 发射后的计时，SWEEP 画面在动作结束后再停留一小会

  // s: { visible, scanT, raise, analyzing, progress, flash, target, camPos }
  function update(dt, s) {
    t += dt;
    if (s.scanT >= s.raise && sweepT < 0) sweepT = 0;
    if (sweepT >= 0) sweepT += dt;
    if (s.scanT < 0 && sweepT > 1.6) sweepT = -1;
    if (!s.visible) return;
    acc += dt;
    if (acc < 1 / FPS) return;
    acc = 0;
    draw(s);
  }

  function state(s) {
    if (s.analyzing) return s.progress >= 1 ? 'match' : 'analyze';
    if (s.scanT >= 0 || sweepT >= 0) return s.scanT >= 0 && s.scanT < s.raise ? 'charge' : 'sweep';
    return 'ready';
  }

  function draw(s) {
    const st = state(s);
    const col = COLOR[st] ?? COLOR.sweep;
    const g = ctx;
    g.fillStyle = '#02070a';
    g.fillRect(0, 0, CW, CH);
    // 背景网格
    g.strokeStyle = 'rgba(95,216,232,0.07)';
    g.lineWidth = 1;
    for (let x = 0; x < CW; x += 16) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, CH); g.stroke(); }
    for (let y = 0; y < CH; y += 16) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(CW, y + 0.5); g.stroke(); }

    // 顶栏：型号 + 状态灯 + 电量
    g.fillStyle = col;
    g.font = 'bold 18px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    g.fillText('SCN-07', 12, 17);
    if ((t * 2) % 1 < 0.6) { g.beginPath(); g.arc(100, 17, 4, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 4; i++) {
      g.globalAlpha = i < 3 ? 1 : 0.25;
      g.fillRect(CW - 58 + i * 11, 10, 8, 14);
    }
    g.globalAlpha = 1;
    g.fillRect(12, 32, CW - 24, 2);

    // 主状态字
    const label = {
      ready: 'READY', charge: 'CHARGE', sweep: 'SWEEP', analyze: 'ANALYZE', match: 'MATCH',
    }[st];
    g.font = 'bold 40px ui-monospace, Menlo, monospace';
    g.textAlign = 'left';
    g.fillText(label, 12, 64);

    // 示波器
    const mid = 112;
    let amp = 3;
    if (st === 'charge') amp = 4 + 10 * Math.min(1, s.scanT / s.raise);
    if (st === 'sweep') amp = 16 * Math.exp(-Math.max(0, sweepT) * 1.6) + 3;
    if (st === 'analyze') amp = 6 + 12 * s.progress;
    if (st === 'match') amp = 2;
    g.strokeStyle = col;
    g.lineWidth = 2.5;
    g.beginPath();
    for (let x = 12; x <= CW - 12; x += 3) {
      const u = x / CW;
      let y = Math.sin(u * 22 + t * 9) * 0.6 + Math.sin(u * 51 - t * 14) * 0.3 + (Math.random() - 0.5) * 0.5;
      if (st === 'match') y += Math.exp(-(((u - 0.5) * 14) ** 2)) * -8;
      if (x === 12) g.moveTo(x, mid + y * amp); else g.lineTo(x, mid + y * amp);
    }
    g.stroke();

    // 底栏：分析进度 / 目标信息
    const by = 146;
    g.lineWidth = 2;
    g.strokeRect(12, by, CW - 24, 18);
    let fill = 0;
    if (st === 'charge') fill = Math.min(1, s.scanT / s.raise);
    else if (st === 'sweep') fill = Math.max(0, 1 - sweepT / 1.6);
    else if (st === 'analyze' || st === 'match') fill = Math.min(1, s.progress);
    if (fill > 0) g.fillRect(15, by + 3, (CW - 30) * fill, 12);
    g.font = 'bold 16px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    if (st === 'analyze' || st === 'match') {
      g.fillText(`${Math.round(Math.min(1, s.progress) * 100)}%`, CW - 12, 64 - 6);
      if (s.target && s.camPos) {
        g.fillText(`${s.target.distanceTo(s.camPos).toFixed(1)}m`, CW - 12, 64 + 12);
        g.textAlign = 'left';
        g.fillText(`TGT ${targetId(s.target)}`, 12, 134);
      }
    } else {
      g.textAlign = 'left';
      g.globalAlpha = 0.6;
      g.fillText('TGT ----', 12, 134);
      g.globalAlpha = 1;
    }
    g.textAlign = 'left';

    // 扫描线 + 发射闪白
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < CH; y += 3) g.fillRect(0, y, CW, 1);
    if (s.flash > 0.01) {
      g.fillStyle = `rgba(200,250,255,${Math.min(0.5, s.flash * 0.5)})`;
      g.fillRect(0, 0, CW, CH);
    }

    tex.needsUpdate = true;
  }

  return { group, update };
}

// 目标位置哈希成 4 位十六进制编号，同一个线索每次一样
function targetId(p) {
  const h = (Math.floor(p.x * 37.1) * 73856093) ^ (Math.floor(p.y * 51.7) * 19349663) ^ (Math.floor(p.z * 29.3) * 83492791);
  return ((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}
