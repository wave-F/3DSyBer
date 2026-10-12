import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 静态网格合批：把 root 下共享材质的普通 Mesh 烘焙世界矩阵后合并成一个
// 按 z 方向分块（chunk 米），合并后的块仍能被视锥裁剪
// 多材质网格按 group 拆开分别归入对应材质
// 只合并材质本身不依赖物体局部坐标的网格（uv / 世界坐标 / 视空间法线都可以）
export function mergeStatic(root, { chunk = 80, skip = () => false } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.morphTargetInfluences) return;
    if (skip(o)) return;
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '');
    const zc = Math.floor(o.getWorldPosition(new THREE.Vector3()).z / chunk);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const parts = Array.isArray(o.material) && g.groups.length
      ? g.groups.map((gr) => ({ mat: mats[gr.materialIndex], start: gr.start, count: gr.count }))
      : [{ mat: mats[0], start: 0, count: Infinity }];
    for (const p of parts) {
      const key = `${p.mat.uuid}|${attrs}|${zc}|${o.castShadow}|${o.renderOrder}`;
      if (!buckets.has(key)) buckets.set(key, { mat: p.mat, geos: [], renderOrder: o.renderOrder });
      buckets.get(key).geos.push(slice(g, p.start, p.count).applyMatrix4(o.matrixWorld));
    }
    victims.push(o);
  });

  for (const o of victims) o.removeFromParent();

  let made = 0;
  for (const { mat, geos, renderOrder } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = renderOrder;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    made++;
  }
  return { removed: victims.length, made };
}

// 取几何体的一段索引区间，复制成独立的非共享几何体
function slice(g, start, count) {
  const out = g.clone();
  out.clearGroups();
  if (g.index && count !== Infinity) {
    const idx = g.index.array.slice(start, start + count);
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}
