import * as THREE from 'three/webgpu';
import {
  texture, uniform, instanceIndex, hash, float, vec2, vec3, fract, sin, smoothstep,
  positionView, screenUV, perspectiveDepthToViewZ, cameraNear, cameraFar, mx_noise_float,
  varying, uv, color, PI2,
} from 'three/tsl';
import { gameTime } from './investigation/clock.js';
import { DECK_Y } from './bridge.js';
import { FOG_HEX } from './fog.js';
import { WIND } from './rain.js';
import { smokeTexture } from './textures.js';
import { addLightGroup } from './debugLights.js';

// 粒子：桥面风雾
// 全部是 GPU 实例化面片，位置由 instanceIndex 和 gameTime 算出（无 CPU 逐粒子更新），分析 / 重建冻结时一起停住。
// 画在独立场景里，由 main.js 用半分辨率单独渲染后叠回：主场景 MRT 里透明物体会直接覆盖法线 / 金属度，
// 烟雾面片放进去会在湿路面的屏幕反射上抠出方框。sceneDepth 是主场景深度，用来遮挡和软化粒子边缘。

const MIST_N = 40;

export function buildSmoke(camera, sceneDepth, fogNode) {
  const fxScene = new THREE.Scene();
  fxScene.fogNode = fogNode;
  // 叠回时靠 alpha 判断覆盖率，必须清成透明。这一遍常被辉光等效果在内部"重置渲染状态"后触发，
  // 那时的清屏 alpha 是 1，所以渲染前自己设 0，渲染后还原
  let clearAlpha = 1;
  fxScene.onBeforeRender = (renderer) => { clearAlpha = renderer.getClearAlpha(); renderer.setClearAlpha(0); };
  fxScene.onAfterRender = (renderer) => { renderer.setClearAlpha(clearAlpha); };
  const puff = smokeTexture();
  const wind = vec3(WIND.x, 0, WIND.z);
  const camPos = uniform(new THREE.Vector3());

  // 与主场景深度比较：粒子贴近表面时淡出，在表面后面时完全隐藏
  const soft = (dist) => {
    const sceneZ = perspectiveDepthToViewZ(sceneDepth.sample(screenUV).r, cameraNear, cameraFar);
    return positionView.z.sub(sceneZ).div(dist).saturate();
  };
  // 离相机太近的面片会糊满屏幕，提前淡掉
  const near = (a, b) => smoothstep(a, b, positionView.z.negate());

  const mist = buildMist();
  addLightGroup('桥面风雾', (on) => { mist.visible = on; });

  function sprite(material, count, order) {
    const s = new THREE.Sprite(material);
    s.count = count;
    s.frustumCulled = false;
    s.renderOrder = order;
    fxScene.add(s);
    return s;
  }

  function puffMaterial() {
    return new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  }

  // 桥面风雾：贴着桥面的大片淡雾沿风向平移，在相机前后循环；噪声让雾一团一团地浓淡起伏
  function buildMist() {
    const AX = 22, AZ = 70;
    const m = puffMaterial();
    const id = instanceIndex.toFloat();
    const r = (n) => hash(id.mul(5.31).add(200 + n * 17));
    const speed = r(1).mul(0.6).add(0.7);
    const base = vec3(r(2).mul(AX), 0, r(3).mul(AZ)).add(wind.mul(gameTime.mul(speed).mul(0.55)));
    // 在窗口里循环：x 以桥中线为中心，z 以相机为中心；靠近窗口边缘时淡出，换边时不会跳
    const ux = fract(base.x.div(AX));
    const uz = fract(base.z.sub(camPos.z).div(AZ).add(0.5));
    const x = ux.sub(0.5).mul(AX);
    const z = camPos.z.add(uz.sub(0.5).mul(AZ));
    const y = float(DECK_Y + 0.5).add(r(4).mul(1.8)).add(sin(gameTime.mul(0.25).add(r(5).mul(PI2))).mul(0.25));
    m.positionNode = vec3(x, y, z);
    m.scaleNode = vec2(r(6).mul(5).add(5));
    m.rotationNode = r(7).mul(PI2).add(gameTime.mul(r(8).sub(0.5).mul(0.04)));

    const edge = smoothstep(0, 0.15, ux).mul(smoothstep(1, 0.85, ux)).mul(smoothstep(0, 0.15, uz)).mul(smoothstep(1, 0.85, uz));
    const density = smoothstep(-0.25, 0.45, mx_noise_float(vec3(x.mul(0.06), z.mul(0.06), gameTime.mul(0.05))));
    const amount = varying(edge.mul(density));
    m.colorNode = color(FOG_HEX).mul(9);
    m.opacityNode = texture(puff, uv()).a.mul(amount).mul(0.5).mul(soft(1.2)).mul(near(1.5, 5));
    return sprite(m, MIST_N, 2);
  }

  return {
    scene: fxScene,
    update() {
      camPos.value.copy(camera.position);
    },
  };
}
