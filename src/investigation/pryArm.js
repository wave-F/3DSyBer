import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 第 3 轮撬门：手握撬棍 + 撬门镜头
// 在 Blender 里制作：tools/blender/build_pry_anim.py 搭镜头和动画，export_pry_anim.py 导出 pry-arm.glb
// GLB 和 supercar_door.glb 是同一套坐标，直接挂在车模根节点下就能对齐门缝；放在主场景，会被车门正常遮挡
// 动画时间轴：0 开始举起撬棍 → PRY_INSERT 秒插稳 → 之后和 PRY_KEYS 的撬门时间 t 一一对应（动画时间 = PRY_INSERT + t）
export const PRY_INSERT = 0.35 + 0.18 + 0.2;   // 与 build_pry_anim.py 的 T0 一致
export const PRY_HIT = 0.35 + 0.18;            // 撬棍尖顶进门缝的时刻
const HIDE_T = PRY_INSERT + 2.1;               // 卡扣崩开后手收到画面外
const FRAME0 = 1 / 30;                         // Blender 第 1 帧在动画里的时间

export function createPryArm(carRoot) {
  const group = new THREE.Group();
  group.visible = false;
  carRoot.add(group);
  let mixer = null, camNode = null, ready = false;
  new GLTFLoader().load('/assets/pry-arm.glb', (gltf) => {
    group.add(gltf.scene);
    camNode = gltf.scene.getObjectByName('PryCamRest');
    gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(FRAME0);
    ready = true;
  }, undefined, (error) => console.error('Failed to load pry arm:', error));

  return {
    get ready() { return ready; },
    // 撬门镜头的世界位姿（Blender 里摆好的 PryCam）
    camPose(pos, quat) {
      camNode.updateWorldMatrix(true, false);
      camNode.getWorldPosition(pos);
      camNode.getWorldQuaternion(quat);
    },
    // time：从举起撬棍开始计的秒数
    set(time) {
      if (!ready) return;
      group.visible = time < HIDE_T;
      mixer.setTime(FRAME0 + Math.max(0, time));
    },
    hide() { group.visible = false; },
  };
}
