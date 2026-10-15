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
import { tx } from '../src/i18n.js';

// 运行真实游戏模块，仅替换浏览器 / 音频输出依赖，不需要 WebGPU 或声卡。
async function load(path, imports, globals = {}) {
  const url = new URL(`../${path}`, import.meta.url);
  const context = createContext({ console, performance, ...globals });
  const module = new SourceTextModule(await readFile(url, 'utf8'), {
    context, identifier: url.href,
    initializeImportMeta(meta) { meta.env = { DEV: false, BASE_URL: '/' }; },
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

test('试听清单的 Foley 事件与 Studio 大小写一致', () => {
  assert.deepEqual(events.EVENTS.filter((e) => e.path.startsWith('event:/foley/')).map((e) => e.path), [
    'event:/foley/FootStep', 'event:/foley/FootStep_Water', 'event:/foley/ClothFoley',
    'event:/foley/pry_insert', 'event:/foley/pry_open',
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
  for (const path of paths) assert.ok(events.EVENTS.some((event) => event.path === path), path);
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

async function player(audio, puddle = () => false) {
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
    './bridge.js': { DECK_Y: 0, HALF_W: 7, puddleAt: puddle },
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
    '../i18n.js': { tx },
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

test('加载界面中英切换仍等待声音预加载，保留菜单手势、慢淡入和结局回标题重开', async () => {
  function element() {
    const classes = new Set(), listeners = new Map(), children = new Map();
    return {
      style: {}, dataset: {}, textContent: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      },
      querySelector(name) { if (!children.has(name)) children.set(name, element()); return children.get(name); },
      addEventListener(name, fn) { listeners.set(name, fn); },
      fire(name, event = {}) { listeners.get(name)?.(event); },
    };
  }
  const root = element(), overlay = element(), langButton = element();
  const manager = {}, timers = [], keys = new Map(), calls = [];
  const langListeners = [];
  let lang = 'zh', frame, now = 0;
  const { loading } = await load('src/loading.js', {
    'three/webgpu': { DefaultLoadingManager: manager },
    './i18n.js': {
      getLang: () => lang,
      setLang(next) { lang = next; langListeners.forEach((fn) => fn(next)); },
      onLang: (fn) => langListeners.push(fn),
      tx: (zh, en) => lang === 'en' ? en : zh,
    },
  }, {
    document: { getElementById: (id) => ({ loading: root, overlay, 'lang-btn': langButton })[id] },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frame = fn; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
    addEventListener: (name, fn) => keys.set(name, fn),
    location: { reload: () => calls.push('reload') },
  });
  loading.onWake(() => calls.push('wake'));
  loading.onDeny(() => calls.push('deny'));
  loading.onStart(() => calls.push('start'));
  assert.equal(loading.fadeLeft, null);
  let finishAudio;
  loading.waitFor(new Promise((resolve) => { finishAudio = resolve; }), '声音', 'AUDIO');
  manager.onProgress('/assets/supercar.glb', 1, 1);
  now = 1000; frame(now);
  assert.equal(root.querySelector('.ld-bar .st').textContent, '正在加载 · 声音');
  assert.ok(parseFloat(root.querySelector('.ld-bar .fill').style.width) < 85);
  root.fire('pointerdown'); root.fire('click');
  assert.deepEqual(calls, ['wake', 'deny']);
  let stopped = false, prevented = false;
  root.querySelector('.ld-lang').fire('click', {
    stopPropagation() { stopped = true; }, preventDefault() { prevented = true; },
  });
  assert.ok(stopped && prevented);
  assert.equal(root.querySelector('.ld-bar .st').textContent, 'LOADING · AUDIO');
  assert.equal(overlay.querySelector('h1').textContent, 'PAUSED');
  now = 20000; frame(now);
  assert.equal(root.querySelector('.ld-bar .st').textContent, 'LOADING · AUDIO');
  assert.equal(timers.length, 0); // 即使超过预热上限，也不能越过没加载完的声音
  finishAudio(); await new Promise((resolve) => setImmediate(resolve));
  now += 1000; frame(now);
  assert.equal(root.querySelector('.ld-bar .st').textContent, 'PREPARING');
  for (let i = 0; i < 200 && !timers.length; i++) { now += 16; frame(now); }
  assert.equal(root.querySelector('.ld-bar .st').textContent, 'READY');
  assert.deepEqual(timers.map((t) => t.ms), [400, 1050]);
  timers.splice(0).forEach((t) => t.fn());
  calls.length = 0;
  root.fire('pointerdown'); root.fire('click');
  assert.deepEqual(calls, ['start']);
  assert.deepEqual(timers.map((t) => t.ms), [1150, 4750]);
  root.fire('click'); keys.get('keydown')();
  assert.deepEqual(calls, ['start']);
  const fadeTimers = timers.splice(0);
  now += fadeTimers[0].ms;
  fadeTimers[0].fn();
  assert.equal(loading.fadeLeft, 3600);
  now += 1600;
  assert.equal(loading.fadeLeft, 2000);
  now += 2000;
  fadeTimers[1].fn();
  assert.equal(loading.done, true);
  assert.equal(loading.fadeLeft, 0);
  loading.showTitle();
  assert.equal(loading.done, false);
  assert.equal(root.classList.contains('fading'), false);
  assert.equal(root.classList.contains('closing'), false);
  assert.equal(root.classList.contains('ready'), true);
  assert.deepEqual(timers.map((t) => t.ms), [1500]);
  timers.splice(0).forEach((t) => t.fn());
  calls.length = 0;
  root.fire('pointerdown'); root.fire('click');
  assert.deepEqual(calls, []); // 标题重开走整页 reload，不在旧调查进度上重新 start
  assert.deepEqual(timers.map((t) => t.ms), [700]);
  root.fire('click');
  timers.splice(0).forEach((t) => t.fn());
  assert.deepEqual(calls, ['reload']);
});

test('踩在水洼上用水脚步代替普通脚步，衣物声照常', async () => {
  const played = [];
  class FmodRuntime {
    ready = true;
    play({ path }) { played.push(path); }
  }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} } });
  // 从 z = -10.8 往 -Z 走，过了 z = -13 才是水洼
  const p = await player(sound, (x, z) => z < -13);
  p.key('KeyW');
  p.frames(120);
  const steps = played.filter((path) => path !== 'event:/foley/ClothFoley');
  assert.ok(steps.includes('event:/foley/FootStep'));
  assert.ok(steps.includes('event:/foley/FootStep_Water'));
  assert.equal(steps.indexOf('event:/foley/FootStep_Water'), steps.lastIndexOf('event:/foley/FootStep') + 1);
  assert.equal(played.filter((path) => path === 'event:/foley/ClothFoley').length, steps.length);
});

function runtimeStub(calls) {
  // 记录 FMOD 调用的最小运行时：方法名与真实 FmodRuntime 一致；preload 一完成就全部就绪
  return class FmodRuntime {
    ready = false;
    complete = false;
    loops = new Map();
    prepared = new Set();
    loaded = Promise.resolve();
    preload() { if (!this.ready) { this.ready = this.complete = true; calls.push(['boot']); } return Promise.resolve(); }
    initialize() { calls.push(['resume']); return Promise.resolve(); }
    description() {}
    setMuted() {}
    play({ path, position }) { calls.push(['play', path, position]); }
    prepareLoop(path, position) { this.loops.set(path, {}); this.prepared.add(path); calls.push(['prepare', path, position]); }
    prepareInstance() { return null; }
    startLoop(path, position) {
      if (this.prepared.delete(path)) { calls.push(['unpause', path]); return {}; }
      if (this.loops.has(path)) return this.loops.get(path);
      this.loops.set(path, {}); calls.push(['start', path, position]); return {};
    }
    moveLoop(path, position) {
      if (!this.loops.has(path)) return;
      if (this.prepared.delete(path)) calls.push(['unpause', path]);
      calls.push(['move', path, position]);
    }
    stopLoop(path, immediate = false) { this.prepared.delete(path); if (this.loops.delete(path)) calls.push(['stop', path, immediate]); }
    setSnapshot(path, on) { calls.push(['snapshot', path, on]); }
    instance() { return null; }
    update() {}
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

test('页面打开就装入 Bank 并预备好全部循环（暂停）；加载界面有手势才放菜单音乐', async () => {
  const calls = [];
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime: runtimeStub(calls) }, './events.js': events,
  }, { document: { addEventListener() {}, hidden: false }, setTimeout, clearTimeout });
  await sound.preload();
  const prepared = calls.filter(([a]) => a === 'prepare').map(([, path]) => path);
  for (const path of ['event:/music/menu', 'event:/amb/rain', 'event:/amb/traffic', 'event:/amb/Amb_1', 'event:/vehicle/drive_out', 'event:/vehicle/drive_in']) {
    assert.ok(prepared.includes(path), path);
  }
  assert.ok(!calls.some(([a]) => a === 'start' || a === 'unpause'));   // 加载期间什么都不出声
  sound.unlock();
  await flush();
  assert.deepEqual(calls.filter(([a]) => a === 'unpause').map(([, path]) => path), ['event:/music/menu']);
});

test('点击开始只做轻量操作：音乐淡出、进入音效、取消暂停已开好的环境循环，不装 Bank 也不新建实例', async () => {
  const calls = [];
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime: runtimeStub(calls) }, './events.js': events,
  }, { document: { addEventListener() {}, hidden: false }, setTimeout, clearTimeout });
  await sound.preload();
  sound.unlock();
  await flush();
  calls.length = 0;
  sound.start();
  // 全部在点击回调里同步完成
  assert.deepEqual(calls.slice(0, 3), [['resume'], ['stop', 'event:/music/menu', false], ['play', 'event:/ui/enter_game', undefined]]);
  assert.ok(calls.slice(3).every(([a]) => a === 'unpause'), JSON.stringify(calls));
  const resumed = calls.filter(([a]) => a === 'unpause').map(([, path]) => path);
  assert.ok(resumed.includes('event:/amb/rain') && resumed.includes('event:/amb/Amb_4'));
  assert.ok(!resumed.includes('event:/vehicle/siren') && !resumed.includes('event:/vehicle/drive_out'));
  await flush();
  assert.equal(calls.filter(([a]) => a === 'boot' || a === 'prepare' || a === 'start').length, 0);
});

