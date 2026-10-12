import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { texture, uv, vertexColor, uniform, vec3, float, mix, normalWorld, positionWorld } from 'three/tsl';
import { adGlowNode } from './ads.js';
import { NEON } from './signs.js';
import TYPES from './data/buildings.json';
import LAYOUT from './data/cityLayout.json';
import { addLightGroup } from './debugLights.js';

// 近景模型楼（KitBash3D 楼体）。布局在 Blender 里摆：art/city.blend → tools/blender/city_export.py → cityLayout.json
// 楼型网格烘焙好光照（tools/blender/city_bake.py），同楼型多栋共享网格与材质
// 光照存在顶点色里（编码 (v/range)^(1/2.2)），运行时不受场景灯光影响：颜色 = 底色贴图 × (烘焙光照 + 招牌补光)
// 材质名带类别前缀：std 普通 / glass 玻璃（顶点色已含亮窗）/ lamp 灯具 / let 字牌
// 招牌是每栋楼单独摆的，补光不进烘焙，运行时每栋楼取自己最近的 MAX_LIGHTS 块招牌照亮立面

// 整体亮度（调过曝就改这里）
export const bldgLight = {
  wall: uniform(6),     // 烘焙光照倍率
  glass: uniform(1.0),  // 亮窗
  lamp: uniform(0.7),   // 楼体自带灯具
  letter: uniform(0.9), // 楼体自带字牌
  sign: uniform(1.0),   // 招牌照在墙上的补光
};
if (import.meta.env.DEV) window.__bldg = bldgLight;
addLightGroup('楼体墙面', (on) => { bldgLight.wall.value = on ? 6 : 0; });
addLightGroup('楼体亮窗', (on) => { bldgLight.glass.value = on ? 1 : 0; });
addLightGroup('楼体灯具', (on) => { bldgLight.lamp.value = on ? 0.7 : 0; });
addLightGroup('楼体字牌', (on) => { bldgLight.letter.value = on ? 0.9 : 0; });
addLightGroup('招牌补光', (on) => { bldgLight.sign.value = on ? 1 : 0; });

// 布局覆盖的沿桥范围（这一段不再生成程序楼）
export const NEAR_Z = LAYOUT.near;

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIGHTS = 4;
const BOX_GLOW = '#ffe6b0';

// 占地矩形（世界坐标，含外挑件），供程序楼避让
export function modelFootprints(margin = 3) {
  return LAYOUT.footprints.map(([x0, x1, z0, z1]) => ({ x0: x0 - margin, x1: x1 + margin, z0: z0 - margin, z1: z1 + margin }));
}

// 每栋楼的招牌补光：{ p: (x, y, z, 半径), c: 颜色×强度, a: 广告轮播参数 (start, phase, pool, 是否广告) }
const signLights = LAYOUT.buildings.map(() => []);
const NO_AD = new THREE.Vector4(0, 0, 0, 0);

// 招牌：按 Blender 里摆好的招牌挂上（tools/blender/city_signs.py 摆放，city_export.py 导出）
// c = 安装面（所有外凸物之前的平面），gap = 安装面到墙的距离（撑杆长度）
export function placeModelSigns(signs, screenLights) {
  for (const s of LAYOUT.signs) {
    const n = new THREE.Vector3(s.n[0], 0, s.n[1]);
    const t = new THREE.Vector3().crossVectors(UP, n);
    const c = new THREE.Vector3(s.c[0], 0, s.c[1]);
    const face = { c, t, n, dep: 0 };
    const gap = s.gap ?? 0;
    const opt = { box: !!s.box, dim: !!s.dim, gap };
    let hex = NEON[s.color] ?? BOX_GLOW, k = 1, slot = null, out = 1.2;
    switch (s.type) {
      case 'screen': slot = signs.screen(face, 0, s.y, s.w, s.h, { gap, edge: NEON[s.color] }); k = 1.0; break;
      case 'vscreen': slot = signs.vscreen(face, 0, s.y, s.w, s.h, gap, NEON[s.color] ?? NEON.cyan); k = 1.3; out = 1.5; break;
      case 'holo': slot = signs.holo(face, 0, s.y, s.w, s.h, gap); k = 0.45; out = 0; break;
      case 'board': slot = signs.rooftop(c.x, s.y - s.h / 2 - gap, c.z, n, s.w, s.h, gap); k = 0.5; break;
      case 'ticker': hex = signs.ticker(face, 0, s.y, s.w, s.h, gap, s.idx ?? 0); k = 0.7; break;
      case 'logo': hex = signs.logo(face, 0, s.y, s.w, s.h, gap, s.idx ?? 0); k = 0.4; break;
      case 'blade': signs.blade(face, 0, s.y, s.w, s.h, NEON[s.color], opt); k = s.dim ? 0.5 : 1.2; out = 0.4 + s.w / 2; break;
      default: signs.flat(face, 0, s.y, s.w, s.h, s.type === 'vflat', NEON[s.color], opt); k = s.dim ? 0.4 : s.box ? 0.7 : 1.0;
    }
    if (s.box && s.type !== 'screen') hex = BOX_GLOW;
    const pos = c.clone().addScaledVector(n, out);
    pos.y = s.y;
    const radius = Math.max(s.w, s.h) * 0.8 + 5;
    const a = slot ? new THREE.Vector4(slot.start, slot.phase, slot.pool, 1) : NO_AD;
    const col = slot ? new THREE.Color(k, k, k) : new THREE.Color(hex).multiplyScalar(k);
    signLights[s.b].push({ p: new THREE.Vector4(pos.x, pos.y, pos.z, radius), c: col, a });
    if (slot && (s.type === 'screen' || s.type === 'vscreen')) {
      const lp = c.clone().addScaledVector(n, 6); lp.y = s.y;
      screenLights.push({ pos: lp, z: lp.z, color: new THREE.Color(), slot });
    }
  }
}

