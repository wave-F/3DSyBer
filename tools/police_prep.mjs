// 运行环境：本项目未安装 gltf-transform，需在任意临时目录
//   npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 draco3dgltf sharp
// 后复制本文件过去执行：node police_prep.mjs <源 glb> <输出 glb>
// 警车预处理：删引擎舱 → 按部件拆材质 → 烘焙节点变换 → 拆出驾驶门（左前，+X 侧）→ 合并 + 压缩
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, prune, textureCompress, draco, clearNodeTransform } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const SRC = process.argv[2] ?? '../police_src.glb';
const OUT = process.argv[3] ?? '../police.glb';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const doc = await io.read(SRC);
const root = doc.getRoot();
const matByName = Object.fromEntries(root.listMaterials().map((m) => [m.getName(), m]));
const ext = matByName.PoliceExterior;

const ENGINE = /engine|battery|tanks_low|oil|cooler|boxy|windshield fluid|thing next to battery|radiator_low$/i;
const groups = {
  Glass: /^(windshield|window (back|front|rear))_low$/i,
  LightCover: /^(?!tire).*(cover|headlight protection)/i,
  LightRed: /^(more )?light top left_low$/i,
  LightBlue: /^(more )?light top right_low$/i,
};
// 驾驶门（前门）上的零件：左右镜像在同一网格里，只取 +X 一侧
const DOOR_PARTS = new Set([
  'Door Front_low', 'Door Line Front_low', 'Thing Around window Front_low', 'Window Front_low',
  'Front door handle idk_low', 'Door Handle Front_low', 'Door Panel_low', 'Bottom of front door_low',
  'Front Door End_low', 'Black Thing around the front door_low', 'Main Plane Door Front_low',
  'Secondary Plane Front Door_low', 'Buttons on Door Front_low', 'Door Front Open_low',
  'Police Sign Middle Left_low', 'Side Mirror_low', 'Whatever that is its on the door front_low', 'Door Thingy Front_low',
  ...(process.env.EXTRA_DOOR ?? '').split(',').filter(Boolean),
]);
// 前后门连成一条的内饰条（扶手/窗台），按 B 柱缝 z=-0.21 切开，前半段跟驾驶门走
const B_PILLAR_Z = -0.21;
const SPLIT_Z_PARTS = new Set(['Door Handle or idk_low', 'Sub on door_low', 'Continuing of door handle_low']);
for (const n of SPLIT_Z_PARTS) DOOR_PARTS.add(n);

const made = {};
for (const node of root.listNodes()) {
  const name = node.getName();
  if (ENGINE.test(name)) {
    node.listChildren().forEach((c) => c.dispose());
    node.dispose();
    continue;
  }
  for (const [mat, re] of Object.entries(groups)) {
    if (!re.test(name)) continue;
    made[mat] ??= ext.clone().setName(mat).setExtras({ role: mat });
    const meshes = [node.getMesh(), ...node.listChildren().map((c) => c.getMesh())].filter(Boolean);
    for (const mesh of meshes) for (const p of mesh.listPrimitives()) p.setMaterial(made[mat]);
  }
}

// 烘焙：所有网格节点挂到场景根下、变换写进顶点 → 顶点即模型空间
await doc.transform(flatten());
const scene = root.getDefaultScene() ?? root.listScenes()[0];
for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);

// 找门零件（Sketchfab 结构：父节点叫 "Door Front_low"，子节点叫 "Door Front_low_PoliceExterior_0"）
const isDoorPart = (n) => DOOR_PARTS.has(n.getName().replace(/_(PoliceExterior|PoliceInterior|Hologram|Decals)_0$/, ''));
const doorNodes = root.listNodes().filter((n) => n.getMesh() && isDoorPart(n));
console.log('door part nodes', doorNodes.length, '/', DOOR_PARTS.size);

function splitPrim(prim, zMin = -Infinity) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const keep = [], take = [];
  for (let i = 0; i < idx.length; i += 3) {
    const cx = pos[idx[i] * 3] + pos[idx[i + 1] * 3] + pos[idx[i + 2] * 3];
    const cz = (pos[idx[i] * 3 + 2] + pos[idx[i + 1] * 3 + 2] + pos[idx[i + 2] * 3 + 2]) / 3;
    (cx > 0 && cz > zMin ? take : keep).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const mk = (arr) => doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(arr)).setBuffer(prim.getIndices().getBuffer());
  const door = prim.clone().setIndices(mk(take));
  if (keep.length) prim.setIndices(mk(keep)); else prim.dispose();
  return door;
}

// 铰链：车门外板最前缘（+X 侧）
let hz = -1e9, hx = 0;
const doorPrims = [];
for (const n of doorNodes) {
  for (const prim of n.getMesh().listPrimitives()) {
    const base = n.getName().replace(/_(PoliceExterior|PoliceInterior|Hologram|Decals)_0$/, '');
    const d = splitPrim(prim, SPLIT_Z_PARTS.has(base) ? B_PILLAR_Z : -Infinity);
    if (n.getName().startsWith('Door Front_low')) {
      const pos = d.getAttribute('POSITION').getArray(), idx = d.getIndices().getArray();
      for (const i of idx) if (pos[i * 3 + 2] > hz) { hz = pos[i * 3 + 2]; }
      for (const i of idx) if (pos[i * 3 + 2] > hz - 0.06) hx = Math.max(hx, pos[i * 3]);
    }
    doorPrims.push([n.getName(), d]);
  }
  if (n.getMesh().listPrimitives().length === 0) n.dispose();
}
const hinge = [hx - 0.02, 0, hz - 0.04];
console.log('hinge', hinge.map((v) => v.toFixed(3)));

const doorRoot = doc.createNode('Door_FL').setTranslation(hinge);
scene.addChild(doorRoot);
for (const [name, prim] of doorPrims) {
  const mesh = doc.createMesh(name + '_door').addPrimitive(prim);
  doorRoot.addChild(doc.createNode(name + '_door').setMesh(mesh).setTranslation([-hinge[0], 0, -hinge[2]]));
}

// 门附近的全息标志：打印范围，决定是否跟门走
for (const n of root.listNodes()) {
  if (!/Police Sign/.test(n.getName()) || !n.getMesh()) continue;
  const p = n.getMesh().listPrimitives()[0].getAttribute('POSITION');
  console.log('sign', n.getName(), p.getMin([]).map((v) => v.toFixed(2)), p.getMax([]).map((v) => v.toFixed(2)));
}

await doc.transform(
  dedup(), join(), weld(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  draco(),
);
await io.write(OUT, doc);
const desc = (n, d = 0) => { const m = n.getMesh(); console.log(' '.repeat(d) + n.getName(), m ? m.listPrimitives().map((p) => p.getMaterial().getName()).join(',') : ''); n.listChildren().forEach((c) => desc(c, d + 1)); };
scene.listChildren().filter((n) => n.getName() === 'Door_FL' || n.getMesh()).slice(0, 30).forEach((n) => desc(n));
console.log('top-level nodes', scene.listChildren().length);
