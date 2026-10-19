// 加载界面必须第一个导入：在其他模块开始加载资源前挂上进度回调
import { loading } from './loading.js';
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, metalness, roughness, vec2, vec3, float, sample, uniform,
  packNormalToRGB, unpackRGBToNormal, renderOutput, screenUV, mix, smoothstep, luminance, vec4,
  builtinAOContext, rtt,
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
import { buildBridge, DECK_Y, HALF_W } from './bridge.js';
import { buildCity } from './city.js';
import { buildCrash } from './crash.js';
import { buildPoliceCar } from './policeCar.js';
import { buildRain } from './rain.js';
import { buildSmoke } from './smoke.js';
import { buildCordon, CORDON } from './cordon.js';
import { createPlayer } from './player.js';
import { createIntro } from './intro.js';
import { buildSky } from './sky.js';
import { distanceFog, createVolumetricFog } from './fog.js';
import { clock, tick } from './investigation/clock.js';
import { createInvestigation } from './investigation/state.js';
import { addLightGroup } from './debugLights.js';
import { HURT } from './investigation/finale.js';
import { sound } from './audio/sound.js';
import { AD_DWELL } from './ads.js';
import { createStaticGI } from './globalIllumination.js';
import { initGLTF } from './gltf.js';
import { applySurfaceRain, mountSurfaceRainPanel, updateSurfaceRain } from './surfaceRain.js';

// 网页一打开就装入全部 Bank 并预备好所有循环；加载界面等声音就绪后才允许点击开始
loading.waitFor(sound.preload(), '声音', 'AUDIO');
// 加载期间第一次点击 / 按键开始菜单音乐；还没就绪时的点击是无效点击
loading.onWake(() => sound.unlock());
loading.onDeny(() => sound.play('ui/deny'));

const renderer = new THREE.WebGPURenderer();
initGLTF(renderer);   // KTX2 贴图要等 WebGPU 初始化后才知道显卡支持的压缩格式
// Forward+ 分簇光照：每个像素只计算真正照到它的点光源（灯一盏不少，开销按覆盖范围算）
renderer.lighting = new ClusteredLighting(64, 32, 24, 16);
// 画质：像素比、体积雾、屏幕反射（原版 1.5 / 雾 0.5·6 步·24 灯 / 反射 80·0.5，帧率对比后定为下面这套）
const QUALITY = { pixelRatio: 1.25, fog: { res: 0.33, lightSteps: 4, maxLights: 12 }, ssr: { maxDistance: 50, quality: 0.3 } };
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.pixelRatio));
// 中间 RT（场景、AO、SSR、雾、辉光）不超过 1920×1080，避免大屏按实际像素建一堆全分辨率目标。
// 画布本身跟窗口走：最后一步全屏 quad 画到实际分辨率，铺满窗口，不留黑边
const FRAME = { w: 1920, h: 1080 };
// 中间 RT 钉死在 1920×1080（再乘各自的半分辨率系数），跟窗口无关。
// 尺寸不变时 RenderTarget.setSize 直接返回，不 dispose，所以切分辨率不会重建这些 RT。
// 窗口更小只是采样一张更大的贴图，不会按小尺寸重分配。最终 quad 仍画到画布的实际分辨率
function capScale(node, fraction, key = 'resolutionScale') {
  const pin = (target) => {
    target.x = FRAME.w * renderer.getPixelRatio();
    target.y = FRAME.h * renderer.getPixelRatio();
    if (key) node[key] = fraction;
    return target;
  };
  // SMAA / 辉光在 updateBefore 里自己取屏幕尺寸再调 setSize，包 setSize 会被绕过
  if (node.updateBefore) {
    const update = node.updateBefore.bind(node);
    node.updateBefore = (frame) => {
      const get = frame.renderer.getDrawingBufferSize.bind(frame.renderer);
      frame.renderer.getDrawingBufferSize = (target) => pin(get(target));
      try { return update(frame); }
      finally { frame.renderer.getDrawingBufferSize = get; }
    };
  }
  const orig = node.setSize.bind(node);
  node.setSize = (w, h) => orig(FRAME.w * renderer.getPixelRatio(), FRAME.h * renderer.getPixelRatio());
}
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// 距离雾：远景灰绿雨霾（随高度变薄）+ 贴地低雾，参数在 fog.js
scene.fogNode = distanceFog;

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
new HDRLoader().load(`${import.meta.env.BASE_URL}assets/shanghai_bund_1k.hdr`, (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  inv.tablet.uiScene.environment = hdr;   // 手和设备的金属反射
  inv.tablet.uiScene.environmentIntensity = 0.35;
  scene.environmentIntensity = envOn ? 0.12 : 0;
});

