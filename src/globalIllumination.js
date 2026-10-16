import * as THREE from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';

// 只在加载界面计算。覆盖桥面可走区域，城市和灯带是光照来源，不给整座城市铺探针。
export const GI = {
  probes: [5, 3, 29],
  cubemapSize: 32,
  sampleCount: 512,
  bounces: 1,
  probesPerFrame: 2,
  intensity: 0.8,
  falloff: 10,
  near: 0.1,
  far: 180,
};

// 独立采集场景：共享几何和贴图，但不共享可变材质、灯光或物体状态。
// 不带天空 / HDRI（实时环境光已经负责）、雾、车辆、雨和调查全息，避免把它们永久烘进光照。
function captureWorld(world, ambientLights) {
  const scene = new THREE.Scene();
  scene.backgroundNode = null;
  scene.fogNode = null;
  const materials = new Map();
  const instances = [];
  const root = world.clone(true);
  const originals = [];
  const copies = [];
  world.traverse((o) => originals.push(o));
  root.traverse((o) => copies.push(o));

  function captureMaterial(src) {
    if (materials.has(src)) return materials.get(src);
    const m = src.clone();
    m.fog = false;
    m.mrtNode = null;
    // 压低采集时的湿地镜面 / 清漆高光，以漫反射的表面亮度为主。
    if (m.isMeshStandardMaterial || m.isMeshStandardNodeMaterial) {
      m.envMap = null;
      m.envMapIntensity = 0;
      m.roughness = 1;
      m.roughnessNode = null;
      m.clearcoat = 0;
      m.clearcoatNode = null;
    }
    materials.set(src, m);
    return m;
  }

  copies.forEach((o, i) => {
    // Object3D.clone 会把 userData JSON 化；楼体的 object uniform 必须仍拿到 Color / Vector4。
    o.userData = originals[i].userData;
    // 城市在主场景里只放 FAR_LAYER（跳过 AO 预渲染），探针的 CubeCamera 只看 layer 0
    o.layers.enable(0);
    if (o.isInstancedMesh) instances.push(o);
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    // 全息广告 / 透明光晕不作静态光源。真正的灯箱、霓虹字、亮窗仍参与采集。
    if (list.every((m) => m.transparent && !m.depthWrite)) o.visible = false;
    o.material = Array.isArray(o.material) ? list.map(captureMaterial) : captureMaterial(o.material);
  });

  scene.add(root);
  for (const light of ambientLights) scene.add(light.clone());
  return {
    scene,
    dispose() {
      for (const m of materials.values()) m.dispose();
      for (const o of instances) o.dispose();
      scene.clear();
      // 几何体和纹理仍由游戏使用，绝不能随采集场景一起 dispose。
    },
  };
}

export function createStaticGI({ scene, world, ambientLights, assetsReady, volume, settings = GI }) {
  const probes = new LightProbeGrid(volume.width, volume.height, volume.depth, ...settings.probes);
  probes.name = '静态全局光照';
  probes.position.set(...volume.position);
  probes.falloff = settings.falloff;

  let status = 'waiting';
  let enabled = true;
  let capture = null;
  let index = 0, bounce = 0;
  let finish;
  const ready = new Promise((resolve) => { finish = resolve; });
  const total = settings.probes.reduce((n, v) => n * v, 1);

  function fail(error) {
    status = 'failed';
    capture?.dispose();
    capture = null;
    scene.remove(probes);
    probes.dispose();
    console.warn('[GI] 静态光照计算失败，保留原有灯光', error);
    finish(false);
  }

  // 等模型解析、材质替换和实例摆放都完成，不能只等网络请求结束。
  Promise.resolve(assetsReady).then(() => { status = 'pending'; }, fail);

  return {
    ready,
    probes,
    get status() { return status; },
    get progress() { return status === 'ready' ? 1 : (bounce * total + index) / ((settings.bounces + 1) * total); },
    setEnabled(on) { enabled = on; probes.visible = on; },
    update(renderer) {
      if ((status !== 'pending' && status !== 'baking') || !renderer.initialized) return;
      try {
        if (status === 'pending') {
          capture = captureWorld(world, ambientLights);
          status = 'baking';
        }
        const count = Math.min(settings.probesPerFrame, total - index);
        probes.bake(renderer, capture.scene, {
          cubemapSize: settings.cubemapSize,
          sampleCount: settings.sampleCount,
          near: settings.near,
          far: settings.far,
          start: index,
          count,
          pass: bounce,
        });
        index += count;
        if (index < total) return;
        index = 0;
        if (++bounce <= settings.bounces) return;

        // 整个体积及反弹计算完成后才接入主场景；游戏里只采样，不再 bake。
        probes.intensity = settings.intensity;
        probes.visible = enabled;
        scene.add(probes);
        capture.dispose();
        capture = null;
        status = 'ready';
        finish(true);
      } catch (error) {
        fail(error);
      }
    },
  };
}
