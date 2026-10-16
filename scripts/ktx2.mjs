// 贴图转 KTX2（Basis Universal）：显存按压缩格式常驻（约为 RGBA 的 1/4~1/8），解码在 Worker 里做，不卡主线程
// 用法：npm run assets:ktx2 [-- GLB 文件或目录 ...]
//   不带参数：处理 public/assets 下所有 .glb，外加下方 LOOSE 列出的单张贴图
//   原地改写；已经转好的会跳过，可以重复运行（Blender 重新导出 GLB、重新生成广告图集后再跑一遍即可）
// 依赖 KTX-Software 4.x 的 `ktx` 命令：https://github.com/KhronosGroup/KTX-Software/releases
//   macOS 可以不装 pkg：pkgutil --expand-full 解开，把 bin/ktx 和 lib/libktx* 放进 ~/.local/ktx-4.4.2/{bin,lib}
//   本脚本会自动把 ~/.local/ktx-*/bin 和 $KTX_HOME/bin 加进 PATH
// 只有改美术资源的人需要跑；转好的文件提交进仓库，打包发布不需要 ktx
//
// 编码策略（实测后定的）：
//   颜色类贴图（底色、自发光、金属粗糙度、AO）：ETC1S。下载体积和原 JPEG/WebP 相当或更小，显存省 6~8 倍
//     楼体 quality 192（远看 + 烘焙光照 + 雾）；车、手臂、路面、广告图集 quality 255
//   GLB 里的法线贴图：保持原图不转。ETC1S 压精细法线会出块状噪点；UASTC 画质好但下载体积是 WebP 的 3~5 倍
//   路面法线例外：沥青是细碎噪点，ETC1S 看不出块（PSNR 34dB），2K JPEG 3.7MB → 0.76MB
// 楼体贴图（assets/bldg）：KitBash 几种楼共用同一批贴图，改成外置共享文件 bldg/tex/<源图哈希>.ktx2，
//   GLB 只引用 URI，同一张图全场只下载、解码一次；按源图哈希命名，源图没变就直接复用，不重新编码
// Draco 网格会按原导出精度重新编码（顶点色 12 bit，烘焙光照不出色带）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO, Format } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { textureCompress, listTextureSlots, unpartition } from '@gltf-transform/functions';
import { toktx, Mode } from '@gltf-transform/cli';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const BLDG = path.join(ASSETS, 'bldg');
const BLDG_TEX = path.join(BLDG, 'tex');
const TEX_SRC = path.join(ROOT, 'art', 'textures');   // 单张贴图的源文件（不进 dist）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));

// 单张贴图：art/textures/<src> → public/assets/<src 换成 .ktx2>，代码里 loadTexture('xxx.ktx2')
const LOOSE = [
  { src: 'clean_asphalt_diff_2k.jpg', srgb: true },
  { src: 'clean_asphalt_nor_gl_2k.jpg', srgb: false },
  { src: 'clean_asphalt_rough_2k.jpg', srgb: false },
  { src: 'gen/ads_atlas.jpg', srgb: true },   // tools/make_ad_atlas.py 生成
];

// 让 gltf-transform 和本脚本找得到 ktx
const extraBins = [];
if (process.env.KTX_HOME) extraBins.push(path.join(process.env.KTX_HOME, 'bin'));
const local = path.join(os.homedir(), '.local');
if (fs.existsSync(local)) for (const d of fs.readdirSync(local)) if (d.startsWith('ktx-')) extraBins.push(path.join(local, d, 'bin'));
process.env.PATH = [...extraBins, process.env.PATH].join(path.delimiter);

