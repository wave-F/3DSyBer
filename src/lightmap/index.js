import * as THREE from 'three/webgpu';
import { PhysicalLightingModel } from 'three/webgpu';
import {
  texture, uv, uniform, vec3, float, mix, lights, normalView, roughness,
  diffuseContribution, specularColorBlended, positionViewDirection, BRDF_GGX,
  materialColor, materialMetalness, materialRoughness,
} from 'three/tsl';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { buildLightmapUV } from './charts.js';
import { gameTime } from '../investigation/clock.js';
import { addLightGroup } from '../debugLights.js';

// 预烘焙光照图：静态物体的漫反射（直接光 + 间接光 + 阴影 + AO）离线用 Cycles 算好
// 流程见 docs/systems/lightmap.md：bake.html 导出静态场景 → tools/blender/scene_bake.py 烘焙 → public/assets/lightmap/
// 运行时：
//   - 静态表面的漫反射只来自光照图，环境图只留高光
//   - userData.lightmap = 'bake'（路灯，烘焙时作为光源）/ 'spec'（大屏补光）的灯，漫反射已在光照图里，
//     静态表面上只算高光（湿路面亮斑）；其余实时灯（火光、双闪、警灯）照常计算
//   - 广告大屏的光按屏单独烘成一个通道，运行时乘上当前广告颜色
//   - KB3D 近景楼共用一张图集，每栋楼在图集里的位置按物体传入（userData.lmRect）

const BASE = `${import.meta.env.BASE_URL}assets/lightmap/`;

export const lightmapState = {
  active: false,          // 光照图已加载并启用
  exposure: uniform(1),   // 光照图整体亮度
  clay: uniform(0),       // 调试：1 = 静态表面换成统一灰色、去掉高光，只看光照（开发态 window.__lm.clay.value = 1）
  manifest: null,
};
if (import.meta.env.DEV) window.__lm = lightmapState;

let screenSlots = [];

// manifest 一开始就去取，模型楼加载时要用里面每栋楼的图集位置
export const manifestReady = fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((m) => {
    lightmapState.manifest = m;
    if (m) {
      lightmapState.exposure.value = m.exposure ?? 1;
      screenSlots = (m.screens ?? []).slice(0, 4);
    }
    else console.warn('[lightmap] 没有光照图（public/assets/lightmap/manifest.json），使用实时光照');
    return m;
  });

// 代码生成的图集登记：名字 → { meshes, info }
const atlases = new Map();
// 共享贴图节点：先放 1×1 占位，加载后换 value
const blank = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
blank.needsUpdate = true;
const texNodes = new Map();
function texNode(key) {
  if (!texNodes.has(key)) texNodes.set(key, texture(blank));
  return texNodes.get(key);
}
// 大屏通道颜色：每张图集的 RGBA 四个通道对应 manifest.screens 的前四块屏
const screenColors = Array.from({ length: 4 }, () => uniform(new THREE.Color(0, 0, 0)));

// 烘焙辐照度（单位与 three 的点光一致：漫反射 = 底色 × 这个值）
export function lightmapIrradiance(atlas, lmUV = uv(1)) {
  const main = texNode(atlas).sample(lmUV).rgb;
  const sc = texNode(`${atlas}_sc`).sample(lmUV);
  const screens = screenColors[0].mul(sc.r).add(screenColors[1].mul(sc.g)).add(screenColors[2].mul(sc.b)).add(screenColors[3].mul(sc.a));
  return main.add(screens).mul(lightmapState.exposure);
}

// 代码生成的静态网格登记一张图集并生成 uv1（buildBridge 里调用；导出页和运行时都走这里）
export function prepareLightmap(name, meshes, opts) {
  const info = buildLightmapUV(meshes, opts);
  for (const m of meshes) m.userData.lightmapAtlas = name;
  atlases.set(name, { meshes, info, opts });
  return info;
}
export function lightmapAtlases() { return atlases; }

// 静态表面的光照模型：漫反射 = 光照图；高光照常（环境反射 + 实时灯）
class BakedLightingModel extends PhysicalLightingModel {
  constructor(irradiance, aoStrength = 0.5) {
    super();
    this.baked = irradiance;
    this.aoStrength = aoStrength;
  }