test('没有提前手势时点开始不会补放菜单音乐', async () => {
  const calls = [];
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime: runtimeStub(calls) }, './events.js': events,
  }, { document: { addEventListener() {}, hidden: false }, setTimeout, clearTimeout });
  await sound.preload();
  sound.start();
  sound.unlock();
  await flush();
  assert.ok(!calls.some(([a, path]) => (a === 'unpause' || a === 'start') && path === 'event:/music/menu'));
  assert.ok(calls.some(([a, path]) => a === 'play' && path === 'event:/ui/enter_game'));
});

test('跟随声源：Bank 未装完不启动；第一次开始、之后移动、null 停止（可立即切断）', async () => {
  const calls = [];
  const Runtime = runtimeStub(calls);
  let runtime;
  class FmodRuntime extends Runtime { constructor() { super(); runtime = this; this.ready = true; } }
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime }, './events.js': events,
  }, { document: { addEventListener() {} } });
  sound.follow('vehicle/drive_out', { x: 0, y: 0, z: 0 });
  sound.loop('vehicle/drive_in', true);
  assert.deepEqual(calls, []);
  runtime.complete = true;
  sound.follow('vehicle/drive_out', { x: 0, y: 0, z: 0 });
  sound.follow('vehicle/drive_out', { x: 0, y: 0, z: 5 });
  sound.follow('vehicle/drive_out', null, { immediate: true });
  sound.follow('vehicle/drive_out', null);
  sound.loop('vehicle/drive_in', true);
  sound.loop('vehicle/drive_in', false);
  assert.deepEqual(calls, [
    ['start', 'event:/vehicle/drive_out', { x: 0, y: 0, z: 0 }],
    ['move', 'event:/vehicle/drive_out', { x: 0, y: 0, z: 5 }],
    ['stop', 'event:/vehicle/drive_out', true],
    ['start', 'event:/vehicle/drive_in', undefined],
    ['stop', 'event:/vehicle/drive_in', false],
  ]);
});

