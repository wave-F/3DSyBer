import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { DECK_Y } from './bridge.js';
import { addLightGroup } from './debugLights.js';

// 玩家开来的警车：停在出生点右后方，车头斜向事故现场。
// 模型：NCPD Villefort Police Cruiser by valvetin (CC-BY-4.0)，见 public/assets/police_cruiser_LICENSE.txt
// 已预处理（删引擎舱、按部件拆出玻璃/灯罩/警灯材质、Draco + WebP，约 1MB）
// 模型本地坐标：地面 y≈-0.05，车头朝 +Z，车身左侧在 +X，原始长 6.4m
const URL = '/assets/police_cruiser.glb';
const SCALE = 0.92;
export const POLICE_POS = new THREE.Vector3(3.9, DECK_Y, -14.5);
export const POLICE_YAW = -0.3; // 车头 +Z 略偏向桥面中线

// 玩家碰撞盒（车辆组本地坐标，与 player.js 的旋转盒约定一致）
export const policeCollider = {
  x: POLICE_POS.x, z: POLICE_POS.z, yaw: POLICE_YAW,
  minX: -1.0, maxX: 1.0, minZ: -3.08 * SCALE, maxZ: 3.32 * SCALE,
};

export function buildPoliceCar(scene) {
  const group = new THREE.Group();
  group.name = 'PoliceCruiser';
  group.position.copy(POLICE_POS);
  group.rotation.y = POLICE_YAW;
  scene.add(group);

  const red = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1030, emissiveIntensity: 0, roughness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000820, emissive: 0x2050ff, emissiveIntensity: 0, roughness: 0.3 });

  const draco = new DRACOLoader().setDecoderPath('/draco/');
  new GLTFLoader().setDRACOLoader(draco).loadAsync(URL).then((gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(SCALE);
    model.position.y = 0.05 * SCALE;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = fixMaterial(o.material, { red, blue });
    });
    group.add(model);
  }).catch((error) => {
    console.error('Failed to load the police cruiser', error);
  }).finally(() => draco.dispose());

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
  return { group, update };
}

// Sketchfab 导出的材质全是 BLEND + 双面 + 纯黑自发光贴图，逐个改成合适的渲染方式
function fixMaterial(m, { red, blue }) {
  switch (m.name) {
    case 'LightRed': return red;
    case 'LightBlue': return blue;
    case 'Glass':
      return new THREE.MeshPhysicalMaterial({ color: 0x05080c, roughness: 0.05, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.78 });
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
