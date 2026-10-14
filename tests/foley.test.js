import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as events from '../src/audio/events.js';

// 运行真实游戏模块，仅替换浏览器 / 音频输出依赖，不需要 WebGPU 或声卡。
async function load(path, imports, globals = {}) {
  const url = new URL(`../${path}`, import.meta.url);
  const context = createContext({ console, performance, ...globals });
  const module = new SourceTextModule(await readFile(url, 'utf8'), {
    context, identifier: url.href,
    initializeImportMeta(meta) { meta.env = { DEV: false }; },
  });
  await module.link((name) => {
    const values = imports[name];
    assert.ok(values, `Missing test dependency: ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

test('试听清单只保留两个大小写匹配的 Foley 事件', () => {
  assert.deepEqual(events.EVENTS.filter((e) => e.path.startsWith('event:/foley/')).map((e) => e.path), [
    'event:/foley/FootStep', 'event:/foley/ClothFoley',
  ]);
});

test('每一步叠加衣物声；未初始化和单个事件失败不会阻塞游戏', async () => {
  const played = [], warnings = [];
  let runtime;
  class FmodRuntime {
    ready = false;
    constructor() { runtime = this; }
    play({ path, volume, pitch }) {
      if (this.failStep && path === 'event:/foley/FootStep') throw new Error('missing step');
      played.push({ path, volume, pitch });
    }
  }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} }, console: { warn: (...args) => warnings.push(args) } });
  sound.step();
  sound.cloth();
  assert.equal(played.length, 0);
  runtime.ready = true;
  sound.step();
  assert.deepEqual(played, [
    { path: 'event:/foley/FootStep', volume: undefined, pitch: 1 },
    { path: 'event:/foley/ClothFoley', volume: undefined, pitch: 1 },
  ]);
  runtime.failStep = true;
  sound.step();
  assert.equal(played.at(-1).path, 'event:/foley/ClothFoley');
  assert.equal(warnings.length, 1);
});

test('游戏拒绝额外音量倍率，分析循环也不再设置增益', async () => {
  const played = [], pitches = [];
  let stopped = false;
  class FmodRuntime {
    ready = true;
    play(event) { played.push(event); }
    startLoop() {
      return {
        setVolume() { assert.fail('游戏不应修改循环音量'); },
        setPitch(value) { pitches.push(value); },
      };
    }
    stopLoop() { stopped = true; }
  }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} } });
  sound.play('ui/hover', { volume: 1.6 });
  sound.cloth({ volume: 0.5 });
  sound.step();
  assert.equal(played.length, 4);
  assert.ok(played.every((event) => !Object.hasOwn(event, 'volume')));
  assert.equal(sound.setVolume, undefined);
  sound.analyze(0.5);
  sound.analyze(null);
  assert.equal(pitches.length, 1);
  assert.equal(stopped, true);
});

test('默认单次播放不写实例音量，试听工具可显式调整', async () => {
  const { FmodRuntime } = await load('src/audio/fmodRuntime.js', { './events.js': events });
  const fmod = new FmodRuntime();
  const gains = [];
  fmod.module = { OK: 0 };
  fmod.instance = () => ({
    setVolume(value) { gains.push(value); return 0; },
    setPitch() { return 0; }, start() { return 0; }, release() {},
  });
  fmod.play({ path: 'event:/foley/FootStep' });
  assert.equal(gains.length, 0);
  assert.ok(events.EVENTS.every((event) => !Object.hasOwn(event, 'volume')));
  fmod.play({ path: 'event:/foley/FootStep', volume: 0.5 });
  assert.deepEqual(gains, [0.5]);
});

test('事件 / 混音重建必须显式授权，默认不会启动 Studio', () => {
  const env = { ...process.env };
  delete env.FMOD_ALLOW_REAUTHOR;
  for (const mode of ['events', 'mix']) {
    const result = spawnSync(process.execPath, [new URL('../scripts/fmod.mjs', import.meta.url).pathname, mode], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FMOD_ALLOW_REAUTHOR=1/);
    assert.match(result.stderr, /npm run audio:build/);
  }
});

test('试听页启用 / 播放不覆盖 Studio 音量，仅手动推子会修改增益', async () => {
  const writes = [], selectors = new Map();
  function element() {
    return {
      value: 1, children: [], listeners: {},
      append(...children) { this.children.push(...children); },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute() {},
    };
  }
  const document = {
    hidden: false, addEventListener() {}, createElement: element,
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, element());
      return selectors.get(selector);
    },
  };
  class FmodRuntime {
    ready = false;
    preload() { return Promise.resolve(); }
    initialize() { this.ready = true; return Promise.resolve(); }
    getVcaVolume() { return 0.63; }
    setVolume(value) { writes.push(['master', value]); }
    setVcaVolume(path, value) { writes.push([path, value]); }
    setMuted() {} update() {} play() {}
  }
  await load('src/audio-bench.js', {
    './audio-bench.css': {}, './audio/fmodRuntime.js': { FmodRuntime }, './audio/events.js': events,
  }, { document, addEventListener() {}, requestAnimationFrame() { return 1; } });
  await selectors.get('#initialize').listeners.click();
  const slider = selectors.get('#vcas').children[0].children[1];
  assert.equal(slider.value, 0.63);
  assert.equal(slider.disabled, false);
  await selectors.get('#events').children[0].children[2].listeners.click();
  assert.deepEqual(writes, []);
  slider.value = 0.42;
  slider.listeners.input();
  assert.deepEqual(writes, [['vca:/Ambience', 0.42]]);
});

async function player() {
  const input = {}, calls = [];
  class Controls extends THREE.EventDispatcher {
    isLocked = true;
    enabled = true;
    constructor(camera) { super(); this.camera = camera; }
    lock() { this.isLocked = true; this.dispatchEvent({ type: 'lock' }); }
    unlock() { this.isLocked = false; this.dispatchEvent({ type: 'unlock' }); }
    moveForward(distance) { this.camera.position.z -= distance; }
    moveRight(distance) { this.camera.position.x += distance; }
  }
  const { createPlayer } = await load('src/player.js', {
    'three/addons/controls/PointerLockControls.js': { PointerLockControls: Controls },
    './bridge.js': { DECK_Y: 0, HALF_W: 7 },
    './crash.js': { carCollider: { x: 100, z: 0, yaw: 0, minX: -1, maxX: 1, minZ: -1, maxZ: 1 } },
    './policeCar.js': { policeCollider: { x: 100, z: 0, yaw: 0, minX: -1, maxX: 1, minZ: -1, maxZ: 1 } },
    './cordon.js': { CORDON: { z0: -1000, z1: 1000 }, CORDON_MARGIN: 1 },
    './audio/sound.js': { sound: { step: () => calls.push('step'), cloth: () => calls.push('cloth') } },
  }, { addEventListener: (name, fn) => { input[name] = fn; }, document: { addEventListener() {} } });
  const camera = new THREE.PerspectiveCamera();
  const update = createPlayer(camera, {}, { addEventListener() {}, classList: { add() {}, remove() {} } });
  return {
    camera, update, calls,
    key: (code, down = true) => input[down ? 'keydown' : 'keyup']({ code }),
    frames: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(dt); },
  };
}

test('走跑共用逐步触发，跑步步频更快，斜走不额外加速', async () => {
  for (const [running, diagonal, expected] of [[false, false, 21], [true, false, 27], [false, true, 21]]) {
    const p = await player();
    p.key('KeyW');
    if (running) p.key('ShiftLeft');
    if (diagonal) p.key('KeyD');
    // 斜走时每秒交替左右，避免碰到护栏影响步频统计。
    for (let i = 0; i < 600; i++) {
      if (diagonal && i % 60 === 0) p.key(i % 120 === 0 ? 'KeyD' : 'KeyA', false);
      if (diagonal && i % 60 === 0) p.key(i % 120 === 0 ? 'KeyA' : 'KeyD');
      p.update(1 / 60);
    }
    assert.equal(p.calls.filter((c) => c === 'step').length, expected);
    assert.ok(p.calls.every((c) => c === 'step'));
  }
});

test('撞墙 / 静止不持续出脚步，停步只补一次衣物声', async () => {
  const p = await player();
  p.key('KeyD');
  p.frames(180);
  p.calls.length = 0;
  p.frames(120);
  assert.equal(p.calls.length, 0);
  p.key('KeyD', false);
  p.key('KeyW');
  p.frames(30);
  p.key('KeyW', false);
  p.calls.length = 0;
  p.frames(120);
  assert.deepEqual(p.calls, ['cloth']);
});

test('走跑切换不重复落脚，暂停 / 禁止移动 / 零 dt 不追补脚步', async () => {
  const p = await player();
  p.key('KeyW');
  p.key('ShiftLeft');
  p.frames(24);
  p.calls.length = 0;
  p.key('ShiftLeft', false);
  p.update(1 / 60);
  assert.equal(p.calls.length, 0);
  p.update.controls.unlock();
  p.frames(60);
  p.update.controls.lock();
  p.frames(60);
  assert.equal(p.calls.length, 0); // 解锁时清理按键，恢复后不会自己走
  p.key('KeyW');
  p.update.controls.enabled = false;
  p.frames(60);
  p.update.controls.enabled = true;
  p.frames(60, 0);
  assert.equal(p.calls.length, 0);
  p.update(1 / 60);
  assert.equal(p.calls.length, 0);
});

test('明显原地转身有衣物声，细小抖动 / 待机无声且连续转身有限频', async () => {
  const p = await player();
  p.frames(60);
  assert.equal(p.calls.length, 0);
  for (let i = 0; i < 1200; i++) { p.camera.rotation.y += i % 2 ? 0.001 : -0.001; p.update(1 / 60); }
  assert.equal(p.calls.length, 0);
  for (let i = 0; i < 60; i++) { p.camera.rotation.y += 0.1; p.update(1 / 60); }
  assert.ok(p.calls.length >= 1 && p.calls.length <= 3);
  assert.ok(p.calls.every((c) => c === 'cloth'));
});

test('扫描仪拿放 / 扫描举落 / 分析举落仅在动作切换时触发', async () => {
  const calls = [];
  const { createViewmodel } = await load('src/investigation/viewmodel.js', {
    'three/webgpu': THREE, 'three/tsl': tsl,
    'three/addons/loaders/GLTFLoader.js': { GLTFLoader: class { load() {} } },
    '../audio/sound.js': { sound: { cloth: () => calls.push('cloth') } },
  });
  const vm = createViewmodel(new THREE.Scene(), new THREE.PerspectiveCamera());
  const frames = (n, shown = true) => { for (let i = 0; i < n; i++) vm.update(1 / 60, shown); };
  frames(60);
  assert.equal(calls.length, 1); // 拿出，然后待机无重复
  calls.length = 0;
  assert.equal(vm.scan(() => {}), true);
  assert.equal(vm.scan(() => {}), false);
  frames(180);
  assert.equal(calls.length, 2); // 举起和放下
  calls.length = 0;
  const target = new THREE.Vector3(0, 0, -5);
  for (let i = 0; i < 60; i++) { vm.analyze(target, i / 60); vm.update(1 / 60, true); }
  vm.analyze(null, 0);
  frames(60);
  assert.equal(calls.length, 2);
  calls.length = 0;
  frames(60, false); // 包括过场分支传入 false 时的收起
  assert.equal(calls.length, 1);
});

test('平板拿出 / 收起各触发一次，重复设置状态不会重播', async () => {
  const calls = [];
  const { createTablet } = await load('src/investigation/tablet.js', {
    'three/webgpu': THREE, 'three/tsl': tsl,
    'three/addons/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry },
    './clock.js': { uiTime: tsl.uniform(0) },
    '../audio/sound.js': { sound: { cloth: () => calls.push('cloth') } },
  }, {
    document: { createElement: () => ({ getContext: () => ({ fillText() {} }) }), body: { style: {} } },
    addEventListener() {},
  });
  const tablet = createTablet(new THREE.PerspectiveCamera());
  tablet.toggle(false);
  tablet.toggle(true);
  tablet.toggle(true);
  tablet.toggle(false);
  tablet.toggle(false);
  assert.deepEqual(calls, ['cloth', 'cloth']);
});
