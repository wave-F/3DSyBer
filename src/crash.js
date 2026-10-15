import * as THREE from 'three/webgpu';
import { float, mx_noise_float, positionLocal, positionWorld, vec3 } from 'three/tsl';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { rng } from './textures.js';
import { DECK_Y, HALF_W, BREAK, concrete as concreteBase, metal as metalBase } from './bridge.js';
import { mergeStatic } from './merge.js';
import { markKeep } from './investigation/mask.js';
import { addLightGroup } from './debugLights.js';
import { addTireTracks } from './tireTracks.js';

// 雨夜湿车漆：金属底 + 清漆层（精细曲面车身会映出满车霓虹，金属度与清漆光泽需克制）
const carPaint = markKeep(new THREE.MeshPhysicalNodeMaterial({ color: 0x2f7f9f, roughness: 0.38, metalness: 0.35, clearcoat: 0.85, clearcoatRoughness: 0.18 }));
// Object-space variation stays attached to the car without UV seams or visible tiling.
const paintVariation = mx_noise_float(positionLocal.mul(5));
carPaint.roughnessNode = float(0.38).add(paintVariation.mul(0.055)).clamp(0.3, 0.46);
carPaint.clearcoatRoughnessNode = float(0.18).add(paintVariation.mul(0.035)).clamp(0.13, 0.23);

// 车的位置与朝向（车头为本地 +X）
export const CAR_POS = new THREE.Vector3(5.5, DECK_Y, 0.2);
export const CAR_YAW = -0.75;

// 供玩家碰撞用的车体包围盒（车本地坐标）
export const carCollider = {
  x: CAR_POS.x, z: CAR_POS.z, yaw: CAR_YAW,
  minX: -2.1, maxX: 1.75, minZ: -1.15, maxZ: 1.15,
};

export function buildCrash(scene) {
  const r = rng(404);
  const readyCbs = [];
  let ready = null;
  const car = buildCar((info) => { ready = info; readyCbs.forEach((cb) => cb(info)); });
  car.group.position.copy(CAR_POS);
  car.group.position.y -= 0.03;
  car.group.rotation.set(-0.02, CAR_YAW, -0.03); // 左前轮脱落：车头下沉、左侧略低
  scene.add(car.group);
  car.group.updateMatrixWorld(true);

  buildBrokenRail(scene);
  buildDebris(scene, r);
  const skids = buildSkidMarks(scene);

  // 车头起火的橙色闪烁光（放在车头前上方，离引擎盖约 0.8m，避免平方衰减把引擎盖打爆）
  const fireLight = new THREE.PointLight(0xff6a20, 6, 10, 2);
  fireLight.position.copy(car.group.localToWorld(new THREE.Vector3(2.0, 1.5, 0)));
  scene.add(fireLight);

  // 双闪警示光
  const hazardLight = new THREE.PointLight(0xffa020, 0, 14, 2);
  hazardLight.position.copy(car.group.localToWorld(new THREE.Vector3(-3.0, 1.2, 0)));
  scene.add(hazardLight);

  let fireOn = true;
  let hazardOn = true;
  // 演出接管：{ on, boost, x }。boost 放大亮度与照射范围，x 为灯在车身本地 X 上的位置（扫光）
  let hazardOverride = null;
  let hazardLit = false;
  const HAZARD_LOCAL = new THREE.Vector3(-3.0, 1.2, 0);
  const _hp = new THREE.Vector3();
  function update(dt, t) {
    const o = hazardOverride;
    const on = o ? o.on : Math.floor(t * 1.6) % 2 === 0;
    const boost = o?.boost ?? 1;
    hazardLit = hazardOn && on;
    car.hazardMat.emissiveIntensity = hazardLit ? 8 * Math.min(boost, 3) : 0;
    hazardLight.intensity = hazardLit ? 5 * boost : 0;
    hazardLight.distance = 14 * Math.max(1, Math.sqrt(boost));
    _hp.copy(HAZARD_LOCAL);
    if (o?.x != null) { _hp.x = o.x; _hp.z = o.z ?? 2.2; }
    hazardLight.position.copy(car.group.localToWorld(_hp));
    fireLight.intensity = fireOn ? 4 + Math.sin(t * 23) * 1.5 + Math.sin(t * 7.1) * 1.5 : 0;
  }
  addLightGroup('车头火光', (on) => { fireOn = on; if (!on) fireLight.intensity = 0; });
  addLightGroup('双闪', (on) => {
    hazardOn = on;
    if (!on) { hazardLight.intensity = 0; car.hazardMat.emissiveIntensity = 0; }
  });
  // info: { pristine: 未变形的模型副本（重建前半段用）, crashed: 变形后的模型（重建后半段用）, door: 右车门节点（rotation.y 开合） }
  const onCarReady = (cb) => { if (ready) cb(ready); else readyCbs.push(cb); };
  return {
    update, carGroup: car.group, onCarReady, hazardMat: car.hazardMat,
    skids, setHazardOverride(o) { hazardOverride = o; },
    get hazardLit() { return hazardLit; },
  };
}

