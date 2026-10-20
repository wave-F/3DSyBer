// 楼体亮窗去细线：KitBash 玻璃幕墙前面有一层 1~2 cm 宽的竖横窗框（普通墙体材质），
// 100 m 外不到 0.2 像素，镜头一动就在亮窗上闪成一道道细线；玻璃自身的窄边条也会按自己的中心点单独点亮，在暗窗格上描出亮边
// 用法：npm run assets:windows [-- 楼型 ...]（默认 bldgLG），原地改写 public/assets/bldg/<楼型>.glb
//   之后要重跑 npm run assets:lod -- <楼型>，远景 L1 / L2 / L3 从这个文件生成
//   city_bake.py 重新烘焙楼体后也要再跑一遍（可重复运行：处理过的没有细窗框可删，窗格只会再放大一次 PANE_GROW）
// 做法（只改网格，不重新烘焙）：
//   1. 玻璃窄条（宽度 < GLASS_THIN）改成离它最近的整块窗格的颜色
//   2. 删掉贴在玻璃前面的细窗框（宽度 < BAR_W、离玻璃 < BAR_GAP）
//   3. 每块矩形窗格四边各外扩 PANE_GROW，盖住窗格之间的缝（不扩的话删掉窗框后会透出楼后面的天空）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Format } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { compactPrimitive, unpartition, unweld, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLDG = path.join(ROOT, 'public', 'assets', 'bldg');
const GLASS_THIN = 0.2;   // 米：玻璃三角形到最长边的高小于这个算窄条
const FRONT_MIN = 0.3;    // 平方米：整块窗格三角形的最小面积
const BAR_W = 0.08;       // 米：窗框三角形宽度上限（正面 1~2 cm，侧面是窗框进深）
const BAR_GAP = 0.15;     // 米：窗框离玻璃的最大距离
const PANE_GROW = 0.03;   // 米：窗格外扩
const CELL = 1;           // 米：空间网格

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const NAMES = names.length ? names : ['bldgLG'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

// ---- 几何工具 ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function triShape(a, b, c) {
  const area = len(cross(sub(b, a), sub(c, a))) / 2;
  const longest = Math.max(len(sub(b, a)), len(sub(c, b)), len(sub(a, c)));
  return { area, longest, width: longest > 0 ? (2 * area) / longest : 0 };
}
// 点到三角形距离（Ericson, Real-Time Collision Detection 5.1.5）
function distPointTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(p, lerp(a, b, v))); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(p, lerp(a, c, w))); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return len(sub(p, lerp(b, c, w))); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return len(sub(p, add(a, add(scale(ab, v), scale(ac, w)))));
}

// 楼体 glb 只有一个网格节点；按节点变换转到世界坐标做判断，写回时再转回局部
function toWorld(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}
function invertAffine(m) {
  const [a, b, c, , d, e, f, , g, h, i, , tx, ty, tz] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  return (p) => {
    const x = p[0] - tx, y = p[1] - ty, z = p[2] - tz;
    return [r[0] * x + r[3] * y + r[6] * z, r[1] * x + r[4] * y + r[7] * z, r[2] * x + r[5] * y + r[8] * z];
  };
}
const readPos = (prim, m) => {
  const pos = prim.getAttribute('POSITION'), v = [0, 0, 0], out = [];
  for (let i = 0; i < pos.getCount(); i++) out.push(toWorld(m, pos.getElement(i, v)));
  return out;
};
const indicesOf = (prim) => (prim.getIndices() ? Array.from(prim.getIndices().getArray()) : Array.from({ length: prim.getAttribute('POSITION').getCount() }, (_, i) => i));

