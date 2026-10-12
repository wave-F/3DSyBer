import * as THREE from 'three/webgpu';
import { DECK_Y } from '../bridge.js';
import { rng } from '../textures.js';
import { markKeep } from './mask.js';

// 反转线索的场景道具：第二辆车的胎痕、车身右侧黄色刮漆、离开现场的血脚印

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 沿曲线铺一条胎痕带
function tireTrack(scene, curve, offsets, mat, steps = 30, width = 0.26) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(curve(i / steps));
  for (const off of offsets) {
    for (let i = 0; i < steps; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = b.clone().sub(a);
      const len = dir.length();
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(width, len + 0.05), mat);
      const nx = dir.z / len, nz = -dir.x / len;
      seg.position.set((a.x + b.x) / 2 + nx * off, DECK_Y + 0.021, (a.z + b.z) / 2 + nz * off);
      seg.rotation.order = 'YXZ';
      seg.rotation.set(-Math.PI / 2, Math.atan2(dir.x, dir.z), 0);
      scene.add(seg);
    }
  }
}

export function buildTwistProps(scene, carGroup) {
  // 1. 第二辆车（更宽的轮胎）：从右侧车道向左切入，碰撞后回正离开
  const skidMat = markKeep(new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.7, depthWrite: false }));
  const cutIn = (t) => new THREE.Vector3(-4.9 + Math.sin(Math.min(t, 1) * Math.PI * 0.5) * 1.6, 0, -30 + t * 14);
  tireTrack(scene, cutIn, [-0.85, 0.85], skidMat, 24, 0.3);
  const fadeMat = markKeep(new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.35, depthWrite: false }));
  const away = (t) => new THREE.Vector3(-3.3 - Math.sin(t * Math.PI * 0.5) * 1.1, 0, -16 + t * 9);
  tireTrack(scene, away, [-0.85, 0.85], fadeMat, 10, 0.3);

  // 2. 车身右侧（组内 +Z）的黄色刮漆
  const scrapeTex = canvasTex(512, 96, (g, w, h) => {
    const r = rng(5);
    for (let i = 0; i < 70; i++) {
      const y = h * 0.5 + (r() - 0.5) * h * 0.7;
      const x0 = r() * w * 0.3, x1 = w * (0.55 + r() * 0.45);
      g.strokeStyle = `rgba(${230 + r() * 25 | 0},${170 + r() * 50 | 0},20,${0.25 + r() * 0.6})`;
      g.lineWidth = 1 + r() * 4;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y + (r() - 0.5) * 10);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,30,20,0.5)';
    for (let i = 0; i < 40; i++) g.fillRect(r() * w * 0.8, h * 0.3 + r() * h * 0.4, 6 + r() * 30, 1 + r() * 2);
  });
  const scrapeMat = markKeep(new THREE.MeshStandardMaterial({
    map: scrapeTex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0.2,
    polygonOffset: true, polygonOffsetFactor: -4,
  }));
  const scrape = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.34), scrapeMat);
  scrape.position.set(-0.35, 0.58, 1.02);
  carGroup.add(scrape);

  // 3. 血脚印：从血泊出发，走向北侧（+Z）离开，越走越淡
  const shoeTex = canvasTex(64, 128, (g) => {
    g.fillStyle = 'rgba(120,8,10,0.95)';
    g.beginPath(); g.ellipse(32, 40, 20, 34, 0, 0, Math.PI * 2); g.fill();      // 前掌
    g.beginPath(); g.ellipse(32, 100, 15, 20, 0, 0, Math.PI * 2); g.fill();     // 后跟
    g.globalCompositeOperation = 'destination-out';
    for (let y = 12; y < 120; y += 7) g.fillRect(8, y, 48, 2);                    // 鞋底纹
  });
  const start = new THREE.Vector3(2.4, 0, 5.9), end = new THREE.Vector3(-1.6, 0, 15.5);
  const dir = end.clone().sub(start).normalize();
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const yaw = Math.atan2(dir.x, dir.z);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const mat = markKeep(new THREE.MeshStandardMaterial({
      map: shoeTex, transparent: true, depthWrite: false, roughness: 0.2, opacity: 0.95 * (1 - t * 0.85),
    }));
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.28), mat);
    const p = start.clone().lerp(end, t).addScaledVector(side, (i % 2 ? 1 : -1) * 0.12);
    fp.position.set(p.x, DECK_Y + 0.019, p.z);
    fp.rotation.order = 'YXZ';
    fp.rotation.set(-Math.PI / 2, yaw + Math.PI, 0);
    scene.add(fp);
  }
}
