import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, max, normalMap,
  triplanarTexture, positionWorld, normalWorld,
  positionView, sin, dot, step, fract, floor, min, abs, sign, select, hash, mod, mx_noise_float,
} from 'three/tsl';
import { mergeStatic } from './merge.js';
import { addLightGroup } from './debugLights.js';
import { laneTexture, puddleTexture, loadTexture, highwaySignTexture, tickerTexture } from './textures.js';

export const DECK_Y = 20;     // 桥面高度
export const HALF_W = 7;      // 桥面半宽
export const HALF_L = 260;    // 桥面半长
export const BREAK = { side: 1, z0: -3.5, z1: 2.5 }; // 右侧护栏撞断的区间
// 路灯沿桥每 30 m 一盏，两侧错开 15 m（扶手立柱要避开）
const LAMP_Z = { 1: [], '-1': [] };
for (let z = -240; z <= 240; z += 30) { LAMP_Z[1].push(z + 15); LAMP_Z[-1].push(z); }

// 混凝土：按世界坐标三向投影贴图，任意尺寸的盒子都不会拉伸
const concreteMap = loadTexture('concrete_wall_008_diff_1k.jpg');
export const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
concrete.colorNode = triplanarTexture(texture(concreteMap), null, null, float(0.3), positionWorld, normalWorld).rgb.mul(vec3(0.24, 0.25, 0.28));

export const metal = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.35, metalness: 0.85 });

