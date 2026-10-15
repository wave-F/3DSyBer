import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, max, normalMap,
  triplanarTexture, positionWorld, normalWorld,
  positionView, sin, dot, step,
} from 'three/tsl';
import { mergeStatic } from './merge.js';
import { prepareLightmap } from './lightmap/index.js';
import { addLightGroup } from './debugLights.js';
import { laneTexture, puddleTexture, loadTexture, highwaySignTexture, tickerTexture } from './textures.js';

export const DECK_Y = 20;     // 桥面高度
export const HALF_W = 7;      // 桥面半宽
export const HALF_L = 260;    // 桥面半长
export const BREAK = { side: 1, z0: -3.5, z1: 2.5 }; // 右侧护栏撞断的区间

// 混凝土：按世界坐标三向投影贴图，任意尺寸的盒子都不会拉伸
const concreteMap = loadTexture('concrete_wall_008_diff_1k.jpg');
export const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
concrete.colorNode = triplanarTexture(texture(concreteMap), null, null, float(0.3), positionWorld, normalWorld).rgb.mul(vec3(0.24, 0.25, 0.28));
concrete.userData.lightmap = true;
concrete.userData.bake = { albedoMap: concreteMap, albedo: [0.24, 0.25, 0.28] };   // 烘焙时的平均底色（节点材质导不出颜色）

export const metal = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.35, metalness: 0.85 });
metal.userData.lightmap = true;

// 光照图：封锁区（玩家能走到的范围）往外 15 m 内最精细，越远越粗；朝下的面和被路面盖住的桥面顶只给一点
const LM_NEAR = [-60, 82];
const SEG = 10;   // 长条几何体沿 z 每 10 m 分一段，光照图按段给精度
const segs = (len) => Math.max(1, Math.ceil(len / SEG));
function bridgeDensity(c, n, mesh) {
  const dz = Math.max(LM_NEAR[0] - c.z, c.z - LM_NEAR[1], 0);
  let d = 28 * Math.max(0.1, Math.exp(-dz / 30));
  if (n.y < -0.5) d *= 0.2;
  if (mesh.material === concrete && n.y > 0.5 && Math.abs(c.y - DECK_Y) < 0.05) d *= 0.2;
  return d;
}

