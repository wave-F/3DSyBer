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

// 只写深度的遮挡材质：先画一遍模型外壳的深度，全息层只显示最外层表面
// 放在透明队列（transparent），保证在不透明场景之后绘制，不会把背后的场景挖成黑洞
const depthOnly = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide });
depthOnly.fog = false;

// 把任意模型克隆成全息版本（几何共享，只替换材质）
// shell：只显示外壳。精细模型（车内饰、引擎、底盘）层层叠加时轮廓线过多、加法混合过曝，开启后被外壳挡住的部分不再显示
export function hologramize(source, hex, strength = 1, { shell = false } = {}) {
  const holo = source.clone(true);
  const mat = hologramMaterial(hex, strength);
  holo.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.castShadow = false; if (shell) o.renderOrder = 2; }
    if (o.isLight) o.visible = false;
  });
  if (!shell) return holo;
  const mask = source.clone(true);
  mask.traverse((o) => {
    if (o.isMesh) { o.material = depthOnly; o.castShadow = false; o.renderOrder = 1; }
    if (o.isLight) o.visible = false;
  });
  const g = new THREE.Group();
  g.add(mask, holo);
  return g;
}