// 静态光照只采集桥和城市，不把演出车辆 / 警灯 / 雨 / 全息烘进去。
const staticWorld = new THREE.Group();
staticWorld.name = '桥与城市';
scene.add(staticWorld);
buildBridge(staticWorld);
// AO 只在事故现场附近看得出来（半径 0.65 m）：城市、天空只放 FAR_LAYER，主相机照画，AO 预渲染（只看 layer 0）跳过它们
const FAR_LAYER = 2;
camera.layers.enable(FAR_LAYER);
const farOnly = (root) => root.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) o.layers.set(FAR_LAYER); });
const bridgeParts = new Set(staticWorld.children);
const updateCity = buildCity(staticWorld);
// 模型楼是异步加进来的，加载完再标一遍
const markCity = () => { for (const o of staticWorld.children) if (!bridgeParts.has(o)) farOnly(o); };
markCity();
updateCity.ready.then(markCity, markCity);
// 静态探针先停用：不创建、不采集、不等待。实现仍在 globalIllumination.js，改回 true 即恢复。
const USE_STATIC_GI = false;
const gi = USE_STATIC_GI ? createStaticGI({
  scene, world: staticWorld, ambientLights: [hemi, moon], assetsReady: updateCity.ready,
  volume: {
    width: HALF_W * 2 + 6, height: 6, depth: CORDON.z1 - CORDON.z0 + 20,
    position: [0, DECK_Y + 3.3, (CORDON.z0 + CORDON.z1) / 2],
  },
}) : null;
if (gi) {
  loading.waitFor(gi.ready, '静态全局光照', 'STATIC GLOBAL ILLUMINATION');
  if (import.meta.env.DEV) window.__gi = gi;
  // 暂停时右上角直接切换，方便和关灯后的画面对比。正式构建没有这个按钮。
  let giOn = true;
  let giButton = null;
  addLightGroup('全局光照（静态探针）', (on) => {
    giOn = on;
    gi.setEnabled(on);
    if (giButton) giButton.textContent = `测试 · 静态光照：${on ? '开' : '关'}`;
  });
  if (import.meta.env.DEV) {
    giButton = document.createElement('button');
    giButton.textContent = '测试 · 静态光照：开';
    giButton.style.cssText = 'position:fixed;right:24px;top:364px;transform:scale(1.5);transform-origin:right top;z-index:12;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#9ad7ff;background:rgba(5,12,20,.7);border:1px solid rgba(154,215,255,.6);cursor:pointer;';
    document.body.appendChild(giButton);
    giButton.addEventListener('click', (e) => {
      e.stopPropagation();
      giOn = !giOn;
      gi.setEnabled(giOn);
      giButton.textContent = `测试 · 静态光照：${giOn ? '开' : '关'}`;
      const box = document.querySelector('[data-label="全局光照（静态探针）"] input');
      if (box) box.checked = giOn;
      giButton.blur();
    });
    const syncGiButton = () => { giButton.style.display = document.pointerLockElement ? 'none' : ''; };
    document.addEventListener('pointerlockchange', syncGiButton);
    syncGiButton();
  }
}
mountSurfaceRainPanel();
const crash = buildCrash(scene);
const police = buildPoliceCar(scene);
const beforeSky = new Set(scene.children);
const updateSky = buildSky(scene);
for (const o of scene.children) if (!beforeSky.has(o)) farOnly(o);
const updateRain = buildRain(scene, camera);
const updateCordon = buildCordon(scene);
applySurfaceRain(scene);
const playArea = { x: [-HALF_W, HALF_W], z: [CORDON.z0, CORDON.z1], y: DECK_Y + 1.7 };
sound.setRainSpots(updateCity.rainSpots, playArea);
sound.setBillboards(updateCity.adScreens, playArea, AD_DWELL);
const overlay = document.getElementById('overlay');
const updatePlayer = createPlayer(camera, document.body, overlay);
const inv = createInvestigation(scene, camera, crash, updatePlayer.controls, updatePlayer.gait);
// 加载界面点击开始：这一下是用户手势，同时启动 FMOD 并锁定鼠标
let started = false;
loading.onStart(() => {
  started = true;
  asyncPipelines = false;   // 游戏开始后恢复同步创建管线（见下方「加载期间异步编译着色器」）
  inv.warmFinale(false);
  sound.start();
  updatePlayer.controls.lock();
});
const intro = createIntro({ camera, police, controls: updatePlayer.controls, inv });
// 加载界面期间（画面被盖住）轮流摆到开场跟车的起点、终点机位，并把结局跑车放到镜头前，
// 让这些第一次出现的物体在加载时就编译好材质。否则点击开始 / 结局开始的第一帧会现场编译、卡住主线程
// 200 ms 左右；FMOD 的混音也跑在主线程，卡住时声音会重复上一小段，听起来就是卡顿。
// 加载界面会等画面连续不卡才允许点击开始，所以编译一定在开始前完成。
let warmFrame = 0;
function warmTransitions() {
  const k = Math.floor(warmFrame++ / 6) % 3;
  intro.warm(k === 1);
  inv.warmFinale(k === 2);
}
if (import.meta.env.DEV) { window.__cam = camera; window.__inv = inv.debug; window.__renderer = renderer; window.__scene = scene; window.__police = police; window.__intro = intro; } // 开发时截图调机位用

