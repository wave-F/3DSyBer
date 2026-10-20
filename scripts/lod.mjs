// 楼体远景 LOD：给 public/assets/bldg/<楼型>.glb 生成两档简化模型
// 用法：npm run assets:lod [-- 楼型 ...] [--skip-l1] [--skip-l2]
//   L1 <楼型>_l1.glb：meshoptimizer 自动减面（绝对误差 0.3 m，约 15~25%），材质、顶点色烘焙光照照旧，100~250 m 用
//   L2 <楼型>_l2.glb：Blender 低模壳 + 两张烘焙贴图（tools/blender/kb3d_lod.py），约 2.5k~5k 面，250 m 以外用
//   清单写到 src/data/buildingLods.json（不写进 buildings.json：kb3d_bake.py 重烘时会整条覆盖楼型条目）
// 实测：误差 1.2 m 那档会丢掉一大半亮窗；0.3 m 在 150 m 外和原模看不出差别
// 依赖：Blender（$BLENDER，默认找 ~/Applications/Blender/*/Blender.app），KTX-Software（同 assets:ktx2）
// Blender 读不了 KTX2：喂给它的源模型先把贴图换回 art/bake_tex/<贴图名>.jpg（kb3d_bake.py 的产物）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO, Format } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, compactPrimitive, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLDG = path.join(ROOT, 'public', 'assets', 'bldg');
const BAKE_TEX = path.join(ROOT, 'art', 'bake_tex');
const MANIFEST = path.join(ROOT, 'src', 'data', 'buildingLods.json');
const TYPES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'buildings.json'), 'utf8'));
const L1_ERROR = 0.3;   // 米

const argv = process.argv.slice(2);
const names = argv.filter((a) => !a.startsWith('--'));
const NAMES = names.length ? names : Object.keys(TYPES);
const skipL1 = argv.includes('--skip-l1'), skipL2 = argv.includes('--skip-l2');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-'));
const rel = (p) => path.relative(ROOT, p);

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const tris = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

// 写 GLB，图片留在外部 URI（和 scripts/ktx2.mjs 一致：楼体贴图共享 bldg/tex/*.ktx2）
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

// ---- L1：逐图元减面。Permissive 允许跨 UV / 顶点色接缝合并（不开的话卡在 ~60%），
// 误差按绝对值封顶，Prune 删掉比误差还小的碎岛 ----
async function makeL1(name) {
  const doc = await io.read(path.join(BLDG, `${name}.glb`));
  const before = tris(doc);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray();
      const idx = new Uint32Array(prim.getIndices().getArray());
      const nv = pos.length / 3;
      const col = prim.getAttribute('COLOR_0');
      const attrs = new Float32Array(nv * 3);
      if (col) {
        const c = col.getArray(), n = col.getElementSize();
        const norm = col.getNormalized() ? (c instanceof Uint8Array ? 255 : 65535) : 1;
        for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) attrs[i * 3 + k] = c[i * n + k] / norm;
      }
      const [res] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 3, [1, 1, 1], null, 0, L1_ERROR,
        ['Permissive', 'Prune', 'ErrorAbsolute']);
      if (res.length === 0) { mesh.removePrimitive(prim); prim.dispose(); continue; }   // 整块被剪掉（空图元 Draco 编不了）
      prim.setIndices(prim.getIndices().clone().setArray(res));
      compactPrimitive(prim);
    }
  }
  await doc.transform(prune());
  const draco = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME);
  (draco ?? doc.createExtension(KHRDracoMeshCompression).setRequired(true)).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 5, decodeSpeed: 5,
    quantizationBits: { POSITION: 14, NORMAL: 10, COLOR: 12, TEX_COORD: 12, GENERIC: 12 },
  });
  const after = tris(doc);
  const file = path.join(BLDG, `${name}_l1.glb`);
  await writeGLBExternalImages(file, doc);
  console.log(`L1  ${name}  ${before} → ${after} tris (${(after / before * 100).toFixed(1)}%)  ${(fs.statSync(file).size / 1024) | 0} KB`);
  return after;
}

