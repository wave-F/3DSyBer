import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { rng, bloodTexture, smokeTexture } from './textures.js';
import { DECK_Y, HALF_W, concrete, metal, lightConeMaterial } from './bridge.js';

// 雨夜湿车漆：金属底 + 清漆层（精细曲面车身会映出满车霓虹，金属度与清漆光泽需克制）
const carPaint = new THREE.MeshPhysicalMaterial({ color: 0x2f7f9f, roughness: 0.45, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.18 });

// 车的位置与朝向（车头为本地 +X）
const CAR_POS = new THREE.Vector3(5.5, DECK_Y, 0.2);
const CAR_YAW = -0.75;

// 供玩家碰撞用的车体包围盒（车本地坐标）
export const carCollider = {
  x: CAR_POS.x, z: CAR_POS.z, yaw: CAR_YAW,
  minX: -2.1, maxX: 1.75, minZ: -1.15, maxZ: 1.15,
};

export function buildCrash(scene) {
  const r = rng(404);
  const car = buildCar();
  car.group.position.copy(CAR_POS);
  car.group.position.y -= 0.03;
  car.group.rotation.set(-0.02, CAR_YAW, -0.03); // 左前轮脱落：车头下沉、左侧略低
  scene.add(car.group);
  car.group.updateMatrixWorld(true);

  buildBrokenRail(scene);
  buildDebris(scene, r);
  buildSkidMarks(scene);
  buildVictim(scene);

  // 车头起火的橙色闪烁光（放在车头前上方，离引擎盖约 0.8m，避免平方衰减把引擎盖打爆）
  const fireLight = new THREE.PointLight(0xff6a20, 6, 10, 2);
  fireLight.position.copy(car.group.localToWorld(new THREE.Vector3(2.0, 1.5, 0)));
  scene.add(fireLight);

  // 双闪警示光
  const hazardLight = new THREE.PointLight(0xffa020, 0, 14, 2);
  hazardLight.position.copy(car.group.localToWorld(new THREE.Vector3(-3.0, 1.2, 0)));
  scene.add(hazardLight);

  const smoke = buildSmoke(scene, car.group.localToWorld(new THREE.Vector3(1.2, 1.0, 0)));

  return function update(dt, t) {
    const on = Math.floor(t * 1.6) % 2 === 0;
    car.hazardMat.emissiveIntensity = on ? 8 : 0;
    hazardLight.intensity = on ? 5 : 0;
    fireLight.intensity = 4 + Math.sin(t * 23) * 1.5 + Math.sin(t * 7.1) * 1.5;
    smoke(dt);
  };
}

// 超跑模型（Blender 导出：Draco 压缩 + WebP 贴图，约 3.5MB）
// 模型本地坐标：地面 y=0，车头朝 +Z，车身左侧在 +X；节点 Body + Wheel_FL/FR/RL/RR
const CAR_URL = '/assets/supercar.glb';
const CRUMPLE = 1; // 车头撞击变形强度，0 = 完好无损

function buildCar() {
  const group = new THREE.Group();
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa020, emissiveIntensity: 0 });

  const draco = new DRACOLoader().setDecoderPath('/draco/');
  new GLTFLoader().setDRACOLoader(draco).load(CAR_URL, (gltf) => {
    const model = gltf.scene;
    model.rotation.y = Math.PI / 2; // 车头 +Z → 组内 +X
    group.add(model);

    const mats = carMaterials(hazardMat);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name.replace(/^GC_/, '');
      if (mats[key]) o.material = mats[key];
      else fixImportedMaterial(o.material);
    });

    const body = model.getObjectByName('Body');
    if (CRUMPLE > 0) body.traverse((o) => { if (o.isMesh) crumpleFront(o.geometry); });

    // 左前轮脱落，倒在车头左前方
    const wheel = model.getObjectByName('Wheel_FL');
    group.attach(wheel);
    wheel.position.set(2.1, 0.24, -1.75);
    wheel.rotation.set(0, 0.6, Math.PI / 2 - 0.25); // 轮轴（本地 X）转向接近竖直，轮子侧躺
    draco.dispose();
  });

  const beam = new THREE.SpotLight(0xdff4ff, 30, 30, 0.45, 0.6, 2);
  beam.position.set(1.45, 0.55, 0.6);
  beam.target.position.set(8, -0.5, 2);
  group.add(beam, beam.target);

  // 车灯在雨雾中的光束
  const beamGeo = new THREE.ConeGeometry(2.2, 12, 32, 1, true);
  beamGeo.translate(0, -6, 0);
  const beamCone = new THREE.Mesh(beamGeo, lightConeMaterial(0xcfe8ff));
  beamCone.position.copy(beam.position);
  beamCone.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, -1, 0),
    beam.target.position.clone().sub(beam.position).normalize()
  );
  group.add(beamCone);

  // 尾灯 + 双闪（模型本身没有红色尾灯材质，补两条发光灯带）
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1030, emissiveIntensity: 4 });
  for (const z of [-0.62, 0.62]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.5), tailMat);
    tail.position.set(-2.03, 0.62, z);
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.14), hazardMat);
    hz.position.set(-2.0, 0.62, z * 1.55);
    group.add(tail, hz);
  }

  return { group, hazardMat };
}

