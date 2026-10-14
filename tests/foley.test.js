import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as events from '../src/audio/events.js';
import * as voiceEvents from '../src/audio/voiceEvents.js';

// 运行真实游戏模块，仅替换浏览器 / 音频输出依赖，不需要 WebGPU 或声卡。
async function load(path, imports, globals = {}) {
  const url = new URL(`../${path}`, import.meta.url);
  const context = createContext({ console, performance, ...globals });
  const module = new SourceTextModule(await readFile(url, 'utf8'), {
    context, identifier: url.href,
    initializeImportMeta(meta) { meta.env = { DEV: false }; },
  });
  await module.link((name) => {
    const values = imports[name] ?? (name === './voiceEvents.js' ? voiceEvents : undefined);
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

test('真实对话实例等 STOPPED 后释放，暂停和取消不会重复 release', async () => {
  const { FmodRuntime } = await load('src/audio/fmodRuntime.js', { './events.js': events });
  const runtime = new FmodRuntime();
  runtime.ready = true;
  runtime.module = { OK: 0, STUDIO_PLAYBACK_STOPPED: 0, STUDIO_STOP_IMMEDIATE: 1 };
  runtime.system = { update: () => 0 };
  let state = 1, releases = 0;
  const pauses = [];
  runtime.instance = () => ({
    setPaused(value) { pauses.push(value); return 0; }, start: () => 0, stop: () => 0,
    getPlaybackState(out) { out.val = state; return 0; }, release() { releases++; },
    setVolume() { assert.fail('Voice must not override Studio gain'); },
  });
  const voice = runtime.playVoice('event:/voice/en/opening_01');
  runtime.setVoicesPaused(true);
  runtime.setVoicesPaused(false);
  runtime.update();
  assert.equal(releases, 0);
  state = 0;
  runtime.update();
  assert.equal(await voice.done, true);
  voice.stop();
  assert.equal(releases, 1);
  assert.deepEqual(pauses, [false, true, false]);
  state = 1;
  const cancelled = runtime.playVoice('event:/voice/en/opening_02');
  cancelled.stop(); cancelled.stop();
  assert.equal(await cancelled.done, false);
  assert.equal(releases, 2);
});

test('scifi 替换素材后沿用原事件路径 / 分析起停，不覆盖 Studio 音量', async () => {
  const paths = [
    'event:/scifi/scan_pulse', 'event:/scifi/analyze_loop',
    'event:/scifi/analyze_complete', 'event:/scifi/analyze_cancel',
    'event:/scifi/dream_enter', 'event:/scifi/dream_exit',
  ];
  assert.deepEqual(events.EVENTS.filter((event) => event.path.startsWith('event:/scifi/')).map((event) => event.path), paths);
  const { FmodRuntime: Runtime } = await load('src/audio/fmodRuntime.js', { './events.js': events });
  const calls = [], pitches = [], warnings = [];
  class FmodRuntime extends Runtime {
    ready = true;
    module = { OK: 0, STUDIO_STOP_ALLOWFADEOUT: 'fadeout' };
    instance(path) {
      calls.push(['instance', path]);
      return {
        setVolume() { assert.fail(`不应覆盖 ${path} 的 Studio 音量`); },
        setPitch(value) { pitches.push([path, value]); return 0; },
        start() { calls.push(['start', path]); return 0; },
        stop(mode) { calls.push(['stop', path, mode]); return 0; },
        release() { calls.push(['release', path]); },
      };
    }
    setVolume() { assert.fail('游戏不应修改 Master 音量'); }
    setVcaVolume() { assert.fail('游戏不应修改 VCA 音量'); }
  }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} }, console: { warn: (...args) => warnings.push(args) } });
  for (const path of paths.filter((path) => !path.endsWith('/analyze_loop'))) {
    sound.play(path.slice('event:/'.length), { volume: 0.1 });
  }
  sound.analyze(0);
  sound.analyze(0.5);
  sound.analyze(1);
  sound.analyze(null);
  sound.analyze(null);
  for (const path of paths) {
    assert.equal(calls.filter(([action, name]) => action === 'start' && name === path).length, 1);
  }
  assert.deepEqual(pitches.filter(([path]) => path.endsWith('/analyze_loop')).map(([, pitch]) => pitch), [0.85, 1.125, 1.4]);
  assert.deepEqual(calls.filter(([action]) => action === 'stop'), [['stop', 'event:/scifi/analyze_loop', 'fadeout']]);
  assert.deepEqual(warnings, []);
});