// 每个物体自己的招牌灯（objectGroup uniform，按物体更新；材质仍然共享）
const NO_LIGHT = { p: new THREE.Vector4(0, -1000, 0, 1), c: new THREE.Color(0), a: NO_AD };
const lightNodes = Array.from({ length: MAX_LIGHTS }, (_, i) => ({
  p: uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => (object.userData.signLights?.[i] ?? NO_LIGHT).p),
  c: uniform(new THREE.Color()).onObjectUpdate(({ object }) => (object.userData.signLights?.[i] ?? NO_LIGHT).c),
  a: uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => (object.userData.signLights?.[i] ?? NO_LIGHT).a),
}));
function signGlow() {
  let sum = vec3(0);
  for (const l of lightNodes) {
    const d = l.p.xyz.sub(positionWorld);
    const dist = d.length().max(0.01);
    const att = float(1).sub(dist.div(l.p.w)).clamp(0, 1).pow(2);
    const lambert = normalWorld.dot(d.div(dist)).max(0);
    const col = mix(l.c, adGlowNode(l.a.xyz).mul(l.c.r), l.a.w);   // 大屏：颜色跟着当前广告换
    sum = sum.add(col.mul(att.mul(lambert)));
  }
  return sum.mul(bldgLight.sign);
}

const RANGE = 4;
function bakedMaterial(src) {
  const [kind] = src.name.split(':');
  const light = vertexColor().rgb.pow(2.2).mul(RANGE);
  const glow = signGlow();
  const m = new THREE.MeshBasicNodeMaterial();
  const base = src.map ? texture(src.map, uv()).rgb.mul(vec3(src.color.r, src.color.g, src.color.b)) : vec3(src.color.r, src.color.g, src.color.b);
  const lit = base.mul(light.mul(bldgLight.wall).add(glow));
  if (kind === 'glass') {
    m.colorNode = light.mul(bldgLight.glass).add(glow.mul(0.15));
  } else if (kind === 'lamp') {
    m.colorNode = vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(bldgLight.lamp).add(lit);
  } else if (kind === 'let') {
    m.colorNode = lit.add(base.mul(bldgLight.letter));
  } else {
    m.colorNode = lit;
  }
  m.name = src.name;
  return m;
}

export function loadModelBuildings(scene) {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const mats = new Map();
  const byType = new Map();
  LAYOUT.buildings.forEach((b, i) => {
    if (!TYPES[b.type]) return;
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type).push(i);
  });
  const jobs = [...byType].map(([type, list]) => loader.loadAsync(`/${TYPES[type].file}`).then((gltf) => {
    const proto = gltf.scene;
    proto.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name;
      if (!mats.has(key)) mats.set(key, bakedMaterial(o.material));
      o.material = mats.get(key);
    });
    for (const i of list) {
      const b = LAYOUT.buildings[i];
      const root = proto.clone();   // 共享几何体与材质
      root.name = b.name;
      root.position.set(...b.pos);
      root.rotation.y = b.yaw;
      // 离楼心最近的几块招牌
      const lights = signLights[i].slice().sort((a, c) =>
        Math.hypot(a.p.x - b.pos[0], a.p.z - b.pos[2]) - Math.hypot(c.p.x - b.pos[0], c.p.z - b.pos[2])).slice(0, MAX_LIGHTS);
      root.traverse((o) => { if (o.isMesh) o.userData.signLights = lights; });
      root.updateMatrixWorld(true);
      scene.add(root);
    }
  }));
  Promise.all(jobs).finally(() => draco.dispose());
}
