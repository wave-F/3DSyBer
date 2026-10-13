import * as THREE from 'three/webgpu';
import { markKeep } from './mask.js';

// 第 3 轮：事故车右后翼子板上的检修卡槽（车门变形卡死，只能从车外读取执行器缓存）
// 车辆组本地坐标：车头 +X，车身右侧 +Z。卡槽位置用射线贴到车身表面，朝向固定为车身右侧
const SLOT_LOCAL = new THREE.Vector2(-1.0, 0.62);   // 车门后方、后轮拱前上方（x, y）

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
  // 卡槽面板：竖向，面朝本地 +Z
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.008), plateMat);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.112, 0.002), slitMat);
  slit.position.z = 0.0045;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.09, 0.002), ledMat);
  led.position.set(0.016, 0, 0.0045);
  group.add(plate, slit, led);
  group.visible = false;

  crash.onCarReady(() => {
    const car = crash.carGroup;
    car.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const origin = car.localToWorld(new THREE.Vector3(SLOT_LOCAL.x, SLOT_LOCAL.y, 3));
    const target = car.localToWorld(new THREE.Vector3(SLOT_LOCAL.x, SLOT_LOCAL.y, 0));
    ray.set(origin, target.sub(origin).normalize());
    const hit = ray.intersectObject(car, true).find((h) => h.object.visible);
    normal.set(0, 0, 1).transformDirection(car.matrixWorld).setY(0).normalize();
    world.copy(hit ? hit.point : car.localToWorld(new THREE.Vector3(SLOT_LOCAL.x, SLOT_LOCAL.y, 1.0)));
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