test('广告牌只在近处大屏换图时响，世界开始前和远处的屏不响', async () => {
  const calls = [];
  const { sound } = await load('src/audio/sound.js', {
    './fmodRuntime.js': { FmodRuntime: runtimeStub(calls) }, './events.js': events,
  }, { document: { addEventListener() {}, hidden: false }, setTimeout, clearTimeout });
  const area = { x: [-7, 7], z: [-46, 68], y: 21.7 };
  sound.setBillboards([{ x: 20, y: 30, z: 0, phase: 1 }, { x: 400, y: 30, z: 0, phase: 1 }], area, 9);
  sound.updateBillboards(7.5);
  sound.updateBillboards(8.5);   // (8.5 + 1) / 9 跨过整数：换图，但世界还没开始
  assert.deepEqual(calls, []);
  await sound.preload();
  sound.start();
  await flush();
  calls.length = 0;
  sound.updateBillboards(16);
  sound.updateBillboards(17.5);  // 再换一次
  sound.updateBillboards(17.6);
  assert.deepEqual(calls.map(([a, path, at]) => [a, path, at.x, at.y, at.z]), [['play', 'event:/world/billboard_update', 20, 30, 0]]);
});

test('运行时先装入 BOOT Bank，其余逐个装入并等采样解码完；全部装完仍缺的事件只报一次', async () => {
  const { FmodRuntime } = await load('src/audio/fmodRuntime.js', { './events.js': events }, { setTimeout });
  const fmod = new FmodRuntime();
  const loaded = [];
  let decoding = 3;   // 前几次查询仍在解码
  fmod.module = { OK: 0, STUDIO_LOAD_MEMORY: 0, STUDIO_LOAD_BANK_NORMAL: 0, STUDIO_LOADING_STATE_LOADING: 2, ErrorString: () => 'not found' };
  fmod.ready = true;
  fmod.system = {
    update: () => 0,
    loadBankMemory(bytes, length, mode, flags, out) {
      loaded.push(bytes.file);
      out.val = { loadSampleData: () => 0, getSampleLoadingState(state) { state.val = decoding > 0 ? 2 : 3; return 0; } };
      return 0;
    },
    getEvent(path, out) { return path === 'event:/ok' ? ((out.val = {}), 0) : 1; },
  };
  const later = [];
  fmod.fetches = new Map(events.BANKS.map((file) => [file, new Promise((resolve) => later.push(() => resolve(Object.assign(new Uint8Array(1), { file }))))]));
  for (const file of events.BOOT_BANKS) fmod.loadBank(file, Object.assign(new Uint8Array(1), { file }));
  const rest = fmod.loadRest();
  assert.deepEqual(loaded, events.BOOT_BANKS);
  assert.throws(() => fmod.description('event:/missing'));
  assert.throws(() => fmod.description('event:/missing'));   // 还没装完：可能只是 Bank 未到
  later.forEach((resolve) => resolve());
  const poll = setInterval(() => { decoding--; }, 10);
  await rest;
  clearInterval(poll);
  assert.deepEqual(loaded, events.BANKS);
  assert.ok(decoding <= 0);
  assert.equal(fmod.complete, true);
  assert.throws(() => fmod.description('event:/missing'));
  assert.equal(fmod.description('event:/missing'), undefined);
  assert.deepEqual(fmod.description('event:/ok'), {});
});

