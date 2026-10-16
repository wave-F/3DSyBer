import * as THREE from 'three/webgpu';
import { gltfLoader } from './gltf.js';
import { texture, uv, vertexColor, uniform, vec3, float, mix, smoothstep, mx_noise_float, bumpMap, normalWorld, positionWorld } from 'three/tsl';
import { adGlowNode } from './ads.js';
import { NEON } from './signs.js';
import TYPES from './data/buildings.json';
import LAYOUT from './data/cityLayout.json';
import { addLightGroup } from './debugLights.js';

// 近景模型楼（KitBash3D 楼体）。布局在 Blender 里摆：art/city.blend → tools/blender/city_export.py → cityLayout.json
// 楼型网格烘焙好光照（tools/blender/city_bake.py），同楼型多栋共享网格与材质
// 光照存在顶点色里（编码 (v/range)^(1/2.2)），作为自发光：底色贴图 × (烘焙光照 × 高度明暗 × 冷色 + 青色环境光 + 招牌补光)
// 材质是 PBR（MeshStandardNodeMaterial）：在烘焙基调上再吃场景点光源、环境反射和屏幕反射，墙面按雨痕变湿（bldgWet）
// 材质名带类别前缀：std 普通 / glass 玻璃（顶点色已含亮窗）/ lamp 灯具 / let 字牌
// 招牌是每栋楼单独摆的，补光不进烘焙，运行时每栋楼取自己最近的 MAX_LIGHTS 块招牌照亮立面

// 整体亮度（调过曝就改这里）
const WALL = 4.5;
export const bldgLight = {
  wall: uniform(WALL),  // 烘焙光照倍率
  glass: uniform(1.0),  // 亮窗
  lamp: uniform(0.7),   // 楼体自带灯具
  letter: uniform(0.9), // 楼体自带字牌
  sign: uniform(1.0),   // 招牌照在墙上的补光
};
// 夜景明暗层次（只作用于烘焙光照，不动亮窗、灯具、招牌补光）：
// 街面霓虹从下往上照，楼脚亮、往上逐渐沉进夜色；冷色倾向和青色环境光让楼体和雾色、天空同一色调
export const bldgShade = {
  y0: uniform(0),                                         // 从这个高度开始变暗（世界坐标 y，桥面 20）
  y1: uniform(100),                                       // 到这个高度暗到 top
  foot: uniform(1.25),                                    // 楼脚倍率
  top: uniform(0.22),                                     // 楼顶倍率
  curve: uniform(0.75),                                   // <1：离开楼脚就较快变暗
  cool: uniform(new THREE.Color(0.78, 0.95, 1.05)),       // 烘焙光照的色调（乘），压掉暖黄
  ambient: uniform(new THREE.Color(0.006, 0.014, 0.014)), // 青色环境光（加，乘底色）
};
// PBR 部分：楼体能吃到场景点光源（路灯、广告屏）、环境反射和屏幕反射
export const bldgWet = {
  amount: uniform(1),       // 湿度总开关
  diffuse: uniform(0.25),   // 实时灯光的漫反射倍率（烘焙已含天光，这里只补点光源）
  dryEnv: uniform(0.3),     // 干墙的环境反射（走 aoNode，只压环境光，不压点光源）；湿处为 1
  darken: uniform(0.62),    // 湿处底色变深
  dryRough: uniform(0.88),
  wetRough: uniform(0.22),
  bump: uniform(0.15),      // 水膜起伏强度
  glassRough: uniform(0.06),
  glassMetal: uniform(0.5), // 屏幕反射强度跟金属度走
};
if (import.meta.env.DEV) window.__bldg = { ...bldgLight, shade: bldgShade, wet: bldgWet };
addLightGroup('楼体墙面', (on) => { bldgLight.wall.value = on ? WALL : 0; });
addLightGroup('楼体亮窗', (on) => { bldgLight.glass.value = on ? 1 : 0; });
addLightGroup('楼体灯具', (on) => { bldgLight.lamp.value = on ? 0.7 : 0; });
addLightGroup('楼体字牌', (on) => { bldgLight.letter.value = on ? 0.9 : 0; });
addLightGroup('招牌补光', (on) => { bldgLight.sign.value = on ? 1 : 0; });

