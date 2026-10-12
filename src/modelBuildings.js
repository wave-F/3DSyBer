import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { texture, uv, vertexColor, uniform, vec3, float, normalWorld, positionWorld } from 'three/tsl';
import TYPES from './data/buildings.json';
import LAYOUT from './data/cityLayout.json';

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

// 布局覆盖的沿桥范围（这一段不再生成程序楼）
export const NEAR_Z = LAYOUT.near;

const NEON = { cyan: '#20f0ff', pink: '#ff2a9a', yellow: '#ffd23a', violet: '#a060ff', red: '#ff3040', green: '#40ff90' };
const ADS = { ramen: 'ad_ramen.jpg', drink: 'ad_drink.jpg', whisky: 'ad_whisky.jpg', idol: 'ad_idol.jpg', arm: 'ad_arm.jpg' };
const AD_GLOW = { ramen: '#ffb070', drink: '#70c8ff', whisky: '#ffa850', idol: '#ff70c8', arm: '#80a8ff' };   // 大屏整体色调
const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIGHTS = 4;

// 占地矩形（世界坐标，含外挑件），供程序楼避让
export function modelFootprints(margin = 3) {
  return LAYOUT.footprints.map(([x0, x1, z0, z1]) => ({ x0: x0 - margin, x1: x1 + margin, z0: z0 - margin, z1: z1 + margin }));
}

// 每栋楼的招牌补光：{ p: (x, y, z, 半径), c: 颜色×强度 }
const signLights = LAYOUT.buildings.map(() => []);

// 招牌：按 Blender 里摆好的招牌面片挂上
export function placeModelSigns(signs, screenLights) {
  for (const s of LAYOUT.signs) {
    const n = new THREE.Vector3(s.n[0], 0, s.n[1]);
    const t = new THREE.Vector3().crossVectors(UP, n);
    const c = new THREE.Vector3(s.c[0], 0, s.c[1]);
    const face = { c, t, n, dep: 0 };
    let hex, k;
    if (s.type === 'screen') {
      signs.screen(face, 0, s.y, s.w, s.h, ADS[s.ad]);
      const pos = c.clone().addScaledVector(n, 6); pos.y = s.y;
      screenLights.push({ pos, z: pos.z, color: new THREE.Color(AD_GLOW[s.ad]) });
      hex = AD_GLOW[s.ad]; k = 1.0;
    } else if (s.type === 'blade') {
      signs.blade(face, 0, s.y, s.w, s.h, NEON[s.color]);
      hex = NEON[s.color]; k = 1.2;
    } else {
      signs.flat(face, 0, s.y, s.w, s.h, s.type === 'vflat', NEON[s.color]);
      hex = NEON[s.color]; k = 1.0;
    }
    const pos = c.clone().addScaledVector(n, s.type === 'blade' ? 0.4 + s.w / 2 : 1.2);
    pos.y = s.y;
    const radius = Math.max(s.w, s.h) * 0.8 + 5;
    signLights[s.b].push({ p: new THREE.Vector4(pos.x, pos.y, pos.z, radius), c: new THREE.Color(hex).multiplyScalar(k) });
  }
}

// 每个物体自己的招牌灯（objectGroup uniform，按物体更新；材质仍然共享）
const NO_LIGHT = { p: new THREE.Vector4(0, -1000, 0, 1), c: new THREE.Color(0) };
const lightNodes = Array.from({ length: MAX_LIGHTS }, (_, i) => ({
  p: uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => (object.userData.signLights?.[i] ?? NO_LIGHT).p),
  c: uniform(new THREE.Color()).onObjectUpdate(({ object }) => (object.userData.signLights?.[i] ?? NO_LIGHT).c),
}));
function signGlow() {
  let sum = vec3(0);
  for (const l of lightNodes) {
    const d = l.p.xyz.sub(positionWorld);
    const dist = d.length().max(0.01);
    const att = float(1).sub(dist.div(l.p.w)).clamp(0, 1).pow(2);
    const lambert = normalWorld.dot(d.div(dist)).max(0);
    sum = sum.add(l.c.mul(att.mul(lambert)));
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