export function buildBridge(scene) {
  const group = new THREE.Group();

  // 桥面
  const deck = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1, 1.4, HALF_L * 2), concrete);
  deck.position.set(0, DECK_Y - 0.7, 0);
  group.add(deck);

  // 湿路面
  const road = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 - 1, HALF_L * 2), roadMaterial());
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

  // 护栏：混凝土防撞墙 + 墙顶钢管扶手 + 嵌入式灯槽
  for (const s of [-1, 1]) {
    const segments = s === BREAK.side
      ? [[-HALF_L, BREAK.z0], [BREAK.z1, HALF_L]]
      : [[-HALF_L, HALF_L]];
    for (const [a, b] of segments) addRailing(group, s, a, b);
  }

  // 路灯 + 雨雾中的光柱
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 8, 8);
  // 灯杆立在防撞墙顶外侧（造型没改，只是从墙里挪到墙顶，灯臂相应加长，灯头位置不变）
  const poleX = HALF_W + 0.16;
  const armGeo = new THREE.BoxGeometry(poleX - (HALF_W - 1.75), 0.1, 0.1);
  const headGeo = new THREE.BoxGeometry(0.7, 0.12, 0.3);
  // 灯头只要略高于辉光阈值 1.3，保留暖色光晕。原 8 会在色调映射前剪成纯白
  const headMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe2b0, emissiveIntensity: 2.2 });
  const streetLights = [];
  for (let z = -240; z <= 240; z += 30) {
    for (const s of [-1, 1]) {
      const zz = z + (s > 0 ? 15 : 0);
      const hx = s * (HALF_W - 1.6);
      const pole = new THREE.Mesh(poleGeo, metal);
      pole.position.set(s * poleX, DECK_Y + 4, zz);
      const arm = new THREE.Mesh(armGeo, metal);
      arm.position.set(s * (poleX + HALF_W - 1.75) / 2, DECK_Y + 7.95, zz);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(hx, DECK_Y + 7.85, zz);
      group.add(pole, arm, head);
      if (Math.abs(zz) <= 75) {
        const light = new THREE.PointLight(0xffd6a0, 48, 28, 2);
        light.position.set(hx, DECK_Y + 7.5, zz);
        light.userData.fogCone = true;   // 体积雾里按向下的光锥散射
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
  addGantry(group, -48, false, ['湾岸线', 'BAYSHORE  ROUTE', 'B7'], ['出口 北岸', 'NORTH  BANK', '2km'], '前方事故 减速慢行  ACCIDENT AHEAD  SLOW DOWN  雨天路滑  RAIN  ', '#ffb020');
  addGantry(group, 70, true, ['市中心', 'CITY  CENTER', 'C1'], ['港区', 'HARBOR', '5km'], '本路段由 URSA 调度  ROUTED BY URSA  限速 80  SPEED LIMIT 80  ', '#ff3030');

  mergeStatic(group);
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
  const diff = loadTexture('clean_asphalt_diff_2k.ktx2');
  const nor = loadTexture('clean_asphalt_nor_gl_2k.ktx2', false);
  const rough = loadTexture('clean_asphalt_rough_2k.ktx2', false);
  const lanes = laneTexture();
  const puddles = puddleTexture();
  puddleMask = puddles.image;

  const W = HALF_W * 2 - 1, L = HALF_L * 2;
  const aUV = uv().mul(vec2(W / 4, L / 4));
  const lane = texture(lanes, uv().mul(vec2(1, L / 14)));
  const puddle = smoothstep(0.15, 0.7, texture(puddles, uv()).r);

  const mat = new THREE.MeshStandardNodeMaterial();
  const base = mix(texture(diff, aUV).rgb.mul(0.5), lane.rgb.mul(0.7), lane.a);
  // 贴墙脚一圈接触阴影。路面不再铺灯槽青光。
  const ax = abs(positionWorld.x);
  const wallAO = smoothstep(WALL.inner - 0.7, WALL.inner, ax).mul(0.45).oneMinus();
  const brokenGap = step(0, positionWorld.x).mul(smoothstep(BREAK.z0 - 1.6, BREAK.z0 - 0.4, positionWorld.z))
    .mul(smoothstep(BREAK.z1 + 1.6, BREAK.z1 + 0.4, positionWorld.z));
  mat.colorNode = base.mul(mix(float(0.5), float(0.3), puddle)).mul(wallAO);
  mat.emissiveNode = CYAN.mul(smoothstep(WALL.inner - 1.1, WALL.inner, ax).pow(2).mul(brokenGap.oneMinus()).mul(0));
  mat.roughnessNode = max(mix(texture(rough, aUV).r.mul(0.35), float(0.04), puddle), lane.a.mul(0.3));
  // 金属度压低（原 0.55/0.9），避免路面像镜子一样把所有霓虹再反射一遍
  mat.metalnessNode = mix(float(0.15), float(0.5), puddle).mul(lane.a.mul(-0.5).add(1));
  mat.envMapIntensity = 0.3;
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

// ---------------------------------------------------------------------------
// 护栏：重型混凝土防撞墙（下宽上窄的 F 型截面）+ 墙顶钢管扶手 + 嵌在墙顶内侧凹槽里的青色灯带
// 截面坐标 (u, h)：u 从墙脚内侧（贴路面那一侧）往桥外量，h 从桥面往上量，单位米
// ---------------------------------------------------------------------------
export const WALL = {
  inner: HALF_W - 0.4,   // 墙脚内侧 |x|，玩家碰撞边界也在这里
  width: 0.58,           // 墙底宽
  height: 0.88,          // 墙高
  seg: 4,                // 每 4 m 一段（分段缝、编号、灯带分节都按这个网格）
  railU: 0.4,            // 扶手中心
  railH: 1.13,           // 扶手中心高度
  railR: 0.045,
  // 灯槽：切进上段斜面，开口朝路面
  grooveH: [0.79, 0.84],
  grooveU: 0.34,
};
// 不带灯槽的外轮廓（撞断的碎墙沿用这一份）
export const WALL_PROFILE = [[0, 0], [0, 0.075], [0.18, 0.255], [0.3, 0.86], [0.32, 0.88], [0.56, 0.88], [0.58, 0.86], [0.58, 0]];
const slopeU = (h) => 0.18 + (h - 0.255) * (0.12 / 0.605);   // 上段斜面上某高度对应的 u
const WALL_PROFILE_GROOVE = [
  [0, 0], [0, 0.075], [0.18, 0.255],
  [slopeU(WALL.grooveH[0]), WALL.grooveH[0]], [WALL.grooveU, WALL.grooveH[0]],
  [WALL.grooveU, WALL.grooveH[1]], [slopeU(WALL.grooveH[1]), WALL.grooveH[1]],
  [0.3, 0.86], [0.32, 0.88], [0.56, 0.88], [0.58, 0.86], [0.58, 0],
];
const GANTRY_Z = [-48, 70];
const CYAN = vec3(0.13, 0.94, 1);

// 世界 z → 段号、段内位置、到最近分段缝的距离（墙和灯带共用，保证分节对齐）
function segCoords() {
  const sz = positionWorld.z.add(HALF_L).div(WALL.seg);
  const fz = fract(sz).mul(WALL.seg);
  return { seg: floor(sz), fz, joint: min(fz, float(WALL.seg).sub(fz)) };
}
// 每段灯带亮度略有不同，墙面溢光跟着同一个值
const segBright = (seg, side) => hash(seg.add(side.mul(311))).mul(0.25).add(0.8);

// 编号模板字：0-9、B、- 共 12 格
function glyphAtlas() {
  const cw = 64, chH = 112, chars = '0123456789B-';
  const c = document.createElement('canvas');
  c.width = cw * chars.length; c.height = chH;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 100px "DIN Condensed", "Arial Narrow", Arial, sans-serif';
  [...chars].forEach((ch, i) => g.fillText(ch, cw * (i + 0.5), chH * 0.54));
  // 模板喷字的断桥：每个字中间横切一道
  g.fillStyle = '#000'; g.fillRect(0, chH * 0.5, c.width, 5);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// 防撞墙材质：混凝土底色 + 每段色差 + 分段缝 + 雨水流痕 + 墙脚脏污 + 编号 + 灯槽溢光
function wallMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const h = p.y.sub(DECK_Y);
  const side = sign(p.x);
  const inner = normalWorld.x.mul(side).negate().clamp(0, 1);   // 朝向路面的面
  const top = smoothstep(0.6, 0.9, normalWorld.y);
  const { seg, fz, joint } = segCoords();
  const along = select(side.greaterThan(0), fz, float(WALL.seg).sub(fz));   // 站在路上看过去的阅读方向

  const segTint = hash(seg.add(side.mul(977)));
  const base = triplanarTexture(texture(concreteMap), null, null, float(0.3), positionWorld, normalWorld).rgb
    .mul(vec3(0.24, 0.25, 0.28)).mul(segTint.mul(0.3).add(0.85));

  // 雨水从墙顶和分段缝往下流：竖向拉长的噪声，越往下越重；缝两侧更湿
  const nearJoint = smoothstep(0.35, 0.0, joint);
  const streakN = mx_noise_float(vec3(p.z.mul(9), h.mul(0.8), side.mul(5.3)));
  const streak = smoothstep(0.0, 0.55, streakN).mul(h.div(WALL.height).oneMinus().clamp(0, 1).mul(0.5).add(0.5))
    .max(nearJoint.mul(0.75)).mul(top.oneMinus());
  const grime = smoothstep(0.0, 0.3, h).mul(0.5).add(0.5);
  const jointLine = smoothstep(0.006, 0.022, joint).mul(0.8).add(0.2);
  let col = base.mul(grime).mul(streak.mul(0.38).oneMinus()).mul(jointLine).mul(top.mul(-0.2).add(1));

  // 龙门架立柱前后各 1.4 m：黄黑斜纹防撞警示，磨损斑驳
  const gz = min(abs(p.z.sub(GANTRY_Z[0])), abs(p.z.sub(GANTRY_Z[1])));
  const wear = smoothstep(-0.25, 0.25, mx_noise_float(p.mul(14)));
  const hazard = step(gz, 1.4).mul(step(0.1, h)).mul(step(h, 0.72)).mul(step(0.5, inner)).mul(wear.mul(0.25).add(0.65));
  const stripe = step(0.5, fract(p.z.mul(side).add(h).mul(2.4)));
  col = mix(col, mix(vec3(0.02, 0.02, 0.02), vec3(0.4, 0.28, 0.02), stripe), hazard);

  // 每 3 段喷一个编号 B7-xxx（数字取段号），在上段斜面、灯槽下方
  const cw = 0.075, h0 = 0.47, chH = 0.11;
  const ci = floor(along.sub(0.5).div(cw));
  const cu = fract(along.sub(0.5).div(cw));
  const cv = h.sub(h0).div(chH);
  const num = mod(floor(seg.div(3)).add(select(side.greaterThan(0), float(100), float(500))), 1000);
  const div = select(ci.equal(3), float(100), select(ci.equal(4), float(10), float(1)));
  const digit = mod(floor(num.div(div)), 10);
  const code = select(ci.equal(0), float(10), select(ci.equal(1), float(7), select(ci.equal(2), float(11), digit)));
  const inBox = step(0, ci).mul(step(ci, 5)).mul(step(0, cv)).mul(step(cv, 1))
    .mul(step(mod(seg, 3), 0.5)).mul(step(0.9, inner));
  const glyph = texture(glyphAtlas(), vec2(code.add(cu.mul(0.9).add(0.05)).div(12), cv)).r;
  col = mix(col, vec3(0.3, 0.31, 0.3), glyph.mul(inBox).mul(wear.mul(0.4).add(0.5)));

  // 墙脚排水孔：每 3 段一个
  const scupper = step(abs(mod(seg, 3).sub(1)), 0.1).mul(step(abs(fz.sub(2)), 0.18)).mul(step(h, 0.06)).mul(step(0.5, inner));
  col = mix(col, vec3(0.006, 0.006, 0.007), scupper);

  // 灯槽内壁：深色金属
  const groove = step(WALL.grooveH[0] - 0.003, h).mul(step(h, WALL.grooveH[1] + 0.003));
  col = mix(col, vec3(0.03, 0.033, 0.037), groove);

  m.colorNode = col;
  m.roughnessNode = mix(float(0.9), float(0.42), streak.mul(0.7).add(top.mul(0.45)).clamp(0, 1)).mul(groove.mul(-0.6).add(1));
  m.metalnessNode = groove.mul(0.6);
  // 灯槽往下打在斜面上的青色溢光：系数很低，只留一点点
  const spill = inner.mul(smoothstep(0.3, WALL.grooveH[0], h).pow(4)).mul(step(h, WALL.grooveH[0] - 0.003));
  m.emissiveNode = CYAN.mul(spill.mul(segBright(seg, side)).mul(0.008));
  return m;
}

// 灯槽扩散罩：磨砂青光，按 4 m 分节，节与节之间有暗缝
function diffuserMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const { seg, joint } = segCoords();
  const gap = smoothstep(0.03, 0.07, joint).mul(0.92).add(0.08);
  // 亮度 ≈0.45：暗一些的氛围灯，远低于辉光阈值 1.3
  m.colorNode = CYAN.mul(segBright(seg, sign(positionWorld.x))).mul(gap).mul(0.45);
  return m;
}

// 镀锌钢：湿处更亮更暗沉，轻微斑驳
function railMetalMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.7 });
  const n = mx_noise_float(positionWorld.mul(vec3(3, 6, 0.8)));
  const n2 = mx_noise_float(positionWorld.mul(22));
  m.colorNode = vec3(0.34, 0.36, 0.38).mul(n.mul(0.15).add(0.9)).mul(n2.mul(0.08).add(1));
  m.roughnessNode = float(0.38).add(n.mul(0.14)).add(n2.mul(0.06)).clamp(0.2, 0.6);
  return m;
}

