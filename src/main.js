import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, metalness, roughness, vec2, vec3, float, sample, uniform,
  packNormalToRGB, unpackRGBToNormal, renderOutput, screenUV, mix, smoothstep, luminance,
  fog, color, exp, positionView, positionWorld,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { buildBridge } from './bridge.js';
import { buildCity } from './city.js';
import { buildCrash } from './crash.js';
import { buildRain } from './rain.js';
import { createPlayer } from './player.js';
import { buildSky, FOG_HEX } from './sky.js';

const renderer = new THREE.WebGPURenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// 两层雾：远景灰绿雨霾（上限 0.9，保留远处剪影和灯光）+ 贴地低雾
const dist = positionView.z.negate();
const haze = float(1).sub(exp(dist.mul(-0.0045))).mul(0.9);
const low = float(1).sub(exp(dist.mul(-0.03))).mul(smoothstep(26, 6, positionWorld.y)).mul(0.85);
scene.fogNode = fog(color(FOG_HEX), float(1).sub(float(1).sub(haze).mul(float(1).sub(low))));

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 3000);

scene.add(new THREE.HemisphereLight(0x3a5258, 0x05070a, 0.55));
const moon = new THREE.DirectionalLight(0x8899cc, 0.3);
moon.position.set(-50, 100, 30);
scene.add(moon);

// 夜景 HDRI 只用作反射环境（车漆、水面），不作背景
new HDRLoader().load('/assets/shanghai_bund_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.environmentIntensity = 0.12;
});

buildBridge(scene);
buildCity(scene);
const updateCrash = buildCrash(scene);
const updateSky = buildSky(scene);
const updateRain = buildRain(scene, camera);
if (import.meta.env.DEV) window.__cam = camera; // 开发时截图调机位用
const updatePlayer = createPlayer(camera, document.body, document.getElementById('overlay'));

// ---------- 后期 ----------
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({
  output,
  normal: packNormalToRGB(normalView),
  metalrough: vec2(metalness, roughness),
}));
scenePass.getTexture('normal').type = THREE.UnsignedByteType;
scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

const sceneColor = scenePass.getTextureNode('output');
const sceneDepth = scenePass.getTextureNode('depth');
const sceneMR = scenePass.getTextureNode('metalrough');
const sceneNormal = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uv)));

// 1. 屏幕空间反射：湿路面倒映霓虹
const ssrPass = ssr(sceneColor, sceneDepth, sceneNormal, {
  metalnessNode: sceneMR.r,
  roughnessNode: sceneMR.g,
});
ssrPass.resolutionScale = 0.5;
ssrPass.maxDistance.value = 80;
ssrPass.thickness.value = 0.6;
ssrPass.quality.value = 0.5;
let hdr = sceneColor.add(ssrPass.rgb);

// 2. 辉光
hdr = hdr.add(bloom(hdr, 0.8, 0.35, 0.85));

// 3. 调色：灰绿青色调，暗部压深，霓虹保持高饱和
const lum = luminance(hdr.rgb);
const sat = smoothstep(0.4, 2.5, lum).mul(0.25).add(0.75);   // 越亮越饱和
let graded = mix(vec3(lum), hdr.rgb, sat);
graded = graded.mul(vec3(0.9, 1.02, 0.98)).add(vec3(0.0, 0.006, 0.005).mul(float(1).sub(lum).clamp()));

// 4. 色调映射后：抗锯齿 → 色差 → 暗角 → 胶片颗粒
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputColorTransform = false;
let ldr = smaa(renderOutput(graded));
ldr = chromaticAberration(ldr, uniform(0.05), vec2(0.5, 0.5), float(0.3));
const vignette = smoothstep(0.85, 0.25, screenUV.sub(0.5).length());
ldr = ldr.mul(mix(float(0.55), float(1), vignette));
pipeline.outputNode = film(ldr, uniform(0.12));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updatePlayer(dt);
  updateCrash(dt, now / 1000);
  updateRain(dt);
  updateSky(dt, now / 1000);
  pipeline.render();
});
