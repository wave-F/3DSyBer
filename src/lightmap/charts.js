import * as THREE from 'three/webgpu';

// 光照图 UV（第二套 UV，属性名 uv1）：把世界坐标的静态网格按平面分块，再装进一张图集
// 烘焙导出页（bake.html）和游戏运行时跑的是同一份代码，所以两边的 uv1 逐顶点一致，不需要另存 UV 文件
// 规则：
//   - 输入几何体必须已经是世界坐标（mergeStatic 合并后的静态块），会被换成非索引几何体
//   - 一块 = 同一平面、同一 z 格（cell 米）、顶点相连的三角形；长条几何体要在代码里沿 z 分段，才能按位置给不同精度
//   - density(中心, 法线, mesh) 返回每米像素数；装不下时整体按比例缩小
//   - uv1 用 Blender 约定（v 向上，原点在左下），与 EXRLoader 读出的数据方向一致
// 返回的 hash 由顶点位置算出，烘焙时写进 manifest；运行时对不上说明几何体改了、光照图过期

const PAD = 3;   // 每块四周留的像素（烘焙时向外扩 2 像素，双线性采样不串色）

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export function buildLightmapUV(meshes, { width, height, density, cell = 10 }) {
  const charts = [];
  meshes.forEach((mesh) => {
    if (mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
    const pos = mesh.geometry.attributes.position;
    const tris = pos.count / 3;
    const groups = new Map();
    for (let t = 0; t < tris; t++) {
      _a.fromBufferAttribute(pos, t * 3); _b.fromBufferAttribute(pos, t * 3 + 1); _c.fromBufferAttribute(pos, t * 3 + 2);
      _n.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_c, _a));
      const len = _n.length();
      if (len < 1e-9) _n.set(0, 1, 0); else _n.divideScalar(len);
      const cz = (_a.z + _b.z + _c.z) / 3;
      const key = `${Math.round(_n.x * 200)},${Math.round(_n.y * 200)},${Math.round(_n.z * 200)}|${Math.round(_n.dot(_a) * 50)}|${Math.floor(cz / cell)}`;
      let g = groups.get(key);
      if (!g) { g = { n: _n.clone(), tris: [] }; groups.set(key, g); }
      g.tris.push(t);
    }
    // 同一平面里按共享顶点再拆成相连的块
    for (const g of groups.values()) {
      const parent = g.tris.map((_, i) => i);
      const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
      const owner = new Map();
      g.tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          const v = t * 3 + k;
          const pk = `${Math.round(pos.getX(v) * 1000)},${Math.round(pos.getY(v) * 1000)},${Math.round(pos.getZ(v) * 1000)}`;
          const o = owner.get(pk);
          if (o === undefined) owner.set(pk, i); else parent[find(i)] = find(o);
        }
      });
      const comps = new Map();
      g.tris.forEach((t, i) => {
        const r = find(i);
        if (!comps.has(r)) comps.set(r, []);
        comps.get(r).push(t);
      });
      for (const list of comps.values()) charts.push(makeChart(mesh, g.n, list));
    }
  });

  // 每块的目标像素密度
  for (const ch of charts) ch.dens = Math.max(0.05, density(ch.center, ch.n, ch.mesh));

  // 装箱：按高度排序的货架算法，装不下就整体缩小
  let scale = 1;
  const need = charts.reduce((s, ch) => s + (ch.du * ch.dens + PAD * 2) * (ch.dv * ch.dens + PAD * 2), 0);
  if (need > width * height * 0.8) scale = Math.sqrt(width * height * 0.8 / need);
  let ok = false;
  for (let iter = 0; iter < 60 && !ok; iter++, scale *= 0.94) ok = pack(charts, scale, width, height);
  if (!ok) throw new Error('lightmap: 图集装不下');

  // 写 uv1
  let hash = 2166136261;
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    for (let i = 0; i < pos.count; i++) {
      hash = Math.imul(hash ^ (Math.round(pos.getX(i) * 100) + Math.round(pos.getY(i) * 37) * 7 + Math.round(pos.getZ(i) * 100) * 13), 16777619) >>> 0;
    }
  }
  for (const ch of charts) {
    const uv1 = ch.mesh.geometry.attributes.uv1;
    const pos = ch.mesh.geometry.attributes.position;
    const ku = ch.du > 1e-6 ? ch.w / ch.du : 0, kv = ch.dv > 1e-6 ? ch.h / ch.dv : 0;
    for (const t of ch.tris) {
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k;
        _a.fromBufferAttribute(pos, v);
        const pu = (_a.dot(ch.u) - ch.u0) * ku, pv = (_a.dot(ch.v) - ch.v0) * kv;
        uv1.setXY(v, (ch.x + PAD + (ku ? pu : ch.w / 2)) / width, (ch.y + PAD + (kv ? pv : ch.h / 2)) / height);
      }
    }
  }
  return { hash: hash.toString(16), charts: charts.length, scale: +scale.toFixed(4) };
}

function makeChart(mesh, n, tris) {
  const pos = mesh.geometry.attributes.position;
  const u = new THREE.Vector3().crossVectors(Math.abs(n.y) > 0.9 ? X : Y, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const center = new THREE.Vector3();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      _a.fromBufferAttribute(pos, t * 3 + k);
      const pu = _a.dot(u), pv = _a.dot(v);
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
      center.add(_a);
    }
  }
  center.divideScalar(tris.length * 3);
  return { mesh, n, tris, u, v, u0, v0, du: u1 - u0, dv: v1 - v0, center };
}

function pack(charts, scale, W, H) {
  for (const ch of charts) {
    ch.w = Math.max(1, Math.ceil(ch.du * ch.dens * scale));
    ch.h = Math.max(1, Math.ceil(ch.dv * ch.dens * scale));
    if (ch.w + PAD * 2 > W || ch.h + PAD * 2 > H) return false;
  }
  const order = charts.map((_, i) => i).sort((i, j) => (charts[j].h - charts[i].h) || (charts[j].w - charts[i].w) || (i - j));
  let x = 0, y = 0, rowH = 0;
  for (const i of order) {
    const ch = charts[i];
    const bw = ch.w + PAD * 2, bh = ch.h + PAD * 2;
    if (x + bw > W) { x = 0; y += rowH; rowH = 0; }
    if (y + bh > H) return false;
    ch.x = x; ch.y = y;
    x += bw; rowH = Math.max(rowH, bh);
  }
  return true;
}
