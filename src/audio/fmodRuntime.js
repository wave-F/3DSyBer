import { BANKS, BOOT_BANKS } from './events.js';

const BASE = `${import.meta.env.BASE_URL}fmod/`;
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
let modulePromise;

function loadModule() {
  if (modulePromise) return modulePromise;
  modulePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}fmodstudioL.js`;
    script.async = true;
    script.onerror = () => { script.remove(); reject(new Error(`无法加载 ${script.src}`)); };
    script.onload = () => {
      const module = {
        window,
        INITIAL_MEMORY: 128 * 1024 * 1024,
        locateFile: (file) => new URL(BASE + file, document.baseURI).href,
        preRun: () => {},
        onRuntimeInitialized: () => resolve(module),
        onAbort: (reason) => reject(new Error(`FMOD WASM: ${reason}`)),
      };
      try {
        if (!window.FMODModule) throw new Error('FMODModule missing');
        window.FMODModule(module);
      } catch (error) { reject(error); }
    };
    document.head.appendChild(script);
  }).catch((error) => { modulePromise = undefined; throw error; });
  return modulePromise;
}

export class FmodRuntime {
  ready = false;
  disposed = false;
  complete = false;   // 全部 Bank 已装入、采样数据已解码
  banks = [];
  descriptions = new Map();
  missing = new Set();
  loops = new Map();
  prepared = new Set();   // 已开始但保持暂停的循环（流已打开），第一次真正播放时取消暂停
  snapshots = new Map();
  vcas = new Map();
  // 保留有效句柄直到 STOPPED 再 release，避免操作已释放的一次性实例。
  oneShots = new Set();
  voices = new Map();

  check(result, label) {
    if (result !== this.module.OK) throw new Error(`FMOD ${label}: ${this.module.ErrorString(result)}`);
  }

  // 网页一打开就调用：下载全部 Bank（BOOT_BANKS 高优先级），WASM 和 BOOT_BANKS 一到就初始化 FMOD，
  // 其余 Bank 随后逐个装入并等采样数据全部解码完（loaded）。不需要用户手势：浏览器音频输出先挂起，
  // 第一次点击 / 按键时由 initialize() 恢复。这样点击开始时不再有装 Bank 之类的重活卡住主线程。
  preload() {
    if (!this.loading) {
      this.fetches = new Map(BANKS.map((file) => [file, fetch(BASE + file, { priority: BOOT_BANKS.includes(file) ? 'high' : 'low' }).then(async (response) => {
        if (!response.ok) throw new Error(`FMOD bank HTTP ${response.status}: ${file}`);
        return new Uint8Array(await response.arrayBuffer());
      })]));
      this.loading = Promise.all([
        loadModule().then((module) => { this.module = module; }),
        ...BOOT_BANKS.map((file) => this.fetches.get(file)),
      ]).then((parts) => this.boot(parts.slice(1)))
        .catch((error) => { this.loading = undefined; this.fetches = undefined; throw error; });
      this.loaded = this.loading.then(() => this.loadRest());
      this.loaded.catch((error) => console.warn('[audio] banks', error.message));
    }
    return this.loading;
  }

  boot(bootBytes) {
    if (this.disposed || this.ready) return;
    const f = this.module;
    try {
      const out = {};
      this.check(f.Studio_System_Create(out), 'create');
      this.system = out.val;
      const core = {};
      this.check(this.system.getCoreSystem(core), 'core');
      this.core = core.val;
      this.check(this.core.setDSPBufferSize(2048, 2), 'DSP buffer');
      const rate = {};
      if (this.core.getDriverInfo(0, null, null, rate, null, null) === f.OK && rate.val) {
        this.check(this.core.setSoftwareFormat(rate.val, f.SPEAKERMODE_DEFAULT, 0), 'sample rate');
      }
      // 右手坐标系，与 three.js 一致：位置、朝向直接传世界坐标（米）
      this.check(this.system.initialize(128, f.STUDIO_INIT_NORMAL, f.INIT_NORMAL | f.INIT_3D_RIGHTHANDED, null), 'initialize');
      this.attributes = f._3D_ATTRIBUTES();
      BOOT_BANKS.forEach((file, i) => this.loadBank(file, bootBytes[i]));
      const bus = {};
      this.check(this.system.getBus('bus:/', bus), 'master bus');
      this.master = bus.val;
      this.ready = true;
      this.update();
    } catch (error) {
      this.system?.release();
      this.system = this.core = this.master = undefined;
      this.ready = false;
      throw error;
    }
  }

  loadBank(file, bytes) {
    const f = this.module, bank = {};
    this.check(this.system.loadBankMemory(bytes, bytes.byteLength, f.STUDIO_LOAD_MEMORY, f.STUDIO_LOAD_BANK_NORMAL, bank), `load ${file}`);
    this.check(bank.val.loadSampleData(), `samples ${file}`);
    this.banks.push(bank.val);
  }

  // 剩余 Bank 按顺序装入：每个 Bank 单独一个任务，避免一次长时间占住主线程（混音也跑在主线程）
  async loadRest() {
    for (const file of BANKS.filter((name) => !BOOT_BANKS.includes(name))) {
      const bytes = await this.fetches.get(file);
      await nextTask();
      if (this.disposed || !this.ready) return;
      this.loadBank(file, bytes);
    }
    await this.samplesLoaded();
    this.complete = true;
  }

  // 等全部 Bank 的采样数据解码进内存；非线程版 FMOD 在 update 里推进异步加载
  async samplesLoaded() {
    const LOADING = this.module.STUDIO_LOADING_STATE_LOADING;
    for (;;) {
      this.update();
      const pending = this.banks.some((bank) => {
        const state = {};
        return bank.getSampleLoadingState(state) === this.module.OK && state.val === LOADING;
      });
      if (!pending || this.disposed) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  // 在用户手势里调用：恢复浏览器音频输出（FMOD 在页面打开时已初始化）；还没初始化完就等它
  initialize() {
    if (this.disposed) return Promise.resolve();
    if (this.ready) { this.core.mixerResume(); return Promise.resolve(); }
    return this.preload().then(() => { if (this.ready) this.core.mixerResume(); });
  }

  description(path) {
    if (!this.ready || this.missing.has(path)) return;
    if (!this.descriptions.has(path)) {
      const out = {};
      const result = this.system.getEvent(path, out);
      if (result !== this.module.OK) {
        // Bank 全部装完仍找不到：只报一次，之后每帧的调用静默跳过
        if (this.complete) this.missing.add(path);
        throw new Error(`FMOD event missing: ${path} (${this.module.ErrorString(result)})`);
      } else this.descriptions.set(path, out.val);
    }
    return this.descriptions.get(path);
  }

  instance(path) {
    const desc = this.description(path);
    if (!desc) return;
    const out = {};
    this.check(desc.createInstance(out), `instance ${path}`);
    return out.val;
  }

  // position：3D 事件的世界坐标（米）
  play({ path, volume, pitch = 1, parameters = {}, position }) {
    const inst = this.instance(path);
    if (!inst) return;
    try {
      if (position) this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
      // 不传 volume 就完全沿用 Bank；仅供试听工具显式设置实例增益。
      if (volume !== undefined) this.check(inst.setVolume(volume), `volume ${path}`);
      this.check(inst.setPitch(pitch), `pitch ${path}`);
      for (const [name, value] of Object.entries(parameters)) {
        this.check(inst.setParameterByName(name, value, false), `parameter ${name}`);
      }
      this.check(inst.start(), `start ${path}`);
      this.oneShots.add(inst);
    } catch (error) { inst.release(); throw error; }
  }

  // 对话实例持有到结束；停止 / 失败都会 settle，不能让剧情永远等不到。
  playVoice(path, paused = false) {
    const inst = this.instance(path);
    if (!inst) return null;
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    const finish = (ok) => {
      if (!this.voices.delete(inst)) return;
      inst.release();
      settle(ok);
    };
    this.voices.set(inst, finish);
    try {
      this.check(inst.setPaused(paused), `pause ${path}`);
      this.check(inst.start(), `voice ${path}`);
    } catch (error) { finish(false); throw error; }
    return { done, stop: () => {
      if (!this.voices.has(inst)) return;
      try { inst.stop(this.module.STUDIO_STOP_IMMEDIATE); } finally { finish(false); }
    } };
  }

  setVoicesPaused(paused) {
    for (const inst of this.voices.keys()) this.check(inst.setPaused(paused), 'pause dialogue');
  }

  // 循环事件：触发一次后由 FMOD 的 Loop Region 一直循环。position 给 3D 事件定位
  startLoop(path, position) {
    if (!this.ready) return;
    let inst = this.loops.get(path);
    if (inst) {
      if (this.prepared.has(path)) {
        if (position) this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
        this.resume(path, inst);
      }
      return inst;
    }
    inst = this.instance(path);
    if (!inst) return;
    try {
      if (position) this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
      this.check(inst.start(), `loop ${path}`);
    } catch (error) { inst.release(); throw error; }
    this.loops.set(path, inst);
    return inst;
  }

  // 预先开始一个循环但保持暂停：流式素材在加载界面就打开，之后 startLoop / moveLoop 只取消暂停
  prepareLoop(path, position) {
    if (!this.ready || this.loops.has(path)) return this.loops.get(path);
    const inst = this.prepareInstance(path, position);
    if (!inst) return;
    this.loops.set(path, inst);
    this.prepared.add(path);
    return inst;
  }

  // 暂停状态下开始的实例（调用方自己管理，比如多实例的雨打楼体）
  prepareInstance(path, position, setup) {
    const inst = this.instance(path);
    if (!inst) return;
    try {
      if (position) this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
      setup?.(inst);
      this.check(inst.setPaused(true), `pause ${path}`);
      this.check(inst.start(), `prepare ${path}`);
    } catch (error) { inst.release(); throw error; }
    return inst;
  }

  resume(path, inst) {
    if (this.prepared.delete(path)) this.check(inst.setPaused(false), `resume ${path}`);
  }

  // 跟着物体移动的声源：更新已启动实例的位置（预备好的实例同时取消暂停）
  moveLoop(path, position) {
    const inst = this.loops.get(path);
    if (!inst) return;
    this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
    this.resume(path, inst);
  }

  stopLoop(path, immediate = false) {
    const inst = this.loops.get(path);
    if (!inst) return;
    this.prepared.delete(path);
    inst.stop(immediate ? this.module.STUDIO_STOP_IMMEDIATE : this.module.STUDIO_STOP_ALLOWFADEOUT);
    inst.release();
    this.loops.delete(path);
  }

  // 3D 属性：position / forward / up 为 {x, y, z}，速度恒为 0（环境声源静止，不做多普勒）
  fill(position, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 }) {
    const a = this.attributes;
    for (const [key, v] of [['position', position], ['forward', forward], ['up', up]]) {
      a[key].x = v.x; a[key].y = v.y; a[key].z = v.z;
    }
    a.velocity.x = a.velocity.y = a.velocity.z = 0;
    return a;
  }

  setListener(position, forward, up) {
    if (this.ready) this.check(this.system.setListenerAttributes(0, this.fill(position, forward, up), null), 'listener');
  }

  // Snapshot：start 时 AHDSR 淡入强度，stop(ALLOWFADEOUT) 时淡出
  setSnapshot(path, on) {
    if (!this.ready) return;
    const inst = this.snapshots.get(path);
    if (on && !inst) {
      const next = this.instance(path);
      try { this.check(next.start(), `snapshot ${path}`); } catch (error) { next.release(); throw error; }
      this.snapshots.set(path, next);
    } else if (!on && inst) {
      inst.stop(this.module.STUDIO_STOP_ALLOWFADEOUT);
      inst.release();
      this.snapshots.delete(path);
    }
  }

  vca(path) {
    if (!this.vcas.has(path)) {
      const out = {};
      this.check(this.system.getVCA(path, out), `vca ${path}`);
      this.vcas.set(path, out.val);
    }
    return this.vcas.get(path);
  }

  setVcaVolume(path, volume) {
    if (this.ready) this.check(this.vca(path).setVolume(Math.max(0, Math.min(1, volume))), `vca ${path}`);
  }

  getVcaVolume(path) {
    if (!this.ready) return 1;
    const out = {};
    this.check(this.vca(path).getVolume(out, {}), `vca ${path}`);
    return out.val;
  }

  setMuted(muted) {
    if (!this.ready) return;
    this.check(this.master.setMute(muted), 'mute');
    this.check(this.master.setPaused(muted), 'pause');
    this.update(); // 后台没有渲染帧也必须提交静音
  }

  setVolume(volume) {
    if (this.ready) this.check(this.master.setVolume(Math.max(0, Math.min(1, volume))), 'master volume');
  }

  stopOneShots() {
    for (const inst of this.oneShots) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      inst.release();
    }
    this.oneShots.clear();
  }

  update() {
    if (!this.ready) return;
    this.check(this.system.update(), 'update');
    for (const inst of this.oneShots) {
      const state = {};
      const result = inst.getPlaybackState(state);
      if (result === this.module.OK && state.val === this.module.STUDIO_PLAYBACK_STOPPED) {
        inst.release();
        this.oneShots.delete(inst);
      }
    }
    for (const [inst, finish] of this.voices) {
      const state = {};
      const result = inst.getPlaybackState(state);
      if (result !== this.module.OK) finish(false);
      else if (state.val === this.module.STUDIO_PLAYBACK_STOPPED) finish(true);
    }
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.stopOneShots();
    for (const [inst, finish] of this.voices) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      finish(false);
    }
    for (const inst of this.loops.values()) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      inst.release();
    }
    this.loops.clear();
    this.prepared.clear();
    for (const inst of this.snapshots.values()) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      inst.release();
    }
    this.snapshots.clear();
    this.vcas.clear();
    this.descriptions.clear();
    this.system?.release();
    this.system = this.core = this.master = undefined;
    this.fetches = undefined;
    this.banks = [];
  }
}
