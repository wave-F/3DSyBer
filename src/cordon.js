import * as THREE from 'three/webgpu';
import {
  uv, vec2, vec3, float, uniform, texture, fract, sin, mod, select, max, exp, smoothstep, step, color,
} from 'three/tsl';
import { DECK_Y, HALF_W } from './bridge.js';
import { gameTime } from './investigation/clock.js';
import { sound } from './audio/sound.js';
import { onLang, tx } from './i18n.js';

// 调查区域边界：两个龙门路牌（z = -48 / 70）往里缩 2 m，立全息封锁屏障
export const CORDON = { z0: -46, z1: 68 };
export const CORDON_MARGIN = 0.8; // 玩家离屏障的最近距离

const W = HALF_W * 2 - 0.6;   // 屏障宽度
const H = 2.6;                // 屏障高度
const HEX = 0xff2236;         // 警告红：和满街的青色/粉色霓虹区分开

// 滚动文字（透明底，用 alpha 当遮罩）
function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 128;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  const paint = () => {
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.font = 'bold 54px "Menlo", "PingFang SC", monospace';
    g.fillText(tx('// RESTRICTED AREA  调查封锁区  公序 COS-7731  禁止越过  ', '// RESTRICTED AREA  CRIME SCENE  COS-7731  DO NOT CROSS  '), 30, 66);
    t.needsUpdate = true;
  };
  paint();
  onLang(paint);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// 全息屏障材质：六边形网格 + 细扫描线 + 上扫光带 + 滚动文字 + 偶发故障闪烁
// 远处几乎只剩轮廓，玩家靠近才逐渐显现；所有亮度都低于辉光阈值（1.3），不会发光晕
function barrierMaterial(tex, phase) {
  const near = uniform(0);   // 0 远 → 1 贴近
  const hitX = uniform(0.5); // 玩家在屏障上的横向位置（uv.x）
  const t = gameTime.add(phase);

  const u = uv();
  const glitch = step(fract(t.mul(0.17)), float(0.03));
  const p = vec2(u.x.mul(W).add(glitch.mul(sin(u.y.mul(60).add(t.mul(80))).mul(0.08))), u.y.mul(H));

  // 六边形网格（约 25 cm 一格）
  const q = p.mul(4);
  const r = vec2(1, 1.732), h = r.mul(0.5);
  const a = mod(q, r).sub(h);
  const b = mod(q.sub(h), r).sub(h);
  const gv = select(a.dot(a).lessThan(b.dot(b)), a, b).abs();
  const hex = smoothstep(0.43, 0.5, max(gv.x.mul(0.5).add(gv.y.mul(0.866)), gv.x));

  const scan = sin(p.y.mul(140)).mul(0.5).add(0.5);
  const sweep = fract(p.y.mul(0.35).sub(t.mul(0.5))).pow(10);
  const rim = smoothstep(0.025, 0.0, u.y).add(smoothstep(0.975, 1.0, u.y));

  // 中间一条文字横幅
  const tv = u.y.sub(0.5).div(0.11).add(0.5);
  const inBand = step(0, tv).mul(step(tv, 1));
  const text = texture(tex, vec2(u.x.mul(W / 7).sub(t.mul(0.04)), tv)).a.mul(inBand);
  const bandEdge = smoothstep(0.04, 0, tv.abs()).add(smoothstep(0.04, 0, tv.sub(1).abs()));

  // 玩家贴近处的波纹光斑
  const d2 = p.x.sub(hitX.mul(W)).pow(2).add(p.y.sub(1.5).pow(2));
  const spot = exp(d2.mul(-1.2)).mul(near);
  const ripple = sin(d2.sqrt().mul(9).sub(t.mul(6))).mul(0.5).add(0.5).pow(4).mul(spot);

  const vis = near.mul(0.4).add(0.3);
  const k = hex.mul(0.22).add(scan.mul(0.03)).add(sweep.mul(0.18)).add(rim.mul(0.55))
    .add(text.mul(0.6)).add(inBand.mul(0.05)).add(bandEdge.mul(0.3))
    .mul(vis).mul(glitch.mul(-0.6).add(1))
    .add(spot.mul(hex.mul(0.25).add(0.03))).add(ripple.mul(0.12));

  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.fog = false;
  m.colorNode = color(HEX).mul(k);
  m.userData = { near, hitX };
  return m;
}

export function buildCordon(scene) {
  const tex = bannerTexture();
  const group = new THREE.Group();
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.4, metalness: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX).multiplyScalar(0.9) });
  const floorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX).multiplyScalar(0.5) });

  const barriers = [];
  for (const [z, out] of [[CORDON.z0, -1], [CORDON.z1, 1]]) {
    const mat = barrierMaterial(tex, out > 0 ? 37 : 0);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    wall.position.set(0, DECK_Y + H / 2, z);
    if (out > 0) wall.rotation.y = Math.PI; // 正面（文字）朝向场内
    group.add(wall);
    barriers.push({ z, out, mat });

    // 两侧投射立柱：深色金属 + 朝内一条细光带 + 顶部投射头
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.12);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.16, H + 0.3, 0.22), pylonMat);
      pylon.position.set(x, DECK_Y + (H + 0.3) / 2, z);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, H - 0.2, 0.05), glowMat);
      strip.position.set(x - s * 0.09, DECK_Y + H / 2, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.34), pylonMat);
      head.position.set(x, DECK_Y + H + 0.36, z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.5), pylonMat);
      base.position.set(x, DECK_Y + 0.04, z);
      group.add(pylon, strip, head, base);
    }
    // 地面发射槽
    const slot = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, 0.06), floorMat);
    slot.position.set(0, DECK_Y + 0.01, z);
    group.add(slot);
  }
  scene.add(group);

  // 靠近边界时的提示
  const hint = document.createElement('div');
  const paintHint = () => { hint.textContent = tx('// 调查封锁区 · 请返回事故现场', '// RESTRICTED AREA · RETURN TO THE SCENE'); };
  paintHint();
  onLang(paintHint);
  hint.style.cssText = 'position:fixed;left:50%;top:62%;transform:translateX(-50%);padding:6px 16px;'
    + 'border-left:2px solid #ff2236;background:rgba(24,0,4,0.5);color:#ff5a66;'
    + 'font:13px Menlo,"PingFang SC",monospace;letter-spacing:2px;pointer-events:none;opacity:0;transition:opacity 0.3s';
  document.body.appendChild(hint);
  let warned = false;   // 提示出现时响一次警告；退到 3.5 m 外再靠近才重新响

  return function update(dt, playerPos) {
    let minD = Infinity;
    for (const { z, out, mat } of barriers) {
      const d = Math.abs(playerPos.z - z);
      minD = Math.min(minD, d);
      const target = THREE.MathUtils.smoothstep(8, 1, d); // 8 m 外最淡，1 m 内最亮
      const { near, hitX } = mat.userData;
      near.value += (target - near.value) * Math.min(1, dt * 5);
      const ux = playerPos.x / W + 0.5;
      hitX.value = out > 0 ? 1 - ux : ux;
    }
    hint.style.opacity = minD < 2.5 ? '1' : '0';
    if (minD < 2.5 && !warned && dt > 0) { warned = true; sound.play('ui/warning'); }
    else if (minD > 3.5) warned = false;
  };
}