let wallMat, diffuserMat, railMat, reflectorMat, unitWallGeo, unitDiffuserGeo, unitRailGeo;
function wallAssets() {
  if (wallMat) return;
  wallMat = wallMaterial();
  diffuserMat = diffuserMaterial();
  railMat = railMetalMaterial();
  reflectorMat = new THREE.MeshStandardMaterial({ color: 0x241808, emissive: 0xffa040, emissiveIntensity: 0.4, roughness: 0.3 });
  // 单位长度（z 0→1），每段按长度缩放；材质全用世界坐标，缩放不会拉伸
  const unit = (pts) => {
    const shape = new THREE.Shape(pts.map(([u, h]) => new THREE.Vector2(u, h)));
    return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  };
  unitWallGeo = unit(WALL_PROFILE_GROOVE);
  unitDiffuserGeo = new THREE.BoxGeometry(0.01, WALL.grooveH[1] - WALL.grooveH[0] - 0.008, 1).translate(0, 0, 0.5);
  unitRailGeo = new THREE.CylinderGeometry(WALL.railR, WALL.railR, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
}

// 截面局部 (u, h) 放到 s 侧：x = s·(inner + u)。s = -1 时镜像
function placeSpan(group, geo, mat, s, z0, z1, x = 0, y = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(s, 1, z1 - z0);
  mesh.position.set(s * (WALL.inner + x), DECK_Y + y, z0);
  // 镜像会翻转三角形朝向：几何体合并时烘焙了矩阵，这里提前用翻转版几何
  if (s < 0) mesh.geometry = mirrored(geo);
  group.add(mesh);
}
const mirrorCache = new Map();
function mirrored(geo) {
  if (!mirrorCache.has(geo)) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of Object.values(g.attributes)) {
        const a = attr.array, k = attr.itemSize;
        for (let c = 0; c < k; c++) { const t = a[(i + 1) * k + c]; a[(i + 1) * k + c] = a[(i + 2) * k + c]; a[(i + 2) * k + c] = t; }
      }
    }
    mirrorCache.set(geo, g);
  }
  return mirrorCache.get(geo);
}

