import * as THREE from 'three/webgpu';
import { texture, uv, vertexColor, vec3, float, mix, positionWorld } from 'three/tsl';
import { gltfLoader } from './gltf.js';
import { rng } from './textures.js';
import { MEGA } from './sky.js';
import { bldgLight, bldgShade, modelFootprints } from './modelBuildings.js';
import { CORDON } from './cordon.js';
import TYPES from './data/buildings.json';
import LODS from './data/buildingLods.json';

// 中景模型楼：离玩家活动区 100~400 m 的环带，用 KitBash 楼型的简化版替换原来的程序方盒
// 楼型和两档简化模型由 npm run assets:lod 生成（scripts/lod.mjs）：
//   L1 自动减面（误差 0.3 m），100~250 m；L2 低模壳 + 烘焙贴图，250~450 m；L3 更粗的低模壳 + 小贴图，450 m 以外
//   （按 65° 视角、1080p 估算：450 m 处 1 m ≈ 1.9 px，L3 壳误差约 1.5~2 m，再加雨雾，看不出来）
// 玩家只在桥上一小段走动，每栋楼到玩家的距离几乎不变：摆放时就按距离定档，运行时不切换
// 同楼型同档合成 InstancedMesh；材质是 modelBuildings.js 纯烘焙版（不吃实时光、不含招牌补光和湿墙），共用同一套亮度参数

export const FAR_RING = { near: 100, far: 400, l1: 250, l3: 450 };
// 外圈：400 m 以外到原远景方盒的覆盖范围（|x| ≤ 530、|z| ≤ 710），也用 L2 模型楼铺满（仅桌面端）
// 开着时 city.js 的远景方盒全部隐藏，只留作开发态对比
export const FAR_OUTER = { on: true, x: 530, z: 710 };

// 按距离定档；楼型没有 L3 时退回 L2
const lodAt = (type, d) => (d < FAR_RING.l1 ? 1 : d < FAR_RING.l3 || !LODS[type].l3 ? 2 : 3);

// 到玩家活动区（桥中线上警戒线之间那一段）的水平距离
export function playerDist(x, z) {
  const dz = Math.max(0, z - CORDON.z1, CORDON.z0 - z);
  return Math.hypot(x, dz);
}

// 楼型权重：高楼多一些（矮楼放在中景基本被前排挡住）
const WEIGHTS = { towerC: 3, bldgLG: 2, tower02: 2, tower03: 2, tower08: 2, midrise: 2, towerL: 1.5, capsule: 1, bldgM: 1, bldgS: 0.4 };
const GAP = 3;          // 楼间最小间距
const TRIES = 40000;    // 撒点次数（越多越密）
// 缩放随距离放大：KitBash 楼最高 160 m，撑不起原来方盒（最高 240 m）那样的天际线；
// 远处放大 1.6 倍，层高 3.4 → 5.4 m，300 m 外看不出来
const scaleAt = (d, r) => { const t = Math.min(1, Math.max(0, (d - FAR_RING.near) / (FAR_RING.far - FAR_RING.near))); return 0.95 + t * 0.35 + r * (0.15 + t * 0.3); };

