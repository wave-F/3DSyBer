import * as THREE from 'three/webgpu';
import { color, float, uniform, normalView, positionViewDirection, positionWorld, sin, fract } from 'three/tsl';
import { uiTime } from './clock.js';
import { markKeep } from './mask.js';

// 全息材质：边缘发光（菲涅尔）+ 向上滚动的扫描线 + 细密横纹，加法混合
const cache = new Map();
export function hologramMaterial(hex, strength = 1) {
  const key = `${hex}_${strength}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.fog = false;
  const fres = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(2.2);
  const sweep = fract(positionWorld.y.mul(0.35).sub(uiTime.mul(0.5))).pow(14);
  const lines = sin(positionWorld.y.mul(90)).mul(0.5).add(0.5).pow(3).mul(0.25);
  const k = uniform(strength);
  m.colorNode = color(hex).mul(fres.mul(1.1).add(0.035).add(sweep.mul(0.7)).add(lines.mul(0.6))).mul(k);
  m.userData.strength = k;
  markKeep(m);
  cache.set(key, m);
  return m;
}

// 把任意模型克隆成全息版本（几何共享，只替换材质）
export function hologramize(source, hex, strength = 1) {
  const holo = source.clone(true);
  const mat = hologramMaterial(hex, strength);
  holo.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.castShadow = false; }
    if (o.isLight) o.visible = false;
  });
  return holo;
}
