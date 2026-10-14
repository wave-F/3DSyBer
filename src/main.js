import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, metalness, roughness, vec2, vec3, float, sample, uniform,
  packNormalToRGB, unpackRGBToNormal, renderOutput, screenUV, mix, smoothstep, luminance,
  fog, color, exp, positionView, positionWorld, builtinAOContext, rtt,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { buildBridge } from './bridge.js';
import { buildCity } from './city.js';
import { buildCrash } from './crash.js';
import { buildPoliceCar } from './policeCar.js';
import { buildRain } from './rain.js';
import { buildCordon } from './cordon.js';
import { createPlayer } from './player.js';
import { createIntro } from './intro.js';
import { buildSky, FOG_HEX } from './sky.js';
import { clock, tick } from './investigation/clock.js';
import { createInvestigation } from './investigation/state.js';
import { addLightGroup } from './debugLights.js';

const renderer = new THREE.WebGPURenderer();
// Forward+ 分簇光照：每个像素只计算真正照到它的点光源（灯一盏不少，开销按覆盖范围算）
renderer.lighting = new ClusteredLighting(64, 32, 24, 16);
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

const hemi = new THREE.HemisphereLight(0x3a5258, 0x05070a, 0.55);
const moon = new THREE.DirectionalLight(0x8899cc, 0.3);
moon.position.set(-50, 100, 30);
scene.add(hemi, moon);
let envOn = true;
addLightGroup('环境光（天光、月光）', (on) => {
  hemi.intensity = on ? 0.55 : 0;
  moon.intensity = on ? 0.3 : 0;
});
addLightGroup('环境反射', (on) => {
  envOn = on;
  scene.environmentIntensity = on ? 0.12 : 0;
});

// 夜景 HDRI 只用作反射环境（车漆、水面），不作背景
new HDRLoader().load('/assets/shanghai_bund_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  inv.tablet.uiScene.environment = hdr;   // 手和设备的金属反射
  inv.tablet.uiScene.environmentIntensity = 0.35;
  scene.environmentIntensity = envOn ? 0.12 : 0;
});

buildBridge(scene);
const updateCity = buildCity(scene);
const crash = buildCrash(scene);
const police = buildPoliceCar(scene);
const updateSky = buildSky(scene);
const updateRain = buildRain(scene, camera);
const updateCordon = buildCordon(scene);
const updatePlayer = createPlayer(camera, document.body, document.getElementById('overlay'));
const inv = createInvestigation(scene, camera, crash, updatePlayer.controls);
const intro = createIntro({ camera, police, controls: updatePlayer.controls, inv });
if (import.meta.env.DEV) { window.__cam = camera; window.__inv = inv.debug; window.__renderer = renderer; window.__scene = scene; window.__police = police; window.__intro = intro; } // 开发时截图调机位用

// ---------- 后期 ----------
// Separate pre-pass avoids feeding the shaded scene back into its own AO.
const aoPrePass = pass(scene, camera);
aoPrePass.setResolutionScale(0.5);
aoPrePass.transparent = false;
aoPrePass.setMRT(mrt({ output: normalView }));
const aoDepth = aoPrePass.getTextureNode('depth');
const aoNormal = aoPrePass.getTextureNode('output');
const aoPass = ao(aoDepth, aoNormal, camera);
aoPass.resolutionScale = 0.5;
aoPass.radius.value = 0.65;
aoPass.thickness.value = 0.35;
aoPass.samples.value = 16;
const aoFiltered = denoise(aoPass.getTextureNode(), aoDepth, aoNormal, camera);
aoFiltered.radius.value = 3;
const aoTexture = rtt(aoFiltered).setResolutionScale(0.5);
const aoAmount = uniform(0.65);
const scenePass = pass(scene, camera);
scenePass.contextNode = builtinAOContext(mix(float(1), aoTexture.sample(screenUV).r, aoAmount));
addLightGroup('AO（车底、轮拱遮蔽）', (on) => { aoAmount.value = on ? 0.65 : 0; });
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
const ssrAmt = uniform(1);
let hdr = sceneColor.add(ssrPass.rgb.mul(ssrAmt));
addLightGroup('屏幕反射', (on) => { ssrAmt.value = on ? 1 : 0; });

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
// 阈值 1.3：只让真正的光源发光晕，被照亮的地面和高光不再泛白
const bloomAmt = uniform(1);
hdr = hdr.add(bloom(hdr, 0.5, 0.35, 1.3).mul(bloomAmt));
addLightGroup('辉光', (on) => { bloomAmt.value = on ? 1 : 0; });

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
  if (intro.playing) intro.update(dt);
  else updatePlayer(dt * inv.moveScale);
  crash.update(clock.dt, clock.elapsed);
  police.update(clock.dt, clock.elapsed);
  updateRain(clock.dt);
  updateCordon(dt, camera.position);
  updateSky(clock.dt, clock.elapsed);
  updateCity();
  inv.update(dt);
  tabletAmt.value = Math.min(1, inv.tablet.amount * 1.4);
  pipeline.render();
});
