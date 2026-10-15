import * as THREE from 'three/webgpu';
import { attribute, float, mix, texture } from 'three/tsl';

// 扫描枪的"高级感"材质：
// 1. 程序生成的霓虹 HDR 反射环境（暗房间 + 青/品红灯条 + 顶部柔光箱 + 远处城市灯点），只给扫描枪用
// 2. 原贴图只有一种粗糙度、没有金属度；按底色亮度和自发光区域重新生成 颜色 / 粗糙度 / 金属度 贴图
//    深色区 → 橡胶（保留原色、粗），其余 → 枪灰金属外壳（斑驳粗糙度），亮处边角 → 磨损亮钢，自发光区域 → 玻璃窗
// 3. 握把按几何高度单独标成橡胶（顶点属性 gripMask），机头才是金属

// ---------- 霓虹反射环境 ----------
// 等距柱状 HDR，行 0 在最上方（与 HDRLoader 一致，flipY = true）
const ENV_W = 512;
const ENV_H = 256;

// 发光体：方位中心 / 半宽、仰角上下限（度）、线性颜色、强度
const ENV_LIGHTS = [
  { az: 0, half: 40, el: [50, 80], c: [0.75, 0.85, 1], k: 3 },        // 顶部冷白柔光箱：大面积柔和高光
  { az: -20, half: 25, el: [18, 20.5], c: [0.9, 0.95, 1], k: 5 },       // 细白灯条：清漆上的锐利反光线
  { az: 70, half: 3, el: [-15, 40], c: [0.15, 0.85, 1], k: 6 },        // 青色竖灯条
  { az: -130, half: 2.5, el: [-10, 35], c: [1, 0.12, 0.55], k: 2.5 },      // 品红竖灯条
  { az: 180, half: 60, el: [28, 31], c: [0.2, 0.9, 1], k: 4 },          // 背后青色横灯带
  { az: 130, half: 10, el: [5, 12], c: [1, 0.5, 0.15], k: 4 },          // 琥珀色招牌
];
const CITY_PALETTE = [[0.2, 0.9, 1], [1, 0.2, 0.6], [1, 0.6, 0.25], [0.8, 0.85, 1]];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// 带软边的区间：lo..hi 内为 1
const band = (x, lo, hi, soft) => smooth(lo - soft, lo, x) * (1 - smooth(hi, hi + soft, x));
// 方位角差（度，-180..180）
const azDiff = (a, b) => ((a - b + 540) % 360) - 180;

let envTex = null;

export function neonEnvironment() {
  if (envTex) return envTex;
  // 固定种子的随机城市灯点，每次生成一样
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lights = ENV_LIGHTS.slice();
  for (let i = 0; i < 70; i++) {
    lights.push({
      az: rnd() * 360 - 180, half: 0.6 + rnd() * 2.2,
      el: (() => { const e = -4 + rnd() * 18; return [e, e + 0.8 + rnd() * 3]; })(),
      c: CITY_PALETTE[(rnd() * CITY_PALETTE.length) | 0], k: 1.2 + rnd() * 3,
    });
  }

  const data = new Uint16Array(ENV_W * ENV_H * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let y = 0; y < ENV_H; y++) {
    const el = (0.5 - (y + 0.5) / ENV_H) * 180;   // +90 顶 … -90 底
    // 底色：地面近黑，地平线一点蓝灰雨雾，天顶偏暗
    const sky = el < 0 ? 0.004 + 0.02 * smooth(-25, 0, el) : 0.024 - 0.012 * smooth(0, 70, el);
    for (let x = 0; x < ENV_W; x++) {
      const az = ((x + 0.5) / ENV_W) * 360 - 180;
      let r = sky * 0.55, g = sky * 0.7, b = sky;
      for (const L of lights) {
        const w = band(Math.abs(azDiff(az, L.az)), -1, L.half, 0.8) * band(el, L.el[0], L.el[1], 0.8);
        if (w <= 0) continue;
        r += L.c[0] * L.k * w; g += L.c[1] * L.k * w; b += L.c[2] * L.k * w;
      }
      const i = (y * ENV_W + x) * 4;
      data[i] = toHalf(r); data[i + 1] = toHalf(g); data[i + 2] = toHalf(b); data[i + 3] = toHalf(1);
    }
  }
  envTex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.LinearSRGBColorSpace;
  envTex.minFilter = envTex.magFilter = THREE.LinearFilter;
  envTex.generateMipmaps = false;
  envTex.flipY = true;
  envTex.needsUpdate = true;
  return envTex;
}

// ---------- 表面遮罩 ----------
// R = 清漆，G = 粗糙度，B = 金属度（clearcoatMap 读 R，roughnessMap 读 G，metalnessMap 读 B）
function readPixels(image, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// 平滑值噪声（像素空间，cell 为格子大小），用来做金属表面的斑驳和粗糙度起伏
function valueNoise(x, y, cell, seed) {
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const h = (a, b) => (Math.imul(Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2246822519), 1274126177) >>> 0) / 4294967296;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
  const bot = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
  return top + (bot - top) * sy;
}

// 金属枪身配色（sRGB）：深枪灰外壳，亮处边角磨出浅钢色
const GUNMETAL = [0.4, 0.415, 0.44];
const WORN_STEEL = [0.62, 0.63, 0.65];
const MEDIAN_LUM = 0.17;   // 原贴图机身的中位亮度，用来保留刻线和面板明暗

