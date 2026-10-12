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
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { buildBridge } from './bridge.js';
import { buildCity } from './city.js';
import { buildCrash } from './crash.js';
import { buildRain } from './rain.js';
import { createPlayer } from './player.js';
import { buildSky, FOG_HEX } from './sky.js';
import { clock, tick } from './investigation/clock.js';
import { createInvestigation } from './investigation/state.js';
import { onLightMode } from './lightMode.js';

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
  inv.tablet.uiScene.environment = hdr;   // 手和设备的金属反射
  inv.tablet.uiScene.environmentIntensity = 0.35;
  scene.environmentIntensity = 0.12;
});

buildBridge(scene);
buildCity(scene);
const crash = buildCrash(scene);
const updateSky = buildSky(scene);
const updateRain = buildRain(scene, camera);
const updatePlayer = createPlayer(camera, document.body, document.getElementById('overlay'));
const inv = createInvestigation(scene, camera, crash, updatePlayer.controls);
if (import.meta.env.DEV) { window.__cam = camera; window.__inv = inv.debug; } // 开发时截图调机位用

// ---------- 后期 ----------
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({
  output,
  normal: packNormalToRGB(normalView),
  metalrough: vec2(metalness, roughness),
  keep: float(0),   // 分析模式保留原色的遮罩，线索与全息材质写 1
}));
scenePass.getTexture('normal').type = THREE.UnsignedByteType;
scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;
scenePass.getTexture('keep').type = THREE.UnsignedByteType;

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

// 1.5 平板：举起时背景压暗虚化，叠加单独渲染的平板界面（独立场景，不会被场景遮挡）
const tabletAmt = uniform(0);
// 叠加场景（平板 + 第一人称手和扫描设备）：mask 通道标记不透明的手/设备，用来遮住背后的世界
const uiPass = pass(inv.tablet.uiScene, camera);
uiPass.setMRT(mrt({ output, mask: float(1) }));
uiPass.getTexture('mask').type = THREE.UnsignedByteType;
const uiMask = uiPass.getTextureNode('mask').r;
const blurred = gaussianBlur(hdr, null, 4, { resolutionScale: 0.25 });
hdr = mix(hdr, blurred.rgb.mul(0.16), tabletAmt);
hdr = hdr.mul(float(1).sub(uiMask)).add(uiPass.getTextureNode('output').rgb);

// 2. 辉光
const bloomPass = bloom(hdr, 0.8, 0.35, 0.85);
hdr = hdr.add(bloomPass);
// 降光版：阈值 0.85 → 1.3、强度 0.8 → 0.5，只让真正的光源发光晕
onLightMode((low) => {
  bloomPass.threshold.value = low ? 1.3 : 0.85;
  bloomPass.strength.value = low ? 0.5 : 0.8;
});

// 2.5 分析模式：灰蓝去饱和 + 世界网格 + 扫描波
hdr = inv.fx.apply(hdr, sceneDepth, scenePass.getTextureNode('keep'), uiMask);

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
  tick(dt);
  updatePlayer(dt * inv.moveScale);
  crash.update(clock.dt, clock.elapsed);
  updateRain(clock.dt);
  updateSky(clock.dt, clock.elapsed);
  inv.update(dt);
  tabletAmt.value = Math.min(1, inv.tablet.amount * 1.4);
  pipeline.render();
});
