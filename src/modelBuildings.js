import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { texture, uv, vertexColor, uniform, vec3, mix } from 'three/tsl';
import { NEON } from './signs.js';
import TYPES from './data/buildings.json';
import LAYOUT from './data/cityLayout.json';
import { addLightGroup } from './debugLights.js';
import { manifestReady, buildingIrradiance, buildingRect, lightmapState } from './lightmap/index.js';

// 近景模型楼（KitBash3D 楼体）。布局在 Blender 里摆：art/city.blend → tools/blender/city_export.py → cityLayout.json
// 光照和桥、招牌、邻楼一起在同一个 Cycles 场景里烘焙（tools/blender/scene_bake.py），存在光照图图集 bldg.exr 里
// 同楼型多栋共享网格与材质；楼型网格带第二套 UV（0..1），每栋楼在图集里的位置由 userData.lmRect 传给着色器
// 运行时不受场景灯光影响：颜色 = 底色贴图 × 烘焙光照（招牌、大屏、路灯、亮窗照在墙上的光都已在图里）
// 材质名带类别前缀：std 普通 / glass 玻璃（顶点色 = 亮窗）/ lamp 灯具 / let 字牌

// 整体亮度（调过曝就改这里；光照图本身的亮度在 lightmap/index.js 的 exposure）
export const bldgLight = {
  wall: uniform(2.5),   // 烘焙光照倍率（楼离得远、雾大，比物理值提亮一些才看得出轮廓）
  glass: uniform(1.0),  // 亮窗
  lamp: uniform(0.7),   // 楼体自带灯具
  letter: uniform(0.9), // 楼体自带字牌
};
if (import.meta.env.DEV) window.__bldg = bldgLight;
addLightGroup('楼体墙面', (on) => { bldgLight.wall.value = on ? 2.5 : 0; });
addLightGroup('楼体亮窗', (on) => { bldgLight.glass.value = on ? 1 : 0; });
addLightGroup('楼体灯具', (on) => { bldgLight.lamp.value = on ? 0.7 : 0; });
addLightGroup('楼体字牌', (on) => { bldgLight.letter.value = on ? 0.9 : 0; });

// 布局覆盖的沿桥范围（这一段不再生成程序楼）
export const NEAR_Z = LAYOUT.near;

const UP = new THREE.Vector3(0, 1, 0);

// 占地矩形 [x0, x1, z0, z1]（世界坐标，含外挑件）
export const MODEL_FOOTPRINTS = LAYOUT.footprints;

// 占地矩形加边距，供程序楼避让
export function modelFootprints(margin = 3) {
  return LAYOUT.footprints.map(([x0, x1, z0, z1]) => ({ x0: x0 - margin, x1: x1 + margin, z0: z0 - margin, z1: z1 + margin }));
}

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
    let slot = null;
    switch (s.type) {
      case 'screen': slot = signs.screen(face, 0, s.y, s.w, s.h, { gap, edge: NEON[s.color] }); break;
      case 'vscreen': slot = signs.vscreen(face, 0, s.y, s.w, s.h, gap, NEON[s.color] ?? NEON.cyan); break;
      case 'holo': signs.holo(face, 0, s.y, s.w, s.h, gap); break;
      case 'board': signs.rooftop(c.x, s.y - s.h / 2 - gap, c.z, n, s.w, s.h, gap); break;
      case 'ticker': signs.ticker(face, 0, s.y, s.w, s.h, gap, s.idx ?? 0); break;
      case 'logo': signs.logo(face, 0, s.y, s.w, s.h, gap, s.idx ?? 0); break;
      case 'blade': signs.blade(face, 0, s.y, s.w, s.h, NEON[s.color], opt); break;
      default: signs.flat(face, 0, s.y, s.w, s.h, s.type === 'vflat', NEON[s.color], opt);
    }
    if (slot && (s.type === 'screen' || s.type === 'vscreen')) {
      const lp = c.clone().addScaledVector(n, 6); lp.y = s.y;
      screenLights.push({ pos: lp, z: lp.z, color: new THREE.Color(), slot });
    }
  }
}

const RANGE = 4;            // 亮窗顶点色编码：(v/RANGE)^(1/2.2)
const GLASS_ALBEDO = 0.03;  // 玻璃反照率（与 scene_bake.py 一致）
function bakedMaterial(src, light) {
  const [kind] = src.name.split(':');
  const m = new THREE.MeshBasicNodeMaterial();
  const col = vec3(src.color.r, src.color.g, src.color.b);
  const base = mix(src.map ? texture(src.map, uv()).rgb.mul(col) : col, vec3(0.5), lightmapState.clay);   // clay：调试只看光照
  const wall = light.mul(bldgLight.wall);
  const lit = base.mul(wall);
  if (kind === 'glass') {
    const windows = vertexColor().rgb.pow(2.2).mul(RANGE);
    m.colorNode = wall.mul(GLASS_ALBEDO).add(windows.mul(bldgLight.glass));
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

// 返回 Promise：全部楼放进场景后完成
export function loadModelBuildings(scene) {
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const mats = new Map();
  const byType = new Map();
  LAYOUT.buildings.forEach((b, i) => {
    if (!TYPES[b.type]) return;
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type).push(i);
  });
  const jobs = [...byType].map(([type, list]) => Promise.all([
    loader.loadAsync(`${import.meta.env.BASE_URL}${TYPES[type].file}`), manifestReady,
  ]).then(([gltf, manifest]) => {
    // 没有光照图时给一点均匀底光，至少能看出楼的轮廓
    const light = manifest ? buildingIrradiance() : vec3(0.03);
    const proto = gltf.scene;
    proto.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name;
      if (!mats.has(key)) mats.set(key, bakedMaterial(o.material, light));
      o.material = mats.get(key);
    });
    for (const i of list) {
      const b = LAYOUT.buildings[i];
      const root = proto.clone();   // 共享几何体与材质
      root.name = b.name;
      root.position.set(...b.pos);
      root.rotation.y = b.yaw;
      const rect = buildingRect(manifest, b.name);
      if (manifest && !rect) console.warn('[lightmap] 光照图里没有这栋楼，需要重新烘焙：', b.name);
      root.traverse((o) => { if (o.isMesh) { o.userData.lmRect = rect; o.userData.bldg = true; } });
      root.updateMatrixWorld(true);
      scene.add(root);
    }
  }));
  return Promise.all(jobs).finally(() => draco.dispose());
}
