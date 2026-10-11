import * as THREE from 'three/webgpu';
import {
  texture, float, vec3, triplanarTexture, positionWorld, normalWorld, time, sin, hash, instanceIndex,
} from 'three/tsl';
import { loadTexture, litWindowTextures } from './textures.js';

// 模块化楼体：所有构件按材质合批成 InstancedMesh
// 立面 = 深色玻璃芯体 + 外凸的窗间墙(pier)和窗下墙(spandrel)，窗洞有真实深度

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const STYLES = {
  office: {
    floorH: 3.8, bayW: 3.2, pierW: 0.45, spH: 1.1, dep: 0.55, lit: 0.1, ac: 0, balcony: 0, pipes: 0.3, fins: 0,
    walls: [[0.42, 0.45, 0.5], [0.3, 0.32, 0.36], [0.5, 0.5, 0.48]], glass: [[0.06, 0.08, 0.1], [0.05, 0.07, 0.07]],
    setbacks: 3, podium: 0.6,
  },
  resi: {
    floorH: 3.0, bayW: 2.8, pierW: 0.8, spH: 1.15, dep: 0.45, lit: 0.17, ac: 0.3, balcony: 0.3, pipes: 0.9, fins: 0,
    walls: [[0.5, 0.47, 0.42], [0.36, 0.38, 0.38], [0.3, 0.42, 0.42], [0.45, 0.36, 0.33]], glass: [[0.05, 0.05, 0.05]],
    setbacks: 2, podium: 0.8,
  },
  kitsch: {
    floorH: 3.2, bayW: 3.0, pierW: 0.7, spH: 1.0, dep: 0.5, lit: 0.2, ac: 0.2, balcony: 0.15, pipes: 0.5, fins: 0,
    walls: [[0.7, 0.42, 0.5], [0.42, 0.62, 0.56], [0.7, 0.62, 0.38], [0.5, 0.45, 0.65]], glass: [[0.06, 0.05, 0.07]],
    setbacks: 2, podium: 0.9,
  },
  corp: {
    floorH: 4.2, bayW: 1.8, pierW: 0.14, spH: 0.35, dep: 0.25, lit: 0.06, ac: 0, balcony: 0, pipes: 0, fins: 0.6,
    walls: [[0.12, 0.13, 0.15], [0.18, 0.18, 0.2]], glass: [[0.03, 0.05, 0.07], [0.06, 0.06, 0.08]],
    setbacks: 3, podium: 0.4,
  },
};
export const STYLE_NAMES = Object.keys(STYLES);

const LIT_TINTS = [
  [1.0, 0.72, 0.42], [1.0, 0.78, 0.5], [1.0, 0.66, 0.36], [0.75, 0.85, 1.0], [1.0, 0.35, 0.8], [0.35, 0.9, 1.0],
];
const NEON = [[0.1, 0.95, 1.0], [1.0, 0.15, 0.6], [1.0, 0.85, 0.2], [0.6, 0.3, 1.0], [1.0, 0.2, 0.2]];

class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.m = []; this.c = []; }
  push(m, c) { this.m.push(...m.elements); this.c.push(c[0], c[1], c[2]); }
  build(parent) {
    const n = this.c.length / 3;
    if (!n) return;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    mesh.instanceMatrix.array.set(this.m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    mesh.frustumCulled = false;
    parent.add(mesh);
  }
}