export function buildBridge(scene) {
  const group = new THREE.Group();

  // 桥面
  const deck = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1, 1.4, HALF_L * 2, 1, 1, segs(HALF_L * 2)), concrete);
  deck.position.set(0, DECK_Y - 0.7, 0);
  group.add(deck);

  // 湿路面
  const road = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 - 1, HALF_L * 2, 1, segs(HALF_L * 2)), roadMaterial());
  road.rotation.x = -Math.PI / 2;
  road.position.y = DECK_Y + 0.01;
  group.add(road);

  // 桥墩
  const pierGeo = new THREE.BoxGeometry(4, DECK_Y - 1.4, 3);
  for (let z = -HALF_L + 15; z < HALF_L; z += 30) {
    const pier = new THREE.Mesh(pierGeo, concrete);
    pier.position.set(0, (DECK_Y - 1.4) / 2, z);
    group.add(pier);
  }

  // 桥体两侧霓虹灯带
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x22e6ff, emissiveIntensity: 4 });
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, HALF_L * 2), stripMat);
    strip.position.set(s * (HALF_W + 0.52), DECK_Y - 0.5, 0);
    group.add(strip);
  }

  // 护栏：混凝土路缘 + 金属立柱 + 横杆
  for (const s of [-1, 1]) {
    const segments = s === BREAK.side
      ? [[-HALF_L, BREAK.z0], [BREAK.z1, HALF_L]]
      : [[-HALF_L, HALF_L]];
    for (const [a, b] of segments) addRailing(group, s, a, b);
  }

  // 路灯 + 雨雾中的光柱
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 8, 8);
  const armGeo = new THREE.BoxGeometry(1.6, 0.1, 0.1);
  const headGeo = new THREE.BoxGeometry(0.7, 0.12, 0.3);
  // 灯头只要略高于辉光阈值 1.3，保留暖色光晕。原 8 会在色调映射前剪成纯白
  const headMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe2b0, emissiveIntensity: 2.2 });
  const streetLights = [];
  const bakeLights = [];   // 烘焙用：每个灯头都是光源（实时点光只放在封锁区附近）
  for (let z = -240; z <= 240; z += 30) {
    for (const s of [-1, 1]) {
      const zz = z + (s > 0 ? 15 : 0);
      const hx = s * (HALF_W - 1.6);
      const pole = new THREE.Mesh(poleGeo, metal);
      pole.position.set(s * (HALF_W - 0.3), DECK_Y + 4, zz);
      const arm = new THREE.Mesh(armGeo, metal);
      arm.position.set(s * (HALF_W - 1.0), DECK_Y + 7.95, zz);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(hx, DECK_Y + 7.85, zz);
      group.add(pole, arm, head);
      bakeLights.push({ pos: [hx, DECK_Y + 7.5, zz], color: 0xffd6a0, intensity: 48, radius: 0.25 });
      if (Math.abs(zz) <= 75) {
        const light = new THREE.PointLight(0xffd6a0, 48, 28, 2);
        light.position.set(hx, DECK_Y + 7.5, zz);
        light.userData.fogCone = true;   // 体积雾里按向下的光锥散射
        light.userData.lightmap = 'bake';   // 漫反射已烘进光照图，静态表面上只算高光
        streetLights.push(light);
        group.add(light);
      }
    }
  }
  addLightGroup('路灯（灯头、照地）', (on) => {
    headMat.emissiveIntensity = on ? 2.2 : 0;
    for (const light of streetLights) light.intensity = on ? 48 : 0;
  });

  // 跨桥龙门架：高速路牌 + LED 跑马灯
  addGantry(group, -48, false, ['湾岸線', 'BAYSHORE  ROUTE', 'B7'], ['出口 新宿', 'EXIT  SHINJUKU', '2km'], '前方事故 减速慢行  ACCIDENT AHEAD  SLOW DOWN  雨天路滑  RAIN  ', '#ffb020');
  addGantry(group, 70, true, ['夜城中心', 'CITY  CENTER', 'C1'], ['港区', 'HARBOR', '5km'], '欢迎来到夜城  WELCOME TO NIGHT CITY  限速 80  SPEED LIMIT 80  ', '#ff3030');

  mergeStatic(group);
  // 混凝土、路面、金属合并块进光照图；发光件、实例化立柱不进（立柱由探针照亮）
  const receivers = group.children.filter((o) => o.isMesh && !o.isInstancedMesh && o.material.userData.lightmap);
  prepareLightmap('bridge', receivers, { width: 2048, height: 2048, density: bridgeDensity, cell: SEG });
  group.userData.bakeLights = bakeLights;
  scene.add(group);
}

function addGantry(parent, zPos, flip, signA, signB, ticker, tickerColor) {
  const group = new THREE.Group();
  group.position.z = zPos;
  if (flip) group.rotation.y = Math.PI;
  parent.add(group);
  const z = 0;
  const y = DECK_Y + 7.5;
  const span = HALF_W * 2 + 3;
  const beamMat = metal;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.8, 0.5), beamMat);
    post.position.set(s * (HALF_W + 0.25), DECK_Y + 3.9, z);
    group.add(post);
  }
  // 桁架：上下弦杆 + 斜撑
  for (const dy of [0.9, -0.9]) {
    for (const dz of [-0.5, 0.5]) {
      const chord = new THREE.Mesh(new THREE.BoxGeometry(span, 0.14, 0.14), beamMat);
      chord.position.set(0, y + dy, z + dz);
      group.add(chord);
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = -span / 2 + (i + 0.5) * (span / 12);
    for (const dz of [-0.5, 0.5]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), beamMat);
      brace.position.set(x, y, z + dz);
      brace.rotation.z = i % 2 ? 0.6 : -0.6;
      group.add(brace);
    }
  }
  // 路牌朝向本地 +z
  const signs = [[signA, -HALF_W / 2], [signB, HALF_W / 2]];
  for (const [lines, x] of signs) {
    const mat = new THREE.MeshStandardMaterial({ map: highwaySignTexture(lines), emissiveMap: null, roughness: 0.4 });
    mat.emissive.set(0xffffff);
    mat.emissiveMap = mat.map;
    mat.emissiveIntensity = 0.5;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.25), mat);
    sign.position.set(x, y + 0.2, z + 0.62);
    group.add(sign);
    const back = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.35, 0.1), beamMat);
    back.position.set(x, y + 0.2, z + 0.55);
    group.add(back);
  }
  // 跑马灯挂在路牌下方
  const tex = tickerTexture(ticker, tickerColor);
  const tMat = new THREE.MeshBasicNodeMaterial();
  tMat.colorNode = texture(tex, uv().mul(vec2(0.5, 1)).add(vec2(gameTime.mul(0.04), 0))).rgb.mul(3);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(span - 1, 0.7), tMat);
  strip.position.set(0, y - 1.5, z + 0.6);
  group.add(strip);
}

