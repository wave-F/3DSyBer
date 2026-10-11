import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, float, time, sin, smoothstep, mix, positionWorld, positionWorldDirection,
  mx_fractal_noise_float, color, hash, instanceIndex,
} from 'three/tsl';
import { loadTexture, farWindowTexture, idTexture } from './textures.js';

export const FOG_HEX = 0x1b2726;

export const MEGA = [
  { x: 60, z: -560, w: 150, d: 120, h: 460, id: 'H7', c: '#20e8ff' },
  { x: -380, z: -260, w: 130, d: 130, h: 380, id: 'H11', c: '#ff3a9a' },
  { x: 420, z: 240, w: 120, d: 140, h: 340, id: 'H4', c: '#ffd23a' },
];

export function buildSky(scene) {
  // 天空：地平线与雾同色，向上渐暗
  const dir = positionWorldDirection;
  scene.backgroundNode = mix(color(FOG_HEX), color(0x040708), smoothstep(0.0, 0.45, dir.y));

  // 被城市灯光从下方照亮的低云
  const cloudMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  cloudMat.fog = false;
  const p = positionWorld.xz.mul(0.0025).add(vec2(time.mul(0.004), time.mul(0.0015)));
  const n = mx_fractal_noise_float(vec3(p, time.mul(0.003)), 4, 2.0, 0.5);
  const dist = positionWorld.xz.length();
  cloudMat.colorNode = mix(color(0x0b1212), color(0x3a2a38), smoothstep(-0.1, 0.5, n));
  cloudMat.opacityNode = smoothstep(-0.25, 0.45, n).mul(smoothstep(2200, 600, dist)).mul(0.9);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), cloudMat);
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = 240;
  scene.add(clouds);

  buildMegabuildings(scene);
  buildHolograms(scene);
  return buildFlyers(scene);
}

// 远处巨型建筑：退台堆叠 + 稀疏灯光 + 楼体编号 + 航空灯
function buildMegabuildings(scene) {
  const tex = farWindowTexture(77, 24, 120);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a2e33, map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.8,
  });
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x20e8ff });
  bandMat.color.multiplyScalar(3);
  const redMat = new THREE.MeshBasicNodeMaterial();
  redMat.colorNode = vec3(10, 0.4, 0.3).mul(sin(time.mul(1.8)).mul(0.5).add(0.5).pow(4));

  for (const m of MEGA) {
    let y = 0, w = m.w, d = m.d;
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const h = (m.h / tiers) * (i === 0 ? 1.2 : 0.93);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(m.x, y + h / 2, m.z);
      scene.add(b);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.2, d + 2), bandMat);
      band.position.set(m.x, y + h, m.z);
      scene.add(band);
      y += h; w *= 0.82; d *= 0.82;
    }
    const idMat = new THREE.MeshBasicMaterial({ map: idTexture(m.id, m.c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    idMat.color.setScalar(3);
    idMat.fog = false;
    const id = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), idMat);
    // 编号贴在朝向桥的那一面
    const useX = Math.abs(m.x) > Math.abs(m.z);
    const nx = useX ? -Math.sign(m.x) : 0, nz = useX ? 0 : -Math.sign(m.z);
    const half = useX ? m.w / 2 : m.d / 2;
    id.position.set(m.x + nx * (half + 1), m.h * 0.2, m.z + nz * (half + 1));
    id.lookAt(id.position.x + nx, id.position.y, id.position.z + nz);
    scene.add(id);
    const light = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), redMat);
    light.position.set(m.x, y + 2, m.z);
    scene.add(light);
  }
}

// 全息广告：加法混合 + 扫描线 + 闪烁，缓慢漂浮
const holos = [];
function holoMaterial(file) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const scan = sin(uv().y.mul(260).add(time.mul(6))).mul(0.25).add(0.75);
  const flick = sin(time.mul(23)).mul(0.06).add(0.94).mul(sin(time.mul(3.1)).mul(0.1).add(0.9));
  const img = texture(loadTexture(file), uv()).rgb;
  // 压掉 JPG 底色噪点，避免出现方框
  const mask = smoothstep(0.05, 0.18, img.r.max(img.g).max(img.b));
  m.colorNode = img.mul(mask).mul(scan).mul(flick).mul(1.6);
  m.fog = false; // 加法混合的面片若参与雾计算，会叠加出雾色方框
  return m;
}
function buildHolograms(scene) {
  const koi = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), holoMaterial('gen/holo_koi.jpg'));
  koi.position.set(6, 68, -125);
  koi.rotation.y = 0.15;
  scene.add(koi);
  holos.push({ mesh: koi, base: koi.position.clone(), rot: koi.rotation.y, k: 0.6 });

  const geisha = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), holoMaterial('gen/holo_geisha.jpg'));
  geisha.position.set(-18, 100, 150);
  geisha.rotation.y = Math.PI - 0.2;
  scene.add(geisha);
  holos.push({ mesh: geisha, base: geisha.position.clone(), rot: geisha.rotation.y, k: 0.4 });
}

// 远处飞行器：白色前灯 + 红色尾灯的移动光点
function buildFlyers(scene) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  white.color.setScalar(8);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  red.color.multiplyScalar(8);
  const body = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.4, metalness: 0.8 });
  const flyers = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 2.4), body);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.0), white);
    f.position.x = 2.6;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.2), red);
    b.position.x = -2.6;
    g.add(hull, f, b);
    scene.add(g);
    const lane = i % 2 === 0;
    flyers.push({
      g,
      // 沿 z 向或 x 向的航线
      axis: lane ? 'z' : 'x',
      off: (lane ? 1 : -1) * (120 + Math.random() * 300) * (Math.random() < 0.5 ? 1 : -1),
      y: 70 + Math.random() * 110,
      speed: (25 + Math.random() * 25) * (Math.random() < 0.5 ? 1 : -1),
      s: Math.random() * 1600 - 800,
    });
  }
  return function update(dt, t) {
    for (const f of flyers) {
      f.s += f.speed * dt;
      if (f.s > 800) f.s -= 1600;
      if (f.s < -800) f.s += 1600;
      if (f.axis === 'z') { f.g.position.set(f.off, f.y, f.s); f.g.rotation.y = f.speed > 0 ? -Math.PI / 2 : Math.PI / 2; }
      else { f.g.position.set(f.s, f.y, f.off); f.g.rotation.y = f.speed > 0 ? 0 : Math.PI; }
    }
    for (const h of holos) {
      h.mesh.position.y = h.base.y + Math.sin(t * h.k) * 2.5;
      h.mesh.rotation.y = h.rot + Math.sin(t * h.k * 0.5) * 0.12;
    }
  };
}