test('事件 / 混音重建必须显式授权，默认不会启动 Studio', () => {
  const env = { ...process.env };
  delete env.FMOD_ALLOW_REAUTHOR;
  for (const mode of ['events', 'mix']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/fmod.mjs', import.meta.url)), mode], { env, encoding: 'utf8' });
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

async function player(audio) {
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
    './audio/sound.js': { sound: audio ?? { step: () => calls.push('step'), cloth: () => calls.push('cloth') } },
  }, { addEventListener: (name, fn) => { input[name] = fn; }, document: { addEventListener() {} } });
  const camera = new THREE.PerspectiveCamera();
  const update = createPlayer(camera, {}, { addEventListener() {}, classList: { add() {}, remove() {} } });
  return {
    camera, update, calls,
    key: (code, down = true) => input[down ? 'keydown' : 'keyup']({ code }),
    frames: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(dt); },
  };
}

test('脚步跟随设备晃动频率，跑步更快，斜走不额外加速', async () => {
  for (const [running, diagonal, expected] of [[false, false, 25], [true, false, 35], [false, true, 25], [true, true, 35]]) {
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

test('左右 Shift 跑步步频均降低 20%，不降低移动速度', async () => {
  for (const shift of ['ShiftLeft', 'ShiftRight']) {
    const p = await player();
    p.key('KeyW');
    p.key(shift);
    p.frames(180); // 进入稳态，排除起步速度平滑的影响
    const phase = p.update.gait.phase;
    const z = p.camera.position.z;
    p.frames(600);
    const originalRunFrequency = (1.6 + 8 * 1.55) / Math.PI;
    const actualRunFrequency = (p.update.gait.phase - phase) / Math.PI / 10;
    assert.ok(Math.abs(actualRunFrequency / originalRunFrequency - 0.8) < 1e-10);
    assert.ok(Math.abs(p.camera.position.z - z + 80) < 1e-10);
  }
});

test('不同帧率 / 走跑切换 / 黑梦减速时，每次设备下沉只落一步且渲染共用步相', async () => {
  for (const fps of [30, 60, 144]) {
    const p = await player();
    p.camera.quaternion.identity();
    const { createViewmodel } = await load('src/investigation/viewmodel.js', {
      'three/webgpu': THREE, 'three/tsl': tsl,
      'three/addons/loaders/GLTFLoader.js': { GLTFLoader: class { load() {} } },
      '../audio/sound.js': { sound: { cloth() {} } },
    }, { performance: { now: () => 0 } });
    const overlay = new THREE.Scene();
    const gait = p.update.gait;
    const vm = createViewmodel(overlay, p.camera, gait);
    const holder = overlay.children[0].children[0];
    // 先拿稳设备，呼吸时钟固定，避免把姿态插值 / 呼吸误当成行走晃动。
    for (let i = 0; i < fps; i++) { p.update(1 / fps); vm.update(1 / fps, true); }
    p.key('KeyW');
    for (let i = 0; i < fps * 8; i++) {
      const running = i >= fps * 2 && i < fps * 4;
      p.key('ShiftLeft', running);
      const scale = i >= fps * 5 ? 0.5 : 1;
      const before = gait.phase;
      const previousCalls = p.calls.length;
      const previousSpeed = gait.speed;
      const previousZ = p.camera.position.z;
      p.update(1 / fps, scale);
      vm.update(1 / fps, true);
      const expectedSpeed = previousSpeed + (Math.abs(p.camera.position.z - previousZ) * fps - previousSpeed) * Math.min(1, 8 / fps);
      assert.ok(Math.abs(gait.phase - before - (1.6 + expectedSpeed * 1.55) / fps * (running ? 0.8 : 1)) < 1e-10);
      const landed = Math.floor((gait.phase + Math.PI / 2) / Math.PI) > Math.floor((before + Math.PI / 2) / Math.PI);
      assert.deepEqual(p.calls.slice(previousCalls), landed ? ['step'] : [], `${fps} fps, frame ${i}`);
      assert.ok(Math.abs(holder.position.x - (0.21 + Math.cos(gait.phase) * 0.012 * gait.amplitude)) < 1e-10);
      assert.ok(Math.abs(holder.position.y - (-0.24 - Math.abs(Math.sin(gait.phase)) * 0.014 * gait.amplitude)) < 1e-10);
    }
    // 枪身的减速余摆仍可继续，但停步后不多补脚步声。
    p.key('KeyW', false);
    p.calls.length = 0;
    for (let i = 0; i < fps; i++) { p.update(1 / fps); vm.update(1 / fps, true); }
    assert.deepEqual(p.calls, ['cloth']);
  }
});

test('平板 / 暂停 / 相机跳点不推进落脚，不会恢复时补播', async () => {
  const p = await player();
  p.key('KeyW');
  p.frames(60);
  p.calls.length = 0;
  const phase = p.update.gait.phase;
  for (let i = 0; i < 120; i++) p.update(1 / 60, 0);
  assert.equal(p.update.gait.phase, phase);
  assert.equal(p.update.gait.amplitude, 0);
  assert.deepEqual(p.calls, []);
  p.camera.position.z += 10;
  p.update(1 / 60);
  assert.equal(p.update.gait.phase, phase);
  assert.deepEqual(p.calls, []);
  p.update(1 / 60);
  assert.ok(p.update.gait.phase > phase);
  assert.ok(p.calls.length <= 1);
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

test('原地转身 / 抬头低头 / 细小抖动 / 待机均不触发声音', async () => {
  const p = await player();
  p.frames(60);
  assert.equal(p.calls.length, 0);
  for (let i = 0; i < 1200; i++) { p.camera.rotation.y += i % 2 ? 0.001 : -0.001; p.update(1 / 60); }
  assert.equal(p.calls.length, 0);
  for (let i = 0; i < 600; i++) {
    p.camera.rotation.y += 0.1;
    p.camera.rotation.x = Math.sin(i * 0.1) * 0.6;
    p.update(1 / 60);
  }
  assert.deepEqual(p.calls, []);
});

test('停步仅补一次 ClothFoley，随后转镜头（含 Shift / 相机微调）不再触发声音', async () => {
  const played = [];
  class FmodRuntime {
    ready = true;
    play({ path }) { played.push(path); }
  }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} } });
  for (const shift of [null, 'ShiftLeft', 'ShiftRight']) {
    const p = await player(sound);
    p.key('KeyW');
    if (shift) p.key(shift);
    p.frames(60);
    assert.ok(played.includes('event:/foley/FootStep'));
    p.key('KeyW', false);
    played.length = 0;
    for (let i = 0; i < 120; i++) {
      p.camera.rotation.y += 0.04;
      p.camera.rotation.x = Math.sin(i * 0.1) * 0.2;
      p.camera.position.x += 0.003; // 模拟碰撞 / 相机修正，不是方向键移动
      p.update(1 / 60);
    }
    assert.deepEqual(played, ['event:/foley/ClothFoley']); // 保留停步衣物声，转向没有额外触发
    played.length = 0;
    for (let i = 0; i < 120; i++) {
      p.camera.rotation.y -= 0.1;
      p.update(1 / 60);
    }
    assert.deepEqual(played, []);
    played.length = 0;
  }
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
    '../i18n.js': { tx: (zh) => zh },
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
