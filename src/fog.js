// 雾：距离雾（材质里按距离、高度混雾色）+ 体积雾（后期里沿视线累加雾里的灯光散射）
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, uniformArray, reference, float, int, vec2, vec3, vec4, color, fog, output,
  exp, mix, smoothstep, dot, atan, tan, cos, positionView, positionWorld, cameraPosition, texture3D,
  screenUV, screenCoordinate, interleavedGradientNoise, getViewPosition, perspectiveDepthToViewZ, rtt,
} from 'three/tsl';
import { gameTime } from './investigation/clock.js';
import { DECK_Y } from './bridge.js';
import { addLightGroup } from './debugLights.js';

// 地平线、远雾、桥面雾共用。冷灰，不再用以前的灰绿 0x1b2726。
export const FOG_HEX = 0x161a1e;

// ---------- 可调参数 ----------
// 开发态右下角「测试 · 雾」面板能实时拖动，调好后点「复制参数」把数值贴回这里
export const FOG = {
  // 距离雾
  haze: 0.0045,          // 远景雨霾密度（相机所在高度，每米）
  hazeMax: 0.9,          // 远景雨霾最多盖住多少（留一点远处剪影和灯光）
  hazeFalloff: 0.006,    // 雨霾随高度变薄（每米）：越大楼顶越清楚、桥下越浓。0 = 不随高度变
  low: 0.03,             // 贴地低雾密度（每米）
  lowMax: 0.85,          // 贴地低雾最多盖住多少
  lowTop: 26,            // 贴地低雾从这个高度开始出现（米）
  lowBottom: 6,          // 到这个高度最浓（米）
  drift: 0.35,           // 雾的浓淡起伏，0 = 均匀
  driftSize: 140,        // 起伏团块大小（米）
  glowFade: 1,           // 自发光招牌、全息随距离变暗的程度，0 = 不变暗
  // 体积雾
  density: 0.024,        // 桥面高度的雾密度（每米）。整体浓淡主要调这个
  heightFalloff: 0.035,  // 往上变薄的速度（每米），桥面以上约 1 / 这个值 米变成三分之一
  ambient: 3.5,          // 底雾亮度：没有灯的地方，雾被城市天光映出的灰绿
  scatter: 1.2,          // 灯光散射强度：灯周围的光晕和路灯光锥有多亮
  anisotropy: 0.45,      // 前向散射（-0.9 ~ 0.9）：越大迎着灯看光晕越集中，背着灯越暗
  extinction: 0.012,     // 雾里的光传多远就衰减掉（每米）
  noise: 0.8,            // 雾团的浓淡起伏，0 = 均匀
  noiseSize: 36,         // 雾团大小（米）
  wind: 1,               // 雾团随风飘动的速度倍数
  coneAngle: 52,         // 路灯光锥半角（度）
  coneSoft: 18,          // 光锥边缘过渡（度）
  coneOmni: 0.12,        // 路灯光锥外还剩多少光（灯头本身的光晕）
  maxDist: 90,           // 底雾算到多远（米），再远交给距离雾
};
// 画质与性能：res / lightSteps / maxLights 可运行时切换（main.js 的画质档位），下面是上限
const AMB_STEPS = 12;     // 底雾沿视线采样次数
const LIGHT_STEPS = 6;    // 每盏灯沿视线采样次数上限（着色器按这个展开）
const MAX_LIGHTS = 24;    // 同时参与散射的灯数上限（uniform 数组长度）
export const FOG_QUALITY = { res: 0.33, lightSteps: 4, maxLights: 12 };
const WIND = new THREE.Vector3(1.2, -0.5, 0.5);   // 雾团飘动方向（米 / 秒），和雨的风向一致

const U = {};
for (const k in FOG) U[k] = uniform(FOG[k]);
const distOn = uniform(1);
const volOn = uniform(1);
const windDrift = uniform(new THREE.Vector3());   // 累计风向位移，倍速变化时不跳
let windTime = 0;
const EYE_Y = DECK_Y + 1.7;