const BLDG_QUALITY = 192;
const QUALITY = 255;
const SLOTS = /^(?!normalTexture$).*/;   // 除法线以外的槽位
const SRGB_SLOTS = /^(baseColorTexture|emissiveTexture|specularColorTexture|sheenColorTexture|diffuseTexture)$/;
// 运行时要在 CPU 上读像素的贴图不能转（压缩纹理没法 drawImage）：
//   扫描枪底色 / 自发光：scannerMaterial.js 读出来重新生成金属材质
const KEEP = /^scanner_/;
const wanted = (tex) => tex.getMimeType() !== 'image/ktx2' && !KEEP.test(tex.getName())
  && listTextureSlots(tex).some((s) => SLOTS.test(s));

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
const rel = (p) => path.relative(ROOT, p);
const isBldg = (file) => path.dirname(file) === BLDG;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 一张图 → KTX2（ETC1S + mipmap）。flip：给 TextureLoader 习惯（flipY = true）的贴图预先上下翻，
// 压缩纹理不支持 flipY，翻好再存，UV 采样结果和原来一致
let tmpId = 0;
async function encode(input, { srgb, quality, flip = false }) {
  const png = path.join(TMP, `${tmpId}.png`), out = path.join(TMP, `${tmpId++}.ktx2`);
  // ETC1S / UASTC 是 4×4 块压缩，WebGPU 要求尺寸是 4 的倍数（1024×891 这类图直接建不了纹理）
  const { width, height } = await sharp(input).metadata();
  const m4 = (n) => Math.max(4, Math.round(n / 4) * 4);
  let img = sharp(input).removeAlpha();
  if (m4(width) !== width || m4(height) !== height) img = img.resize(m4(width), m4(height), { fit: 'fill', kernel: 'lanczos3' });
  if (flip) img = img.flip();
  await img.png().toFile(png);
  execFileSync('ktx', ['create', '--format', srgb ? 'R8G8B8_SRGB' : 'R8G8B8_UNORM', '--assign-tf', srgb ? 'srgb' : 'linear',
    '--encode', 'basis-lz', '--qlevel', String(quality), '--clevel', '2', '--generate-mipmap', png, out]);
  const data = fs.readFileSync(out);
  fs.rmSync(png); fs.rmSync(out);
  return data;
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// 重新编码 Draco 时沿用 Blender 导出精度（city_bake.py：position 14 / color 12）
function keepDracoPrecision(doc) {
  const draco = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME);
  if (draco) draco.setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    encodeSpeed: 5, decodeSpeed: 5,
    quantizationBits: { POSITION: 14, NORMAL: 10, COLOR: 12, TEX_COORD: 12, GENERIC: 12 },
  });
}

// 写 GLB，但图片留在外部 URI（gltf-transform 写 GLB 时总会把图片嵌进去，这里自己拼 GLB）
async function writeGLBExternalImages(file, doc) {
  await doc.transform(unpartition());
  const { json, resources } = await io.writeJSON(doc, { format: Format.GLTF, basename: path.basename(file, '.glb') });
  if (json.buffers?.length !== 1) throw new Error(`${rel(file)}: 期望 1 个 buffer，实际 ${json.buffers?.length}`);
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

// 楼体：贴图外置到 bldg/tex/<源图哈希>.ktx2（全部楼共享）
async function processBldg(file, doc) {
  const textures = doc.getRoot().listTextures();
  const todo = textures.filter((t) => !t.getURI().startsWith('tex/') || t.getMimeType() !== 'image/ktx2');
  if (!todo.length) return false;
  fs.mkdirSync(BLDG_TEX, { recursive: true });
  let encoded = 0, reused = 0;
  for (const t of todo) {
    if (t.getMimeType() === 'image/ktx2') {
      // 已经是 KTX2 但还嵌在 GLB 里（旧流程转的）：按内容哈希外置
      const name = crypto.createHash('sha1').update(t.getImage()).digest('hex').slice(0, 16) + '.ktx2';
      const out = path.join(BLDG_TEX, name);
      if (!fs.existsSync(out)) fs.writeFileSync(out, t.getImage());
      t.setURI(`tex/${name}`);
      continue;
    }
    const srgb = listTextureSlots(t).some((s) => SRGB_SLOTS.test(s));
    const key = `etc1s q${BLDG_QUALITY} ${srgb ? 'srgb' : 'linear'} m4\n`;
    const name = crypto.createHash('sha1').update(key).update(t.getImage()).digest('hex').slice(0, 16) + '.ktx2';
    const out = path.join(BLDG_TEX, name);
    if (fs.existsSync(out)) reused++;
    else { fs.writeFileSync(out, await encode(Buffer.from(t.getImage()), { srgb, quality: BLDG_QUALITY })); encoded++; }
    t.setImage(fs.readFileSync(out)).setMimeType('image/ktx2').setURI(`tex/${name}`);
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  keepDracoPrecision(doc);
  await writeGLBExternalImages(file, doc);
  return `${todo.length} 张贴图（新编码 ${encoded}，复用 ${reused}）`;
}

// 其他 GLB：贴图嵌在 GLB 里
async function processEmbedded(file, doc) {
  const todo = doc.getRoot().listTextures().filter(wanted);
  if (!todo.length) return false;
  keepDracoPrecision(doc);
  const only = new RegExp(`^(${todo.map((t) => escape(t.getName())).join('|')})$`);   // 只动 todo 里的贴图（按名字匹配）
  // ktx 不认 WebP：要转的先无损转 PNG（法线不动）
  if (todo.some((t) => t.getMimeType() === 'image/webp')) {
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'png', formats: /webp/, slots: SLOTS, pattern: only }));
  }
  await doc.transform(toktx({ encoder: sharp, mode: Mode.ETC1S, quality: QUALITY, compression: 2, slots: SLOTS, pattern: only }));
  await io.write(file, doc);
  return `${todo.length} 张贴图`;
}