test('预备好的循环保持暂停，第一次 startLoop / moveLoop 才取消暂停，停止时清掉标记', async () => {
  const { FmodRuntime } = await load('src/audio/fmodRuntime.js', { './events.js': events }, { setTimeout });
  const fmod = new FmodRuntime();
  const log = [];
  fmod.module = { OK: 0, STUDIO_STOP_ALLOWFADEOUT: 0, STUDIO_STOP_IMMEDIATE: 1 };
  fmod.ready = true;
  fmod.attributes = { position: {}, forward: {}, up: {}, velocity: {} };
  fmod.instance = (path) => ({
    setPaused(v) { log.push([path, 'paused', v]); return 0; }, start() { log.push([path, 'start']); return 0; },
    set3DAttributes() { log.push([path, '3d']); return 0; }, stop() { return 0; }, release() { log.push([path, 'release']); },
  });
  fmod.prepareLoop('event:/a');
  fmod.prepareLoop('event:/b', { x: 0, y: 0, z: 0 });
  assert.deepEqual(log, [['event:/a', 'paused', true], ['event:/a', 'start'], ['event:/b', '3d'], ['event:/b', 'paused', true], ['event:/b', 'start']]);
  log.length = 0;
  fmod.startLoop('event:/a');
  fmod.startLoop('event:/a');
  fmod.moveLoop('event:/b', { x: 1, y: 0, z: 0 });
  fmod.moveLoop('event:/b', { x: 2, y: 0, z: 0 });
  assert.deepEqual(log, [['event:/a', 'paused', false], ['event:/b', '3d'], ['event:/b', 'paused', false], ['event:/b', '3d']]);
  fmod.stopLoop('event:/a');
  assert.equal(fmod.prepared.size, 0);
});