// 超跑模型（Blender 导出：Draco 压缩 + WebP 贴图，约 3.5MB）
// 模型本地坐标：地面 y=0，车头朝 +Z，车身左侧在 +X；节点 Body + Door_R + Wheel_FL/FR/RL/RR
// Door_R：右侧（副驾）车门，原点在前铰链，绕本地 Y 轴转，正角度门尾外翻；导出时已带撞后外翻 7°
// 源文件 art/supercar_door.blend，由 tools/blender/build_door_car.py 生成
const CAR_URL = `${import.meta.env.BASE_URL}assets/supercar_door.glb`;
export const DOOR_AJAR = 7 * Math.PI / 180;
const CAR_GLASS_URL = `${import.meta.env.BASE_URL}assets/supercar_glass_damage.glb`;
const CRUMPLE = 1; // 车头撞击变形强度，0 = 完好无损

function buildCar(onReady) {
  const group = new THREE.Group();
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa020, emissiveIntensity: 0 });

  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  Promise.all([loader.loadAsync(CAR_URL), loader.loadAsync(CAR_GLASS_URL)]).then(([gltf, glass]) => {
    const model = gltf.scene;
    model.rotation.y = Math.PI / 2; // 车头 +Z → 组内 +X
    group.add(model);

    const mats = carMaterials(hazardMat);
    const originalGlass = [];
    const paintMeshes = [];   // 主车漆面，给车门残漆贴花投影用
    model.traverse((o) => {
      if (!o.isMesh) return;
      const imported = o.material;
      const key = imported.name.replace(/^GC_/, '');
      if (key === 'GlassWindshield') originalGlass.push(o);
      if (key === 'CarPaint_Main') paintMeshes.push(o);
      if (mats[key]) {
        o.material = mats[key];
        if (imported.normalMap) {
          // Shared base materials must not share different parts' normal maps.
          o.material = o.material.clone();
          o.material.normalMap = imported.normalMap;
          o.material.normalScale.copy(imported.normalScale).multiplyScalar(key === 'CarPaint_Main' ? 0.4 : 0.7);
        }
      }
      else fixImportedMaterial(o.material);
      // 大灯玻璃和白色灯腔。灯腔是一整块亮面，关掉自发光后仍会在引擎盖上被打成白光
      if (key === 'Glass_Headlight' || key === 'LED_WhiteHeadlight') o.visible = false;
    });

    // 变形前保留一份独立几何的副本，给重建全息用
    const pristine = model.clone(true);
    pristine.traverse((o) => { if (o.isMesh) o.geometry = o.geometry.clone(); });
    pristine.getObjectByName('Door_R').rotation.y = 0;   // 事故前车门是关着的

    const body = model.getObjectByName('Body');
    // The source shares one material across all windows. Replace that whole set
    // with the exported intact side/rear glass plus the damaged front windshield.
    for (const mesh of originalGlass) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    glass.scene.name = 'CrashGlazing';
    glass.scene.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name.replace(/^GC_/, '');
      o.material = mats[key];
    });
    body.add(glass.scene);
    if (CRUMPLE > 0) body.traverse((o) => { if (o.isMesh) crumpleFront(o.geometry); });
    // 整辆车都是线索，分析模式下保留原色
    model.traverse((o) => { if (o.isMesh) markKeep(o.material); });

    // 左前轮脱落，平躺在车身左侧偏后（车左侧朝向护栏，再往前会出桥面悬空）
    const wheel = model.getObjectByName('Wheel_FL');
    group.attach(wheel);
    wheel.position.set(-1.9, 0, -1.9);
    wheel.rotation.set(0, 0.6, Math.PI / 2); // 轮轴（本地 X）转向竖直，轮子平躺
    // 按包围盒贴地，落在路面上
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wheel);
    wheel.position.y += DECK_Y + 0.01 - box.min.y;
    onReady({ pristine, crashed: model, paintMeshes, door: model.getObjectByName('Door_R') });
  }).catch((error) => {
    console.error('Failed to load the crash vehicle and replacement glazing', error);
  }).finally(() => draco.dispose());

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
    Damage_Laminated_Glass: phys({ color: 0x344e56, roughness: 0.16, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.14, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    Damage_Fracture_Edges: std({ color: 0x8babb4, roughness: 0.3, metalness: 0.15, side: THREE.DoubleSide }),
    Glass_Headlight: phys({ color: 0x050607, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.15, depthWrite: false }),
    LED_WhiteHeadlight: std({ color: 0x050607, emissive: 0x000000, emissiveIntensity: 0 }),
    LED_OrangeSignle: hazardMat,
  };
}