// 摆放：在环带里随机撒点，楼型 / 朝向（90° 倍数）/ 缩放随机，占地不重叠
// avoid：要避让的矩形 [{ x0, x1, z0, z1 }]（保留的远景方盒等）
function layout(r, avoid) {
  const names = Object.keys(WEIGHTS).filter((n) => TYPES[n] && LODS[n]);
  const total = names.reduce((s, n) => s + WEIGHTS[n], 0);
  const pick = () => { let x = r() * total; for (const n of names) if ((x -= WEIGHTS[n]) <= 0) return n; return names[0]; };
  const blocks = [
    ...modelFootprints(6),
    ...MEGA.map((m) => ({ x0: m.x - m.w / 2 - 8, x1: m.x + m.w / 2 + 8, z0: m.z - m.d / 2 - 8, z1: m.z + m.d / 2 + 8 })),
    ...avoid,
  ];
  const hit = (a, list, gap) => list.some((b) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap);
  const out = [];
  const R = FAR_RING.far;
  for (let i = 0; i < TRIES; i++) {
    const x = (r() * 2 - 1) * R, z = (r() * 2 - 1) * (R + CORDON.z1);
    const d = playerDist(x, z);
    if (d < FAR_RING.near || d > FAR_RING.far) continue;
    const type = pick();
    const rot = Math.floor(r() * 4);
    const s = scaleAt(d, r());
    // 楼型占地（Blender 局部 x / y → three x / -z），转 rot×90° 后取包围盒
    const [bx0, bx1, by0, by1] = TYPES[type].bounds;
    const c = Math.cos(rot * Math.PI / 2), sn = Math.sin(rot * Math.PI / 2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [lx, lz] of [[bx0, -by0], [bx1, -by0], [bx0, -by1], [bx1, -by1]]) {
      const wx = x + s * (c * lx + sn * lz), wz = z + s * (-sn * lx + c * lz);
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
    const fp = { x0, x1, z0, z1 };
    // 沿桥那一段两侧是程序楼（第一、二排）和近景模型楼，环带从 |x| ≥ 100 开始
    if (z1 > -290 && z0 < 290 && Math.min(Math.abs(x0), Math.abs(x1)) < 100) continue;
    if (x0 < 0 && x1 > 0 && z1 > -290 && z0 < 290) continue;
    if (hit(fp, blocks, 0) || hit(fp, out.map((o) => o.fp), GAP)) continue;
    out.push({ type, x, z, rot, s, fp, lod: lodAt(type, d) });
  }
  return out;
}

// 楼型占地包围盒（rot×90°、等比缩放 s）
function footprint(type, x, z, rot, s) {
  const [bx0, bx1, by0, by1] = TYPES[type].bounds;
  const c = Math.cos(rot * Math.PI / 2), sn = Math.sin(rot * Math.PI / 2);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[bx0, -by0], [bx1, -by0], [bx0, -by1], [bx1, -by1]]) {
    const wx = x + s * (c * lx + sn * lz), wz = z + s * (-sn * lx + c * lz);
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  return { x0, x1, z0, z1 };
}

// 外圈楼型权重：远处看天际线，偏高楼；小矮楼基本被挡，不放
const OUTER_WEIGHTS = { towerC: 3, bldgLG: 2, tower02: 2, tower03: 2, tower08: 2, midrise: 1.5, towerL: 1.5, capsule: 0.6, bldgM: 0.6 };
const OUTER_TRIES = 60000;
const CELL = 64;   // 碰撞检测用的网格边长

// 外圈摆放：400 m 以外的矩形区域，L2 / L3
// KitBash 楼最高 160 m、多数 60 m 左右，撑不起原方盒（40~240 m）的天际线：
// 等比放大 1.3~1.75 之外再纵向拉伸（sy），这个距离层高变化看不出来
function layoutOuter(r, avoid) {
  const names = Object.keys(OUTER_WEIGHTS).filter((n) => TYPES[n] && LODS[n]);
  const total = names.reduce((s, n) => s + OUTER_WEIGHTS[n], 0);
  const pick = () => { let x = r() * total; for (const n of names) if ((x -= OUTER_WEIGHTS[n]) <= 0) return n; return names[0]; };
  // 网格加速：每个格子记录压到它的占地
  const grid = new Map();
  const cells = (f, fn) => {
    for (let i = Math.floor(f.x0 / CELL); i <= Math.floor(f.x1 / CELL); i++) {
      for (let j = Math.floor(f.z0 / CELL); j <= Math.floor(f.z1 / CELL); j++) fn(`${i},${j}`);
    }
  };
  const insert = (f) => cells(f, (k) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(f); });
  const hit = (a, gap) => {
    let found = false;
    cells({ x0: a.x0 - gap, x1: a.x1 + gap, z0: a.z0 - gap, z1: a.z1 + gap }, (k) => {
      if (found) return;
      const list = grid.get(k);
      if (list) found = list.some((b) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap);
    });
    return found;
  };
  for (const f of avoid) insert(f);
  const out = [];
  for (let i = 0; i < OUTER_TRIES; i++) {
    const x = (r() * 2 - 1) * FAR_OUTER.x, z = (r() * 2 - 1) * FAR_OUTER.z;
    if (playerDist(x, z) <= FAR_RING.far) continue;
    const type = pick();
    const rot = Math.floor(r() * 4);
    const s = 1.3 + r() * 0.45;
    const tall = TYPES[type].height > 100;
    const sy = tall ? 1 + r() * 0.35 : 1 + r() * 0.8;
    const fp = footprint(type, x, z, rot, s);
    if (Math.min(Math.abs(fp.x0), Math.abs(fp.x1)) < 14 || (fp.x0 < 0 && fp.x1 > 0)) continue;   // 桥两端延长线留出通道
    if (hit(fp, GAP)) continue;
    insert(fp);
    out.push({ type, x, z, rot, s, sy, fp, lod: lodAt(type, playerDist(x, z)), outer: true });
  }
  return out;
}

