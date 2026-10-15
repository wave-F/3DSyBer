import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { createStaticGI, GI } from '../src/globalIllumination.js';

function fixture(assetsReady = Promise.resolve()) {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.3 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(), material);
  wall.name = 'wall';
  wall.userData.signLights = [{ p: new THREE.Vector4(1, 2, 3, 4), c: new THREE.Color(0xff00ff) }];
  world.add(wall);
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
  holo.name = 'hologram';
  world.add(holo);
  const car = new THREE.Mesh(new THREE.BoxGeometry(), material);
  car.name = 'moving-car';
  scene.add(world, car);
  const ambient = new THREE.HemisphereLight(0x334455, 0x010203, 0.55);
  scene.add(ambient);
  const settings = { ...GI, probes: [2, 2, 2], probesPerFrame: 3 };
  const gi = createStaticGI({
    scene, world, ambientLights: [ambient], assetsReady, settings,
    volume: { width: 20, height: 6, depth: 134, position: [0, 23.3, 11] },
  });
  return { scene, world, wall, car, holo, ambient, gi, settings };
}

test('静态 GI 等模型就绪和 renderer 初始化；探针只在加载阶段分批计算', async () => {
  let loaded;
  const f = fixture(new Promise((resolve) => { loaded = resolve; }));
  const calls = [];
  f.gi.probes.bake = (renderer, scene, options) => calls.push(options);
  const renderer = { initialized: true };
  f.gi.update(renderer);
  assert.equal(f.gi.status, 'waiting');
  loaded();
  await Promise.resolve();
  f.gi.update({ initialized: false });
  assert.equal(calls.length, 0);
  for (let i = 0; i < 5; i++) f.gi.update(renderer);
  assert.equal(f.gi.status, 'baking');
  assert.equal(f.gi.probes.parent, null);
  assert.ok(f.gi.progress > 0 && f.gi.progress < 1);
  f.gi.update(renderer);
  assert.equal(await f.gi.ready, true);
  assert.equal(f.gi.status, 'ready');
  assert.equal(f.gi.progress, 1);
  assert.equal(f.gi.probes.parent, f.scene);
  assert.equal(f.gi.probes.intensity, f.settings.intensity);
  assert.deepEqual(calls.map(({ start, count, pass }) => [start, count, pass]), [
    [0, 3, 0], [3, 3, 0], [6, 2, 0], [0, 3, 1], [3, 3, 1], [6, 2, 1],
  ]);
  f.gi.update(renderer);
  assert.equal(calls.length, 6, '完成后不再逐帧重新烘焙');
});

test('采集场景隔离雾 / 天空 / 动态物体，保留楼体 uniform 类型，不修改原材质', async () => {
  const f = fixture();
  let capture;
  let disposed = false;
  f.gi.probes.bake = (renderer, scene) => {
    capture = scene;
    const wall = scene.getObjectByName('wall');
    wall.material.addEventListener('dispose', () => { disposed = true; });
  };
  await Promise.resolve();
  f.gi.update({ initialized: true });
  assert.equal(capture.environment, null);
  assert.equal(capture.backgroundNode, null);
  assert.equal(capture.fogNode, null);
  assert.equal(capture.getObjectByName('moving-car'), undefined);
  const wall = capture.getObjectByName('wall');
  assert.equal(wall.geometry, f.wall.geometry);
  assert.notEqual(wall.material, f.wall.material);
  assert.equal(wall.material.fog, false);
  assert.equal(wall.material.roughness, 1);
  assert.equal(wall.material.envMapIntensity, 0);
  assert.equal(f.wall.material.roughness, 0.2);
  assert.equal(wall.userData.signLights[0].p.isVector4, true);
  assert.equal(wall.userData.signLights[0].c.isColor, true);
  assert.equal(capture.getObjectByName('hologram').visible, false);
  assert.notEqual(capture.children[1], f.ambient);
  for (let i = 0; i < 5; i++) f.gi.update({ initialized: true });
  assert.equal(disposed, true);
  assert.equal(f.wall.parent, f.world);
  assert.equal(f.holo.visible, true);
});

test('GI 开关不触发重烘焙，在完成前关闭也会保留关闭状态', async () => {
  const { gi, scene } = fixture();
  let calls = 0;
  gi.probes.bake = () => { calls++; };
  gi.setEnabled(false);
  await Promise.resolve();
  for (let i = 0; i < 6; i++) gi.update({ initialized: true });
  assert.equal(gi.probes.parent, scene);
  assert.equal(gi.probes.visible, false);
  gi.setEnabled(true);
  gi.update({ initialized: true });
  assert.equal(gi.probes.visible, true);
  assert.equal(calls, 6);
});

test('模型加载失败或 bake 抛错时释放资源，不会让加载界面永久等待', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const missing = fixture(Promise.reject(new Error('missing building')));
  assert.equal(await missing.gi.ready, false);
  assert.equal(missing.gi.status, 'failed');
  const broken = fixture();
  broken.gi.probes.bake = () => { throw new Error('GPU bake failed'); };
  await Promise.resolve();
  broken.gi.update({ initialized: true });
  assert.equal(await broken.gi.ready, false);
  assert.equal(broken.gi.status, 'failed');
  assert.equal(broken.gi.probes.parent, null);
});