  direct(params, builder) {
    const tag = params.lightNode?.light?.userData.lightmap;
    if (tag !== 'bake' && tag !== 'spec') { super.direct(params, builder); return; }
    const { lightDirection, lightColor, reflectedLight } = params;
    const irr = normalView.dot(lightDirection).clamp().mul(lightColor);
    reflectedLight.directSpecular.addAssign(irr.mul(BRDF_GGX({ lightDirection, f0: specularColorBlended, f90: 1, roughness })));
  }

  indirect(builder) {
    const ctx = builder.context;
    ctx.reflectedLight.indirectDiffuse.addAssign(this.baked.mul(diffuseContribution));
    // 环境图只要高光，漫反射部分已经在光照图里
    const ibl = ctx.iblIrradiance;
    ctx.iblIrradiance = vec3(0);
    this.indirectSpecular(builder);
    ctx.iblIrradiance = ibl;
    this.ambientOcclusion(builder);
  }

  // 屏幕空间 AO 只用来补动态物体（警车、道具）的接触阴影；静态遮蔽已经烘在图里，减半避免角落双重变暗
  ambientOcclusion(builder) {
    const { ambientOcclusion, reflectedLight } = builder.context;
    const dotNV = normalView.dot(positionViewDirection).clamp();
    const aoExp = roughness.mul(-16.0).oneMinus().negate().exp2();
    const specAO = ambientOcclusion.sub(dotNV.add(ambientOcclusion).pow(aoExp).oneMinus()).clamp();
    reflectedLight.indirectDiffuse.mulAssign(mix(float(1), ambientOcclusion, this.aoStrength));
    reflectedLight.indirectSpecular.mulAssign(mix(float(1), specAO, this.aoStrength));
  }
}

const COPY = ['color', 'map', 'roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale',
  'envMapIntensity', 'emissive', 'emissiveMap', 'emissiveIntensity', 'side'];
function bakedMaterial(src, irradiance, lightList) {
  let m;
  if (src.isNodeMaterial) m = src.clone();
  else {
    m = new THREE.MeshStandardNodeMaterial();
    for (const k of COPY) {
      if (src[k] === undefined) continue;
      if (m[k]?.isColor || m[k]?.isVector2) m[k].copy(src[k]);
      else m[k] = src[k];
    }
  }
  m.name = `${src.name || src.type}·lightmap`;
  const clay = lightmapState.clay;
  m.colorNode = mix(m.colorNode ?? materialColor, vec3(0.5), clay);
  m.metalnessNode = mix(m.metalnessNode ?? materialMetalness, float(0), clay);
  m.roughnessNode = mix(m.roughnessNode ?? materialRoughness, float(1), clay);
  m.setupLightingModel = () => new BakedLightingModel(irradiance);
  m.lightsNode = lights(lightList);
  return m;
}

