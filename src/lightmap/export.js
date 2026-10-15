import * as THREE from 'three/webgpu';
import { buildBridge } from '../bridge.js';
import { buildCity } from '../city.js';
import { buildCrash } from '../crash.js';
import { buildCordon } from '../cordon.js';
import { adScreenMaterial, AD_GLOW } from '../ads.js';
import { lightmapAtlases } from './index.js';

// 烘焙导出页（bake.html，开发服务器上打开；npm run lightmap 会用无头 Chrome 自动打开）
// 用游戏同一份代码搭出静态场景，写出 Blender 能读的 art/bake/scene.json + scene.bin + tex/*.png：
//   recv  光照图接收面（带 uv1，代码生成的桥面、路缘、护栏、龙门架……）
//   occ   遮挡 / 反弹 / 发光体（招牌、大屏、事故车、碎片、程序楼……）
//   lights 路灯（全部灯头）
// KB3D 近景楼不在这里导出，Blender 脚本直接从 art/city.blend 的楼体库按 cityLayout.json 摆放
// 警车不进烘焙（开场会开进来），由探针 / 实时光照亮

const CENTER = new THREE.Vector3(0, 20, 10);
const RADIUS = 240;              // 只导出离事故现场这么远以内的东西
const PLAY = new THREE.Vector3(0, 22, 11);
const SCREEN_CHANNELS = 4;
const SCREEN_GAIN = 2.4 * 0.9;   // adScreenMaterial：图集 × 扫描线(≈0.9) × 2.4

const log = (...a) => { console.log(...a); document.getElementById('log').textContent += `${a.join(' ')}\n`; };

