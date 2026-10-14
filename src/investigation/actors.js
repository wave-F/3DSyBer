import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { hologramMaterial } from './hologram.js';

// 全息人偶：Quaternius Universal Animation Library（CC0）的人偶 + 动作
// 动作不随时间自动播放，而是按重建时间轴"采样"：拖动、倒放、暂停都能得到确定的姿势

const URL = '/assets/mannequin.glb';
const BLEND = 0.25; // 相邻动作之间的混合过渡秒数

let loading = null;
function loadMannequin() {
  if (!loading) loading = new Promise((res, rej) => new GLTFLoader().load(URL, res, undefined, rej));
  return loading;
}

// segments: [{ t0, t1, clip, mode: 'loop' | 'once', rate = 1, offset = 0 }]
// t 落在某段时，该段动作的本地时间 = offset + (t - t0) * rate；
// 进入新段的前 BLEND 秒，与上一段按权重混合
export async function createActor(hex, segments) {
  const gltf = await loadMannequin();
  const root = SkeletonUtils.clone(gltf.scene);
  const mat = hologramMaterial(hex, 1.0);
  root.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.frustumCulled = false; }
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[clip.name] = a;
  }

  const localTime = (seg, t) => {
    const a = actions[seg.clip];
    const d = a.getClip().duration;
    const lt = (seg.offset ?? 0) + (t - seg.t0) * (seg.rate ?? 1);
    return seg.mode === 'loop' ? ((lt % d) + d) % d : THREE.MathUtils.clamp(lt, 0, d - 1e-3);
  };

  function pose(t) {
    for (const a of Object.values(actions)) a.setEffectiveWeight(0);
    let i = segments.findIndex((s) => t >= s.t0 && t < s.t1);
    if (i < 0) i = t < segments[0].t0 ? 0 : segments.length - 1;
    const cur = segments[i];
    const into = t - cur.t0;
    const w = i > 0 && into < BLEND ? into / BLEND : 1;
    const layers = [[cur, w]];
    if (w < 1) layers.push([segments[i - 1], 1 - w]);
    for (const [seg, wt] of layers) {
      const a = actions[seg.clip];
      a.time = localTime(seg, t);
      a.setEffectiveWeight(a.getEffectiveWeight() + wt);
    }
    mixer.update(0);
  }

  // 单独摆一个动作的某一帧（用于测量姿势，校准落点和朝向）
  function poseClip(name, time) {
    for (const a of Object.values(actions)) a.setEffectiveWeight(0);
    actions[name].time = Math.min(time, actions[name].getClip().duration - 1e-3);
    actions[name].setEffectiveWeight(1);
    mixer.update(0);
  }
  // 在根节点为单位变换时，测量骨骼的本地位置
  function measure(name, time, boneName) {
    const saved = [root.position.clone(), root.quaternion.clone()];
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    poseClip(name, time);
    root.updateMatrixWorld(true);
    const v = root.getObjectByName(boneName).getWorldPosition(new THREE.Vector3());
    root.position.copy(saved[0]);
    root.quaternion.copy(saved[1]);
    return v;
  }
  const duration = (name) => actions[name].getClip().duration;

  // 程序化叠加：在 pose() 之后，把骨骼的 +Y 轴（骨骼方向）转向 dir（根节点本地坐标：+Z 正面，+Y 上，+X 人偶左侧）
  // w 为混合权重（0 = 保持动作姿势，1 = 完全对准）。父骨骼要先于子骨骼调用
  const bones = {};
  const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qR = new THREE.Quaternion(), qD = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(), dW = new THREE.Vector3();
  function aim(boneName, dir, w) {
    if (w <= 0) return;
    const bone = bones[boneName] ??= root.getObjectByName(boneName);
    root.getWorldQuaternion(qR);
    dW.copy(dir).normalize().applyQuaternion(qR);
    bone.getWorldQuaternion(qW);
    yAxis.set(0, 1, 0).applyQuaternion(qW);
    qD.setFromUnitVectors(yAxis, dW);
    if (w < 1) qD.slerp(qP.identity(), 1 - w);
    qW.premultiply(qD);
    bone.parent.getWorldQuaternion(qP);
    bone.quaternion.copy(qP.invert().multiply(qW));
    bone.updateMatrixWorld(true);
  }

  return { root, pose, measure, duration, aim };
}