// 按全局 4 m 网格切开（合批后按 z 分块，远处能被视锥裁掉）
function gridSpans(z0, z1) {
  const out = [];
  let a = z0;
  while (a < z1 - 1e-4) {
    const next = Math.min(z1, -HALF_L + (Math.floor((a + HALF_L) / WALL.seg + 1e-6) + 1) * WALL.seg);
    out.push([a, next]);
    a = next;
  }
  return out;
}

function addRailing(group, s, z0, z1) {
  wallAssets();
  const brokenStart = s === BREAK.side && z0 === BREAK.z1;
  const brokenEnd = s === BREAK.side && z1 === BREAK.z0;
  // 撞断区间两端各留一截给 crash.js 的碎墙 / 弯管接上
  const wallStart = z0 + (brokenStart ? 0.7 : 0);
  const wallEnd = z1 - (brokenEnd ? 0.7 : 0);
  for (const [a, b] of gridSpans(wallStart, wallEnd)) {
    placeSpan(group, unitWallGeo, wallMat, s, a, b);
    placeSpan(group, unitDiffuserGeo, diffuserMat, s, a, b, WALL.grooveU - 0.006, (WALL.grooveH[0] + WALL.grooveH[1]) / 2);
  }

  const railStart = z0 + (brokenStart ? 1.2 : 0);
  const railEnd = z1 - (brokenEnd ? 1.2 : 0);
  for (const [a, b] of gridSpans(railStart, railEnd)) placeSpan(group, unitRailGeo, railMat, s, a, b, WALL.railU, WALL.railH);

  // 扶手立柱 + 底板：每 2 m 一根，避开路灯杆
  const x = s * (WALL.inner + WALL.railU);
  const postStart = z0 + (brokenStart ? 2 : 0);
  const postEnd = z1 - (brokenEnd ? 2 : 0);
  const zs = [];
  for (let z = Math.ceil(postStart / 2) * 2; z <= postEnd; z += 2) {
    if (LAMP_Z[s].some((lz) => Math.abs(lz - z) < 0.5)) continue;
    zs.push(z);
  }
  const postH = WALL.railH - WALL.height;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.032, postH, 10), railMat, zs.length);
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.014, 0.17), railMat, zs.length);
  const m = new THREE.Matrix4();
  zs.forEach((z, i) => {
    posts.setMatrixAt(i, m.makeTranslation(x, DECK_Y + WALL.height + postH / 2, z));
    plates.setMatrixAt(i, m.makeTranslation(x, DECK_Y + WALL.height + 0.007, z));
  });
  group.add(posts, plates);

  // 反光道钉：每段中间一颗，贴在上段斜面
  const rh = 0.68, ru = slopeU(rh) - 0.004, tilt = Math.atan(0.12 / 0.605);
  const rz = [];
  for (let z = -HALF_L + WALL.seg / 2; z < HALF_L; z += WALL.seg) if (z > wallStart + 0.2 && z < wallEnd - 0.2) rz.push(z);
  const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.03, 0.07), reflectorMat, rz.length);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * tilt));
  const one = new THREE.Vector3(1, 1, 1);
  rz.forEach((z, i) => refl.setMatrixAt(i, m.compose(new THREE.Vector3(s * (WALL.inner + ru), DECK_Y + rh, z), q, one)));
  group.add(refl);
}