// ---- L2 低模壳：只看几何（按位置焊接，忽略 UV / 顶点色接缝），所有图元合成一个网格再减面 ----
// 先试过 Blender 体素重构（BLOCKS / VOXEL）+ 塌陷：方正楼还行，斜面、镂空楼型（capsule、towerC、towerL）会塌成一团
const L2_TRIS = 3000, L2_TRIS_TALL = 5000, L2_ERROR = 1.5;
async function makeShell(name) {
  const doc = await io.read(path.join(BLDG, `${name}.glb`));
  const pts = [], tri = [], key = new Map();
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const remap = new Uint32Array(pos.getCount());
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        const k = `${Math.round(x * 200)},${Math.round(y * 200)},${Math.round(z * 200)}`;   // 5 mm 焊接
        let id = key.get(k);
        if (id === undefined) { id = pts.length / 3; key.set(k, id); pts.push(x, y, z); }
        remap[i] = id;
      }
      for (const i of prim.getIndices().getArray()) tri.push(remap[i]);
    }
  }
  const height = Math.max(...pts.filter((_, i) => i % 3 === 1));
  const target = height > 100 ? L2_TRIS_TALL : L2_TRIS;
  const [res] = MeshoptSimplifier.simplify(new Uint32Array(tri), new Float32Array(pts), 3, target * 3, L2_ERROR, ['Prune', 'ErrorAbsolute']);
  const out = new (await import('@gltf-transform/core')).Document();
  const buf = out.createBuffer();
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(pts)).setBuffer(buf))
    .setIndices(out.createAccessor().setType('SCALAR').setArray(res).setBuffer(buf));
  compactPrimitive(prim);
  out.getRoot().getDefaultScene() ?? out.getRoot().setDefaultScene(out.createScene());
  out.getRoot().getDefaultScene().addChild(out.createNode(`${name}_shell`).setMesh(out.createMesh().addPrimitive(prim)));
  const file = path.join(TMP, `${name}_shell.glb`);
  await new NodeIO().write(file, out);
  console.log(`L2  ${name}  壳 ${tri.length / 3} → ${res.length / 3} tris`);
  return file;
}

// ---- L2：Blender 烘焙贴图到低模壳 ----
async function blenderSource(name) {
  const doc = await io.read(path.join(BLDG, `${name}.glb`));
  for (const t of doc.getRoot().listTextures()) {
    const f = path.join(BAKE_TEX, `${t.getName()}.jpg`);
    if (!fs.existsSync(f)) throw new Error(`缺少 ${rel(f)}（kb3d_bake.py 的贴图产物）`);
    t.setImage(fs.readFileSync(f)).setMimeType('image/jpeg').setURI('');
  }
  for (const e of doc.getRoot().listExtensionsUsed()) if (/basisu|draco/i.test(e.extensionName)) e.dispose();
  const out = path.join(TMP, `${name}.glb`);
  await io.write(out, doc);
  return out;
}

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const base = path.join(os.homedir(), 'Applications', 'Blender');
  const apps = [];
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) apps.push(path.join(base, d, 'Blender.app', 'Contents', 'MacOS', 'Blender'));
  apps.push('/Applications/Blender.app/Contents/MacOS/Blender');
  const hit = apps.reverse().find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到 Blender，设置 BLENDER 环境变量');
  return hit;
}

async function makeL2(list) {
  const jobs = [];
  for (const name of list) jobs.push(`${name}=${await blenderSource(name)}=${await makeShell(name)}`);
  const log = execFileSync(findBlender(), ['-b', '--factory-startup', '--python', path.join(ROOT, 'tools', 'blender', 'kb3d_lod.py'), '--', BLDG, ...jobs],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const info = {};
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) console.log('    ' + line.slice(2));
    const m = line.match(/^@@L2 (\S+) tris (\d+) tex (\d+)/);
    if (m) info[m[1]] = { tris: Number(m[2]), tex: Number(m[3]) };
  }
  fs.rmSync(path.join(BLDG, '_lod_tmp'), { recursive: true, force: true });
  // 贴图转 KTX2，外置到 bldg/tex 共享目录
  execFileSync('node', [path.join(ROOT, 'scripts', 'ktx2.mjs'), ...list.map((n) => path.join(BLDG, `${n}_l2.glb`))], { stdio: 'inherit' });
  return info;
}

for (const name of NAMES) {
  if (!TYPES[name]) throw new Error(`未知楼型 ${name}`);
  manifest[name] ??= {};
  if (!skipL1) manifest[name].l1 = { file: `assets/bldg/${name}_l1.glb`, tris: await makeL1(name) };
}
if (!skipL2) {
  const info = await makeL2(NAMES);
  for (const name of NAMES) {
    if (!info[name]) throw new Error(`L2 ${name} 没有产出`);
    manifest[name].l2 = { file: `assets/bldg/${name}_l2.glb`, tris: info[name].tris, range: { wall: 1, glow: 2 } };
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(`清单 ${rel(MANIFEST)}`);
fs.rmSync(TMP, { recursive: true, force: true });
