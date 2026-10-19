import * as THREE from 'three/webgpu';
import { gltfLoader } from './gltf.js';
import { DECK_Y } from './bridge.js';
import { addLightGroup } from './debugLights.js';

// 玩家开来的警车：停在事故车同侧（护栏一侧）后方，车头朝事故现场。
// 左舵，驾驶门在车身 +X 侧，朝向护栏与车之间约 2.4m 的空地，开场玩家从这里下车。
// 模型：NCPD Villefort Police Cruiser by valvetin (CC-BY-4.0)，见 public/assets/police_cruiser_LICENSE.txt
// 已预处理（删引擎舱、拆出玻璃/灯罩/警灯材质、驾驶门拆成独立节点 Door_FL 且原点在铰链、
// 四个轮子 Wheel_FL/FR/RL/RR 原点在轮轴、绕本地 X 转，Draco + WebP）
// 模型本地坐标：地面 y≈-0.05，车头朝 +Z，车身左侧在 +X，原始长 6.4m
const URL = `${import.meta.env.BASE_URL}assets/police_cruiser.glb`;
export const POLICE_SCALE = 0.92;
export const POLICE_POS = new THREE.Vector3(3.2, DECK_Y, -15);
export const POLICE_YAW = 0.05; // 车头 +Z 略偏向护栏，对着事故车
const DOOR_OPEN = -1.12;        // 驾驶门全开角度（绕铰链竖轴，负值向 +X 外摆，约 64°）
const WHEEL_RADIUS = 0.4345;    // 模型空间半径（直径 0.869），世界距离还要乘 POLICE_SCALE

// 玩家碰撞盒（车辆组本地坐标，与 player.js 的旋转盒约定一致）
export const policeCollider = {
  x: POLICE_POS.x, z: POLICE_POS.z, yaw: POLICE_YAW,
  minX: -1.0, maxX: 1.0, minZ: -3.08 * POLICE_SCALE, maxZ: 3.32 * POLICE_SCALE,
};

export function buildPoliceCar(scene) {
  const group = new THREE.Group();
  group.name = 'PoliceCruiser';
  group.position.copy(POLICE_POS);
  group.rotation.y = POLICE_YAW;
  scene.add(group);
  group.updateMatrixWorld(true);

  const red = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1030, emissiveIntensity: 0, roughness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000820, emissive: 0x2050ff, emissiveIntensity: 0, roughness: 0.3 });

  let door = null;
  let doorAmount = 0;
  const wheels = [];
  let roll = 0;
  function applyRoll() {
    const angle = roll / (WHEEL_RADIUS * POLICE_SCALE);
    for (const wheel of wheels) wheel.rotation.x = angle;
  }
  gltfLoader().loadAsync(URL).then((gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(POLICE_SCALE);
    model.position.y = 0.05 * POLICE_SCALE;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = fixMaterial(o.material, { red, blue });
    });
    door = model.getObjectByName('Door_FL');
    door.rotation.y = DOOR_OPEN * doorAmount;
    for (const name of ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']) {
      const wheel = model.getObjectByName(name);
      if (wheel) wheels.push(wheel);
    }
    applyRoll();
    group.add(model);
  }).catch((error) => {
    console.error('Failed to load the police cruiser', error);
  });

  // 驾驶门开合：0 关闭，1 全开
  function setDoor(amount) {
    doorAmount = amount;
    if (door) door.rotation.y = DOOR_OPEN * amount;
  }

  // 开场行驶距离（世界米，向前为正）。模型还没到时先记下，载入后补上。
  function setRoll(distance) {
    roll = distance;
    applyRoll();
  }

  // 车顶警灯：红蓝交替双闪，配一盏随颜色切换的点光
  const light = new THREE.PointLight(0xff1030, 0, 12, 2);
  light.position.set(0, 2.1, -0.2);
  group.add(light);
  const RED = new THREE.Color(0xff1030), BLUE = new THREE.Color(0x2050ff);
  let on = true;
  addLightGroup('警车警灯', (v) => { on = v; });

  function update(dt, t) {
    if (!on) { red.emissiveIntensity = blue.emissiveIntensity = light.intensity = 0; return; }
    // 0.8s 一个周期：红闪两下 → 蓝闪两下
    const p = (t % 0.8) / 0.8;
    const isRed = p < 0.5;
    const q = (p % 0.5) / 0.5;
    const flash = q < 0.18 || (q > 0.32 && q < 0.5) ? 1 : 0;
    red.emissiveIntensity = isRed ? 12 * flash + 0.4 : 0.4;
    blue.emissiveIntensity = isRed ? 0.4 : 12 * flash + 0.4;
    light.color.copy(isRed ? RED : BLUE);
    light.intensity = flash * (isRed ? 5 : 7);
  }

  // 开关门声源位置（世界坐标）：驾驶门中部
  const DOOR_POINT = new THREE.Vector3(0.95, 0.9, -0.25);
  const doorWorld = (out) => { group.updateMatrixWorld(); return group.localToWorld(out.copy(DOOR_POINT)); };
  return { group, update, setDoor, setRoll, doorWorld };
}

// Sketchfab 导出的材质全是 BLEND + 双面 + 纯黑自发光贴图，逐个改成合适的渲染方式
function fixMaterial(m, { red, blue }) {
  switch (m.name) {
    case 'LightRed': return red;
    case 'LightBlue': return blue;
    case 'Glass':
      // 开场在车内往外看，透明度不能像事故车那么深；双面，车内也能看到玻璃反光
      return new THREE.MeshPhysicalMaterial({ color: 0x0a1014, roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    case 'LightCover':
      m.transparent = true;
      m.depthWrite = false;
      break;
    case 'Hologram':
      // 车身全息警徽：自发光，叠加混合
      m.transparent = true;
      m.depthWrite = false;
      m.emissiveMap = m.map;
      m.emissive.set(0xffffff);
      m.emissiveIntensity = 0.7;
      break;
    case 'Decals':
      m.transparent = false;
      m.alphaTest = 0.5;
      m.emissiveMap = null;
      m.emissive.set(0x000000);
      break;
    default:
      // 车身与内饰：不透明，避免整车参与透明排序
      m.transparent = false;
      m.depthWrite = true;
      m.emissiveMap = null;
      m.emissive.set(0x000000);
  }
  m.needsUpdate = true;
  return m;
}