// 未替换的导入材质（皮革、轮胎、织物等）：去掉错误的满金属度、避免镜面
function fixImportedMaterial(m) {
  m.metalness = Math.min(m.metalness, 0.1);
  m.roughness = Math.max(m.roughness, 0.5);
}

// 车头挤压变形：车头缩短、左前角撞得更深、表面起伏（模型本地坐标，车头 +Z，左侧 +X）
// Transform authored normals by the deformation Jacobian, preserving hard edges and UV seams.
function crumpleFront(geo) {
  const p = geo.attributes.position;
  const normals = geo.attributes.normal;
  const normalMatrix = new THREE.Matrix3();
  const normal = new THREE.Vector3();
  const Z0 = 0.9, Z1 = 2.1;
  let hit = false;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z <= Z0) continue;
    hit = true;
    const t = Math.min(1, (z - Z0) / (Z1 - Z0)) * CRUMPLE;
    const left = Math.max(0, x);
    const dt = z < Z1 ? CRUMPLE / (Z1 - Z0) : 0;
    const side = x > 0 ? 1 : 0;
    const dzdx = -side * 0.28 * t;
    const dzdz = 1 - 0.3 * t - (0.3 * (z - Z0) + left * 0.28) * dt;
    z = Z0 + (z - Z0) * (1 - 0.3 * t) - left * 0.28 * t;
    const wave = Math.sin(x * 6) * 0.04 + Math.sin(z * 13 + x * 7) * 0.015 - left * 0.08;
    if (normals) {
      const c = Math.cos(z * 13 + x * 7) * 0.015;
      const dydx = (Math.cos(x * 6) * 0.24 + c * (13 * dzdx + 7) - side * 0.08) * t;
      const dydz = c * 13 * dzdz * t + wave * dt;
      normalMatrix.set(1 + 0.05 * t, 0, x * 0.05 * dt, dydx, 1, dydz, dzdx, 0, dzdz).invert().transpose();
      normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    y += wave * t;
    x *= 1 + 0.05 * t;
    p.setXYZ(i, x, y, z);
  }
  if (hit) {
    p.needsUpdate = true;
    if (normals) normals.needsUpdate = true;
    else geo.computeVertexNormals();
    // Reconstruct tangent space from the deformed surface instead of stale imported tangents.
    geo.deleteAttribute('tangent');
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

// Angular fracture fragments, not randomly rotated rectangular bricks.
function fragmentGeometry(r, width, height, depth) {
  const points = [];
  const count = 5 + Math.floor(r() * 3);
  const offset = r() * Math.PI * 2;
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < count; i++) {
      const angle = offset + (i + (r() - 0.5) * 0.45) * Math.PI * 2 / count;
      const radius = 0.32 + r() * 0.22;
      points.push(new THREE.Vector3(
        Math.cos(angle) * width * radius + layer * width * 0.12,
        layer ? height * (0.45 + r() * 0.55) : 0,
        Math.sin(angle) * depth * radius,
      ));
    }
  }
  return new ConvexGeometry(points);
}