// ---------- 后期 ----------
// Separate pre-pass avoids feeding the shaded scene back into its own AO.
// AO 预渲染只画 layer 0（车、碎片、桥面护栏等近景），用独立相机：它是在 scenePass 画物体的途中被触发的，
// 同一 scene + camera 共用一份渲染列表，物体数不同会把 scenePass 正在遍历的列表改短。每帧渲染前从主相机同步
const aoCamera = new THREE.PerspectiveCamera();
function syncAoCamera() {
  camera.updateMatrixWorld();
  aoCamera.copy(camera, false);
  camera.matrixWorld.decompose(aoCamera.position, aoCamera.quaternion, aoCamera.scale);
  aoCamera.updateMatrixWorld();
  aoCamera.layers.set(0);
}
syncAoCamera();
const aoPrePass = pass(scene, aoCamera);
capScale(aoPrePass, 0.5, '_resolutionScale');
aoPrePass.transparent = false;
aoPrePass.setMRT(mrt({ output: normalView }));
const aoDepth = aoPrePass.getTextureNode('depth');
const aoNormal = aoPrePass.getTextureNode('output');
const aoPass = ao(aoDepth, aoNormal, aoCamera);
capScale(aoPass, 0.5);
aoPass.radius.value = 0.65;
aoPass.thickness.value = 0.35;
aoPass.samples.value = 16;
const aoFiltered = denoise(aoPass.getTextureNode(), aoDepth, aoNormal, aoCamera);
aoFiltered.radius.value = 3;
const aoTexture = rtt(aoFiltered);
capScale(aoTexture, 0.5, '_resolutionScale');
const aoAmount = uniform(0.65);
const scenePass = pass(scene, camera);
capScale(scenePass, 1, '_resolutionScale');
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
capScale(ssrPass, 0.5);
ssrPass.maxDistance.value = QUALITY.ssr.maxDistance;
ssrPass.thickness.value = 0.6;
ssrPass.quality.value = QUALITY.ssr.quality;
const ssrAmt = uniform(1);
let hdr = sceneColor.add(ssrPass.rgb.mul(ssrAmt));
addLightGroup('屏幕反射', (on) => { ssrAmt.value = on ? 1 : 0; });

// 1.1 烟雾粒子：独立场景、半分辨率渲染，按 alpha 盖到场景上（在辉光和分析去饱和之前）
const smoke = buildSmoke(camera, sceneDepth, scene.fogNode);
const smokePass = pass(smoke.scene, camera);
capScale(smokePass, 0.5, '_resolutionScale');
const smokeTex = smokePass.getTextureNode('output');
hdr = hdr.mul(float(1).sub(smokeTex.a)).add(smokeTex.rgb);
if (import.meta.env.DEV) window.__smoke = smoke.scene;   // 开发时截图对比用