async function save(path, body) {
  const res = await fetch(`/__lightmap/save?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`save ${path}: ${res.status}`);
}

// ---------- 贴图 ----------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
function avgColor(tex) {
  const img = tex?.image;
  if (!img || !img.width) return [0.5, 0.5, 0.5];
  canvas.width = canvas.height = 32;
  ctx.drawImage(img, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  const s = [0, 0, 0];
  const srgb = tex.colorSpace === THREE.SRGBColorSpace;
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += srgb ? toLinear(d[i + k] / 255) : d[i + k] / 255;
  return s.map((v) => v / (d.length / 4));
}
const texFiles = new Map();
const pendingTex = [];
function texFile(tex) {
  if (texFiles.has(tex.uuid)) return texFiles.get(tex.uuid);
  const img = tex.image;
  if (!img || !img.width) return null;
  const name = `tex/t${texFiles.size}.png`;
  texFiles.set(tex.uuid, name);
  const c = document.createElement('canvas');
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  pendingTex.push(new Promise((ok) => c.toBlob(ok, 'image/png')).then((b) => save(`art/bake/${name}`, b)));
  return name;
}

// ---------- 材质 → 烘焙描述 ----------
const lin = (c) => [c.r, c.g, c.b];
const mul = (a, b) => a.map((v, i) => v * (Array.isArray(b) ? b[i] : b));
function describe(mat, avgInstance) {
  if (!mat || mat.visible === false) return null;
  if (mat.transparent && (mat.blending === THREE.AdditiveBlending || mat.opacity < 0.95 || mat.depthWrite === false)) return null;
  const tint = avgInstance ?? [1, 1, 1];
  const bake = mat.userData.bake;
  if (mat.isMeshBasicMaterial || mat.isMeshBasicNodeMaterial) {
    if (bake?.emit) return { albedo: [0, 0, 0], emit: bake.emit };
    if (mat.isNodeMaterial) return { albedo: [0.02, 0.02, 0.02], emit: [0, 0, 0] };   // 节点发光材质（跑马灯等）算不出颜色，只当遮挡
    const d = { albedo: [0, 0, 0], emit: mul(lin(mat.color), tint) };
    if (mat.map) d.emitTex = texFile(mat.map);
    return d;
  }
  let albedo;
  if (bake?.albedo) albedo = mul(bake.albedo, bake.albedoMap ? avgColor(bake.albedoMap) : [1, 1, 1]);
  else albedo = mul(lin(mat.color ?? new THREE.Color(0.5, 0.5, 0.5)), mat.map ? avgColor(mat.map) : [1, 1, 1]);
  albedo = mul(mul(albedo, tint), 1 - (mat.metalness ?? 0) * 0.85);
  const d = { albedo, emit: [0, 0, 0] };
  if (mat.emissive && mat.emissiveIntensity > 0) {
    d.emit = mul(lin(mat.emissive), mat.emissiveIntensity);
    if (mat.emissiveMap) d.emitTex = texFile(mat.emissiveMap);
  }
  return d;
}

// ---------- 几何 ----------
const floats = [];
let floatLen = 0;
const objects = [];
const materials = [];
const matKeys = new Map();
function matIndex(d) {
  const key = JSON.stringify(d, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v));
  if (!matKeys.has(key)) { matKeys.set(key, materials.length); materials.push(d); }
  return matKeys.get(key);
}
function push(arr) {
  const off = floatLen;
  floats.push(arr);
  floatLen += arr.length;
  return off;
}

const _v = new THREE.Vector3(), _s = new THREE.Sphere();
// three (x, y, z) → Blender (x, -z, y)
function addObject(name, kind, geo, matrix, d, triFilter = null, start = 0, count = Infinity) {
  const pos = geo.attributes.position, uv0 = geo.attributes.uv, uv1 = geo.attributes.uv1;
  const idx = geo.index;
  const n = Math.min(idx ? idx.count : pos.count, start + count);
  const tris = [];
  for (let i = start; i + 2 < n; i += 3) {
    const t = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
    if (!triFilter || triFilter(t[0])) tris.push(t);
  }
  if (!tris.length) return;
  const P = new Float32Array(tris.length * 9);
  const U0 = d.emitTex || d.albedoTex ? new Float32Array(tris.length * 6) : null;
  const U1 = kind === 'recv' ? new Float32Array(tris.length * 6) : null;
  tris.forEach((t, j) => t.forEach((vi, k) => {
    _v.fromBufferAttribute(pos, vi).applyMatrix4(matrix);
    P.set([_v.x, -_v.z, _v.y], (j * 3 + k) * 3);
    if (U0) U0.set(uv0 ? [uv0.getX(vi), uv0.getY(vi)] : [0, 0], (j * 3 + k) * 2);
    if (U1) U1.set([uv1.getX(vi), uv1.getY(vi)], (j * 3 + k) * 2);
  }));
  objects.push({
    name, kind, mat: matIndex(d), tris: tris.length,
    pos: push(P), uv0: U0 ? push(U0) : -1, uv1: U1 ? push(U1) : -1,
  });
}

function near(geo, matrix) {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  _s.copy(geo.boundingSphere).applyMatrix4(matrix);
  return _s.center.distanceTo(CENTER) < RADIUS + _s.radius;
}

function exportMesh(o, screens) {
  const geo = o.geometry;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = Array.isArray(o.material) && geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
  const recv = o.userData.lightmapAtlas ? 'recv' : 'occ';

  const instances = o.isInstancedMesh ? o.count : 1;
  let avg = null;
  if (o.isInstancedMesh && o.instanceColor) {
    avg = [0, 0, 0];
    for (let i = 0; i < o.count; i++) for (let k = 0; k < 3; k++) avg[k] += o.instanceColor.array[i * 3 + k] / o.count;
  }
  const m = new THREE.Matrix4(), im = new THREE.Matrix4();
  for (let i = 0; i < instances; i++) {
    m.copy(o.matrixWorld);
    if (o.isInstancedMesh) { o.getMatrixAt(i, im); m.multiply(im); }
    if (!near(geo, m)) continue;
    for (const g of groups) {
      const mat = mats[g.materialIndex];
      if (mat === adScreenMaterial() && geo.attributes.adp) { splitScreens(o, geo, m, screens); continue; }
      const d = describe(mat, avg);
      if (!d) continue;
      addObject(`${o.name || mat.name || mat.type}_${objects.length}`, recv, geo, m, d, null, g.start, g.count);
    }
  }
}

// 合批的大屏按 adp（每块屏的轮播参数）拆开，每块屏一个物体
function splitScreens(o, geo, matrix, screens) {
  const adp = geo.attributes.adp, pos = geo.attributes.position;
  const keys = new Map();
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const v = idx ? idx.getX(i) : i;
    const key = `${adp.getX(v)}|${adp.getY(v)}|${adp.getZ(v)}`;
    if (!keys.has(key)) keys.set(key, { start: adp.getX(v), phase: adp.getY(v), pool: adp.getZ(v), center: new THREE.Vector3(), nv: 0 });
    const s = keys.get(key);
    s.center.add(_v.fromBufferAttribute(pos, v).applyMatrix4(matrix)); s.nv++;
  }
  for (const s of keys.values()) {
    s.center.divideScalar(s.nv);
    screens.push({ ...s, geo, matrix: matrix.clone(), key: `${s.start}|${s.phase}|${s.pool}` });
  }
}

async function run() {
  const scene = new THREE.Scene();
  buildBridge(scene);
  const city = buildCity(scene);
  const crash = buildCrash(scene);
  buildCordon(scene);
  log('等待模型加载……');
  await Promise.all([city.ready, new Promise((ok) => crash.onCarReady(ok))]);
  scene.updateMatrixWorld(true);

  // 地面以上可见、静态的网格
  const screens = [];
  let bakeLights = [];
  scene.traverse((o) => {
    if (o.userData.bakeLights) bakeLights = o.userData.bakeLights;
  });
  const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.userData.bldg || o.userData.noBake || !visible(o)) return;
    exportMesh(o, screens);
  });

  // 大屏：离玩家最近的几块单独烘成通道，运行时乘当前广告色；其余按广告平均色烘进主图
  const avgGlow = AD_GLOW.reduce((s, c) => s.map((v, k) => v + [c.r, c.g, c.b][k] / AD_GLOW.length), [0, 0, 0]);
  const uniq = new Map();
  for (const s of screens) if (!uniq.has(s.key)) uniq.set(s.key, s);
  const ranked = [...uniq.values()].sort((a, b) => a.center.distanceTo(PLAY) - b.center.distanceTo(PLAY));
  const channels = ranked.slice(0, SCREEN_CHANNELS);
  for (const s of screens) {
    const ch = channels.findIndex((c) => c.key === s.key);
    const d = ch >= 0 ? { albedo: [0, 0, 0], emit: mul(avgGlow, SCREEN_GAIN), channel: ch, gain: SCREEN_GAIN }
      : { albedo: [0, 0, 0], emit: mul(avgGlow, SCREEN_GAIN) };
    const k = s.key;
    addObject(`screen_${k}`, 'occ', s.geo, s.matrix, d, (v) => `${s.geo.attributes.adp.getX(v)}|${s.geo.attributes.adp.getY(v)}|${s.geo.attributes.adp.getZ(v)}` === k);
  }

  const atlases = {};
  for (const [name, a] of lightmapAtlases()) atlases[name] = { ...a.info, width: a.opts.width, height: a.opts.height };

  await Promise.all(pendingTex);
  const total = new Float32Array(floatLen);
  let off = 0;
  for (const f of floats) { total.set(f, off); off += f.length; }
  const lights = bakeLights.map((l) => ({ pos: [l.pos[0], -l.pos[2], l.pos[1]], color: lin(new THREE.Color(l.color)), intensity: l.intensity, radius: l.radius }));
  const json = {
    version: 1, atlases, lights, materials, objects,
    screens: channels.map((c) => ({ start: c.start, phase: c.phase, pool: c.pool })),
  };
  await save('art/bake/scene.bin', total.buffer);
  await save('art/bake/scene.json', JSON.stringify(json));
  log(`导出完成：${objects.length} 个物体，${materials.length} 种材质，${(floatLen * 4 / 1048576).toFixed(1)} MB，${lights.length} 盏灯，${channels.length} 块通道大屏`);
  for (const [name, a] of Object.entries(atlases)) log(`图集 ${name}: ${a.charts} 块，缩放 ${a.scale}，hash ${a.hash}`);
  await fetch('/__lightmap/done', { method: 'POST' });
}

run().catch(async (e) => {
  log('导出失败', e.stack || e);
  await fetch('/__lightmap/done', { method: 'POST', body: String(e.stack || e) });
});