// 由原贴图生成两张图：
// color：金属区换成枪灰色（保留原贴图的明暗细节），橡胶区保留原色
// surf：R = 清漆，G = 粗糙度，B = 金属度
function buildSurfaceMaps(baseImage, emitImage) {
  const w = baseImage.width, h = baseImage.height;
  const base = readPixels(baseImage, w, h);
  const emit = emitImage ? readPixels(emitImage, w, h) : null;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    return { c, ctx, img: ctx.createImageData(w, h) };
  };
  const S = make(), C = make();
  const o = S.img.data, col = C.img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = (0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2]) / 255;
      const glass = emit ? smooth(0.04, 0.2, Math.max(emit[i], emit[i + 1], emit[i + 2]) / 255) : 0;
      const rubber = 1 - smooth(0.06, 0.11, lum);   // 最暗的握把、缝隙
      const bright = smooth(0.18, 0.28, lum);       // 亮处的边角、零件 → 磨损露出的亮钢
      const metalW = (1 - rubber) * (1 - glass);
      // 两层噪声：大块斑驳（指纹、氧化）+ 细颗粒
      const blot = valueNoise(x, y, 48, 1) * 0.65 + valueNoise(x, y, 14, 2) * 0.35;
      const grain = (Math.imul(i, 2654435761) >>> 0) / 4294967296 - 0.5;

      // 颜色：原贴图的明暗比例 × 枪灰色，亮处混入磨损钢色
      const detail = Math.min(1.35, Math.max(0.5, lum / MEDIAN_LUM));
      const tone = detail * (0.92 + (blot - 0.5) * 0.16);
      for (let k = 0; k < 3; k++) {
        const metalC = (GUNMETAL[k] * (1 - bright) + WORN_STEEL[k] * bright) * tone;
        const orig = base[i + k] / 255;
        col[i + k] = Math.min(1, metalC * metalW + orig * (1 - metalW)) * 255;
      }
      col[i + 3] = 255;

      // 粗糙度：金属 0.3~0.48（斑驳处更粗），磨损边角更光，橡胶 0.82，玻璃 0.06
      let rough = (0.36 + (blot - 0.5) * 0.18 - 0.1 * bright + grain * 0.04) * (1 - rubber) + 0.82 * rubber;
      rough = rough * (1 - glass) + 0.06 * glass;
      o[i] = glass * 255;                                   // 只有玻璃窗有清漆
      o[i + 1] = Math.min(1, Math.max(0.04, rough)) * 255;
      o[i + 2] = 0.95 * metalW * 255;
      o[i + 3] = 255;
    }
  }
  const tex = (m, colorSpace) => {
    m.ctx.putImageData(m.img, 0, 0);
    const t = new THREE.CanvasTexture(m.c);
    t.flipY = false;                     // 与 glTF 贴图一致
    t.colorSpace = colorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { surf: tex(S, THREE.NoColorSpace), color: tex(C, THREE.SRGBColorSpace) };
}

// ---------- 材质替换 ----------
export const SCANNER_LOOK = {
  envIntensity: 0.6,
  clearcoatRoughness: 0.2,
  gripTop: 0.042,      // 握把原点空间里，低于这个高度的是握把（机头底面约 0.043）
  gripBlend: 0.012,    // 机头 → 握把的过渡高度
  rubberTint: 0.7,     // 握把橡胶 = 原贴图 × 这个系数
  rubberRough: 0.8,
};

// 握把遮罩写进顶点属性 gripMask：1 = 橡胶握把，0 = 金属机头
// space 是握把原点所在的节点（viewmodel 的 device group），模型要先对齐好
function markGrip(mesh, space) {
  const geo = mesh.geometry;
  const toSpace = new THREE.Matrix4().copy(space.matrixWorld).invert().multiply(mesh.matrixWorld);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const mask = new Float32Array(pos.count);
  const top = SCANNER_LOOK.gripTop;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toSpace);
    mask[i] = 1 - smooth(top - SCANNER_LOOK.gripBlend, top, v.y);
  }
  geo.setAttribute('gripMask', new THREE.BufferAttribute(mask, 1));
}

// 把扫描枪网格换成金属材质。调用前模型必须已经摆到最终的握持位置
export function applyScannerLook(mesh, space) {
  space.updateMatrixWorld(true);
  markGrip(mesh, space);
  mesh.material = upgradeScannerMaterial(mesh.material, true);
  return mesh.material;
}

export function upgradeScannerMaterial(src, hasGrip = false) {
  const m = new THREE.MeshPhysicalNodeMaterial({
    name: `${src.name}_Metal`,
    emissiveMap: src.emissiveMap,
    emissive: src.emissive.clone(),
    emissiveIntensity: src.emissiveIntensity,
    normalMap: src.normalMap,
    side: src.side,
    clearcoat: 1,
    clearcoatRoughness: SCANNER_LOOK.clearcoatRoughness,
    envMap: neonEnvironment(),
    envMapIntensity: SCANNER_LOOK.envIntensity,
  });
  if (!src.map?.image) {
    m.map = src.map;
    m.roughness = 0.4;
    m.metalness = 0.6;
    return m;
  }
  const { surf, color } = buildSurfaceMaps(src.map.image, src.emissiveMap?.image);
  m.clearcoatMap = surf;   // 只有玻璃窗有清漆
  const grip = hasGrip ? attribute('gripMask', 'float') : float(0);
  const sv = texture(surf);
  m.colorNode = mix(texture(color).rgb, texture(src.map).rgb.mul(SCANNER_LOOK.rubberTint), grip);
  m.roughnessNode = mix(sv.g, float(SCANNER_LOOK.rubberRough), grip);
  m.metalnessNode = sv.b.mul(float(1).sub(grip));
  return m;
}