// 导出的 glTF 材质只保留了基础参数（多数是纯黑 + 金属度 1 + 粗糙度 0），按名字换成手调材质
function carMaterials(hazardMat) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  // 车架/底盘/引擎占车身表面约 40%，按哑光深灰处理，只留少量金属感
  const darkMetal = std({ color: 0x1e2023, roughness: 0.7, metalness: 0.3 });
  return {
    CarPaint_Main: carPaint,
    CarPaint_Accent: phys({ color: 0x0c0e10, roughness: 0.4, metalness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    Carbon_Fiber: phys({ color: 0x141518, roughness: 0.45, metalness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
    Chrome: std({ color: 0xb8bcc0, roughness: 0.3, metalness: 1 }),
    MetalFrame: darkMetal,
    EngineMetal: darkMetal,
    DISCS: std({ color: 0x55585c, roughness: 0.5, metalness: 0.8 }),
    Rim: std({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.8 }),
    MetalAccent: std({ color: 0x8e1010, roughness: 0.45, metalness: 0.6 }),
    PlasticMatte: std({ color: 0x0c0c0d, roughness: 0.8, metalness: 0 }),
    GlassWindshield: phys({ color: 0x05080c, roughness: 0.05, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.75 }),
    Glass_Headlight: phys({ color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false }),
    // 该材质覆盖整个大灯内腔（约 0.58m²），强度过高会整片炸成辉光
    LED_WhiteHeadlight: std({ color: 0x000000, emissive: 0xdff4ff, emissiveIntensity: 1.5 }),
    LED_OrangeSignle: hazardMat,
  };
}

// 未替换的导入材质（皮革、轮胎、织物等）：去掉错误的满金属度、避免镜面
function fixImportedMaterial(m) {
  m.metalness = Math.min(m.metalness, 0.1);
  m.roughness = Math.max(m.roughness, 0.5);
}

// 车头挤压变形：车头缩短、左前角撞得更深、表面起伏（模型本地坐标，车头 +Z，左侧 +X）
// 位移只取决于顶点位置，UV/硬边处拆分的重合顶点会同步移动，不会撕裂；保留原法线以免破坏硬表面着色
function crumpleFront(geo) {
  const p = geo.attributes.position;
  const Z0 = 0.9, Z1 = 2.1;
  let hit = false;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z <= Z0) continue;
    hit = true;
    const t = Math.min(1, (z - Z0) / (Z1 - Z0)) * CRUMPLE;
    const left = Math.max(0, x);
    z = Z0 + (z - Z0) * (1 - 0.3 * t) - left * 0.28 * t;
    y += (Math.sin(x * 6) * 0.04 + Math.sin(z * 13 + x * 7) * 0.015 - left * 0.08) * t;
    x *= 1 + 0.05 * t;
    p.setXYZ(i, x, y, z);
  }
  if (hit) {
    p.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

// 撞断的护栏：一段弯折挂在桥外，一段倒在路面
function buildBrokenRail(scene) {
  const x = HALF_W - 0.2;

  const hanging = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 3.2), metal);
  hanging.position.set(x + 0.9, DECK_Y - 0.5, -2.2);
  hanging.rotation.set(0.25, 0.4, 0.9);
  const hanging2 = hanging.clone();
  hanging2.position.set(x + 0.7, DECK_Y - 0.2, 1.2);
  hanging2.rotation.set(-0.3, -0.5, 0.7);

  const lying = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 2.6), metal);
  lying.position.set(x - 1.4, DECK_Y + 0.06, -4.6);
  lying.rotation.set(0, 0.6, Math.PI / 2);

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), metal);
  post.position.set(x - 0.6, DECK_Y + 0.05, -3.0);
  post.rotation.set(Math.PI / 2, 0, 0.8);

  scene.add(hanging, hanging2, lying, post);

  // 路缘断口的混凝土碎块
  const r = rng(9);
  for (let i = 0; i < 14; i++) {
    const s = 0.1 + r() * 0.3;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s * 1.2), concrete);
    chunk.position.set(x - r() * 2.5, DECK_Y + s * 0.4, -3.5 + r() * 6);
    chunk.rotation.set(r() * 3, r() * 3, r() * 3);
    scene.add(chunk);
  }
}

