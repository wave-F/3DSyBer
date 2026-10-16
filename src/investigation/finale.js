import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { gltfLoader } from '../gltf.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadMannequin } from './actors.js';
import { DECK_Y } from '../bridge.js';
import { CAR_POS } from '../crash.js';
import { DEATH_REPORT } from './clues.js';
import { sound } from '../audio/sound.js';
import { createImpactVoice } from '../audio/impactVoice.js';
import { PEAK } from '../audio/events.js';

// 结局：陈墨被跑车撞飞（第一人称，全程是动画，玩家不能操作）
// 站在车道上看着事故车 → 背后车灯逼近，强制转头 → 白光、撞击、翻滚落地
// → 贴地看向前方，终端摔在不远处，视线越来越糊 → 在模糊中切到镜头 A：高处全景（桥面、事故车、警车、倒地的尸体），由糊转清
// → 终端在全景里亮起 → 硬切镜头 B：终端近景，推到屏幕正上方 → 自动写报告并归档 → 黑屏（不再切回第一人称）
// 所有画面都只由时间 t 决定（可以 seek 到任意一秒检查）

// 受伤后期：main.js 读取这些 uniform
export const HURT = {
  white: uniform(0),     // 白闪（车灯致盲 + 撞击）
  blur: uniform(0),      // 世界画面模糊（终端单独渲染，不受影响）
  desat: uniform(0),     // 去饱和
  vignette: uniform(0),  // 暗角收紧
  lid: uniform(0),       // 眼皮：0 睁开，1 闭上
  ca: uniform(0.05),     // 色差（平时 0.05）
};

const EYE = 1.7;
const LIE_H = 0.13;                                   // 倒地后眼睛离地高度
const START = new THREE.Vector3(-1.6, DECK_Y + EYE, -8); // 站在警车左侧的空车道上，背对来车方向（-Z）
const SPEED = 38;                                     // 车速 m/s（约 137 km/h）
const GRAV = 9.8;
const V0 = new THREE.Vector3(0.6, 4.2, 10);           // 撞飞初速度：沿车行方向（+Z）向后抛起
const FLIP = 0.06;                                    // 落地后视线略微朝下
const ROLL = 0.38;                                    // 倒地后画面侧倾
const AIR = (V0.y + Math.sqrt(V0.y * V0.y + 2 * GRAV * (EYE - LIE_H))) / GRAV; // 空中时间
const SLIDE = new THREE.Vector3(0.15, 0, 1.3);        // 落地后弹起滑行的距离
const CPS = 13;                                       // 报告打字速度（字/秒）
const CHARS = DEATH_REPORT.lines.join('').length;