function collect(args) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    else if (p.endsWith('.glb')) out.push(p);
  };
  for (const a of args.length ? args : [ASSETS]) walk(path.resolve(a));
  return out.sort();
}

// GLB 引用的外部图片路径
function externalImages(file) {
  const b = fs.readFileSync(file);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return (json.images || []).filter((im) => im.uri).map((im) => path.join(path.dirname(file), im.uri));
}

const args = process.argv.slice(2);
let before = 0, after = 0;
for (const file of collect(args)) {
  const name = rel(file);
  const size0 = fs.statSync(file).size;
  const doc = await io.read(file);
  const result = isBldg(file) ? await processBldg(file, doc) : await processEmbedded(file, doc);
  if (!result) {
    console.log(`skip  ${name}`);
    continue;
  }
  before += size0; after += fs.statSync(file).size;
  console.log(`done  ${name}  ${result}  GLB ${mb(size0)} → ${mb(fs.statSync(file).size)}`);
}

// 楼体共享贴图：删掉没有任何 GLB 引用的旧文件
if (fs.existsSync(BLDG_TEX)) {
  const used = new Set(fs.readdirSync(BLDG).filter((f) => f.endsWith('.glb'))
    .flatMap((f) => externalImages(path.join(BLDG, f))).map((p) => path.resolve(p)));
  let shared = 0, removed = 0;
  for (const f of fs.readdirSync(BLDG_TEX)) {
    const p = path.resolve(BLDG_TEX, f);
    if (used.has(p)) shared += fs.statSync(p).size;
    else { fs.rmSync(p); removed++; }
  }
  console.log(`楼体共享贴图  ${used.size} 张  ${mb(shared)}${removed ? `（删除未引用 ${removed} 张）` : ''}`);
}

// 单张贴图（只在不带参数时处理；源文件比产物新才重新编码）
if (!args.length) {
  for (const { src, srgb } of LOOSE) {
    const input = path.join(TEX_SRC, src);
    const out = path.join(ASSETS, src.replace(/\.\w+$/, '.ktx2'));
    if (!fs.existsSync(input)) { console.warn(`缺少源文件 ${rel(input)}`); continue; }
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(input).mtimeMs) { console.log(`skip  ${rel(out)}`); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await encode(input, { srgb, quality: QUALITY, flip: true }));
    const s0 = fs.statSync(input).size, s1 = fs.statSync(out).size;
    before += s0; after += s1;
    console.log(`done  ${rel(out)}  ${mb(s0)} → ${mb(s1)}`);
  }
}
if (before) console.log(`本次处理合计  ${mb(before)} → ${mb(after)}（楼体 GLB 不含外置贴图）`);
fs.rmSync(TMP, { recursive: true, force: true });