function settleFragment(mesh, x, z, r) {
  mesh.rotation.set((r() - 0.5) * 0.8, r() * Math.PI * 2, (r() - 0.5) * 0.8);
  // Measure after rotation so every piece actually touches the asphalt.
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh, true);
  mesh.position.set(x, DECK_Y + 0.012 - box.min.y, z);
}

// Connected bent rails, torn curb ends and a graded field of rubble.
function buildBrokenRail(scene) {
  const x = HALF_W - 0.2;
  const group = new THREE.Group();
  group.name = 'Crash_Rail_Damage';
  const metal = markKeep(metalBase.clone());
  metal.roughness = 0.58;
  const concrete = markKeep(concreteBase.clone());
  const fracture = markKeep(new THREE.MeshStandardNodeMaterial({ roughness: 0.94 }));
  const grain = mx_noise_float(positionWorld.mul(65));
  fracture.colorNode = vec3(0.16, 0.165, 0.16).mul(grain.mul(0.65).add(0.85));
  const rebar = markKeep(new THREE.MeshStandardMaterial({ color: 0x493a2c, roughness: 0.83, metalness: 0.45 }));
  const r = rng(9);

  const railSection = new THREE.Shape();
  railSection.moveTo(-0.04, -0.05);
  railSection.lineTo(0.04, -0.05);
  railSection.lineTo(0.04, 0.05);
  railSection.lineTo(-0.04, 0.05);
  railSection.closePath();
  for (const [edge, direction] of [[BREAK.z0, 1], [BREAK.z1, -1]]) {
    const anchor = edge - direction * 0.7;
    // The intact rear profile joins the curb exactly; the front is a torn surface.
    const outline = [[-0.2, 0], [0, 0], [0.2, 0], [0.2, 0.25], [0.2, 0.5], [0, 0.5], [-0.2, 0.5], [-0.2, 0.25]];
    const points = [];
    const ends = [0.74, 0.88, 0.67, 0.51, 0.2, 0.39, 0.28, 0.6].map((depth) => depth + (r() - 0.5) * 0.14);
    for (let ring = 0; ring < 2; ring++) {
      outline.forEach(([dx, y], i) => points.push(new THREE.Vector3(x + dx, DECK_Y + y, anchor + direction * (ring ? ends[i] : 0))));
    }
    points.push(new THREE.Vector3(x + 0.025, DECK_Y + 0.23, anchor + direction * 0.38));
    const vertices = [];
    const materialIndices = [];
    const triangle = (a, b, c, material) => {
      const indices = direction === -1 ? [a, b, c] : [a, c, b];
      for (const index of indices) vertices.push(...points[index].toArray());
      materialIndices.push(material);
    };
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      triangle(i, i + 8, j + 8, 0);
      triangle(i, j + 8, j, 0);
      triangle(i + 8, 16, j + 8, 1);
    }
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    curbGeo.setIndex(Array.from({ length: vertices.length / 3 }, (_, i) => i));
    materialIndices.forEach((material, i) => curbGeo.addGroup(i * 3, 3, material));
    curbGeo.computeVertexNormals();
    group.add(new THREE.Mesh(curbGeo, [concrete, fracture]));

    for (const height of [0.85, 1.15]) {
      const upper = height > 1;
      const reach = direction === 1 ? 1.15 : 0.85;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, DECK_Y + height, edge - direction * 1.2),
        new THREE.Vector3(x, DECK_Y + height, edge - direction * 0.95),
        new THREE.Vector3(x + 0.12, DECK_Y + height - 0.06, edge - direction * 0.4),
        new THREE.Vector3(x + 0.55 * reach, DECK_Y + height - 0.24, edge + direction * 0.2),
        new THREE.Vector3(x + (upper ? 1.0 : 0.72) * reach, DECK_Y + height - (upper ? 1.35 : 0.85) * reach, edge + direction * (upper ? 1.2 : 0.85) * reach),
      ]);
      group.add(new THREE.Mesh(new THREE.ExtrudeGeometry(railSection, { steps: 20, bevelEnabled: false, extrudePath: curve }), metal));
    }

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), metal);
    post.position.set(x + 0.18, DECK_Y + 0.79, edge - direction * 0.45);
    post.rotation.set(direction * 0.18, 0, -0.46);
    group.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.035, 0.25), metal);
    foot.position.set(x + 0.025, DECK_Y + 0.52, edge - direction * 0.51);
    foot.rotation.z = -0.22;
    group.add(foot);

    for (let i = 0; i < 3; i++) {
      const dx = (i - 1) * 0.12;
      const y = DECK_Y + 0.13 + i * 0.065;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x + dx, y, anchor + direction * 0.24),
        new THREE.Vector3(x + dx, y, edge + direction * 0.1),
        new THREE.Vector3(x + dx + 0.09, y - 0.035, edge + direction * (0.4 + r() * 0.25)),
      ]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.012, 5, false), rebar));
    }
  }

  for (let i = 0; i < 125; i++) {
    const large = i < 10;
    const size = large ? 0.18 + r() * 0.36 : i < 40 ? 0.065 + r() * 0.15 : 0.015 + r() * 0.055;
    const edge = i % 2 ? BREAK.z0 : BREAK.z1;
    const direction = i % 2 ? 1 : -1;
    const spread = large ? 0.9 : 2.1;
    const px = x - 0.12 - Math.pow(r(), 1.8) * spread;
    const pz = edge + direction * r() * (large ? 1.25 : 2.5) + (r() - 0.5) * 0.7;
    const chunk = new THREE.Mesh(fragmentGeometry(r, size, size * (0.35 + r() * 0.5), size * (0.7 + r() * 0.7)), fracture);
    settleFragment(chunk, px, pz, r);
    group.add(chunk);
  }
  const sourceGeometries = new Set();
  group.traverse((o) => { if (o.isMesh) sourceGeometries.add(o.geometry); });
  mergeStatic(group);
  sourceGeometries.forEach((geometry) => geometry.dispose());
  scene.add(group);
}