// 1.2 体积雾：雾里的灯光散射（光晕、路灯光锥、底雾），在手和终端叠加之前
const volFog = createVolumetricFog({ scene, camera, renderer, depthNode: sceneDepth });
volFog.setQuality(QUALITY.fog);
capScale(volFog.tex, QUALITY.fog.res, '_resolutionScale');
hdr = hdr.add(volFog.node);

// 1.5 平板：举起时背景压暗虚化，叠加单独渲染的平板界面（独立场景，不会被场景遮挡）
const tabletAmt = uniform(0);
// 叠加场景（平板 + 第一人称手和扫描设备）：mask 通道标记不透明的手/设备，用来遮住背后的世界
const uiPass = pass(inv.tablet.uiScene, camera);
capScale(uiPass, 1, '_resolutionScale');
uiPass.setMRT(mrt({ output, mask: float(1) }));
uiPass.getTexture('mask').type = THREE.UnsignedByteType;
const uiMask = uiPass.getTextureNode('mask').r;
const blurred = gaussianBlur(hdr, null, 4, { resolutionScale: 0.25 });
hdr = mix(hdr, blurred.rgb.mul(0.16), tabletAmt);
hdr = mix(hdr, blurred.rgb, HURT.blur);   // 结局：被撞后视线模糊（终端在后面单独叠加，不受影响）
hdr = hdr.mul(float(1).sub(uiMask)).add(uiPass.getTextureNode('output').rgb);

// 2. 辉光
// 阈值 1.3：只让真正的光源发光晕，被照亮的地面和高光不再泛白
const bloomAmt = uniform(1);
const bloomPass = bloom(hdr, 0.5, 0.35, 1.3);
capScale(bloomPass, 0.5, '_resolutionScale');
hdr = hdr.add(bloomPass.mul(bloomAmt));
addLightGroup('辉光', (on) => { bloomAmt.value = on ? 1 : 0; });

// 2.5 分析模式：灰蓝去饱和 + 世界网格 + 扫描波
hdr = inv.fx.apply(hdr, sceneDepth, scenePass.getTextureNode('keep'), uiMask);

// 3. 调色：灰绿青色调，暗部压深，霓虹保持高饱和
const lum = luminance(hdr.rgb);
const sat = smoothstep(0.4, 2.5, lum).mul(0.25).add(0.75);   // 越亮越饱和
let graded = mix(vec3(lum), hdr.rgb, sat);
graded = graded.mul(vec3(0.9, 1.02, 0.98)).add(vec3(0.0, 0.006, 0.005).mul(float(1).sub(lum).clamp()));
graded = mix(graded, vec3(luminance(graded)).mul(vec3(1.04, 0.97, 0.96)), HURT.desat);   // 结局：失血去饱和

// 4. 色调映射后：抗锯齿 → 色差 → 暗角 → 胶片颗粒
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputColorTransform = false;
const smaaPass = smaa(renderOutput(graded));
capScale(smaaPass, 1, null);
let ldr = smaaPass;
ldr = chromaticAberration(ldr, HURT.ca, vec2(0.5, 0.5), float(0.3));
const vignette = smoothstep(0.85, 0.25, screenUV.sub(0.5).length());
ldr = ldr.mul(mix(float(0.55), float(1), vignette));
// 结局：暗角收紧（心跳）、白闪、眼皮
const edge = screenUV.sub(0.5).length();
ldr = ldr.mul(mix(float(1), smoothstep(0.72, 0.12, edge), HURT.vignette));
ldr = mix(ldr, vec4(1, 1, 1, 1), HURT.white);
const lidEdge = float(1).sub(HURT.lid).mul(0.62).sub(0.1);
ldr = ldr.mul(float(1).sub(smoothstep(lidEdge, lidEdge.add(0.1), screenUV.y.sub(0.5).abs())));
pipeline.outputNode = film(ldr, uniform(0.12));