export function createBuildingKit() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const plane = new THREE.PlaneGeometry(1, 1);

  // 墙体：世界坐标三向投影的混凝土，被雨淋湿略带光泽
  const concreteMap = loadTexture('concrete_wall_008_diff_1k.jpg');
  const wallMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  wallMat.colorNode = triplanarTexture(texture(concreteMap), null, null, float(0.18), positionWorld, normalWorld).rgb.mul(0.7);

  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.9, envMapIntensity: 0.6 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.6 });

  const litMats = litWindowTextures().map((map) => {
    const m = new THREE.MeshBasicMaterial({ map });
    m.color.setScalar(1.6);
    return m;
  });
  const neonMat = new THREE.MeshBasicMaterial();
  neonMat.color.setScalar(2.2);

  // 航空障碍灯：按实例错开相位闪烁
  const blinkMat = new THREE.MeshBasicNodeMaterial();
  blinkMat.colorNode = vec3(8, 0.3, 0.2).mul(sin(time.mul(2.2).add(hash(instanceIndex).mul(6.28))).mul(0.5).add(0.5).pow(6));

  const B = {
    wall: new Batch(box, wallMat),
    glass: new Batch(box, glassMat),
    metal: new Batch(box, metalMat),
    pipe: new Batch(cyl, metalMat),
    neon: new Batch(box, neonMat),
    blink: new Batch(box, blinkMat),
    lit: litMats.map((m) => new Batch(plane, m)),
  };

  function put(batch, face, u, y, out, su, sy, sn, col) {
    _p.copy(face.c).addScaledVector(face.t, u).addScaledVector(face.n, out);
    _p.y = y;
    _m.makeBasis(face.t, UP, face.n).scale(_s.set(su, sy, sn)).setPosition(_p);
    batch.push(_m, col);
  }
  function putWorld(batch, x, y, z, sx, sy, sz, col) {
    _m.makeScale(sx, sy, sz).setPosition(x, y, z);
    batch.push(_m, col);
  }

  function facade(face, sec, S, r, wallC, info) {
    const H = sec.y1 - sec.y0;
    const floors = Math.round(H / sec.floorH);
    const bays = Math.max(1, Math.round(face.width / S.bayW));
    const bayW = face.width / bays;
    const { dep, pierW } = S;
    const spH = sec.podium ? 0.9 : S.spH;
    const lit = sec.podium ? 0.35 : S.lit;

    for (let f = 0; f < floors; f++) {
      const yb = sec.y0 + f * sec.floorH;
      put(B.wall, face, 0, yb + spH / 2, dep / 2, face.width, spH, dep, wallC);
    }
    for (let k = 0; k <= bays; k++) {
      put(B.wall, face, -face.width / 2 + k * bayW, (sec.y0 + sec.y1) / 2, dep / 2, pierW, H, dep, wallC);
    }

    // 阳台按列分布，更像真实住宅
    const balconyCols = new Set();
    if (S.balcony && !sec.podium) for (let b = 0; b < bays; b++) if (r() < S.balcony) balconyCols.add(b);

    const winW = bayW - pierW;
    const winH = sec.floorH - spH;
    for (let f = 0; f < floors; f++) {
      const yb = sec.y0 + f * sec.floorH;
      for (let b = 0; b < bays; b++) {
        const u = -face.width / 2 + (b + 0.5) * bayW;
        if (r() < lit) {
          const tint = LIT_TINTS[r() < 0.8 ? Math.floor(r() * 3) : 3 + Math.floor(r() * 3)];
          const k = 0.35 + r() * 0.75;
          put(B.lit[Math.floor(r() * 4)], face, u, yb + spH + winH / 2, 0.03, winW, winH, 1, [tint[0] * k, tint[1] * k, tint[2] * k]);
        }
        if (balconyCols.has(b) && f > 0) {
          put(B.wall, face, u, yb + spH - 0.06, dep + 0.6, bayW - 0.1, 0.14, 1.2, wallC);
          put(B.metal, face, u, yb + spH + 0.5, dep + 1.18, bayW - 0.1, 1.0, 0.05, [0.12, 0.12, 0.13]);
        } else if (S.ac && f > 0 && r() < S.ac) {
          const g = 0.12 + r() * 0.12;
          put(B.metal, face, u + (r() - 0.5) * Math.max(0, winW - 0.9), yb + spH * 0.5, dep + 0.28, 0.85, 0.6, 0.55, [g, g, g * 1.02]);
        }
      }
    }

    if (r() < S.pipes) {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const u = -face.width / 2 + Math.floor(r() * bays) * bayW + pierW / 2 + 0.2;
        put(B.pipe, face, u, (sec.y0 + sec.y1) / 2, dep + 0.15, 0.22, H, 0.22, [0.25, 0.24, 0.22]);
      }
    }
    if (info.fins && !sec.podium) {
      for (const k of [0, bays]) {
        put(B.neon, face, -face.width / 2 + k * bayW, (sec.y0 + sec.y1) / 2, dep + 0.06, 0.08, H, 0.08, info.finColor);
      }
    }
  }

  function roof(sec, r, wallC, top, tall) {
    const { cx, cz, hw, hd, y1 } = sec;
    const dep = sec.dep;
    // 屋面 + 檐口
    putWorld(B.wall, cx, y1 + 0.15, cz, hw * 2, 0.3, hd * 2, [wallC[0] * 0.5, wallC[1] * 0.5, wallC[2] * 0.5]);
    putWorld(B.wall, cx, y1 + 0.35, cz, hw * 2 + dep * 2 + 0.5, 0.5, hd * 2 + dep * 2 + 0.5, wallC);
    // 设备箱、水箱
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const sx = 1.5 + r() * 2.5, sz = 1.5 + r() * 2.5, sy = 1 + r() * 1.6;
      const g = 0.25 + r() * 0.2;
      putWorld(B.metal, cx + (r() - 0.5) * (hw * 2 - sx), y1 + 0.6 + sy / 2, cz + (r() - 0.5) * (hd * 2 - sz), sx, sy, sz, [g, g, g]);
    }
    if (r() < 0.5) {
      const rad = 1 + r() * 0.8, h = 2.5 + r();
      _m.makeScale(rad * 2, h, rad * 2).setPosition(cx + (r() - 0.5) * hw, y1 + 0.6 + h / 2, cz + (r() - 0.5) * hd);
      B.pipe.push(_m, [0.3, 0.22, 0.16]);
    }
    if (top) {
      const h = 6 + r() * 14;
      const ax = cx + (r() - 0.5) * hw, az = cz + (r() - 0.5) * hd;
      _m.makeScale(0.25, h, 0.25).setPosition(ax, y1 + 0.6 + h / 2, az);
      B.pipe.push(_m, [0.3, 0.3, 0.32]);
      putWorld(B.blink, ax, y1 + 0.8 + h, az, 0.5, 0.5, 0.5, [1, 1, 1]);
      if (tall) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          putWorld(B.blink, cx + sx * hw, y1 + 0.9, cz + sz * hd, 0.4, 0.4, 0.4, [1, 1, 1]);
        }
      }
    }
  }

  // o: { x, z, w(x 向), d(z 向), h, style, side, r }
  function building(o) {
    const r = o.r;
    const S = STYLES[o.style];
    const pick = (a) => a[Math.floor(r() * a.length)];
    const wallC = pick(S.walls);
    const glassC = pick(S.glass);
    const info = { fins: r() < S.fins, finColor: pick(NEON) };

    const secs = [];
    let cx = o.x, cz = o.z, hw = o.w / 2, hd = o.d / 2, y = 0;
    if (r() < S.podium) {
      const floorH = 4.5;
      const h = floorH * (2 + Math.floor(r() * 2));
      secs.push({ cx, cz, hw, hd, y0: 0, y1: h, floorH, podium: true, dep: S.dep });
      y = h;
      const k = 0.78 + r() * 0.12;
      cx += o.side * hw * (1 - k) * r();
      hw *= k; hd *= 0.8 + r() * 0.15;
    }
    const nSec = 1 + Math.floor(r() * S.setbacks);
    for (let i = 0; i < nSec; i++) {
      const rest = o.h - y;
      if (rest < S.floorH * 3) break;
      const segH = i === nSec - 1 ? rest : rest * (0.45 + r() * 0.2);
      const floors = Math.max(3, Math.round(segH / S.floorH));
      secs.push({ cx, cz, hw, hd, y0: y, y1: y + floors * S.floorH, floorH: S.floorH, dep: S.dep });
      y += floors * S.floorH;
      const k = 0.72 + r() * 0.18;
      cx += o.side * hw * (1 - k);   // 退台向远离桥的一侧收进
      hw *= k; hd *= 0.75 + r() * 0.2;
    }

    const visibleFaces = [];
    secs.forEach((sec, si) => {
      const { cx, cz, hw, hd, y0, y1 } = sec;
      const H = y1 - y0;
      putWorld(B.glass, cx, (y0 + y1) / 2, cz, hw * 2, H, hd * 2, glassC);
      const faces = [
        { c: new THREE.Vector3(cx + hw, 0, cz), t: new THREE.Vector3(0, 0, -1), n: new THREE.Vector3(1, 0, 0), width: hd * 2 },
        { c: new THREE.Vector3(cx - hw, 0, cz), t: new THREE.Vector3(0, 0, 1), n: new THREE.Vector3(-1, 0, 0), width: hd * 2 },
        { c: new THREE.Vector3(cx, 0, cz + hd), t: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 0, 1), width: hw * 2 },
        { c: new THREE.Vector3(cx, 0, cz - hd), t: new THREE.Vector3(-1, 0, 0), n: new THREE.Vector3(0, 0, -1), width: hw * 2 },
      ];
      for (const face of faces) {
        facade(face, sec, S, r, wallC, info);
        if (face.n.x * o.side < 0.5) visibleFaces.push({ ...face, y0, y1, dep: S.dep, toBridge: face.n.x * o.side < -0.5, sec: si });
      }
      // 转角柱封住立面交接处
      const d = S.dep;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        putWorld(B.wall, cx + sx * (hw + d / 2 - 0.05), (y0 + y1) / 2, cz + sz * (hd + d / 2 - 0.05), d + 0.3, H, d + 0.3, wallC);
      }
      roof(sec, r, wallC, si === secs.length - 1, y1 > 80);
    });
    const top = secs[secs.length - 1];
    return { faces: visibleFaces, roofY: top.y1, top, secs, style: o.style };
  }

  function finish(parent) {
    for (const b of Object.values(B)) {
      if (Array.isArray(b)) b.forEach((x) => x.build(parent));
      else b.build(parent);
    }
  }

  return { building, finish };
}