// 车身碎片与玻璃渣
function buildDebris(scene, r) {
  const paint = carPaint;
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 1 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();

  const shards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.01, 0.05), glass, 260);
  for (let i = 0; i < shards.count; i++) {
    v.set(2 + r() * 4.8, DECK_Y + 0.015, -5 + r() * 9);
    q.setFromEuler(e.set(0, r() * 6, 0));
    s.setScalar(0.5 + r() * 1.5);
    shards.setMatrixAt(i, m.compose(v, q, s));
  }
  scene.add(shards);

  for (let i = 0; i < 18; i++) {
    const piece = new THREE.Mesh(
      new THREE.BoxGeometry(0.2 + r() * 0.6, 0.03, 0.15 + r() * 0.4),
      r() < 0.6 ? paint : dark
    );
    piece.position.set(1 + r() * 5.5, DECK_Y + 0.03, -6 + r() * 11);
    piece.rotation.set((r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3);
    scene.add(piece);
  }
}

// 刹车痕：从后方一路拐向护栏
function buildSkidMarks(scene) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.75, depthWrite: false });
  const curve = (t) => new THREE.Vector3(-1.5 + Math.pow(t, 2.2) * 5.4, 0, -30 + t * 28.7);
  for (const off of [-0.8, 0.8]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(curve(i / 40));
    for (let i = 0; i < 40; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = b.clone().sub(a);
      const len = dir.length();
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.22, len + 0.05), mat);
      const nx = dir.z / len, nz = -dir.x / len;
      seg.position.set((a.x + b.x) / 2 + nx * off, DECK_Y + 0.02, (a.z + b.z) / 2 + nz * off);
      seg.rotation.order = 'YXZ';
      seg.rotation.set(-Math.PI / 2, Math.atan2(dir.x, dir.z), 0);
      scene.add(seg);
    }
  }
}

// 盖着白布的遇难者 + 血迹
function buildVictim(scene) {
  const W = 2.2, D = 0.95;
  const geo = new THREE.PlaneGeometry(W, D, 70, 34);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  // 柔和的隆起，布料在身体部位之间自然撑起
  const bump = (x, z, cx, cz, rx, rz, h) => {
    const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
    return h * Math.max(0, 1 - d / 2.4) ** 1.4;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = Math.max(
      bump(x, z, 0.78, 0, 0.14, 0.13, 0.2),       // 头
      bump(x, z, 0.3, 0, 0.36, 0.25, 0.22),       // 躯干
      bump(x, z, 0.25, 0.3, 0.3, 0.08, 0.1),      // 手臂
      bump(x, z, 0.25, -0.3, 0.3, 0.08, 0.1),
      bump(x, z, -0.45, 0.12, 0.45, 0.1, 0.14),   // 腿
      bump(x, z, -0.42, -0.14, 0.45, 0.1, 0.14),
      bump(x, z, -0.85, 0.2, 0.08, 0.06, 0.16),   // 脚
      bump(x, z, -0.82, -0.18, 0.08, 0.06, 0.16)
    );
    // 布料向边缘垂落并带一点褶皱
    const edge = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z));
    h = Math.max(h * 0.95, 0) + 0.015 + Math.sin(x * 9 + z * 4) * 0.008;
    h *= Math.min(1, edge / 0.12 + 0.15);
    p.setY(i, h);
  }
  geo.computeVertexNormals();
  const sheet = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xb8b8b2, roughness: 0.75, side: THREE.DoubleSide })
  );
  sheet.position.set(1.6, DECK_Y + 0.02, 5.2);
  sheet.rotation.y = 0.5;
  scene.add(sheet);

  const bloodMat = (seed, o) => new THREE.MeshStandardMaterial({
    map: bloodTexture(seed), transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.2, opacity: o,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), bloodMat(1, 1));
  pool.rotation.set(-Math.PI / 2, 0, 0.3);
  pool.position.set(2.3, DECK_Y + 0.018, 4.4);
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 3.2), bloodMat(2, 0.8));
  trail.rotation.set(-Math.PI / 2, 0, 0.9);
  trail.position.set(3.4, DECK_Y + 0.017, 3.2);
  scene.add(pool, trail);
}

// 车头冒烟
function buildSmoke(scene, origin) {
  const tex = smokeTexture();
  const parts = [];
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0x5a5a60, transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(mat);
    s.userData.life = i / 40 * 4;
    scene.add(s);
    parts.push(s);
  }
  return (dt) => {
    for (const s of parts) {
      const d = s.userData;
      d.life += dt;
      if (d.life > 4) {
        d.life -= 4;
        d.vx = (Math.random() - 0.5) * 0.4;
        d.vz = (Math.random() - 0.5) * 0.4;
        s.position.copy(origin);
      }
      const t = d.life / 4;
      s.position.x = origin.x + (d.vx || 0) * d.life + t * 1.5;
      s.position.z = origin.z + (d.vz || 0) * d.life;
      s.position.y = origin.y + d.life * 1.4;
      s.scale.setScalar(0.6 + t * 3.5);
      s.material.opacity = Math.sin(t * Math.PI) * 0.45;
    }
  };
}