async function loadEXR(file) {
  const tex = await new EXRLoader().setDataType(THREE.HalfFloatType).loadAsync(BASE + file);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// 加载光照图并替换静态材质（场景搭完后调用一次）。缺失时保持实时光照，返回 false
export async function applyLightmaps(scene) {
  const manifest = await manifestReady;
  if (!manifest) return false;

  const jobs = [];
  for (const [name, a] of Object.entries(manifest.atlases)) {
    jobs.push(loadEXR(a.file).then((t) => { texNode(name).value = t; }));
    if (a.screens) jobs.push(loadEXR(a.screens).then((t) => { texNode(`${name}_sc`).value = t; }));
  }
  await Promise.all(jobs);

  // 静态表面上要算的实时灯：场景里所有点光 / 聚光（路灯和大屏补光只算高光，见 BakedLightingModel.direct）
  const lightList = [];
  scene.traverse((o) => { if (o.isPointLight || o.isSpotLight) lightList.push(o); });

  for (const [name, a] of atlases) {
    const entry = manifest.atlases[name];
    if (!entry) continue;
    if (entry.hash !== a.info.hash) {
      console.warn(`[lightmap] 「${name}」几何体改过（${a.info.hash} ≠ ${entry.hash}），光照图过期，这部分保持实时光照。重新烘焙：npm run lightmap`);
      continue;
    }
    const irr = lightmapIrradiance(name);
    const cache = new Map();
    for (const mesh of a.meshes) {
      if (!cache.has(mesh.material)) cache.set(mesh.material, bakedMaterial(mesh.material, irr, lightList));
      mesh.material = cache.get(mesh.material);
    }
  }
  lightmapState.active = true;
  addLightGroup('烘焙光照图', (on) => { lightmapState.exposure.value = on ? manifest.exposure ?? 1 : 0; });
  return true;
}

// 动态物体（事故车、警车、碎片、道具）的环境光：封锁区里的 L2 球谐探针网格，和光照图在同一个 Cycles 场景里离线烘好
// （scene_bake.py 的 bake_probes），所以车身上的反弹光、霓虹染色和路面、墙面一致。探针外 8 m 渐隐，远处物体仍靠半球光
// 数据 probes.bin：每个探针 9 个系数 × rgb，x 最快、再 y、再 z；这里按 three LightProbeGrid 的图集格式装成 3D 贴图
export async function loadProbes(renderer, scene) {
  const manifest = await manifestReady;
  const info = manifest?.probes;
  if (!info) return null;
  const [{ LightProbeGrid }, { LightProbeGridNode, ATLAS_PADDING }] = await Promise.all([
    import('three/addons/lighting/LightProbeGrid.js'), import('three/addons/tsl/lighting/LightProbeGridNode.js'),
  ]);
  const sh = new Float32Array(await (await fetch(BASE + info.file)).arrayBuffer());
  const [nx, ny, nz] = info.res;
  const size = info.max.map((v, i) => v - info.min[i]);
  const grid = new LightProbeGrid(size[0], size[1], size[2], nx, ny, nz);
  grid.position.set(...info.min.map((v, i) => v + size[i] / 2));
  grid.updateBoundingBox();
  grid.falloff = 8;
  const pz = nz + 2 * ATLAS_PADDING;
  const data = new Uint16Array(nx * ny * pz * 7 * 4);
  for (let t = 0; t < 7; t++) {
    for (let zz = 0; zz < pz; zz++) {
      const iz = Math.min(nz - 1, Math.max(0, zz - ATLAS_PADDING));   // 首尾各一层填充，复制边上那层
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const src = ((iz * ny + iy) * nx + ix) * 27;
          const dst = ((((t * pz + zz) * ny + iy) * nx) + ix) * 4;
          for (let k = 0; k < 4; k++) {
            const f = t * 4 + k;
            data[dst + k] = THREE.DataUtils.toHalfFloat(f < 27 ? sh[src + f] : 0);
          }
        }
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, nx, ny, pz * 7);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  grid.texture = tex;
  if (renderer.library.getLightNodeClass(LightProbeGrid) === null) renderer.library.addLight(LightProbeGridNode, LightProbeGrid);
  scene.add(grid);
  addLightGroup('光照探针（动态物体）', (on) => { grid.intensity = on ? 1 : 0; });
  return grid;
}

// 每帧：大屏通道颜色跟着广告换（glowAt = ads.js 的 adGlowAt；不直接 import，避免 bridge → ads → fog → bridge 循环依赖）
const _c = new THREE.Color();
export function updateLightmaps(glowAt) {
  if (!screenSlots.length) return;
  const t = gameTime.value;
  screenSlots.forEach((s, i) => screenColors[i].value.copy(glowAt(s, t, _c)));
}

// KB3D 楼：图集里每栋楼一块 (ox, oy, sx, sy)，物体级 uniform（材质仍然共享）
const NO_RECT = new THREE.Vector4(0, 0, 0, 0);
const rectNode = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData.lmRect ?? NO_RECT);
export function buildingIrradiance() {
  return lightmapIrradiance('bldg', uv(1).mul(rectNode.zw).add(rectNode.xy));
}
export function buildingRect(manifest, name) {
  const r = manifest?.atlases?.bldg?.rects?.[name];
  return r ? new THREE.Vector4(...r) : null;
}
