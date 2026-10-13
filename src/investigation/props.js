import * as THREE from 'three/webgpu';
import { rng } from '../textures.js';
import { markKeep } from './mask.js';
import { addTireTracks } from '../tireTracks.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

// 第 2 轮的场景道具：第二辆车的胎痕、车身右侧黄色刮漆（第二辆车没有停，现场没有其他人的脚印）

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildTwistProps(scene, crash) {
  const carGroup = crash.carGroup;
  // 1. 第二辆车（更宽的轮胎）：从右侧车道向左切入，碰撞后回正离开
  const cutIn = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-4.9, 0, -30), new THREE.Vector3(-2.6, 0, -18),
    new THREE.Vector3(-3.3, 0, -16), new THREE.Vector3(-4.4, 0, -7),
  );
  addTireTracks(scene, cutIn, { offsets: [-0.85, 0.85], width: 0.265, seed: 705, opacity: 0.62, fadeOut: 0.45 });

  // 2. 车身右侧（组内 +Z）的黄色刮漆
  // 由后向前刮擦：左端（车尾方向）漆块厚，向右拖成细碎的擦痕并收窄；夹杂露出底材的银色划痕
  const scrapeTex = canvasTex(1024, 192, (g, w, h) => {
    const r = rng(5);
    const mid = (x) => h * (0.55 - 0.08 * (x / w));            // 擦痕带中线略微上扬
    const half = (x) => h * (0.3 - 0.2 * (x / w));              // 擦痕带半高：后宽前窄
    // 黄色转印漆：短而碎的笔触，越往前越稀
    for (let i = 0; i < 1800; i++) {
      const x = Math.pow(r(), 1.7) * w * 0.95;
      if (r() > 1 - x / w * 0.6) continue;
      const y = mid(x) + (r() * 2 - 1) * half(x) * (0.4 + 0.6 * r());
      const len = 6 + r() * (40 + 90 * (x / w));
      g.strokeStyle = `rgba(${225 + r() * 30 | 0},${165 + r() * 45 | 0},${15 + r() * 25 | 0},${(0.5 + r() * 0.5) * (1 - 0.45 * x / w)})`;
      g.lineWidth = 1.5 + r() * 4.5 * (1 - 0.7 * x / w);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y - len * 0.08 + (r() - 0.5) * 2);
      g.stroke();
    }
    // 漆块：后端几块较完整的转印
    for (let i = 0; i < 26; i++) {
      const x = r() * w * 0.32;
      const y = mid(x) + (r() * 2 - 1) * half(x) * 0.6;
      g.fillStyle = `rgba(240,${180 + r() * 30 | 0},30,${0.55 + r() * 0.35})`;
      g.beginPath();
      g.ellipse(x, y, 10 + r() * 34, 3 + r() * 7, -0.08, 0, Math.PI * 2);
      g.fill();
    }
    // 露出底材的划痕：细、长、浅灰
    for (let i = 0; i < 26; i++) {
      const x = r() * w * 0.6;
      const y = mid(x) + (r() * 2 - 1) * half(x) * 0.9;
      const len = 80 + r() * 380;
      g.strokeStyle = `rgba(205,210,205,${0.25 + r() * 0.35})`;
      g.lineWidth = 0.6 + r() * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y - len * 0.08 + (r() - 0.5) * 3);
      g.stroke();
    }
  });
  // 第 1 轮几乎看不出（暗、淡）；转折后随双闪反光发亮
  const scrapeMat = markKeep(new THREE.MeshStandardMaterial({
    map: scrapeTex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0.2,
    emissive: 0xffc030, emissiveMap: scrapeTex, emissiveIntensity: 0, opacity: 0.3,
    polygonOffset: true, polygonOffsetFactor: -4,
  }));
  // 贴花投影到车漆曲面上（平面贴片在车身收腰处会悬空）
  // 投影器朝向与车身一致：本地 +Z（车身右侧外法线）为投影方向
  crash.onCarReady(({ paintMeshes }) => {
    carGroup.updateMatrixWorld(true);
    const center = carGroup.localToWorld(new THREE.Vector3(-0.35, 0.56, 1.0));
    const orient = new THREE.Euler().setFromQuaternion(carGroup.getWorldQuaternion(new THREE.Quaternion()));
    const size = new THREE.Vector3(1.9, 0.36, 0.8);
    for (const mesh of paintMeshes) {
      mesh.updateMatrixWorld(true);
      const geo = new DecalGeometry(mesh, center, orient, size);
      if (geo.attributes.position.count === 0) { geo.dispose(); continue; }
      scene.add(new THREE.Mesh(geo, scrapeMat));
    }
  });

  return {
    // opacity：漆面可见度；glow：自发光强度（跟随双闪）
    setScrape(opacity, glow) {
      scrapeMat.opacity = opacity;
      scrapeMat.emissiveIntensity = glow;
    },
  };
}