async function processType(name) {
  const file = path.join(BLDG, `${name}.glb`);
  const doc = await io.read(file);
  await doc.transform(unweld());   // 每个三角形顶点独立，方便逐三角形改色、挪顶点
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  const mesh = node.getMesh();
  const m = node.getWorldMatrix();
  const toLocal = invertAffine(m);
  const glass = mesh.listPrimitives().find((p) => p.getMaterial()?.getName().startsWith('glass:'));
  if (!glass) { console.log(`skip  ${name}（没有玻璃）`); return; }

  const gPos = glass.getAttribute('POSITION'), gCol = glass.getAttribute('COLOR_0');
  const csize = gCol.getElementSize();
  const GP = readPos(glass, m);
  const gIdx = indicesOf(glass);
  const colOf = (i) => gCol.getElement(i, new Array(csize));
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

  // ---- 整块窗格三角形 + 空间网格 ----
  const fronts = [];
  const grid = new Map();
  const key = (p) => `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
  for (let t = 0; t < gIdx.length; t += 3) {
    const v = [GP[gIdx[t]], GP[gIdx[t + 1]], GP[gIdx[t + 2]]];
    const s = triShape(...v);
    if (s.area < FRONT_MIN || s.width < GLASS_THIN) continue;
    const cs = [0, 1, 2].map((j) => colOf(gIdx[t + j]));
    const col = cs[0].map((x, k) => (x + cs[1][k] + cs[2][k]) / 3);
    const f = { t, v, col, l: lum(col) };
    fronts.push(f);
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(v[0][k], v[1][k], v[2][k]) - BAR_GAP - 0.2) / CELL));
    const hi = [0, 1, 2].map((k) => Math.floor((Math.max(v[0][k], v[1][k], v[2][k]) + BAR_GAP + 0.2) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = `${x},${y},${z}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(f);
    }
  }
  function nearest(p, maxDist) {
    let best = null, bd = maxDist;
    for (const f of grid.get(key(p)) ?? []) {
      const d = distPointTri(p, ...f.v);
      if (d <= bd) { bd = d; best = f; }
    }
    return best;
  }

  // ---- 1. 玻璃窄条改色 ----
  let thin = 0;
  for (let t = 0; t < gIdx.length; t += 3) {
    const v = [GP[gIdx[t]], GP[gIdx[t + 1]], GP[gIdx[t + 2]]];
    const s = triShape(...v);
    if (s.area >= FRONT_MIN && s.width >= GLASS_THIN) continue;
    const f = nearest(scale(add(add(v[0], v[1]), v[2]), 1 / 3), 0.5);
    if (!f) continue;
    for (let j = 0; j < 3; j++) gCol.setElement(gIdx[t + j], f.col);
    thin++;
  }

  // ---- 2. 删掉玻璃前的细窗框 ----
  let bars = 0;
  for (const prim of mesh.listPrimitives()) {
    if (!(prim.getMaterial()?.getName() ?? '').startsWith('std:')) continue;
    const P = readPos(prim, m), idx = indicesOf(prim), keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [P[idx[t]], P[idx[t + 1]], P[idx[t + 2]]];
      const isBar = triShape(...v).width < BAR_W && nearest(scale(add(add(v[0], v[1]), v[2]), 1 / 3), BAR_GAP);
      if (isBar) bars++;
      else keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    if (keep.length === idx.length) continue;
    if (!keep.length) { mesh.removePrimitive(prim); prim.dispose(); continue; }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
    compactPrimitive(prim);
  }

  // ---- 3. 矩形窗格外扩 ----
  // 两个整块三角形共用一条边（斜边）、法线一致 → 一块四边形窗格；四个角各沿两条邻边向外推 PANE_GROW
  const rk = (p) => p.map((x) => Math.round(x * 1000)).join(',');
  const edgeMap = new Map();
  for (const f of fronts) {
    for (let j = 0; j < 3; j++) {
      const a = rk(f.v[j]), b = rk(f.v[(j + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push([f, j]);
    }
  }
  const nrm = (f) => norm(cross(sub(f.v[1], f.v[0]), sub(f.v[2], f.v[0])));
  const done = new Set();
  let panes = 0;
  for (const list of edgeMap.values()) {
    if (list.length !== 2) continue;
    const [[f1, j1], [f2, j2]] = list;
    if (done.has(f1) || done.has(f2)) continue;
    if (Math.abs(dot(nrm(f1), nrm(f2))) < 0.999) continue;
    // 四边形顶点顺序：f1 的对角点 → 共边一端 → f2 的对角点 → 共边另一端
    const opp1 = f1.v[(j1 + 2) % 3], e0 = f1.v[j1], e1 = f1.v[(j1 + 1) % 3];
    const opp2 = f2.v.find((p) => rk(p) !== rk(e0) && rk(p) !== rk(e1));
    const quad = [opp1, e0, opp2, e1];
    // 共边是斜边才算矩形（对角线互相平分）
    const mid1 = scale(add(e0, e1), 0.5), mid2 = scale(add(opp1, opp2), 0.5);
    if (len(sub(mid1, mid2)) > 0.01) continue;
    const moved = new Map();
    for (let i = 0; i < 4; i++) {
      const p = quad[i], prev = quad[(i + 3) % 4], next = quad[(i + 1) % 4];
      moved.set(rk(p), add(p, add(scale(norm(sub(p, prev)), PANE_GROW), scale(norm(sub(p, next)), PANE_GROW))));
    }
    for (const f of [f1, f2]) {
      for (let j = 0; j < 3; j++) gPos.setElement(gIdx[f.t + j], toLocal(moved.get(rk(f.v[j]))));
      done.add(f);
    }
    panes++;
  }

  await doc.transform(weld());
  for (const prim of mesh.listPrimitives()) compactPrimitive(prim);
  const draco = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME);
  (draco ?? doc.createExtension(KHRDracoMeshCompression).setRequired(true)).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 5, decodeSpeed: 5,
    quantizationBits: { POSITION: 14, NORMAL: 10, COLOR: 12, TEX_COORD: 12, GENERIC: 12 },
  });
  const size0 = fs.statSync(file).size;
  await writeGLBExternalImages(file, doc);
  console.log(`done  ${name}  玻璃窄条改色 ${thin}，删窗框 ${bars} 三角形，窗格外扩 ${panes}/${fronts.length / 2 | 0}  ${(size0 / 1024) | 0} → ${(fs.statSync(file).size / 1024) | 0} KB`);
}

// 写 GLB，图片留在外部 URI（和 scripts/ktx2.mjs、lod.mjs 一致：楼体贴图共享 bldg/tex/*.ktx2）
async function writeGLBExternalImages(file, doc) {
  await doc.transform(unpartition());
  const { json, resources } = await io.writeJSON(doc, { format: Format.GLTF, basename: path.basename(file, '.glb') });
  const bin = resources[json.buffers[0].uri];
  delete json.buffers[0].uri;
  json.buffers[0].byteLength = bin.byteLength;
  const pad = (n) => (4 - (n % 4)) % 4;
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
  const binBuf = Buffer.concat([Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength), Buffer.alloc(pad(bin.byteLength))]);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));
}

for (const name of NAMES) await processType(name);
