import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import {
  texture, uv, vec2, vec3, float, sin, smoothstep, mix, positionWorld, positionWorldDirection,
  mx_fractal_noise_float, color, hash, instanceIndex, equirectUV, luminance,
} from 'three/tsl';
import { loadTexture, farWindowTexture, idTexture } from './textures.js';
import { addLightGroup } from './debugLights.js';
import { FOG_HEX, fadeWithDistance } from './fog.js';

export { FOG_HEX };

export const MEGA = [
  { x: 60, z: -560, w: 150, d: 120, h: 460, id: 'H7', c: '#20e8ff' },
  { x: -380, z: -260, w: 130, d: 130, h: 380, id: 'H11', c: '#ff3a9a' },
  { x: 420, z: 240, w: 120, d: 140, h: 340, id: 'H4', c: '#ffd23a' },
];

export function buildSky(scene) {
  // 天空盒：白天阴天全景（Poly Haven overcast_soil_puresky，只存上半球）压成夜色。
  // 原图亮的地方当作被城市霓虹从下方照亮的云底，暗的地方是压下来的黑云；地平线与雾同色
  const dir = positionWorldDirection;
  const skyTex = loadTexture('sky_overcast.jpg', false);
  skyTex.wrapT = THREE.ClampToEdgeWrapping;
  const eq = equirectUV(dir);
  // 横向缓慢转动 = 云层整体漂移；纵向只有上半球，地平线对应贴图底边
  const skyUV = vec2(eq.x.add(gameTime.mul(0.0004)), eq.y.sub(0.5).mul(2).clamp(0.002, 0.998));
  // 固定取第 0 级：经度在 ±180° 处跳变，自动选 mip 会在接缝处画出一道竖线
  const raw = luminance(texture(skyTex, skyUV).level(0).rgb);
  const dens = smoothstep(0.38, 0.85, raw).pow(1.6);
  const cityGlow = mix(float(1.6), float(0.6), smoothstep(0.0, 0.6, dir.y));   // 越近地平线，城市光污染越强
  const night = color(0x040708)
    .add(color(0x3a2a38).mul(dens).mul(cityGlow).mul(2.2))
    .add(vec3(0.02, 0.026, 0.026).mul(raw.mul(raw)));
  scene.backgroundNode = mix(night, color(FOG_HEX), smoothstep(0.35, 0.0, dir.y).pow(2));

  // 天空盒前面的低空碎云：比天空盒飘得快，造出前后层次
  const cloudMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  cloudMat.fog = false;
  const p = positionWorld.xz.mul(0.004).add(vec2(gameTime.mul(0.012), gameTime.mul(0.005)));
  const n = mx_fractal_noise_float(vec3(p, gameTime.mul(0.006)), 4, 2.0, 0.5);
  const dist = positionWorld.xz.length();
  cloudMat.colorNode = mix(color(0x070b0b), color(0x2a1e28), smoothstep(0.1, 0.55, n));
  cloudMat.opacityNode = smoothstep(0.05, 0.5, n).mul(smoothstep(2200, 600, dist)).mul(0.4);
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
  redMat.colorNode = vec3(10, 0.4, 0.3).mul(sin(gameTime.mul(1.8)).mul(0.5).add(0.5).pow(4));

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
    fadeWithDistance(idMat);
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
function holoMaterial(file, side = THREE.DoubleSide, { k = 1.6, lo = 0.05, hi = 0.18 } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side });
  const scan = sin(uv().y.mul(260).add(gameTime.mul(6))).mul(0.25).add(0.75);
  const flick = sin(gameTime.mul(23)).mul(0.06).add(0.94).mul(sin(gameTime.mul(3.1)).mul(0.1).add(0.9));
  const img = texture(loadTexture(file), uv()).rgb;
  // 压掉 JPG 底色噪点，避免出现方框
  const mask = smoothstep(lo, hi, img.r.max(img.g).max(img.b));
  m.colorNode = img.mul(mask).mul(scan).mul(flick).mul(k);
  m.fog = false; // 加法混合的面片若参与雾计算，会叠加出雾色方框；改为只按距离变暗
  return fadeWithDistance(m);
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

  // 右前方：斜靠在楼顶上的巨型人像（右前03_tower02，楼顶约 62m），侧身朝向桥面的玩家
  const LW = 44, LH = LW * 732 / 916;
  const lady = new THREE.Mesh(new THREE.PlaneGeometry(LW, LH), holoMaterial('gen/holo_lady.jpg', THREE.DoubleSide, { k: 2.0, lo: 0.04, hi: 0.16 }));
  lady.position.set(20, 62 + LH / 2 - 3, -50);
  lady.rotation.set(-0.12, -0.75, 0);   // 微微后仰，像靠在楼顶上
  scene.add(lady);
  holos.push({ mesh: lady, base: lady.position.clone(), rot: lady.rotation.y, k: 0.25, bob: 0.6 });
  // 这张斜靠的大面片从桥面看会变成一道不受灯光开关影响的白光柱，默认关掉
  addLightGroup('楼顶全息人像', (on) => { lady.visible = on; }, false);

  // 左侧后排楼顶上方：缓慢旋转的企业标志（左后02_bldgLG，楼顶约 136m）
  // 背靠背两片单面，转到背面时文字也是正的
  const logo = new THREE.Group();
  const lmat = holoMaterial('gen/holo_logo.jpg', THREE.FrontSide, { k: 2.2 });
  for (const ry of [0, Math.PI]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(34, 34 * 611 / 573), lmat);
    face.rotation.y = ry;
    logo.add(face);
  }
  logo.position.set(-83, 136 + 6 + 18, -56);
  scene.add(logo);
  // 投影环
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  ringMat.color.multiplyScalar(2.5);
  ringMat.fog = false;
  fadeWithDistance(ringMat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.25, 6, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-83, 137.5, -56);
  scene.add(ring);
  holos.push({ mesh: logo, base: logo.position.clone(), rot: 0, k: 0.3, bob: 0.8, spin: 0.25 });
}

// 远处飞行器：白色前灯 + 红色尾灯的移动光点。先关掉，全息仍由这里带动。
const SHOW_FLYERS = false;
function buildFlyers(scene) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  white.color.setScalar(8);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  red.color.multiplyScalar(8);
  const body = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.4, metalness: 0.8 });
  const flyers = [];
  for (let i = 0; i < 14 && SHOW_FLYERS; i++) {
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
    if (SHOW_FLYERS) for (const f of flyers) {
      f.s += f.speed * dt;
      if (f.s > 800) f.s -= 1600;
      if (f.s < -800) f.s += 1600;
      if (f.axis === 'z') { f.g.position.set(f.off, f.y, f.s); f.g.rotation.y = f.speed > 0 ? -Math.PI / 2 : Math.PI / 2; }
      else { f.g.position.set(f.s, f.y, f.off); f.g.rotation.y = f.speed > 0 ? 0 : Math.PI; }
    }
    for (const h of holos) {
      h.mesh.position.y = h.base.y + Math.sin(t * h.k) * 2.5 * (h.bob ?? 1);
      h.mesh.rotation.y = h.spin ? t * h.spin : h.rot + Math.sin(t * h.k * 0.5) * 0.12;
    }
  };
}