// ---- 材质 ----
const shade = () => {
  const k = positionWorld.y.sub(bldgShade.y0).div(bldgShade.y1.sub(bldgShade.y0)).clamp(0, 1).pow(bldgShade.curve);
  return mix(bldgShade.foot, bldgShade.top, k);
};
// L1：和 modelBuildings.js bakedMaterial 的 basic 版本一致（光照在顶点色里）
function l1Material(src) {
  const [kind] = src.name.split(':');
  const light = vertexColor().rgb.pow(2.2).mul(4);
  const col = vec3(src.color.r, src.color.g, src.color.b);
  const base = src.map ? texture(src.map, uv()).rgb.mul(col) : col;
  const wall = light.mul(bldgLight.wall).mul(shade()).mul(bldgShade.cool).add(bldgShade.ambient);
  let c = base.mul(wall);
  if (kind === 'glass') c = light.mul(bldgLight.glass);
  else if (kind === 'lamp') c = c.add(vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(bldgLight.lamp));
  else if (kind === 'let') c = c.add(base.mul(bldgLight.letter));
  const m = new THREE.MeshBasicNodeMaterial({ side: src.side });
  m.colorNode = c;
  m.name = `far:${src.name}`;
  return m;
}
// L2 / L3：底色槽 = 底色 × 烘焙光照 × 冷色，自发光槽 = 亮窗 + 灯具 + 字牌（tools/blender/kb3d_lod.py）
function l2Material(src, range) {
  const wall = texture(src.map, uv()).rgb.mul(range.wall).mul(bldgLight.wall).mul(shade());
  const glow = texture(src.emissiveMap, uv()).rgb.mul(range.glow).mul(bldgLight.glass);
  // 沿用 glb 的双面设置：低模壳有单面片 / 法线朝内的面，单面渲染会被剔掉，楼看起来是透的
  const m = new THREE.MeshBasicNodeMaterial({ side: src.side });
  m.colorNode = wall.add(glow);
  m.name = src.name;
  return m;
}

// avoid：保留下来的远景方盒占地，不和它们重叠
export function buildFarModels(scene, avoid = []) {
  const group = new THREE.Group();
  group.name = '中景模型楼';
  scene.add(group);
  const list = layout(rng(4096), avoid);
  if (FAR_OUTER.on) {
    // 单独的随机序列，不影响环带原有摆放
    const megaFp = MEGA.map((m) => ({ x0: m.x - m.w / 2 - 8, x1: m.x + m.w / 2 + 8, z0: m.z - m.d / 2 - 8, z1: m.z + m.d / 2 + 8 }));
    list.push(...layoutOuter(rng(8192), [...megaFp, ...list.map((b) => b.fp)]));
  }
  const byFile = new Map();
  for (const b of list) {
    const key = `${b.type}:${b.lod}`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(b);
  }
  const loader = gltfLoader();
  const mats = new Map();
  const place = new THREE.Matrix4(), tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const color = new THREE.Color();
  const tint = rng(77);
  const stats = { buildings: list.length, l1: 0, l2: 0, l3: 0, outer: list.filter((b) => b.outer).length, tris: 0, draws: 0 };
  const jobs = [...byFile].map(([key, items]) => {
    const [type, lod] = key.split(':');
    const info = LODS[type][`l${lod}`];
    return loader.loadAsync(`${import.meta.env.BASE_URL}${info.file}`).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const mkey = lod === '1' ? o.material.name : `l${lod}:${type}`;
        if (!mats.has(mkey)) mats.set(mkey, lod === '1' ? l1Material(o.material) : l2Material(o.material, info.range));
        const mesh = new THREE.InstancedMesh(o.geometry, mats.get(mkey), items.length);
        mesh.name = `${key}:${o.name}`;
        items.forEach((b, i) => {
          q.setFromAxisAngle(UP, b.rot * Math.PI / 2);
          place.compose(pos.set(b.x, 0, b.z), q, scl.set(b.s, b.s * (b.sy ?? 1), b.s));
          mesh.setMatrixAt(i, tmp.multiplyMatrices(place, o.matrixWorld));
          const g = 0.85 + tint() * 0.3;   // 每栋楼亮度略有差别，同楼型不那么像复制
          mesh.setColorAt(i, color.setRGB(g, g, g));
        });
        mesh.computeBoundingSphere();
        group.add(mesh);
        stats.draws++;
        stats.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * items.length;
      });
      stats[`l${lod}`] += items.length;
    });
  });
  const ready = Promise.all(jobs).then(() => {
    stats.tris = Math.round(stats.tris);
    if (import.meta.env.DEV) console.info('[farModels]', stats);
    return stats;
  });
  return { group, ready, list };
}