// ---------- 加载期间异步编译着色器 ----------
// 第一次打开（显卡还没缓存着色器）时，200 多个渲染管线在 Metal 上要编译约 30 秒。three.js 默认在渲染时同步创建管线，
// GPU 进程忙着编译，主线程就跟着卡死，进度条和加载动画整段停住。
// 加载期间（点击开始前）改成异步创建：照常渲染，遇到新管线只发起异步编译，编好之前这个物体先不画（画面被加载界面盖着）。
// 渲染状态与正式渲染完全一致，编出来的管线正式渲染直接复用。点击开始后恢复同步创建，保证游戏里物体第一次出现就画出来。
let asyncPipelines = true;
let pendingPipelines = 0, createdPipelines = 0, donePipelines = 0;
let patchedPipelines = null;
// 只画一次、结果被缓存下来的渲染不能跳过，必须同步编译：环境贴图预过滤（PMREM）只在环境贴图换掉时生成一次，
// 管线没编好就跳过的话生成的是空图，之后不会重画，水面 / 湿路面反射和环境光整体变暗、雾也跟着显得不一样。
const isOneShotTarget = (rt) => !!rt && /^PMREM/.test(rt.texture?.name || '');
// renderer._pipelines 是渲染器内部对象，初始化后才有，所以每帧检查一次
function patchPipelines() {
  const target = renderer._pipelines;
  if (!target || patchedPipelines === target) return;
  patchedPipelines = target;
  const original = target.getForRender.bind(target);
  target.getForRender = (renderObject, promises = null) => {
    if (promises !== null || !asyncPipelines || isOneShotTarget(renderer.getRenderTarget())) return original(renderObject, promises);
    const queued = [];
    const result = original(renderObject, queued);
    for (const p of queued) {
      pendingPipelines++;
      createdPipelines++;
      p.finally(() => { pendingPipelines--; donePipelines++; });
    }
    return result;
  };
}
// 加载界面的预热阶段：等异步编译全部完成，且连续若干帧（覆盖一整轮开场 / 结局机位轮换）没有新管线
const IDLE_FRAMES = 30;
let idleFrames = 0, prepResolve = null;
loading.prepare((progress) => new Promise((resolve) => {
  const t0 = performance.now();
  prepResolve = () => {
    console.info(`[loading] 着色器异步编译完成：${createdPipelines} 个管线，预热阶段 ${(performance.now() - t0).toFixed(0)} ms`);
    resolve();
  };
  prepProgress = progress;
}));
let prepProgress = null, lastCreated = 0;
function trackPipelines() {
  if (!prepResolve) return;
  prepProgress?.(createdPipelines ? donePipelines / createdPipelines : 0);
  idleFrames = pendingPipelines === 0 && lastCreated === createdPipelines ? idleFrames + 1 : 0;
  lastCreated = createdPipelines;
  if (idleFrames >= IDLE_FRAMES) { const r = prepResolve; prepResolve = null; r(); }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
let pauseShown = false;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frame = (now - last) / 1000;
  const dt = Math.min(frame, 0.1);
  last = now;
  // Esc 只解锁鼠标并弹出「已暂停」。平板打开时的解锁不算暂停
  const controls = updatePlayer.controls;
  const paused = !controls.isLocked && !controls.keepOverlayHidden;
  const step = paused ? 0 : dt;
  sound.setDialoguePaused(paused);
  // 暂停层出现 / 消失：面板音 + 世界高切
  if (pauseShown !== !overlay.classList.contains('hidden')) {
    pauseShown = !pauseShown;
    sound.setPause(pauseShown);
  }
  tick(step);
  if (!started) warmTransitions();
  if (intro.playing) intro.update(step);
  else updatePlayer(step, inv.moveScale);
  updateSurfaceRain(step);
  crash.update(clock.dt, clock.elapsed);
  police.update(clock.dt, clock.elapsed);
  updateRain(clock.dt);
  smoke.update();
  updateCordon(step, camera.position);
  updateSky(clock.dt, clock.elapsed);
  updateCity();
  gi?.update(renderer);
  inv.setFps(frame);
  inv.update(step);
  sound.updateBillboards(clock.elapsed);
  sound.update(dt, camera);
  volFog.update(clock.dt);
  tabletAmt.value = Math.min(1, inv.tablet.amount * 1.4);
  syncAoCamera();
  patchPipelines();
  pipeline.render();
  trackPipelines();
});