// 可平铺的 3D 值噪声（三层叠加），雾团用
const noiseTex = (() => {
  const N = 64;
  const acc = new Float32Array(N * N * N);
  let seed = 20771;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [cells, amp] of [[4, 0.55], [8, 0.3], [16, 0.15]]) {
    const lat = new Float32Array(cells ** 3).map(() => rand());
    const at = (x, y, z) => lat[(z % cells) * cells * cells + (y % cells) * cells + (x % cells)];
    const k = cells / N;
    const sm = (t) => t * t * (3 - 2 * t);
    let i = 0;
    for (let z = 0; z < N; z++) {
      const fz = z * k, iz = Math.floor(fz), tz = sm(fz - iz);
      for (let y = 0; y < N; y++) {
        const fy = y * k, iy = Math.floor(fy), ty = sm(fy - iy);
        for (let x = 0; x < N; x++, i++) {
          const fx = x * k, ix = Math.floor(fx), tx = sm(fx - ix);
          const a = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * tx;
          const b = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * tx;
          const c = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * tx;
          const d = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * tx;
          const ab = a + (b - a) * ty, cd = c + (d - c) * ty;
          acc[i] += (ab + (cd - ab) * tz) * amp;
        }
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const data = new Uint8Array(acc.length);
  for (let i = 0; i < acc.length; i++) data[i] = Math.round((acc[i] - lo) / (hi - lo) * 255);
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
})();
const noiseAt = (p) => texture3D(noiseTex, p).level(0).r;

// ---------- 距离雾 ----------
// 雨霾：密度随高度指数变薄，沿视线积分（解析解）；贴地低雾：桥下街道一层
const fogDist = positionView.z.negate();
const drift = noiseAt(positionWorld.add(windDrift.mul(2)).div(U.driftSize)).sub(0.5).mul(3).mul(U.drift).add(1).max(0);
const kdy = positionWorld.y.sub(cameraPosition.y).mul(U.hazeFalloff);
const kdySafe = kdy.abs().max(1e-4).mul(kdy.greaterThanEqual(0).select(1, -1));
const heightAvg = float(1).sub(exp(kdySafe.negate())).div(kdySafe);
const hazeOD = fogDist.mul(U.haze).mul(exp(cameraPosition.y.sub(EYE_Y).mul(U.hazeFalloff).negate())).mul(heightAvg).mul(drift);
const haze = float(1).sub(exp(hazeOD.negate())).mul(U.hazeMax);
const low = float(1).sub(exp(fogDist.mul(U.low).mul(drift).negate()))
  .mul(smoothstep(U.lowTop, U.lowBottom, positionWorld.y)).mul(U.lowMax);
const fogFactor = float(1).sub(float(1).sub(haze).mul(float(1).sub(low))).mul(distOn);

export const distanceFog = fog(color(FOG_HEX), fogFactor);

// 不参与雾的自发光材质（加法混合的招牌、全息）：只按距离变暗，不叠雾色，避免出现雾色方框
const glowFade = mix(float(1), float(1).sub(fogFactor), U.glowFade);
export function fadeWithDistance(material) {
  material.outputNode = vec4(output.rgb.mul(glowFade), output.a);
  return material;
}

// ---------- 体积雾 ----------
function density(p) {
  const q = p.add(windDrift);
  const n = noiseAt(q.div(U.noiseSize)).mul(0.65)
    .add(noiseAt(q.add(windDrift.mul(0.6)).div(U.noiseSize.mul(0.37)).add(vec3(0.31, 0.17, 0.73))).mul(0.35));
  const h = exp(p.y.sub(DECK_Y).mul(U.heightFalloff).negate()).min(4);
  return U.density.mul(h).mul(n.sub(0.5).mul(3).mul(U.noise).add(1).max(0));
}

// Henyey-Greenstein 相位函数
function phase(cosT) {
  const g = U.anisotropy;
  const g2 = g.mul(g);
  return g2.oneMinus().div(g2.add(1).sub(g.mul(2).mul(cosT)).pow(1.5).mul(4 * Math.PI));
}

/**
 * 体积雾后期：半分辨率沿视线采样，遇到场景深度就停；按深度联合双边上采样回全分辨率。
 * 只加散射光，不压暗画面（压暗交给距离雾），因此不会和不写深度的全息、招牌冲突。
 * 灯光每帧从场景里的点光源读取（颜色、亮度、位置），userData.fogCone 的灯按向下的光锥算。
 */
export function createVolumetricFog({ scene, camera, renderer, depthNode }) {
  const lightPos = uniformArray(Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()), 'vec4');
  const lightCol = uniformArray(Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()), 'vec4');
  const lightCount = uniform(0, 'int');
  const lightSteps = uniform(FOG_QUALITY.lightSteps, 'int');
  const camWorld = uniform(new THREE.Matrix4());
  const camPos = uniform(new THREE.Vector3());
  const projInv = uniform(camera.projectionMatrixInverse);
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const lowSize = uniform(new THREE.Vector2(1, 1));
  const ambientColor = color(FOG_HEX);

  const march = Fn(() => {
    const depth = depthNode.sample(screenUV).r;
    const viewPos = getViewPosition(screenUV, depth, projInv).toVar();
    const viewDist = viewPos.length().toVar();
    const rd = camWorld.mul(vec4(viewPos.div(viewDist), 0)).xyz.normalize().toVar();
    const ro = camPos;
    const tEnd = viewDist.min(600).toVar();
    const jitter = interleavedGradientNoise(screenCoordinate).toVar();

    // 底雾：近处密、远处疏的二次分布
    const tAmb = tEnd.min(U.maxDist);
    const amb = float(0).toVar();
    for (let i = 0; i < AMB_STEPS; i++) {
      const u = jitter.add(i).div(AMB_STEPS);
      const s = u.mul(u).mul(tAmb);
      const ds = u.mul(tAmb).mul(2 / AMB_STEPS);
      amb.addAssign(density(ro.add(rd.mul(s))).mul(exp(s.mul(U.extinction).negate())).mul(ds));
    }

    // 灯光：只在光源作用球与视线相交的那段里采样，按角度均分（equiangular），近灯不出噪点
    const coneOuter = cos(U.coneAngle.add(U.coneSoft.mul(0.5)).mul(Math.PI / 180));
    const coneInner = cos(U.coneAngle.sub(U.coneSoft.mul(0.5)).max(0).mul(Math.PI / 180));
    const lit = vec3(0).toVar();
    Loop({ start: int(0), end: lightCount, type: 'int', condition: '<' }, ({ i }) => {
      const lp = lightPos.element(i);
      const lc = lightCol.element(i);
      const range = lp.w;
      const toL = lp.xyz.sub(ro);
      const tc = dot(toL, rd).toVar();
      const D2 = dot(toL, toL).sub(tc.mul(tc)).max(0).toVar();
      const half = range.mul(range).sub(D2).max(0).sqrt();
      const t0 = tc.sub(half).max(0).toVar();
      const t1 = tc.add(half).min(tEnd).toVar();
      If(D2.lessThan(range.mul(range)).and(t1.greaterThan(t0)), () => {
        const D = D2.sqrt().max(0.25).toVar();
        const a0 = atan(t0.sub(tc).div(D)).toVar();
        const a1 = atan(t1.sub(tc).div(D)).toVar();
        const j0 = jitter.add(float(i).mul(0.618)).fract();
        const sum = float(0).toVar();
        const steps = float(lightSteps);
        for (let k = 0; k < LIGHT_STEPS; k++) {
          If(int(k).lessThan(lightSteps), () => {
            const t = tc.add(D.mul(tan(mix(a0, a1, j0.add(k).div(steps)))));
            const p = ro.add(rd.mul(t));
            const v = p.sub(lp.xyz);
            const d = v.length().max(0.05);
            const dir = v.div(d);
            const win = d.div(range).pow(4).oneMinus().clamp(0, 1).pow(2);
            const cone = mix(float(1), mix(U.coneOmni, float(1), smoothstep(coneOuter, coneInner, dir.y.negate())), lc.w);
            sum.addAssign(density(p).mul(phase(dot(dir, rd.negate()))).mul(win).mul(cone).mul(exp(t.mul(U.extinction).negate())));
          });
        }
        // f / pdf：1/d² 与角度均分的概率密度相消，只剩 (a1 - a0) / D
        lit.addAssign(lc.xyz.mul(sum.mul(a1.sub(a0)).div(D.mul(steps))));
      });
    });

    const radiance = lit.mul(U.scatter).add(ambientColor.mul(amb).mul(U.ambient));
    return vec4(radiance, viewPos.z.negate());
  });

  const volTex = rtt(march(), null, null, { type: THREE.HalfFloatType }).setResolutionScale(FOG_QUALITY.res);

  // 联合双边上采样：3×3 低分辨率邻域，按深度差拒绝跨边缘的样本，同时抹平抖动
  const upsample = Fn(() => {
    const z = perspectiveDepthToViewZ(depthNode.sample(screenUV).r, near, far).negate().toVar();
    const lc = screenUV.mul(lowSize).sub(0.5).toVar();
    const c = lc.add(0.5).floor().toVar();
    const f = lc.sub(c).toVar();
    const sum = vec3(0).toVar();
    const wsum = float(0).toVar();
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const o = vec2(x, y);
        const s = volTex.sample(c.add(o).add(0.5).div(lowSize));
        const e = o.sub(f);
        const w = exp(dot(e, e).mul(-0.8)).mul(exp(s.a.sub(z).abs().div(z.mul(0.06).add(0.1)).negate()).add(1e-3));
        sum.addAssign(s.rgb.mul(w));
        wsum.addAssign(w);
      }
    }
    return sum.div(wsum).mul(volOn);
  });
  const node = vec4(upsample(), 0);

  const setOn = (on) => { volOn.value = on ? 1 : 0; volTex.autoUpdate = on; };
  addLightGroup('体积雾', setOn);
  addLightGroup('距离雾', (on) => { distOn.value = on ? 1 : 0; });
  if (import.meta.env.DEV) {
    mountPanel(setOn);
    window.__fog = { FOG, U, setVolOn: setOn, setDistOn: (on) => { distOn.value = on ? 1 : 0; } };   // 开发时截图对比用
  }

  let lights = [];
  let frame = 0;
  const _size = new THREE.Vector2();
  const _p = new THREE.Vector3();
  const pool = Array.from({ length: 64 }, () => ({ light: null, pos: new THREE.Vector3(), range: 0, key: 0 }));
  const picked = [];

  function update(dt) {
    windTime += dt * U.wind.value;
    windDrift.value.copy(WIND).multiplyScalar(windTime);
    if (!volTex.autoUpdate) return;
    // 灯是陆续加进场景的（异步模型、结局车灯），隔一阵重新收一次
    if (frame++ % 60 === 0) {
      lights = [];
      scene.traverse((o) => { if (o.isPointLight && o.userData.fog !== false) lights.push(o); });
    }
    camera.updateMatrixWorld();
    camWorld.value.copy(camera.matrixWorld);
    camPos.value.setFromMatrixPosition(camera.matrixWorld);
    renderer.getDrawingBufferSize(_size);
    const res = FOG_QUALITY.res;
    lowSize.value.set(Math.max(1, Math.floor(_size.x * res)), Math.max(1, Math.floor(_size.y * res)));

    picked.length = 0;
    const reach = U.maxDist.value * 1.5;
    for (const light of lights) {
      if (!light.visible || light.intensity <= 0 || picked.length >= pool.length) continue;
      const range = light.distance > 0 ? light.distance : 40;
      light.getWorldPosition(_p);
      const key = _p.distanceTo(camPos.value) - range;
      if (key > reach) continue;
      const e = pool[picked.length];
      e.light = light; e.pos.copy(_p); e.range = range; e.key = key;
      picked.push(e);
    }
    picked.sort((a, b) => a.key - b.key);
    const n = Math.min(picked.length, FOG_QUALITY.maxLights, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const { light, pos, range } = picked[i];
      lightPos.array[i].set(pos.x, pos.y, pos.z, range);
      const c = light.color, k = light.intensity;
      lightCol.array[i].set(c.r * k, c.g * k, c.b * k, light.userData.fogCone ? 1 : 0);
    }
    lightCount.value = n;
  }

  // 画质档位：分辨率、每灯步数、灯数上限都能运行时改，不用重编译着色器
  function setQuality(q) {
    Object.assign(FOG_QUALITY, q);
    volTex.setResolutionScale(FOG_QUALITY.res);
    lightSteps.value = Math.min(FOG_QUALITY.lightSteps, LIGHT_STEPS);
  }

  return { node, update, setQuality };
}