// 脚下是不是水洼（水脚步用）：读路面同一张水洼遮罩，阈值约等于着色器里水洼过半的位置
let puddleMask = null, puddlePixels = null;
const PUDDLE_LEVEL = 0.42 * 255;
export function puddleAt(x, z) {
  if (!puddleMask) return false;
  if (!puddlePixels) puddlePixels = puddleMask.getContext('2d').getImageData(0, 0, puddleMask.width, puddleMask.height).data;
  // 路面平面绕 X 转 -90°：u 沿 +X，v 沿 -Z；画布第 0 行是 v = 1（贴图默认 flipY）
  const col = Math.floor((x / (HALF_W * 2 - 1) + 0.5) * puddleMask.width);
  const row = Math.floor((0.5 + z / (HALF_L * 2)) * puddleMask.height);
  if (col < 0 || row < 0 || col >= puddleMask.width || row >= puddleMask.height) return false;
  return puddlePixels[(row * puddleMask.width + col) * 4] > PUDDLE_LEVEL;
}

// 湿沥青：PBR 贴图 + 车道线 + 水洼。水洼处更暗、更光滑、反射更强（metalness 同时驱动 SSR 反射强度）
function roadMaterial() {
  const diff = loadTexture('clean_asphalt_diff_2k.jpg');
  const nor = loadTexture('clean_asphalt_nor_gl_2k.jpg', false);
  const rough = loadTexture('clean_asphalt_rough_2k.jpg', false);
  const lanes = laneTexture();
  const puddles = puddleTexture();
  puddleMask = puddles.image;

  const W = HALF_W * 2 - 1, L = HALF_L * 2;
  const aUV = uv().mul(vec2(W / 4, L / 4));
  const lane = texture(lanes, uv().mul(vec2(1, L / 14)));
  const puddle = smoothstep(0.15, 0.7, texture(puddles, uv()).r);

  const mat = new THREE.MeshStandardNodeMaterial();
  const base = mix(texture(diff, aUV).rgb.mul(0.5), lane.rgb.mul(0.7), lane.a);
  mat.colorNode = base.mul(mix(float(0.5), float(0.3), puddle));
  mat.roughnessNode = max(mix(texture(rough, aUV).r.mul(0.35), float(0.04), puddle), lane.a.mul(0.3));
  // 金属度压低（原 0.55/0.9），避免路面像镜子一样把所有霓虹再反射一遍
  mat.metalnessNode = mix(float(0.15), float(0.5), puddle).mul(lane.a.mul(-0.5).add(1));
  mat.envMapIntensity = 0.3;
  mat.userData.lightmap = true;
  mat.userData.bake = { albedoMap: diff, albedo: [0.2, 0.2, 0.2] };
  // 雨滴涟漪：水洼里满强度，普通湿沥青只留一点；远处淡出避免闪烁。
  // 法线同时写进 MRT，SSR 倒影会跟着涟漪一起晃
  const viewDist = positionView.z.negate();
  const rippleAmt = mix(float(0.15), float(1), puddle).mul(smoothstep(28, 6, viewDist)).mul(0.45);
  const g = rainRipples(positionWorld.xz, gameTime).mul(rippleAmt);
  // 路面平面 u 沿 +X、v 沿 -Z，所以切线空间 y 对应 -Z
  const tn = texture(nor, aUV).xyz.mul(2).sub(1);
  const bumped = vec3(tn.xy.mul(puddle.oneMinus().mul(0.8).add(0.05)).add(vec2(g.x.negate(), g.y)), tn.z).normalize();
  mat.normalNode = normalMap(bumped.mul(0.5).add(0.5));
  return mat;
}

