import * as THREE from 'three/webgpu';
import { rng, farWindowTexture } from './textures.js';
import { HALF_W } from './bridge.js';
import { createBuildingKit } from './buildings.js';
import { createSignKit } from './signs.js';
import { MEGA } from './sky.js';

const NEAR_STYLES = [['resi', 0.38], ['kitsch', 0.27], ['office', 0.25], ['corp', 0.1]];
const MID_STYLES = [['office', 0.35], ['corp', 0.25], ['resi', 0.3], ['kitsch', 0.1]];

export function buildCity(scene) {
  const r = rng(2077);
  const weighted = (list) => {
    let x = r();
    for (const [v, w] of list) { if ((x -= w) <= 0) return v; }
    return list[0][0];
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: 0x07090a, roughness: 0.4, metalness: 0.3 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const kit = createBuildingKit();
  const signs = createSignKit(scene, r);
  const screenLights = [];

  for (const side of [-1, 1]) {
    // 第一排：紧邻高架，招牌最密
    for (let z = -270; z < 270;) {
      const d = 18 + r() * 16, w = 16 + r() * 12;
      const x0 = HALF_W + 12 + r() * 6;
      const b = kit.building({ x: side * (x0 + w / 2), z: z + d / 2, w, d, h: 32 + r() * 70, style: weighted(NEAR_STYLES), side, r });
      decorate(b, side, true);
      z += d + 3 + r() * 9;
    }
    // 第二排：更高，招牌少一些
    for (let z = -280; z < 280;) {
      const d = 22 + r() * 20, w = 20 + r() * 16;
      const x0 = 56 + r() * 14;
      const b = kit.building({ x: side * (x0 + w / 2), z: z + d / 2, w, d, h: 60 + r() * 110, style: weighted(MID_STYLES), side, r });
      decorate(b, side, false);
      z += d + 4 + r() * 14;
    }
  }
  kit.finish(scene);
  buildFarCity(scene, r);

  // 离事故现场最近的几块大屏给桥面投下彩色光
  screenLights.sort((a, b) => Math.abs(a.z) - Math.abs(b.z));
  for (const s of screenLights.slice(0, 6)) {
    const light = new THREE.PointLight(s.color, 100, 45, 2); // 原 260，太强会把桥面整体染色
    light.position.copy(s.pos);
    scene.add(light);
  }

  function decorate(b, side, near) {
    for (const face of b.faces) {
      if (face.sec > 1) continue;
      const yMin = Math.max(face.y0 + 3, 5);
      const yMax = Math.min(face.y1 - 2, near ? 48 : 70);
      if (yMax - yMin < 4) continue;
      const used = [];
      const free = (u0, u1, y0, y1) => used.every((q) => u1 < q[0] || u0 > q[1] || y1 < q[2] || y0 > q[3]);
      const tryPlace = (w, h, fn, tries = 8, uFix = null) => {
        for (let i = 0; i < tries; i++) {
          const u = uFix !== null ? uFix : (r() - 0.5) * Math.max(0, face.width - w - 1);
          const y = yMin + h / 2 + r() * Math.max(0, yMax - yMin - h);
          if (Math.abs(u) + w / 2 > face.width / 2 + 0.01) return;
          if (free(u - w / 2 - 0.4, u + w / 2 + 0.4, y - h / 2 - 0.4, y + h / 2 + 0.4)) {
            used.push([u - w / 2, u + w / 2, y - h / 2, y + h / 2]);
            fn(u, y);
            return;
          }
        }
      };

      if (face.toBridge) {
        // LED 大屏
        if (face.width > 10 && r() < (near ? 0.6 : 0.6)) {
          const vertical = r() < 0.3;
          const w = vertical ? 6 + r() * 2 : Math.min(face.width * 0.65, 11 + r() * 6);
          const h = vertical ? w * 1.6 : w * 9 / 16;
          if (h < yMax - yMin) {
            tryPlace(w, h, (u, y) => {
              signs.screen(face, u, y, w, h);
              const pos = face.c.clone().addScaledVector(face.t, u).addScaledVector(face.n, 6);
              pos.y = y;
              screenLights.push({ pos, z: pos.z, color: new THREE.Color(signs.neonHex[Math.floor(r() * signs.neonHex.length)]) });
            });
          }
        }
        // 平贴招牌
        const nFlat = near ? 2 + Math.floor(r() * 4) : 1 + Math.floor(r() * 2);
        for (let i = 0; i < nFlat; i++) {
          const vertical = r() < 0.35;
          const w = vertical ? 1.6 + r() * 0.6 : 4 + r() * 5;
          const h = vertical ? 6 + r() * 4 : 1.6 + r() * 1.0;
          tryPlace(w, h, (u, y) => signs.flat(face, u, y, w, h, vertical));
        }
        // 竖向挑牌（沿桥方向能看到）
        if (near) {
          const nBlade = 2 + Math.floor(r() * 3);
          for (let i = 0; i < nBlade; i++) {
            const edge = (r() < 0.5 ? -1 : 1) * (face.width / 2 - 1.2 - r() * face.width * 0.3);
            tryPlace(0.6, 9, (u, y) => signs.blade(face, u, y, 1.6 + r() * 0.6, 10), 6, edge);
          }
        }
      } else if (near) {
        // 侧立面：靠桥一端挂竖招牌
        const uBridge = -side * face.t.x * (face.width / 2 - 1.5);
        tryPlace(2, 8, (u, y) => signs.flat(face, u, y, 1.8, 8, true), 6, uBridge);
        if (r() < 0.6) tryPlace(2, 8, (u, y) => signs.flat(face, u, y, 1.8, 8, true), 6, uBridge * 0.6);
        if (r() < 0.7) tryPlace(5, 2.2, (u, y) => signs.flat(face, u, y, 5, 2.2, false));
        if (r() < 0.6) tryPlace(0.6, 9, (u, y) => signs.blade(face, u, y, 1.8, 9), 6, uBridge * 0.3);
      }
    }
    // 楼顶广告牌
    if (near && b.roofY < 75 && r() < 0.35) {
      const t = b.top;
      const w = Math.min(t.hd * 2 - 2, 12 + r() * 6);
      if (w > 8) signs.rooftop(t.cx - side * (t.hw - 2), t.y1 + 0.6, t.cz, new THREE.Vector3(-side, 0, 0), w, w * 9 / 16);
    }
  }
}

// 远景楼群：实例化方盒 + 稀疏暖光窗
function buildFarCity(scene, r) {
  const list = [];
  const add = (x, z) => {
    const w = 18 + r() * 26, d = 18 + r() * 26;
    if (Math.abs(x) - w / 2 < 100 && Math.abs(z) < 290) return;
    if (MEGA.some((m) => Math.abs(x - m.x) < (w + m.w) / 2 && Math.abs(z - m.z) < (d + m.d) / 2)) return;
    list.push({ x, z, w, d, h: 40 + r() * 200 });
  };
  for (let x = 110; x < 520; x += 38) {
    for (let z = -700; z < 700; z += 34) {
      add(x + r() * 10, z + r() * 10);
      add(-x - r() * 10, z + r() * 10);
    }
  }
  for (let x = 20; x < 110; x += 36) {
    for (const s of [-1, 1]) {
      for (let z = 300; z < 700; z += 34) {
        add(s * (x + r() * 8), z + r() * 10);
        add(s * (x + r() * 8), -z - r() * 10);
      }
    }
  }

  const tiers = [
    { max: 90, tex: farWindowTexture(11, 12, 26) },
    { max: 160, tex: farWindowTexture(22, 12, 46) },
    { max: Infinity, tex: farWindowTexture(33, 12, 70) },
  ];
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.9 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let min = 0;
  for (const tier of tiers) {
    const sub = list.filter((b) => b.h > min && b.h <= tier.max);
    min = tier.max;
    const side = new THREE.MeshStandardMaterial({
      map: tier.tex, emissiveMap: tier.tex, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.7,
    });
    const mesh = new THREE.InstancedMesh(geo, [side, side, roofMat, roofMat, side, side], sub.length);
    sub.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
      mesh.setMatrixAt(i, m);
      const g = 0.25 + r() * 0.25;
      mesh.setColorAt(i, color.setRGB(g, g * 1.05, g * 1.08));
    });
    scene.add(mesh);
  }
}
