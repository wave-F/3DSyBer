import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { texture, uv, vertexColor, uniform, vec3, float } from 'three/tsl';
import DATA from './data/buildings.json';

// 模型楼（KitBash3D 楼体，Blender 里烘焙好光照，见 tools/blender/kb3d_*.py）
// 光照存在顶点色里（编码 (v/range)^(1/2.2)），运行时不受场景灯光影响：颜色 = 底色贴图 × 烘焙光照
// 材质名带类别前缀：std 普通 / glass 玻璃（顶点色已含亮窗）/ lamp 灯具 / let 字牌

// 放在桥右侧（车所在一侧）事故现场附近；z 为楼体沿桥方向的中心
export const MODEL_PLACEMENTS = [
  { name: 'bldgLG', side: 1, z: -112 },
  { name: 'tower02', side: 1, z: -60 },
  { name: 'capsule', side: 1, z: -26 },
  { name: 'bldgM', side: 1, z: 14 },
];
const FRONT_X = 20;   // 楼体主立面到桥中线的距离

// 整体亮度（调过曝就改这里）
export const bldgLight = {
  wall: uniform(6),     // 烘焙光照倍率
  glass: uniform(1.0),  // 亮窗
  lamp: uniform(0.7),   // 楼体自带灯具
  letter: uniform(0.9), // 楼体自带字牌
};
if (import.meta.env.DEV) window.__bldg = bldgLight;

const NEON = { cyan: '#20f0ff', pink: '#ff2a9a', yellow: '#ffd23a', violet: '#a060ff', red: '#ff3040', green: '#40ff90' };
const ADS = { ramen: 'ad_ramen.jpg', drink: 'ad_drink.jpg', whisky: 'ad_whisky.jpg', idol: 'ad_idol.jpg', arm: 'ad_arm.jpg' };
const UP = new THREE.Vector3(0, 1, 0);

// 楼体局部（Blender：x 沿立面，y 向后，z 向上）→ 世界
function placement(p) {
  const d = DATA[p.name];
  const zf = -d.core[2];                     // 主立面在 three 局部坐标中的 z（正面朝 +z）
  const yaw = -p.side * Math.PI / 2;         // 右侧楼正面朝 -x，左侧朝 +x
  const pos = new THREE.Vector3(p.side * (FRONT_X + zf), 0, p.z);
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
  return { d, m, yaw, pos };
}
const toWorld = (m, bx, by, bz) => new THREE.Vector3(bx, bz, -by).applyMatrix4(m);

// 占地矩形（世界坐标，含外挑件），供程序楼避让
export function modelFootprints(margin = 3) {
  return MODEL_PLACEMENTS.filter((p) => DATA[p.name]).map((p) => {
    const { d, m } = placement(p);
    const [x0, x1, y0, y1] = d.bounds;
    const pts = [toWorld(m, x0, y0, 0), toWorld(m, x1, y0, 0), toWorld(m, x0, y1, 0), toWorld(m, x1, y1, 0)];
    return {
      x0: Math.min(...pts.map((v) => v.x)) - margin, x1: Math.max(...pts.map((v) => v.x)) + margin,
      z0: Math.min(...pts.map((v) => v.z)) - margin, z1: Math.max(...pts.map((v) => v.z)) + margin,
    };
  });
}

// 招牌：按 Blender 里标好的招牌位挂上，颜色与烘焙补光一致
export function placeModelSigns(signs, screenLights) {
  for (const p of MODEL_PLACEMENTS) {
    if (!DATA[p.name]) continue;
    const { d, m } = placement(p);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);   // 立面法线（朝桥）
    const t = new THREE.Vector3(1, 0, 0).transformDirection(m);   // 沿立面方向
    for (const s of d.slots) {
      const c = toWorld(m, s.x, s.y, 0);
      const face = { c, t, n, dep: 0 };
      if (s.type === 'screen') {
        signs.screen(face, 0, s.z, s.w, s.h, ADS[s.ad]);
        const pos = c.clone().addScaledVector(n, 6); pos.y = s.z;
        screenLights.push({ pos, z: pos.z, color: new THREE.Color(0xffb070) });
      } else if (s.type === 'blade') {
        signs.blade(face, 0, s.z, s.w, s.h, NEON[s.color]);
      } else {
        signs.flat(face, 0, s.z, s.w, s.h, s.type === 'vflat', NEON[s.color]);
      }
    }
  }
}

const RANGE = 4;
function bakedMaterial(src) {
  const [kind] = src.name.split(':');
  const light = vertexColor().rgb.pow(2.2).mul(RANGE);
  const m = new THREE.MeshBasicNodeMaterial();
  const base = src.map ? texture(src.map, uv()).rgb.mul(vec3(src.color.r, src.color.g, src.color.b)) : vec3(src.color.r, src.color.g, src.color.b);
  if (kind === 'glass') {
    m.colorNode = light.mul(bldgLight.glass);
  } else if (kind === 'lamp') {
    m.colorNode = vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(bldgLight.lamp).add(base.mul(light).mul(bldgLight.wall));
  } else if (kind === 'let') {
    m.colorNode = base.mul(light).mul(bldgLight.wall).add(base.mul(bldgLight.letter));
  } else {
    m.colorNode = base.mul(light).mul(bldgLight.wall);
  }
  m.name = src.name;
  return m;
}

export function loadModelBuildings(scene) {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const cache = new Map();
  const jobs = MODEL_PLACEMENTS.filter((p) => DATA[p.name]).map((p) => loader.loadAsync(`/${DATA[p.name].file}`).then((gltf) => {
    const { pos, yaw } = placement(p);
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name;
      if (!cache.has(key)) cache.set(key, bakedMaterial(o.material));
      o.material = cache.get(key);
    });
    root.position.copy(pos);
    root.rotation.y = yaw;
    scene.add(root);
  }));
  Promise.all(jobs).finally(() => draco.dispose());
}
