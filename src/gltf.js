import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// 所有 GLB 共用的加载器：Draco 网格 + KTX2 贴图（scripts/ktx2.mjs 转的 Basis Universal）
// 解码器各自开 Worker，全局共用一份，不再每次加载新建 / 销毁
// 解码器 wasm 用 three 自带的默认路径（new URL(..., import.meta.url)），Vite 会打包进 dist/assets
// KTX2 要知道显卡支持哪些压缩格式，必须等 WebGPU 初始化完：main.js 创建渲染器后马上调用 initGLTF(renderer)
// 在那之前发起的贴图请求会排队，等 detectSupport 之后再开始

let resolveReady;
const ready = new Promise((res) => { resolveReady = res; });

// 同一个 URL 只下载、转码一次：楼体 GLB 共用 bldg/tex/ 下的贴图文件
const cache = new Map();
class SharedKTX2Loader extends KTX2Loader {
  load(url, onLoad, onProgress, onError) {
    const key = this.manager.resolveURL(this.path + url);
    let job = cache.get(key);
    if (!job) {
      job = ready.then(() => new Promise((res, rej) => super.load(url, res, onProgress, rej)));
      cache.set(key, job);
    }
    job.then(onLoad, onError);
  }
}

const draco = new DRACOLoader();
const ktx2 = new SharedKTX2Loader();

export function initGLTF(renderer) {
  renderer.init().then(() => {
    ktx2.detectSupport(renderer);
    resolveReady();
  }).catch((e) => console.error('KTX2 support detection failed', e));
}

export function gltfLoader() {
  return new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
}

// 单张 KTX2 贴图（public/assets 下），返回 Promise<CompressedTexture>
export function loadKTX2(url) {
  return new Promise((res, rej) => ktx2.load(url, res, undefined, rej));
}
