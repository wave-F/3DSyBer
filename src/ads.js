import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, float, sin, fract, floor, mod, hash, step, mix, clamp, attribute, uniformArray, smoothstep,
} from 'three/tsl';
import { gameTime } from './investigation/clock.js';
import { loadTexture } from './textures.js';
import { fadeWithDistance } from './fog.js';
import ADS from './data/ads.json';

// 广告轮播：所有大屏共用一张图集（tools/make_ad_atlas.py 生成）和一个材质
// 每块屏只带自己的「起始编号 + 时间偏移 + 横/竖池」（顶点属性 adp），所以内容和换图时机各不相同，且仍能合批
// 横版池给横屏，竖版池给竖屏；屏幕比例和格子比例不一致时最多裁掉 20%，再多就补黑边（黑 = 不亮）

export const AD_DWELL = 9;            // 每张停留秒数
const NH = ADS.h.n, NV = ADS.v.n;
const [AW, AH] = ADS.size;
const CELL = [ADS.h.cell[0] / ADS.h.cell[1], ADS.v.cell[0] / ADS.v.cell[1]];

let atlas = null;
const atlasTex = () => {
  if (!atlas) {
    atlas = loadTexture('gen/ads_atlas.jpg');
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  }
  return atlas;
};

// 每块屏的参数。phase 在 0..DWELL 里均匀撒开，起始编号由调用方给（相邻屏错开）
let counter = 0;
export function adSlot(pool, start = null, phase = null) {
  const n = pool ? NV : NH;
  const i = counter++;
  return {
    pool,
    start: start ?? (i * 5) % n,                               // 5 与 12、8 互质，连续分配的屏不会撞图
    phase: phase ?? ((i * 0.618034) % 1) * AD_DWELL,
  };
}

// 平面几何（1×1，居中），uv 按屏幕比例裁好，带 adp 属性
export function adGeometry(w, h, slot) {
  const g = new THREE.PlaneGeometry(1, 1);
  const A = CELL[slot.pool], a = w / h;
  // 可见比例：cover 裁切，但最多裁掉 20%
  let su = 1, sv = 1;
  if (a > A) sv = Math.max(A / a, 0.8); else su = Math.max(a / A, 0.8);
  // 另一轴按比例放大（超出 0..1 的部分是黑边）
  if (a > A) su = sv * a / A; else sv = su * A / a;
  const uvs = g.attributes.uv;
  for (let k = 0; k < uvs.count; k++) {
    uvs.setXY(k, 0.5 + (uvs.getX(k) - 0.5) * su, 0.5 + (uvs.getY(k) - 0.5) * sv);
  }
  const adp = new Float32Array(uvs.count * 3);
  for (let k = 0; k < uvs.count; k++) adp.set([slot.start, slot.phase, slot.pool], k * 3);
  g.setAttribute('adp', new THREE.BufferAttribute(adp, 3));
  g.scale(w, h, 1);
  return g;
}

// 当前该显示的格子：返回 { idx(池内), gi(全局), k(连续时间/停留) }
function adIndex(adp) {
  const k = gameTime.add(adp.y).div(AD_DWELL);
  const n = mix(float(NH), float(NV), adp.z);
  const idx = mod(floor(k).add(adp.x), n);
  return { idx, gi: idx.add(adp.z.mul(NH)), k };
}

// 采样图集：cu 为格子内 uv（可超出 0..1）
function sampleAd(adp, cu) {
  const { idx, k } = adIndex(adp);
  const pool = adp.z;
  const cols = mix(float(ADS.h.cols), float(ADS.v.cols), pool);
  const cw = mix(float(ADS.h.cell[0] / AW), float(ADS.v.cell[0] / AW), pool);
  const ch = mix(float(ADS.h.cell[1] / AH), float(ADS.v.cell[1] / AH), pool);
  const y0 = mix(float(ADS.h.y / AH), float(ADS.v.y / AH), pool);
  const col = mod(idx, cols), row = floor(idx.div(cols));
  // 换图前后 0.35 秒的故障：横向错位条纹 + 闪黑
  const f = fract(k);
  const edge = step(f, 0.025).add(step(0.985, f)).clamp(0, 1);
  const band = hash(floor(cu.y.mul(18)).add(floor(gameTime.mul(40))));
  const gx = cu.x.add(band.sub(0.5).mul(0.12).mul(edge));
  const inside = step(0, gx).mul(step(gx, 1)).mul(step(0, cu.y)).mul(step(cu.y, 1));
  const lu = clamp(vec2(gx, cu.y), 0.004, 0.996);
  const au = col.add(lu.x).mul(cw);
  const av = float(1).sub(y0.add(row.add(float(1).sub(lu.y)).mul(ch)));
  const img = texture(atlasTex(), vec2(au, av)).rgb;
  const blackout = float(1).sub(edge.mul(step(0.5, band)).mul(0.85));
  return img.mul(inside).mul(blackout);
}

// LED 大屏材质（所有屏共用）
let screenMat = null;
export function adScreenMaterial() {
  if (screenMat) return screenMat;
  const adp = attribute('adp', 'vec3');
  const scan = sin(uv().y.mul(700)).mul(0.1).add(0.9);
  const flick = sin(gameTime.add(adp.y).mul(41)).mul(0.025).add(0.975);
  screenMat = new THREE.MeshBasicNodeMaterial();
  screenMat.colorNode = sampleAd(adp, uv()).mul(scan).mul(flick).mul(2.4);
  return screenMat;
}

// 投影式全息广告材质：加法混合、半透明、扫描线、偶发抖动
let holoMat = null;
export function adHoloMaterial() {
  if (holoMat) return holoMat;
  const adp = attribute('adp', 'vec3');
  const t = gameTime.add(adp.y);
  const jit = step(0.97, hash(floor(t.mul(12)))).mul(hash(floor(uv().y.mul(40)).add(floor(t.mul(30)))).sub(0.5)).mul(0.05);
  const cu = vec2(uv().x.add(jit), uv().y);
  const img = sampleAd(adp, cu);
  const scan = sin(uv().y.mul(320).sub(t.mul(5))).mul(0.3).add(0.7);
  const mask = smoothstep(0.06, 0.25, img.r.max(img.g).max(img.b));   // 暗部透明
  const tint = vec3(0.75, 0.95, 1.1);
  holoMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  holoMat.colorNode = img.mul(tint).mul(mask).mul(scan).mul(sin(t.mul(2.3)).mul(0.08).add(0.92)).mul(1.5);
  holoMat.fog = false;
  fadeWithDistance(holoMat);
  return holoMat;
}

// 广告平均色（照在墙上 / 桥面的补光跟着换）
export const AD_GLOW = ADS.glow.map((h) => new THREE.Color(h));
const glowArray = uniformArray(AD_GLOW, 'color');
// 着色器里：给定 adp 参数节点（vec3：start, phase, pool）返回当前广告的颜色
export function adGlowNode(adpNode) {
  return glowArray.element(adIndex(adpNode).gi.toInt());
}
// JS 里（点光源用）
export function adGlowAt(slot, t, out) {
  const n = slot.pool ? NV : NH;
  const idx = ((Math.floor((t + slot.phase) / AD_DWELL) + slot.start) % n + n) % n;
  return out.copy(AD_GLOW[idx + slot.pool * NH]);
}