// 时间轴（秒）
const T = {};
T.fade = 0.6;                    // 黑场淡入（期间预热跑车着色器）
T.turn0 = 1.0; T.turn1 = 1.55;   // 强制转头看向来车
T.hit = 2.3;                     // 撞击
T.land = T.hit + AIR;            // 落地
T.rest = T.land + 0.55;          // 弹起滑行结束，躺定
T.cut = 6.4;                     // 镜头 A：在模糊中切到全景（第三人称）
T.boot = T.cut + 1.6;            // 全景里终端亮屏：地上一小块亮光，引导视线
T.cut2 = T.cut + 3.6;            // 镜头 B：硬切到终端中景（地上的终端 + 周围路面）
T.push = T.cut2 + 4.5;           // 慢慢推近，直到终端占满画面
T.type0 = T.cut2 + 3.6;          // 快推到位时开始自动写报告
T.type1 = T.type0 + CHARS / CPS;
T.verdict = T.type1 + 0.5;
T.confirm = T.verdict + 0.8;     // 「按住 E 确认归档」出现并自动按满
T.archived = T.confirm + 1.8;
T.black = T.archived + 2.2;      // 归档完成后停一会儿，淡出黑场
T.end = T.black + 1.0;
const HIT_SOUND_AT = T.hit - PEAK.hitBody;
const HIT_POS = { x: START.x, y: DECK_Y + 0.9, z: START.z - 0.6 };

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp01(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const range = (t, a, b) => clamp01((t - a) / (b - a));

export function createFinale({ scene, camera, tablet, ui }) {
  // ---------- 跑车 ----------
  const car = new THREE.Group();
  car.name = 'FinaleCar';
  car.visible = false;
  scene.add(car);
  const wheels = [];
  const glares = [];
  let front = 2.2, ready = false;

  // 车灯照路的光：一直在场景里（亮度 0），避免出场时光源数量变化导致全部材质重编译
  const beam = new THREE.PointLight(0xeef4ff, 0, 32, 2);
  scene.add(beam);

  // 和事故车共用 supercar_door.glb（同一个 URL，浏览器只下载一次）；导出时车门带撞后外翻，这里关上
  gltfLoader().loadAsync(`${import.meta.env.BASE_URL}assets/supercar_door.glb`).then((gltf) => {
    const model = gltf.scene;   // 车头 +Z，地面 y=0
    const door = model.getObjectByName('Door_R');
    if (door) door.rotation.set(0, 0, 0);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x0b0d12, roughness: 0.22, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(9) });
    model.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name.replace(/^GC_/, '');
      if (key === 'CarPaint_Main') o.material = paint;
      else if (key === 'LED_WhiteHeadlight') o.material = lamp;
      else if (key === 'Glass_Headlight') o.visible = false;
      else if (o.material.metalness > 0.9 && o.material.roughness < 0.05) {
        // 导出材质多数是纯黑满金属，改成哑光
        o.material.metalness = 0.3;
        o.material.roughness = 0.45;
      }
    });
    car.add(model);
    for (const n of ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']) {
      const w = model.getObjectByName(n);
      if (w) wheels.push(w);
    }
    const box = new THREE.Box3().setFromObject(model);
    front = box.max.z;
    const halfW = (box.max.x - box.min.x) / 2;

    // 车灯眩光：两团加法混合的光晕，越近越大
    const glareTex = radialTexture();
    for (const s of [-1, 1]) {
      const m = new THREE.SpriteMaterial({ map: glareTex, color: new THREE.Color(1, 1, 1).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const sp = new THREE.Sprite(m);
      sp.position.set(s * (halfW - 0.32), 0.68, front - 0.15);
      car.add(sp);
      glares.push(sp);
    }
    // 尾灯：一条红色灯带，车开远后只剩它
    const tail = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.6, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.04).multiplyScalar(6) }));
    tail.position.set(0, 0.82, box.min.z + 0.05);
    car.add(tail);
    ready = true;
  }).catch((e) => console.error('Failed to load the finale car', e));

  // 陈墨的尸体：只在切到全景后出现（第一人称时镜头就在这个位置，模型会穿进眼睛）
  // 用全息人偶同一个模型（mannequin.glb），从 Death01 最后一帧（平躺）出发，翻成脸朝下、头朝终端，
  // 再在代码里重新摆四肢，按蒙皮后的实际最低点贴地。材质换成深色衣服
  // body 的原点 = 头部骨骼的位置，放在倒地时眼睛所在处
  const HEAD_TURN = 1.0;
  const body = new THREE.Group();
  body.name = 'FinaleBody';
  body.visible = false;
  scene.add(body);
  const blood = bloodPool();       // 头和胸口下面的一摊血，全景期间慢慢洇开
  blood.position.set(0.05, 0.004, -0.3);
  body.add(blood);
  loadMannequin().then((gltf) => {
    const model = SkeletonUtils.clone(gltf.scene);
    const cloth = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.62, metalness: 0.05 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.1 });
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.name === 'M_Joints' ? joint : cloth;
      o.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((c) => c.name === 'Death01');
    const act = mixer.clipAction(clip);
    act.play();
    act.time = clip.duration - 1e-3;
    mixer.update(0);
    model.updateMatrixWorld(true);

    // Death01 结尾是仰面平躺（向后倒）。保留动作自己的地平面，只做两步：
    // 绕竖轴转到「髋 → 头」指向本地 +Z，再绕这条长轴翻 180° 变成脸朝下（翻转不改变贴地程度）
    // 注意不能用肩线定「正面」再对齐地面：躺姿里肩膀是扭着的，那样整个人会被斜着立起来
    const at = (n) => model.getObjectByName(n).getWorldPosition(new THREE.Vector3());
    const along = at('DEF-head').sub(at('DEF-hips'));
    const front = at('DEF-shoulderL').sub(at('DEF-shoulderR')).cross(along);   // GLTFLoader 会去掉名字里的「.」
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(along.x, along.z));
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), front.y > 0 ? Math.PI : 0);
    model.quaternion.copy(flip).multiply(yaw);
    model.updateMatrixWorld(true);
    // 在这个基础上重新摆四肢，做成不对称的趴倒姿势（方向都在 model 坐标里：F 朝头，U 朝上，R 朝尸体右手边）：
    // 右臂往前伸向终端、手肘微弯；左臂软在身体左侧；右腿伸直；左腿屈膝往外收；头侧向右边，脊柱略往右弯
    // 先只定水平方向（四肢都摆在肩、髋的高度），再统一往下压，让肘、手腕、膝、脚踝落到地面
    const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qD = new THREE.Quaternion(), yAx = new THREE.Vector3();
    const setWorld = (bone, q) => {
      bone.parent.getWorldQuaternion(qP);
      bone.quaternion.copy(qP.invert().multiply(q));
      model.updateMatrixWorld(true);
    };
    // 把骨骼转到「自己 → 子关节」指向 dir（最小旋转）。不用骨骼本地轴：这套骨骼导出后的本地轴不一定沿骨骼方向
    const turn = (name, from, to) => {
      const bone = model.getObjectByName(name);
      qD.setFromUnitVectors(from.normalize(), to.clone().normalize());
      setWorld(bone, bone.getWorldQuaternion(qW).premultiply(qD));
    };
    const aim = (name, child, d) => turn(name, at(child).sub(at(name)), d);
    const F = new THREE.Vector3(0, 0, 1), U = new THREE.Vector3(0, 1, 0);
    const R = at('DEF-shoulderR').sub(at('DEF-shoulderL')); R.y = 0; R.normalize();
    const L = R.clone().negate();
    const dir = (f, r, u = 0) => F.clone().multiplyScalar(f).addScaledVector(R, r).addScaledVector(U, u);
    // [骨骼, 子关节, 方向]，父骨骼在前
    const POSE = [
      ['DEF-hips', 'DEF-spine001', dir(1, 0.02)], ['DEF-spine001', 'DEF-spine002', dir(1, 0.05)],
      ['DEF-spine002', 'DEF-spine003', dir(1, 0.1)], ['DEF-spine003', 'DEF-neck', dir(1, 0.14)],
      ['DEF-neck', 'DEF-head', dir(1, 0.18)],
      ['DEF-upper_armR', 'DEF-forearmR', dir(0.72, 0.7)], ['DEF-forearmR', 'DEF-handR', dir(0.95, 0.3)],          // 往前够
      ['DEF-handR', 'DEF-f_middle01R', dir(1, 0.15)],
      ['DEF-upper_armL', 'DEF-forearmL', dir(-0.85, -0.45)], ['DEF-forearmL', 'DEF-handL', dir(-0.95, -0.12)],     // 软在身侧
      ['DEF-handL', 'DEF-f_middle01L', dir(-1, 0)],
      ['DEF-thighR', 'DEF-shinR', dir(-0.97, 0.16)], ['DEF-shinR', 'DEF-footR', dir(-1, 0.12)],                   // 伸直
      ['DEF-thighL', 'DEF-shinL', dir(-0.5, -0.86)], ['DEF-shinL', 'DEF-footL', dir(-0.85, 0.52)],                // 屈膝外收
    ];
    for (const [n, c, d] of POSE) aim(n, c, d);
    // 地面高度只看躯干和头（按蒙皮后的顶点算）：四肢方向改过以后，脚尖、手指可能比躯干还低
    const TORSO = /hips|spine|neck|head|shoulder/;
    const vtx = new THREE.Vector3();
    const torsoMin = () => {
      let m = Infinity;
      model.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
        for (let i = 0; i < si.count; i++) {
          let k = 0;
          for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j;
          if (!TORSO.test(o.skeleton.bones[si.getComponent(i, k)].name)) continue;
          o.getVertexPosition(i, vtx).applyMatrix4(o.matrixWorld);
          m = Math.min(m, vtx.y);
        }
      });
      return m;
    };
    const floor = torsoMin();
    const drop = (root, end, lift) => {
      const p = at(root), e = at(end);
      const goal = e.clone(); goal.y = floor + lift;
      turn(root, e.sub(p), goal.sub(p));
    };
    for (const s of ['L', 'R']) {
      drop(`DEF-upper_arm${s}`, `DEF-forearm${s}`, 0.07);   // 肘落地
      drop(`DEF-forearm${s}`, `DEF-hand${s}`, 0.05);        // 小臂平放，手腕落地
      drop(`DEF-thigh${s}`, `DEF-shin${s}`, 0.09);          // 膝落地
      drop(`DEF-shin${s}`, `DEF-foot${s}`, 0.1);            // 小腿平放
    }
    // 脚：脚尖朝下戳地（趴着时脚背贴地、脚跟朝天）
    for (const s of ['L', 'R']) aim(`DEF-foot${s}`, `DEF-toe${s}`, dir(-0.7, 0, -0.55));
    // 头侧向右边，脸颊贴地：脸原本朝下（-U），绕长轴转向右下
    turn('DEF-head', U.clone().negate(), R.clone().multiplyScalar(Math.sin(HEAD_TURN)).addScaledVector(U, -Math.cos(HEAD_TURN)));
    const h = at('DEF-head');
    model.position.set(-h.x, -torsoMin(), -h.z);
    body.add(model);
  }).catch((e) => console.error('Failed to load the finale body', e));

  // ---------- 关键位置与朝向 ----------
  const toCar = new THREE.Vector3(CAR_POS.x, CAR_POS.y + 0.6, CAR_POS.z).sub(START);
  const yaw0 = Math.atan2(-toCar.x, -toCar.z);                       // 看着事故车
  const pitch0 = Math.atan2(toCar.y, Math.hypot(toCar.x, toCar.z));
  const YAW_FACE = 0;                                               // 转头看向 -Z（来车方向）
  const REST = START.clone().addScaledVector(V0, AIR).add(SLIDE);   // 躺下的位置
  REST.y = DECK_Y + LIE_H;
  // 终端：摔在前方约 2.3 m，屏幕朝上，顶边朝远处（从倒地的位置看过去文字是正的）
  const PAD = new THREE.Vector3(REST.x + 0.35, DECK_Y + 0.006, REST.z + 2.3);
  const BODY_YAW = Math.atan2(PAD.x - REST.x, PAD.z - REST.z);       // 尸体头朝终端
  const PAD_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI + 0.22, 0, 'YXZ'));
  // 镜头 A：全景。站在跑车开走的方向（+Z）、左侧车道上方约 5.6 m，回望事故现场：
  // 近处是倒地处和终端，中景右侧是事故车，远处是闪灯的警车。缓慢横移，不带手持晃动
  const A_FROM = new THREE.Vector3(-4.6, DECK_Y + 5.8, 15.6);
  const A_TO = new THREE.Vector3(-3.7, DECK_Y + 5.4, 15.1);
  const A_LOOK = new THREE.Vector3(1.2, DECK_Y + 0.4, -2.5);
  const UP = new THREE.Vector3(0, 1, 0);
  const lookM = new THREE.Matrix4();
  // 镜头 B：终端中景 → 特写。围绕终端的轨道相机：从侧前方约 3.2 m、俯角约 47° 的中景，
  // 一边推近一边绕到屏幕正上方 0.42 m；终点朝向与终端一致（PAD_Q），屏幕文字正立
  const B_DIST0 = 3.2, B_DIST1 = 0.42;
  const B_TILT0 = 0.75;                          // 起点偏离垂直约 43°（看得到终端躺在路面上）
  const B_YAW1 = Math.PI + 0.22, B_YAW0 = B_YAW1 + 0.5;   // 起点从侧面约 29° 绕进来
  const FWD = new THREE.Vector3(0, 0, -1);

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const qFace = new THREE.Quaternion().setFromEuler(euler.set(0.03, YAW_FACE, 0));
  const qRest = new THREE.Quaternion().setFromEuler(euler.set(-FLIP, Math.PI, ROLL));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3(), v = new THREE.Vector3();

  // ---------- 镜头 ----------
  function cameraAt(t) {
    if (t < T.hit) {
      // 站着：轻微呼吸 → 强制转头（略微过冲）→ 看着车灯逼近，身体往后一缩
      const u = smoother(range(t, T.turn0, T.turn1));
      const over = Math.sin(range(t, T.turn1 - 0.12, T.turn1 + 0.3) * Math.PI) * 0.05 * Math.sign(YAW_FACE - yaw0);
      const yaw = yaw0 + (YAW_FACE - yaw0) * u + over;
      const pitch = pitch0 + (0.03 - pitch0) * u;
      const flinch = smooth(range(t, T.hit - 0.35, T.hit));
      pos.copy(START);
      pos.y += Math.sin(t * 1.9) * 0.005 - flinch * 0.06;
      pos.z += flinch * 0.08;
      camera.position.copy(pos);
      camera.quaternion.setFromEuler(euler.set(pitch - flinch * 0.05, yaw, flinch * 0.06));
      return;
    }
    if (t < T.land) {
      // 撞飞：抛物线 + 向后翻滚（绕本地 X 翻过去，同时绕视线转半圈回到正向）
      const s = t - T.hit, u = s / AIR;
      pos.copy(START).addScaledVector(V0, s);
      pos.y -= 0.5 * GRAV * s * s;
      // 撞击瞬间的剧烈抖动
      const shake = Math.max(0, 1 - s / 0.25) * 0.06;
      pos.x += (Math.random() - 0.5) * shake; pos.y += (Math.random() - 0.5) * shake;
      camera.position.copy(pos);
      const flip = (Math.PI + FLIP) * (1 - (1 - u) ** 2.5);
      const roll = (Math.PI + ROLL) * smooth(u);
      camera.quaternion.copy(qFace)
        .multiply(qa.setFromAxisAngle(AX, flip))
        .multiply(qb.setFromAxisAngle(AZ, roll));
      return;
    }
    if (t < T.cut) {
      // 落地弹起、滑行，然后躺定；只剩呼吸
      const b = range(t, T.land, T.rest);
      const e = 1 - (1 - b) ** 2;
      pos.copy(START).addScaledVector(V0, AIR).addScaledVector(SLIDE, e);
      pos.y = DECK_Y + LIE_H + Math.sin(b * Math.PI) * 0.22 * (1 - b * 0.5);
      if (b >= 1) pos.y += Math.sin(t * 1.3) * 0.003;
      camera.position.copy(pos);
      const jolt = Math.sin(b * Math.PI * 2) * 0.12 * (1 - b);
      camera.quaternion.copy(qRest).multiply(qa.setFromAxisAngle(AX, jolt));
      return;
    }
    if (t < T.cut2) {
      // 镜头 A：全景，匀缓横移
      pos.lerpVectors(A_FROM, A_TO, range(t, T.cut, T.cut2));
      camera.position.copy(pos);
      camera.quaternion.setFromRotationMatrix(lookM.lookAt(pos, A_LOOK, UP));
      return;
    }
    // 镜头 B：缓起缓停地推近并绕到正上方；停稳后极慢地继续压近
    const e = smoother(range(t, T.cut2, T.push));
    let dist = B_DIST0 * (B_DIST1 / B_DIST0) ** e;   // 距离按比例缩小，画面放大速度均匀
    if (t > T.push) dist *= 1 - 0.06 * smooth(range(t, T.push, T.black));
    camera.quaternion.setFromEuler(euler.set(-Math.PI / 2 + B_TILT0 * (1 - e), B_YAW0 + (B_YAW1 - B_YAW0) * e, 0));
    camera.position.copy(PAD).addScaledVector(pos.copy(FWD).applyQuaternion(camera.quaternion), -dist);
  }

  // ---------- 跑车 ----------
  const _w = new THREE.Vector3();
  function carAt(t, dt) {
    if (!ready) return;
    const zf = START.z + SPEED * (t - T.hit);   // 车头的位置，撞击时刚好到达陈墨
    const on = t > 0.15 && zf - front < 270;
    car.visible = on || t <= 0.15;              // 前几帧放在镜头前预热着色器（黑场中看不到）
    if (t <= 0.15) {
      camera.getWorldDirection(_w);
      car.position.copy(camera.position).addScaledVector(_w, 7);
      car.position.y = DECK_Y;
      beam.intensity = 0;
      return;
    }
    car.position.set(START.x + 0.1, DECK_Y, zf - front);
    car.rotation.set(0, 0, 0);
    for (const wh of wheels) wh.rotateX((SPEED / 0.34) * dt);
    // 照路光放在车头前方；离镜头太近时减弱，避免整屏被打白（看得清车头逼近）
    beam.position.set(car.position.x, DECK_Y + 0.7, zf + 2.5);
    const near = THREE.MathUtils.clamp((beam.position.distanceTo(camera.position) - 1) / 12, 0.08, 1);
    beam.intensity = on ? 90 * near : 0;
    // 眩光：按到镜头的距离放大，保持很大的视角
    for (const g of glares) {
      g.getWorldPosition(_w);
      const d = _w.distanceTo(camera.position);
      const facing = camera.position.z < _w.z ? 0.15 : 1;   // 车开过去以后只剩尾灯
      g.scale.setScalar(THREE.MathUtils.clamp(d * 0.11, 0.4, 5) * facing);
    }
  }

  // ---------- 终端 ----------
  let padPlaced = false, padOn = false;
  const typedAt = (t) => Math.max(0, Math.min(CHARS, Math.floor((t - T.type0) * CPS)));
  function bodyAt(t) {
    // 尸体模型先不出现。位置仍按全景时段摆好，之后要露出来时把下面改回 show
    const show = t >= T.cut && t < T.end;
    body.visible = false;
    if (!show) return;
    body.position.set(REST.x, DECK_Y, REST.z);
    body.rotation.set(0, BODY_YAW, 0);
    blood.scale.setScalar(0.6 + 0.4 * smooth(range(t, T.cut, T.cut2 + 3)));
  }

  function padAt(t) {
    if (t >= T.hit + 0.1 && !padPlaced) { tablet.placeAt(PAD, PAD_Q); padPlaced = true; }
    if (!padPlaced) return;
    if (t >= T.boot && !padOn) { padOn = true; tablet.toggle(true); tablet.glitch(0.6); }
    if (!padOn) return;
    const p = clamp01((t - T.confirm) / (T.archived - T.confirm));
    tablet.setData({
      clues: [], reports: [], status: '',
      confirm: t < T.confirm ? null : { p: Math.max(0.001, p), state: p >= 1 ? 'archived' : 'idle', text: DEATH_REPORT.labels.done, onDecline: null },
      final: { ...DEATH_REPORT, typed: t < T.type0 ? 0 : typedAt(t), showVerdict: t >= T.verdict },
    });
  }

  // ---------- 后期 ----------
  function postAt(t) {
    if (t >= T.cut) {
      // 俯视镜头：切镜那一帧的后期数值与切前完全相同（全糊、半闭眼），接缝藏在模糊里；
      // 然后约 1.2 秒内退掉主观效果（模糊/眼皮/暗角/色差），只留冷灰色调；归档后慢慢褪色
      const a = smooth(range(t, T.cut, T.cut + 1.2));
      const fade = range(t, T.archived, T.black);
      HURT.white.value = 0;
      HURT.blur.value = 1 - smooth(range(t, T.cut + 0.1, T.cut + 1.4));
      HURT.lid.value = 0.45 * (1 - smooth(range(t, T.cut, T.cut + 0.8)));
      HURT.ca.value = 0.12 - 0.07 * a;
      HURT.desat.value = 0.55 - 0.15 * a + 0.35 * fade;
      HURT.vignette.value = 0.45 - 0.2 * a + 0.35 * fade;
      return;
    }
    const afterHit = t >= T.hit;
    // 白闪：车灯越来越刺眼 → 撞击瞬间全白，0.7 秒退去
    const glare = afterHit ? 0 : range(t, T.turn1, T.hit) ** 2 * 0.45;
    const hit = afterHit ? (t - T.hit < 0.08 ? 1 : 1 - smooth((t - T.hit - 0.08) / 0.7)) : 0;
    HURT.white.value = Math.max(glare, hit);
    // 模糊：撞后全糊，躺下后稍微清楚一点，切镜前又糊回去（意识涣散，也用来藏切镜接缝）
    HURT.blur.value = afterHit
      ? (t < T.rest ? 1 : 1 - 0.4 * smooth(range(t, T.rest, T.rest + 1.2)) + 0.4 * smooth(range(t, T.cut - 1.1, T.cut)))
      : 0;
    HURT.desat.value = afterHit ? 0.55 * smooth(range(t, T.hit, T.hit + 1.2)) : 0;
    // 暗角：随心跳收缩，心跳越来越慢；切镜前心跳脉动收掉，保证切镜两侧数值连续
    const rate = 1.15 - 0.25 * range(t, T.land, T.cut);
    const beat = Math.max(0, Math.sin(t * rate * Math.PI * 2)) ** 6 * (1 - range(t, T.cut - 1.1, T.cut - 0.3));
    HURT.vignette.value = afterHit ? 0.45 + 0.25 * beat : 0;
    HURT.ca.value = afterHit ? 0.12 + 0.4 * Math.max(0, 1 - (t - T.hit) / 1.5) : 0.05;
    // 躺定后眨一次眼；切镜头前眼皮发沉（半闭时直接切走，不闭死）
    const blink = (a, close, hold, open) => {
      if (t < a) return 0;
      if (t < a + close) return smooth((t - a) / close);
      if (t < a + close + hold) return 1;
      return 1 - smooth((t - a - close - hold) / open);
    };
    HURT.lid.value = Math.max(
      blink(T.rest + 0.6, 0.18, 0.25, 0.6),
      0.45 * smooth(range(t, T.cut - 0.9, T.cut)),
    );
  }

  // ---------- 播放 ----------
  let t = 0, playing = false, onDone = null, faded = false, blacked = false, frozen = false;
  const painVoice = createImpactVoice((id) => sound.voice(id), T.hit);
  function apply(dt) {
    cameraAt(t);
    carAt(t, dt);
    bodyAt(t);
    padAt(t);
    postAt(t);
    if (!faded && t > 0.15) { faded = true; ui.black(0, T.fade * 1000); }
    if (!blacked && t >= T.black) { blacked = true; ui.black(1, 800); }
  }

  function play(done) {
    painVoice.reset();
    t = 0; playing = true; onDone = done; faded = false; blacked = false; frozen = false;
    padPlaced = false; padOn = false;
    ui.black(1, 0);
  }

  return {
    play,
    T,
    // 加载界面期间把跑车放到镜头前（画面被盖住），提前编译它的材质，结局开始时不再现场编译
    warm(on) {
      if (!ready || playing) return;
      car.visible = on;
      if (!on) return;
      // 放在视线与桥面的交点（俯视的跟车机位下，「正前方 7 m」会落到视野下方被裁掉）
      camera.updateMatrixWorld();
      camera.getWorldDirection(_w);
      const down = camera.position.y - DECK_Y;
      const d = _w.y < -0.05 ? Math.min(60, down / -_w.y) : 7;
      car.position.copy(camera.position).addScaledVector(_w, d);
      car.position.y = DECK_Y;
    },
    get playing() { return playing; },
    get ready() { return ready; },
    // running = false 时（暂停）画面停住
    update(dt, running) {
      if (!playing) return;
      const go = running && ready && !frozen;
      if (go) {
        const before = t;
        t += dt;
        // 撞人声提前触发，素材峰值正好落在撞击那一帧；声源在车头撞上来的位置（转头后的正前方）
        if (before < HIT_SOUND_AT && t >= HIT_SOUND_AT) sound.play('vehicle/hit_body', { position: HIT_POS });
        // 第一人称人声走 Dialogue：与撞击帧同步，随游戏暂停，不套车体的 3D 衰减。
        painVoice.update(before, t);
      }
      apply(go ? dt : 0);
      if (t >= T.end) {
        painVoice.stop();
        playing = false;
        car.visible = false;
        body.visible = false;
        beam.intensity = 0;
        const d = onDone; onDone = null;
        d?.();
      }
    },
    // 开发调试：跳到某一秒并定格（resume 继续播放）
    resume() { frozen = false; },
    seek(time) {
      if (!playing) return;
      frozen = true;
      painVoice.stop();
      // 往回跳时重新放置终端
      if (time < t) { padPlaced = false; padOn = false; tablet.release(); }
      t = time;
      faded = true; blacked = time >= T.black;
      ui.black(blacked ? 1 : 0, 0);
      apply(0);
    },
  };
}

// 地上的一摊血：几团不规则的圆叠出来的形状，边缘略软；湿亮（低粗糙度），雨夜里能反光
function bloodPool() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.filter = 'blur(3px)';
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.ellipse(x, y, r, r * (0.7 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2); g.fill(); };
  blob(128, 128, 52);
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, d = 25 + rand() * 30;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.8, 14 + rand() * 22);
  }
  for (let i = 0; i < 7; i++) {   // 溅开的小点
    const a = rand() * Math.PI * 2, d = 82 + rand() * 22;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.8, 2 + rand() * 5);
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x520407, roughness: 0.12, metalness: 0, alphaMap: tex,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

// 中心亮、边缘透明的圆形光晕
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(240,246,255,0.7)');
  grd.addColorStop(0.45, 'rgba(200,220,255,0.15)');
  grd.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