// ---------- 开发态调参面板 ----------
const PANEL = [
  ['距离雾', null],
  ['haze', '远景雨霾密度', 0, 0.02, 0.0001],
  ['hazeMax', '雨霾上限', 0, 1, 0.01],
  ['hazeFalloff', '雨霾随高度变薄', 0, 0.03, 0.0005],
  ['low', '贴地低雾密度', 0, 0.1, 0.001],
  ['lowMax', '低雾上限', 0, 1, 0.01],
  ['lowTop', '低雾起始高度', 0, 60, 0.5],
  ['lowBottom', '低雾最浓高度', -20, 40, 0.5],
  ['drift', '雾浓淡起伏', 0, 1, 0.01],
  ['driftSize', '起伏团块大小', 20, 400, 1],
  ['glowFade', '招牌全息随距离变暗', 0, 1, 0.01],
  ['体积雾', null],
  ['density', '雾密度', 0, 0.1, 0.001],
  ['heightFalloff', '往上变薄', 0, 0.15, 0.001],
  ['ambient', '底雾亮度', 0, 8, 0.05],
  ['scatter', '灯光散射强度', 0, 10, 0.05],
  ['anisotropy', '前向散射', -0.9, 0.9, 0.01],
  ['extinction', '光衰减', 0, 0.06, 0.001],
  ['noise', '雾团起伏', 0, 1.5, 0.01],
  ['noiseSize', '雾团大小', 5, 120, 1],
  ['wind', '飘动速度', 0, 5, 0.05],
  ['coneAngle', '路灯光锥半角', 10, 85, 1],
  ['coneSoft', '光锥边缘过渡', 0, 40, 1],
  ['coneOmni', '光锥外余光', 0, 1, 0.01],
  ['maxDist', '底雾距离', 10, 300, 1],
];