// 车身碎片与玻璃渣
function buildDebris(scene, r) {
  const paint = carPaint;
  const dark = markKeep(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  const glass = markKeep(new THREE.MeshPhysicalMaterial({ color: 0x8ca5a7, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();

  const glassGeo = fragmentGeometry(r, 0.065, 0.008, 0.05);
  const shards = new THREE.InstancedMesh(glassGeo, glass, 260);
  for (let i = 0; i < shards.count; i++) {
    const radius = Math.pow(r(), 1.6) * 3.3;
    const angle = r() * Math.PI * 2;
    v.set(4.8 + Math.cos(angle) * radius * 0.52, DECK_Y + 0.012, -0.8 + Math.sin(angle) * radius);
    q.setFromEuler(e.set(0, r() * 6, 0));
    s.set(0.4 + r() * 1.3, 0.6 + r() * 0.5, 0.4 + r() * 1.6);
    shards.setMatrixAt(i, m.compose(v, q, s));
  }
  scene.add(shards);

  for (let i = 0; i < 18; i++) {
    const piece = new THREE.Mesh(
      fragmentGeometry(r, 0.12 + r() * 0.48, 0.015 + r() * 0.045, 0.1 + r() * 0.35),
      r() < 0.6 ? paint : dark
    );
    const travel = r();
    settleFragment(piece, 3.0 + travel * 3.1 + (r() - 0.5) * 0.7, -4.5 + travel * 6 + (r() - 0.5) * 2.5, r);
    scene.add(piece);
  }
}

// 刹车痕：从后方一路拐向护栏
function buildSkidMarks(scene) {
  const forward = new THREE.Vector3(Math.cos(CAR_YAW), 0, -Math.sin(CAR_YAW));
  const end = CAR_POS.clone().addScaledVector(forward, -1.25);
  end.y = 0;
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-1.5, 0, -30),
    new THREE.Vector3(-1.5, 0, -16),
    end.clone().addScaledVector(forward, -5),
    end,
  );
  return addTireTracks(scene, curve, { offsets: [-0.8, 0.8], width: 0.245, seed: 404, slide: 0.45, opacity: 0.78 });
}