// 布局覆盖的沿桥范围（这一段不再生成程序楼）
export const NEAR_Z = LAYOUT.near;

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIGHTS = 4;
const BOX_GLOW = '#ffe6b0';

// 占地矩形 [x0, x1, z0, z1]（世界坐标，含外挑件）
export const MODEL_FOOTPRINTS = LAYOUT.footprints;

// 占地矩形加边距，供程序楼避让
export function modelFootprints(margin = 3) {
  return LAYOUT.footprints.map(([x0, x1, z0, z1]) => ({ x0: x0 - margin, x1: x1 + margin, z0: z0 - margin, z1: z1 + margin }));
}

// 每栋楼的招牌补光：{ p: (x, y, z, 半径), c: 颜色×强度, a: 广告轮播参数 (start, phase, pool, 是否广告) }
const signLights = LAYOUT.buildings.map(() => []);
const NO_AD = new THREE.Vector4(0, 0, 0, 0);

// 招牌：按 Blender 里摆好的招牌挂上（tools/blender/city_signs.py 摆放，city_export.py 导出）
// c = 安装面（所有外凸物之前的平面），gap = 安装面到墙的距离（撑杆长度）
export function placeModelSigns(signs) {
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

// 雨夜湿墙：竖墙上顺着往下流的雨痕 + 细水线，朝上的檐口、窗台、楼顶积水
function wetness() {
  const p = positionWorld;
  const along = p.x.add(p.z);   // 楼都按轴向摆，竖墙的水平方向就是 x 或 z
  const vert = smoothstep(0.6, 0.3, normalWorld.y.abs());
  const flat = smoothstep(0.7, 0.95, normalWorld.y);
  const streak = smoothstep(-0.15, 0.45, mx_noise_float(vec3(along.mul(1.4), p.y.mul(0.05), 0.0)));
  const drip = smoothstep(0.15, 0.55, mx_noise_float(vec3(along.mul(6.5), p.y.mul(0.22), 3.1)));
  const puddle = smoothstep(-0.3, 0.2, mx_noise_float(p.mul(vec3(0.5, 0.0, 0.5))));
  const wet = streak.mul(0.65).add(drip.mul(0.35)).mul(vert).add(flat.mul(puddle)).clamp(0, 1).mul(bldgWet.amount);
  // 水膜起伏：细密竖向水线，让点光源和反射在湿处碎开，不是一整块平滑高光
  const film = mx_noise_float(vec3(along.mul(18), p.y.mul(1.2), 7.7)).mul(wet);
  return { wet, film };
}

const RANGE = 4;
// 返回 { pbr, basic }：basic 是改 PBR 之前的纯烘焙版本，只留着在测试面板里做前后对比
function bakedMaterial(src) {
  const [kind] = src.name.split(':');
  const light = vertexColor().rgb.pow(2.2).mul(RANGE);
  const glow = signGlow();
  const m = new THREE.MeshStandardNodeMaterial();
  const basic = new THREE.MeshBasicNodeMaterial();
  const base = src.map ? texture(src.map, uv()).rgb.mul(vec3(src.color.r, src.color.g, src.color.b)) : vec3(src.color.r, src.color.g, src.color.b);
  const k = positionWorld.y.sub(bldgShade.y0).div(bldgShade.y1.sub(bldgShade.y0)).clamp(0, 1).pow(bldgShade.curve);
  const shade = mix(bldgShade.foot, bldgShade.top, k);
  const wall = light.mul(bldgLight.wall).mul(shade).mul(bldgShade.cool).add(bldgShade.ambient);
  // 烘焙光照 × 底色（+ 灯具 / 字牌自发光）
  const baked = (albedo) => {
    const lit = albedo.mul(wall.add(glow));
    if (kind === 'lamp') return lit.add(vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(bldgLight.lamp));
    if (kind === 'let') return lit.add(base.mul(bldgLight.letter));
    return lit;
  };
  if (kind === 'glass') {
    // 玻璃：亮窗照旧走烘焙，暗窗变成深色镜面，倒映环境、霓虹和屏幕反射
    m.colorNode = vec3(0.04, 0.045, 0.05);
    m.roughnessNode = bldgWet.glassRough;
    m.metalnessNode = bldgWet.glassMetal;
    m.emissiveNode = basic.colorNode = light.mul(bldgLight.glass).add(glow.mul(0.15));
  } else {
    // 墙体：烘焙光照当作自发光（夜景基调不变），实时光照只在上面加湿面高光、反射和少量漫反射
    const { wet, film } = wetness();
    const albedo = base.mul(mix(float(1), bldgWet.darken, wet));
    m.colorNode = albedo.mul(bldgWet.diffuse);
    m.roughnessNode = mix(bldgWet.dryRough, bldgWet.wetRough, wet);
    m.metalnessNode = float(0);
    m.aoNode = mix(bldgWet.dryEnv, float(1), wet);
    m.normalNode = bumpMap(film, bldgWet.bump);
    m.emissiveNode = baked(albedo);
    basic.colorNode = baked(base);
  }
  m.name = basic.name = src.name;
  return { pbr: m, basic };
}

// 测试按钮：关掉 = 改 PBR 之前的纯烘焙楼，用来对比效果和帧率
// （材质对不放 userData：clone 会把 userData 走一遍 JSON 序列化）
const bldgMeshes = [];
const pairOf = new Map();   // pbr / basic 材质 → { pbr, basic }
let usePBR = true;
function setPBR(on) {
  usePBR = on;
  for (const o of bldgMeshes) o.material = pairOf.get(o.material)[on ? 'pbr' : 'basic'];
}
// 开发态才有；和其他测试按钮一样，鼠标未锁定时（暂停画面）显示在右上角，排在剧情测试按钮下面
if (import.meta.env.DEV) {
  const b = document.createElement('button');
  const label = () => { b.textContent = `测试 · 楼体 PBR：${usePBR ? '开' : '关（旧版烘焙）'}`; };
  label();
  b.style.cssText = 'position:fixed;right:24px;top:316px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#9ad7ff;background:rgba(5,12,20,.7);border:1px solid rgba(154,215,255,.6);cursor:pointer;';
  document.body.appendChild(b);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    setPBR(!usePBR);
    label();
    b.blur();
  });
  const sync = () => { b.style.display = document.pointerLockElement ? 'none' : ''; };
  document.addEventListener('pointerlockchange', sync);
  sync();
}

export function loadModelBuildings(scene) {
  const loader = gltfLoader();
  const mats = new Map();
  const byType = new Map();
  LAYOUT.buildings.forEach((b, i) => {
    if (!TYPES[b.type]) return;
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type).push(i);
  });
  const jobs = [...byType].map(([type, list]) => loader.loadAsync(`${import.meta.env.BASE_URL}${TYPES[type].file}`).then((gltf) => {
    const proto = gltf.scene;
    proto.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name;
      if (!mats.has(key)) {
        const pair = bakedMaterial(o.material);
        mats.set(key, pair);
        pairOf.set(pair.pbr, pair).set(pair.basic, pair);
      }
      o.material = mats.get(key)[usePBR ? 'pbr' : 'basic'];
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
      root.traverse((o) => { if (o.isMesh) { o.userData.signLights = lights; bldgMeshes.push(o); } });
      root.updateMatrixWorld(true);
      scene.add(root);
    }
  }));
  return Promise.all(jobs);
}