const hash2 = (p) => sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453).fract();

// 程序化雨滴涟漪：世界 XZ 上铺几层错开的格子，每格每个周期随机落一滴，
// 圆环向外扩散并衰减。返回高度场梯度（世界 x、z），用来扰动法线
function rainRipples(p, time) {
  let grad = vec2(0, 0);
  const layers = [[0.5, 0.0, 1.15], [0.43, 3.7, 1.35], [0.61, 7.1, 0.95], [0.37, 11.3, 1.6]];
  layers.forEach(([cell, off, rate], i) => {
    const q = p.div(cell).add(off);
    const id = q.floor();
    const f = q.fract().sub(0.5);
    const phase = hash2(id.add(i * 17.3)).x;
    const tt = time.mul(rate).add(phase);
    const t = tt.fract();
    const h = hash2(id.add(tt.floor().mul(vec2(13.1, 7.7))));   // 每个周期换落点
    const v = f.sub(h.sub(0.5).mul(0.36));
    const d = v.length().max(0.0001);
    const s = d.sub(t.mul(0.32)).div(0.05).clamp(-1, 1);          // 环带内 -1..1
    const fade = t.oneMinus().pow(2).mul(step(0.3, h.y));            // 约 30% 的格子本周期不落
    const amp = sin(s.mul(Math.PI)).mul(s.mul(s).oneMinus()).mul(fade);
    grad = grad.add(v.div(d).mul(amp));
  });
  return grad;
}

// 护栏灯带两侧统一青色；原 ×5（亮度≈3.5）过曝，现 ×0.9（亮度≈0.63），低于辉光阈值 1.3，只是一根不发光晕的细亮线
const railNeon = new THREE.MeshBasicMaterial({ color: 0x20f0ff });
railNeon.color.multiplyScalar(0.9);

function addRailing(group, s, z0, z1) {
  const x = s * (HALF_W - 0.2);

  const brokenStart = s === BREAK.side && z0 === BREAK.z1;
  const brokenEnd = s === BREAK.side && z1 === BREAK.z0;
  const curbStart = z0 + (brokenStart ? 0.7 : 0);
  const curbEnd = z1 - (brokenEnd ? 0.7 : 0);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, curbEnd - curbStart, 1, 1, segs(curbEnd - curbStart)), concrete);
  curb.position.set(x, DECK_Y + 0.25, (curbStart + curbEnd) / 2);
  group.add(curb);

  // Damaged spans continue from these cut points in buildBrokenRail.
  const railStart = z0 + (brokenStart ? 1.2 : 0);
  const railEnd = z1 - (brokenEnd ? 1.2 : 0);
  for (const y of [0.85, 1.15]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, railEnd - railStart, 1, 1, segs(railEnd - railStart)), metal);
    rail.position.set(x, DECK_Y + y, (railStart + railEnd) / 2);
    group.add(rail);
  }

  // 护栏顶部霓虹灯带（两侧同色）
  const neon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, railEnd - railStart), railNeon);
  neon.position.set(x, DECK_Y + 1.22, (railStart + railEnd) / 2);
  group.add(neon);

  const postStart = z0 + (brokenStart ? 2 : 0);
  const postEnd = z1 - (brokenEnd ? 2 : 0);
  const count = Math.floor((postEnd - postStart) / 2) + 1;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), metal, count);
  const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.035, 0.24), metal, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const z = postStart + i * 2;
    m.makeTranslation(x, DECK_Y + 0.85, z);
    posts.setMatrixAt(i, m);
    m.makeTranslation(x, DECK_Y + 0.5175, z);
    feet.setMatrixAt(i, m);
  }
  group.add(posts, feet);
}