function mountPanel(setVolOn) {
  const css = 'font:13px "PingFang SC",sans-serif;color:#d7ecff;';
  const btn = document.createElement('button');
  btn.textContent = '测试 · 雾';
  btn.style.cssText = `position:fixed;right:24px;bottom:24px;transform:scale(1.5);transform-origin:right bottom;z-index:11;padding:8px 16px;letter-spacing:.1em;${css}color:#9ad7ff;background:rgba(5,12,20,.7);border:1px solid rgba(154,215,255,.6);cursor:pointer;`;
  const panel = document.createElement('div');
  panel.style.cssText = `display:none;position:fixed;right:24px;bottom:84px;z-index:11;max-height:calc(100vh - 120px);overflow:auto;padding:10px 14px;background:rgba(5,12,20,.86);border:1px solid rgba(154,215,255,.35);${css}`;
  for (const el of [btn, panel]) {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(el);
  }
  const sync = () => {
    const locked = !!document.pointerLockElement;
    btn.style.display = locked ? 'none' : '';
    if (locked) panel.style.display = 'none';
  };
  document.addEventListener('pointerlockchange', sync);
  sync();
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    btn.blur();
  });

  const toggles = document.createElement('div');
  toggles.style.cssText = 'display:flex;gap:16px;margin-bottom:6px;';
  for (const [label, set] of [['距离雾', (on) => { distOn.value = on ? 1 : 0; }], ['体积雾', setVolOn]]) {
    const l = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => set(box.checked));
    l.append(box, document.createTextNode(label));
    toggles.appendChild(l);
  }
  panel.appendChild(toggles);

  const fmt = (v, step) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step))));
  for (const [key, label, min, max, step] of PANEL) {
    if (!label) {
      const h = document.createElement('div');
      h.textContent = key;
      h.style.cssText = 'margin:10px 0 4px;color:#9ad7ff;letter-spacing:.2em;';
      panel.appendChild(h);
      continue;
    }
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:120px 160px 56px;align-items:center;gap:8px;margin:3px 0;';
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step, value: FOG[key] });
    const val = document.createElement('span');
    val.textContent = fmt(FOG[key], step);
    input.addEventListener('input', () => {
      FOG[key] = U[key].value = Number(input.value);
      val.textContent = fmt(FOG[key], step);
    });
    row.append(document.createTextNode(label), input, val);
    panel.appendChild(row);
  }

  const copy = document.createElement('button');
  copy.textContent = '复制参数';
  copy.style.cssText = `margin-top:10px;padding:4px 12px;${css}background:rgba(154,215,255,.12);border:1px solid rgba(154,215,255,.5);cursor:pointer;`;
  copy.addEventListener('click', () => {
    const text = Object.entries(FOG).map(([k, v]) => `  ${k}: ${+v.toFixed(5)},`).join('\n');
    navigator.clipboard?.writeText(text);
    console.log(text);
    copy.textContent = '已复制（也打印在控制台）';
    setTimeout(() => { copy.textContent = '复制参数'; }, 1500);
  });
  panel.appendChild(copy);
}
