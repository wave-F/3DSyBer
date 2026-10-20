import * as THREE from 'three/webgpu';
import {
  abs, dot, float, max, mix, normalMap, normalWorld, positionWorld, pow,
  smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { gameTime } from './investigation/clock.js';
import { loadTexture } from './textures.js';
import { fenestra, FENESTRA_PANEL } from './fenestra.js';

// 车身水流：世界空间采两张错位滚动的水流法线，按表面法线把滚动方向对齐到重力下滑。
// 两层错开半个相位，避免单张噪声正对移动时分离、重叠来回闪。

export const surfaceRain = {
  speed: uniform(0.31),
  intensity: uniform(0),
  tiling: uniform(1.6),
  normalStrength: uniform(0.45),
  wetRoughness: uniform(0.08),
  phase: uniform(0.5),
};

const RAIN_INTENSITY = 0.1;
const DEFAULTS = {
  speed: 0.31, intensity: RAIN_INTENSITY, tiling: 1.6, normalStrength: 0.45, wetRoughness: 0.08, phase: 0.5,
};

let cabin = false;
export function setSurfaceRainCabin(inside) { cabin = inside; }

export function updateSurfaceRain(dt) {
  const target = cabin ? 0 : RAIN_INTENSITY;
  const k = 1 - Math.exp(-dt * 1.6);
  surfaceRain.intensity.value += (target - surfaceRain.intensity.value) * k;
}

const PAINT_NAMES = new Set(['CarPaint_Main', 'CarPaint_Accent', 'PoliceExterior']);
const GLASS_NAMES = new Set(['GlassWindshield', 'Glass', 'Damage_Laminated_Glass']);
const SKIP_NAMES = new Set([
  'LED_OrangeSignle', 'LED_WhiteHeadlight', 'Glass_Headlight', 'LightRed', 'LightBlue',
  'LightCover', 'Hologram', 'Decals', 'Damage_Fracture_Edges', 'Ground', 'Road',
]);

const flowMap = loadTexture('waterN1_webp.webp', false);
flowMap.wrapS = flowMap.wrapT = THREE.RepeatWrapping;

function sampleFlow(uvNode) {
  const s = texture(flowMap, uvNode);
  const n = s.xyz.mul(2).sub(1);
  return { normal: n, wet: float(1).sub(n.z) };
}

function layer(base, scroll, phase) {
  const a = sampleFlow(base.add(vec2(0, scroll)));
  const b = sampleFlow(base.mul(1.37).add(vec2(phase, scroll.mul(0.63))));
  return { wet: max(a.wet, b.wet), normal: a.normal.add(b.normal) };
}

// 坡度低：世界 XZ。立面：三面世界坐标，权重是法线分量的绝对值。滚动顺着法线的下坡方向。
export function surfaceFlow() {
  const n = normalWorld.normalize();
  const p = positionWorld.mul(surfaceRain.tiling);
  const scroll = gameTime.mul(surfaceRain.speed);
  const steep = smoothstep(float(0.35), float(0.8), abs(n.y).oneMinus());
  const flat = layer(p.xz, scroll.mul(n.x.add(n.z).sign()).negate(), surfaceRain.phase);
  const w = n.abs().add(0.001);
  const xy = layer(p.xy, scroll.mul(n.y.sign()), surfaceRain.phase);
  const zy = layer(p.zy, scroll.mul(n.y.sign()), surfaceRain.phase.add(0.17));
  const xz = layer(p.xz, scroll.mul(n.x.add(n.z).sign()).negate(), surfaceRain.phase.add(0.31));
  const triW = w.x.add(w.y).add(w.z);
  const triWet = xy.wet.mul(w.z).add(zy.wet.mul(w.x)).add(xz.wet.mul(w.y)).div(triW);
  const triN = xy.normal.mul(w.z).add(zy.normal.mul(w.x)).add(xz.normal.mul(w.y)).div(triW);
  const wet = mix(flat.wet, triWet, steep).mul(surfaceRain.intensity);
  const normal = mix(flat.normal, triN, steep);
  const slope = pow(abs(n.y).oneMinus(), float(0.6));
  return { wet: wet.mul(mix(float(0.35), float(1), slope)), normal, flat: steep.oneMinus() };
}

function toNodeMaterial(source) {
  if (source.isNodeMaterial) return source;
  const material = source.isMeshPhysicalMaterial
    ? new THREE.MeshPhysicalNodeMaterial()
    : new THREE.MeshStandardNodeMaterial();
  material.name = source.name;
  material.color.copy(source.color);
  material.roughness = source.roughness;
  material.metalness = source.metalness;
  material.map = source.map;
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.normalMap = source.normalMap;
  material.normalScale.copy(source.normalScale);
  material.emissive.copy(source.emissive);
  material.emissiveIntensity = source.emissiveIntensity;
  material.emissiveMap = source.emissiveMap;
  material.envMapIntensity = source.envMapIntensity;
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.side = source.side;
  material.depthWrite = source.depthWrite;
  material.alphaTest = source.alphaTest;
  if (source.clearcoat != null) {
    material.clearcoat = source.clearcoat;
    material.clearcoatRoughness = source.clearcoatRoughness;
  }
  return material;
}

function baseRoughness(material) {
  const sample = material.roughnessMap ? texture(material.roughnessMap, uv()).g : float(1);
  return sample.mul(float(material.roughness ?? 0.5));
}

function isWetSurface(material) {
  if (!material || material.isMeshBasicMaterial || material.isSpriteMaterial) return false;
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return false;
  const name = material.name?.replace(/^GC_/, '') || '';
  if (SKIP_NAMES.has(name)) return false;
  if ((material.emissiveIntensity ?? 0) > 1 && (material.metalness ?? 0) < 0.15) return false;
  return true;
}

function wireRain(material) {
  const flow = surfaceFlow();
  const wet = flow.wet;
  const dry = material.roughnessNode ?? baseRoughness(material);
  material.roughnessNode = mix(dry, surfaceRain.wetRoughness, wet);
  if (material.clearcoat > 0) {
    const dryCoat = material.clearcoatRoughnessNode ?? float(material.clearcoatRoughness ?? 0.1);
    material.clearcoatRoughnessNode = mix(dryCoat, float(0.04), wet);
  }
  const authored = material.normalMap ? texture(material.normalMap, uv()).xyz.mul(2).sub(1) : vec3(0, 0, 1);
  const bumped = vec3(
    authored.xy.add(flow.normal.xy.mul(surfaceRain.normalStrength).mul(surfaceRain.intensity)),
    authored.z,
  ).normalize();
  const flowNormal = normalMap(vec4(bumped.mul(0.5).add(0.5), 1));
  material.normalNode = flowNormal;
  if (material.clearcoat > 0) material.clearcoatNormalNode = flowNormal;
  material.needsUpdate = true;
  return material;
}

const wired = new WeakSet();

export function applySurfaceRain(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((material) => {
      if (!isWetSurface(material) || wired.has(material)) return material;
      const node = toNodeMaterial(material);
      wireRain(node);
      wired.add(node);
      return node;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}

const PANEL = [
  ['speed', '流速', 0, 2, 0.01],
  ['intensity', '强度', 0, 1, 0.01],
  ['tiling', 'Tiling', 0.2, 8, 0.05],
  ['normalStrength', '法线', 0, 2, 0.01],
  ['wetRoughness', '湿粗糙度', 0.02, 0.5, 0.01],
  ['phase', '错位', 0, 1, 0.01],
];

export function mountSurfaceRainPanel() {
  if (!import.meta.env.DEV) return;
  const css = 'font:13px "PingFang SC",sans-serif;color:#d7ecff;';
  const btn = document.createElement('button');
  btn.textContent = '测试 · 外观';
  btn.style.cssText = `position:fixed;left:24px;bottom:24px;transform:scale(1.5);transform-origin:left bottom;z-index:11;padding:8px 16px;letter-spacing:.1em;${css}color:#9ad7ff;background:rgba(5,12,20,.7);border:1px solid rgba(154,215,255,.6);cursor:pointer;`;
  const panel = document.createElement('div');
  panel.style.cssText = `display:none;position:fixed;left:24px;bottom:84px;z-index:11;max-height:calc(100vh - 120px);overflow:auto;padding:10px 14px;background:rgba(5,12,20,.86);border:1px solid rgba(154,215,255,.35);${css}`;
  for (const el of [btn, panel]) {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(el);
  }
  const sync = () => {
    const locked = !!document.pointerLockElement;
    btn.style.display = locked ? 'none' : '';
    if (locked) panel.style.display = 'none';
  };
  document.addEventListener('pointerlockchange', sync);
  sync();
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    btn.blur();
  });
  const fmt = (v, step) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step))));
  const heading = (text) => {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.cssText = 'margin:8px 0 4px;color:#9ad7ff;letter-spacing:.12em;';
    panel.appendChild(h);
  };
  const slider = (store, key, label, min, max, step, read) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:88px 150px 48px;align-items:center;gap:8px;margin:3px 0;';
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step, value: read() });
    const val = document.createElement('span');
    val.textContent = fmt(read(), step);
    input.addEventListener('input', () => {
      store[key].value = Number(input.value);
      val.textContent = fmt(store[key].value, step);
    });
    row.append(document.createTextNode(label), input, val);
    panel.appendChild(row);
  };
  heading('车身雨');
  for (const [key, label, min, max, step] of PANEL) {
    slider(surfaceRain, key, label, min, max, step, () => key === 'intensity' ? RAIN_INTENSITY : surfaceRain[key].value);
  }
  heading('窗视差');
  const toggle = document.createElement('label');
  toggle.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0 8px;cursor:pointer;';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = true;
  box.addEventListener('change', () => { fenestra.on.value = box.checked ? 1 : 0; });
  toggle.append(box, document.createTextNode('启用室内视差'));
  panel.appendChild(toggle);
  for (const item of FENESTRA_PANEL) {
    if (item[1] == null) { heading(item[0]); continue; }
    const [key, label, min, max, step] = item;
    slider(fenestra, key, label, min, max, step, () => fenestra[key].value);
  }
  const copy = document.createElement('button');
  copy.textContent = '复制参数';
  copy.style.cssText = `margin-top:10px;padding:4px 12px;${css}background:rgba(154,215,255,.12);border:1px solid rgba(154,215,255,.5);cursor:pointer;`;
  copy.addEventListener('click', () => {
    const rain = PANEL.map(([k]) => `  ${k}: ${+surfaceRain[k].value.toFixed(5)},`).join('\n');
    const win = FENESTRA_PANEL.filter((i) => i[1] != null).map(([k]) => `  ${k}: ${+fenestra[k].value.toFixed(5)},`).join('\n');
    const text = `车身雨\n${rain}\n窗视差\n${win}`;
    navigator.clipboard?.writeText(text);
    console.log(text);
    copy.textContent = '已复制';
    setTimeout(() => { copy.textContent = '复制参数'; }, 800);
  });
  panel.append(copy);
}
