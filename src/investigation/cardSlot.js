import * as THREE from 'three/webgpu';
import { markKeep } from './mask.js';

// 第 3 轮：驾驶舱内、转向柱下方的检修接口（撬开右门后，从副驾一侧探身插卡）
// 第 4 轮：程叙的根钥，卡在驾驶座和中控通道之间
// 车辆组本地坐标：车头 +X，车身右侧（副驾）+Z，驾驶位在 -Z 一侧
// 座椅和转向柱由 tools/blender/build_door_car.py 补进车身，位置见脚本打印的 CABIN_SLOT_BLENDER
const SLOT_LOCAL = new THREE.Vector3(0.649, 0.541, -0.206);   // 转向柱下方、朝副驾一侧的面
const KEY_LOCAL = new THREE.Vector2(0.02, -0.075);             // 中控通道靠驾驶座一侧（x, z），高度用射线贴到表面

export function buildCardSlot(crash) {
  const group = new THREE.Group();
  const world = new THREE.Vector3();     // 卡槽口中心（世界坐标）
  const normal = new THREE.Vector3();    // 卡槽朝外方向（世界坐标）
  let ready = false;
  let state = 'idle';                    // idle | reading | done
  let t = 0;

  const plateMat = markKeep(new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.45, metalness: 0.7 }));
  const slitMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const ledMat = markKeep(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x30c8ff, emissiveIntensity: 0.6 }));
  // 卡槽面板：竖向（取证卡竖着插），面朝本地 +Z
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.008), plateMat);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.09, 0.002), slitMat);
  slit.position.z = 0.0045;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.075, 0.002), ledMat);
  led.position.set(0.013, 0, 0.0045);
  group.add(plate, slit, led);
  group.visible = false;

  crash.onCarReady(({ crashed }) => {
    const car = crash.carGroup;
    car.updateMatrixWorld(true);
    // 从副驾一侧水平射向转向柱，贴到表面上
    const ray = new THREE.Raycaster();
    const origin = car.localToWorld(SLOT_LOCAL.clone().setZ(0.35));
    const target = car.localToWorld(SLOT_LOCAL.clone());
    ray.set(origin, target.clone().sub(origin).normalize());
    ray.far = 0.8;
    const hit = ray.intersectObject(crashed, true).find((h) => h.object.visible);
    normal.set(0, 0, 1).transformDirection(car.matrixWorld).normalize();
    world.copy(hit ? hit.point : target);
    world.addScaledVector(normal, 0.004);
    group.position.copy(world);
    group.lookAt(world.clone().add(normal));
    car.attach(group);
    group.visible = true;
    ready = true;
  });

  return {
    group,
    get ready() { return ready; },
    world, normal,
    setState(s) { state = s; t = 0; },
    update(dt) {
      t += dt;
      // 待机：青色微光呼吸；读取中：快速闪烁；完成：常亮绿色
      if (state === 'idle') { ledMat.emissive.setHex(0x30c8ff); ledMat.emissiveIntensity = 0.5 + Math.sin(t * 2.2) * 0.35; }
      else if (state === 'reading') { ledMat.emissive.setHex(0x40ff90); ledMat.emissiveIntensity = Math.sin(t * 28) > 0 ? 3 : 0.3; }
      else { ledMat.emissive.setHex(0x40ff90); ledMat.emissiveIntensity = 1.6; }
    },
  };
}

// 程叙的根钥：一张带工程标识的硬质凭证卡。第 4 轮之前不显示
export function buildRootKey(crash) {
  const group = new THREE.Group();
  const world = new THREE.Vector3();
  let ready = false;
  let t = 0;
  const bodyMat = markKeep(new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.35, metalness: 0.8 }));
  const stripeMat = markKeep(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc040, emissiveIntensity: 1 }));
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.004, 0.054), bodyMat);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.001, 0.006), stripeMat);
  stripe.position.set(0, 0.0025, -0.016);
  group.add(card, stripe);
  group.visible = false;

  crash.onCarReady(({ crashed }) => {
    const car = crash.carGroup;
    car.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const origin = car.localToWorld(new THREE.Vector3(KEY_LOCAL.x, 0.9, KEY_LOCAL.y));
    ray.set(origin, new THREE.Vector3(0, -1, 0).transformDirection(car.matrixWorld));
    ray.far = 0.8;
    const hit = ray.intersectObject(crashed, true).find((h) => h.object.visible);
    world.copy(hit ? hit.point : car.localToWorld(new THREE.Vector3(KEY_LOCAL.x, 0.5, KEY_LOCAL.y)));
    world.y += 0.004;
    group.position.copy(world);
    car.attach(group);
    // 斜卡在缝里：一头翘起
    group.rotation.set(0.25, 0.5, -0.35);
    ready = true;
  });

  return {
    group, world,
    get ready() { return ready; },
    setVisible(on) { group.visible = on && ready; },
    update(dt) {
      t += dt;
      stripeMat.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.5;
    },
  };
}
