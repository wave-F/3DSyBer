import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 第 3 轮插卡 / 拔卡：骨骼右手 + 取证卡 + 插卡镜头
// 在 Blender 里制作（后台跑，工程 art/card_arm_anim.blend）：
//   tools/blender/build_card_arm_anim.py 搭镜头、卡、握法和动画，export_card_arm.py 导出 card-insert.glb
// GLB 和 supercar_door.glb 是同一套坐标，挂在车模根节点下；放在主场景，会被车厢正常遮挡
// 一条时间轴两段（秒，与 build_card_arm_anim.py 一致）：
//   插卡 0 → CARD_HIT 卡插到底 → CARD_INSERT_END 手收出画面，卡留在槽里
//   拔卡 CARD_PULL0 → CARD_PULL_END 手伸回来捏住、拔出、放下出画面
export const CARD_HIT = 0.45 + 0.15 + 0.35;
export const CARD_INSERT_END = CARD_HIT + 0.15 + 0.35;
export const CARD_PULL0 = 1.5;
export const CARD_PULL_END = CARD_PULL0 + 0.4 + 0.15 + 0.3 + 0.4;
const FRAME0 = 1 / 30;   // Blender 第 1 帧在动画里的时间

export function createCardArm(carRoot) {
  const group = new THREE.Group();
  group.visible = false;
  carRoot.add(group);
  let mixer = null, camNode = null, ready = false;
  new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/card-insert.glb`, (gltf) => {
    group.add(gltf.scene);
    camNode = gltf.scene.getObjectByName('CardCamRest');
    gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    mixer = new THREE.AnimationMixer(gltf.scene);
    // 手、手指骨骼、卡各一条动画，时间轴相同
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    mixer.setTime(FRAME0);
    ready = true;
  }, undefined, (error) => console.error('Failed to load card arm:', error));

  return {
    get ready() { return ready; },
    // 插卡镜头的世界位姿（Blender 里摆好的 CardCam，和 state.js 原来算的终点机位一致）
    camPose(pos, quat) {
      camNode.updateWorldMatrix(true, false);
      camNode.getWorldPosition(pos);
      camNode.getWorldQuaternion(quat);
    },
    // time：时间轴上的秒数（0 开始插卡，CARD_PULL0 开始拔卡）
    set(time) {
      if (!ready) return;
      group.visible = true;
      mixer.setTime(FRAME0 + Math.max(0, time));
    },
    hide() { group.visible = false; },
  };
}
