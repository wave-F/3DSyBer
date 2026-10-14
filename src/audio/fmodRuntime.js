import { BANKS } from './events.js';

const BASE = `${import.meta.env.BASE_URL}fmod/`;
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
  descriptions = new Map();
  loops = new Map();
  snapshots = new Map();
  vcas = new Map();
  // 保留有效句柄直到 STOPPED 再 release，避免操作已释放的一次性实例。
  oneShots = new Set();

  check(result, label) {
    if (result !== this.module.OK) throw new Error(`FMOD ${label}: ${this.module.ErrorString(result)}`);
  }

  preload() {
    if (!this.loading) {
      this.loading = Promise.all([
        loadModule().then((module) => { this.module = module; }),
        Promise.all(BANKS.map(async (file) => {
          const response = await fetch(BASE + file);
          if (!response.ok) throw new Error(`FMOD bank HTTP ${response.status}: ${file}`);
          return { file, bytes: new Uint8Array(await response.arrayBuffer()) };
        })).then((banks) => { this.banks = banks; }),
      ]).catch((error) => { this.loading = undefined; throw error; });
    }
    return this.loading;
  }

  // 直接在用户手势回调中调用，已就绪时同步恢复浏览器音频输出。
  initialize() {
    if (this.disposed) return Promise.resolve();
    if (this.ready) { this.core.mixerResume(); return Promise.resolve(); }
    if (this.initializing) return this.initializing;
    const start = () => {
      if (this.disposed) return;
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
        for (const { file, bytes } of this.banks) {
          const bank = {};
          this.check(this.system.loadBankMemory(bytes, bytes.byteLength, f.STUDIO_LOAD_MEMORY, f.STUDIO_LOAD_BANK_NORMAL, bank), `load ${file}`);
          this.check(bank.val.loadSampleData(), `samples ${file}`);
        }
        const bus = {};
        this.check(this.system.getBus('bus:/', bus), 'master bus');
        this.master = bus.val;
        this.ready = true;
        this.core.mixerResume();
        this.update();
      } catch (error) {
        this.system?.release();
        this.system = this.core = this.master = undefined;
        this.ready = false;
        throw error;
      }
    };
    // 预载完成后不经过 await，保留当前点击的浏览器激活状态。
    if (this.module && this.banks) {
      try { start(); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
    }
    this.initializing = this.preload().then(start).finally(() => { this.initializing = undefined; });
    return this.initializing;
  }

  description(path) {
    if (!this.ready) return;
    if (!this.descriptions.has(path)) {
      const out = {};
      const result = this.system.getEvent(path, out);
      if (result !== this.module.OK) {
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

  play({ path, volume, pitch = 1, parameters = {} }) {
    const inst = this.instance(path);
    if (!inst) return;
    try {
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

  // 循环事件：触发一次后由 FMOD 的 Loop Region 一直循环。position 给 3D 事件定位
  startLoop(path, position) {
    if (!this.ready) return;
    let inst = this.loops.get(path);
    if (inst) return inst;
    inst = this.instance(path);
    try {
      if (position) this.check(inst.set3DAttributes(this.fill(position)), `3D ${path}`);
      this.check(inst.start(), `loop ${path}`);
    } catch (error) { inst.release(); throw error; }
    this.loops.set(path, inst);
    return inst;
  }

  stopLoop(path, immediate = false) {
    const inst = this.loops.get(path);
    if (!inst) return;
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
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.stopOneShots();
    for (const inst of this.loops.values()) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      inst.release();
    }
    this.loops.clear();
    for (const inst of this.snapshots.values()) {
      inst.stop(this.module.STUDIO_STOP_IMMEDIATE);
      inst.release();
    }
    this.snapshots.clear();
    this.vcas.clear();
    this.descriptions.clear();
    this.system?.release();
    this.system = this.core = this.master = undefined;
    this.banks = undefined;
  }
}
