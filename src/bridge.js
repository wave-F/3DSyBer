import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import {
  texture, uv, vec2, vec3, float, mix, smoothstep, max, normalMap,
  triplanarTexture, positionWorld, normalWorld, normalView, positionViewDirection, color,
} from 'three/tsl';
import { laneTexture, puddleTexture, loadTexture, highwaySignTexture, tickerTexture } from './textures.js';

export const DECK_Y = 20;     // 桥面高度
export const HALF_W = 7;      // 桥面半宽
export const HALF_L = 260;    // 桥面半长
export const BREAK = { side: 1, z0: -3.5, z1: 2.5 }; // 右侧护栏撞断的区间

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
  const headMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe2b0, emissiveIntensity: 8 });
  const coneGeo = new THREE.ConeGeometry(3.2, 7.8, 32, 1, true);
  coneGeo.translate(0, -3.9, 0);
  const coneMat = lightConeMaterial(0xffd6a0);
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
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(hx, DECK_Y + 7.8, zz);
      group.add(pole, arm, head, cone);
      if (Math.abs(zz) <= 75) {
        const light = new THREE.PointLight(0xffd6a0, 90, 28, 2);
        light.position.set(hx, DECK_Y + 7.5, zz);
        group.add(light);
      }
    }
  }

  // 跨桥龙门架：高速路牌 + LED 跑马灯
  addGantry(group, -48, false, ['湾岸線', 'BAYSHORE  ROUTE', 'B7'], ['出口 新宿', 'EXIT  SHINJUKU', '2km'], '前方事故 减速慢行  ACCIDENT AHEAD  SLOW DOWN  雨天路滑  RAIN  ', '#ffb020');
  addGantry(group, 70, true, ['夜城中心', 'CITY  CENTER', 'C1'], ['港区', 'HARBOR', '5km'], '欢迎来到夜城  WELCOME TO NIGHT CITY  限速 80  SPEED LIMIT 80  ', '#ff3030');

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

// 湿沥青：PBR 贴图 + 车道线 + 水洼。水洼处更暗、更光滑、反射更强（metalness 同时驱动 SSR 反射强度）
function roadMaterial() {
  const diff = loadTexture('clean_asphalt_diff_2k.jpg');
  const nor = loadTexture('clean_asphalt_nor_gl_2k.jpg', false);
  const rough = loadTexture('clean_asphalt_rough_2k.jpg', false);
  const lanes = laneTexture();
  const puddles = puddleTexture();

  const W = HALF_W * 2 - 1, L = HALF_L * 2;
  const aUV = uv().mul(vec2(W / 4, L / 4));
  const lane = texture(lanes, uv().mul(vec2(1, L / 14)));
  const puddle = smoothstep(0.15, 0.7, texture(puddles, uv().mul(vec2(W / 11, L / 11))).r);

  const mat = new THREE.MeshStandardNodeMaterial();
  const base = mix(texture(diff, aUV).rgb.mul(0.5), lane.rgb.mul(0.7), lane.a);
  mat.colorNode = base.mul(mix(float(0.5), float(0.3), puddle));
  mat.roughnessNode = max(mix(texture(rough, aUV).r.mul(0.35), float(0.04), puddle), lane.a.mul(0.3));
  // 金属度压低（原 0.55/0.9），避免路面像镜子一样把所有霓虹再反射一遍
  mat.metalnessNode = mix(float(0.15), float(0.5), puddle).mul(lane.a.mul(-0.5).add(1));
  mat.envMapIntensity = 0.3;
  mat.normalNode = normalMap(texture(nor, aUV), vec2(puddle.oneMinus().mul(0.8).add(0.05)));
  return mat;
}

// 假体积光：加法混合的圆锥，边缘与底部渐隐
export function lightConeMaterial(hex) {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const facing = normalView.dot(positionViewDirection).abs();
  mat.fog = false;
  mat.colorNode = color(hex);
  mat.opacityNode = uv().y.pow(1.6).mul(facing.pow(2)).mul(0.07);
  return mat;
}

const railNeonR = new THREE.MeshBasicMaterial({ color: 0x20f0ff });
railNeonR.color.multiplyScalar(5);
const railNeonL = new THREE.MeshBasicMaterial({ color: 0xff2a9a });
railNeonL.color.multiplyScalar(5);

function addRailing(group, s, z0, z1) {
  const len = z1 - z0;
  const cz = (z0 + z1) / 2;
  const x = s * (HALF_W - 0.2);

  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, len), concrete);
  curb.position.set(x, DECK_Y + 0.25, cz);
  group.add(curb);

  for (const y of [0.85, 1.15]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, len), metal);
    rail.position.set(x, DECK_Y + y, cz);
    group.add(rail);
  }

  // 护栏顶部霓虹灯带（左品红、右青）
  const neon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, len), s > 0 ? railNeonR : railNeonL);
  neon.position.set(x, DECK_Y + 1.22, cz);
  group.add(neon);

  const count = Math.floor(len / 2) + 1;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), metal, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(x, DECK_Y + 0.85, z0 + Math.min(i * 2, len));
    posts.setMatrixAt(i, m);
  }
  group.add(posts);
}
